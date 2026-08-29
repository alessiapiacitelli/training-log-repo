interface Window {
  APP_CONFIG?: { supabaseUrl: string; supabaseAnonKey: string };
  supabase?: any;
}

(function () {
"use strict";

/* ---------------- types ---------------- */
type Mode = "memory" | "browser" | "cloud";

interface ExerciseLog {
  done?: boolean;
  v?: string;
}

type LogFieldKey = "weight" | "waist" | "sleep" | "protein" | "cals" | "steps";

interface DayLog {
  ex?: Record<string, ExerciseLog>;
  weight?: string;
  waist?: string;
  sleep?: string;
  protein?: string;
  cals?: string;
  steps?: string;
  notes?: string;
  energy?: number;
  bm?: Record<string, number>;
  _ts?: string;
}

interface AppDB {
  logs: Record<string, DayLog>;
  best: Record<string, number>;
  start: string | null;
}

interface Hold { k: string; n: string; t: number; }
interface Bench { k: string; n: string; s: number; t: number; u: string; }
interface Prescription { 1: string; 2: string; 3: string; }
type SessionExercise = [string, Prescription];
interface Session { title: string; ex: SessionExercise[]; }
interface Creds { username: string; password: string; email: string; }
interface SeriesPoint { d: string; v: number; }

/* ---------------- storage ----------------
   Offline-first. localStorage is the working copy so the page is
   instant and usable with no signal in the gym. Supabase is the
   source of truth, synced on load and after every save.
------------------------------------------- */
var KEY = "recomp-v1";
var mem: AppDB | null = null;
var MODE: Mode = "memory";
var SB: any = null;
var USER: any = null;
var DIRTY: Record<string, number> = {};
var SYNCING = false;
var DB: AppDB = { logs: {}, best: {}, start: null };

function todayISO(d?: Date): string {
  d = d || new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
}

function configured(): boolean {
  var c = window.APP_CONFIG;
  return !!(c && c.supabaseUrl && c.supabaseAnonKey && c.supabaseUrl.indexOf("PASTE_") < 0);
}

/* --- local cache --- */
function localProbe(): boolean {
  try {
    window.localStorage.setItem("__probe", "ok");
    if (window.localStorage.getItem("__probe") === "ok") {
      window.localStorage.removeItem("__probe");
      return true;
    }
  } catch (e) {}
  return false;
}
function localLoad(): AppDB | null {
  try {
    var r = window.localStorage.getItem(KEY);
    if (r) return JSON.parse(r);
  } catch (e) {}
  return null;
}
function localSave(): boolean {
  mem = JSON.parse(JSON.stringify(DB));
  try {
    window.localStorage.setItem(KEY, JSON.stringify(DB));
    return true;
  } catch (e) {
    return false;
  }
}

/* --- supabase --- */
async function sbInit(): Promise<void> {
  if (!configured() || !window.supabase) return;
  SB = window.supabase.createClient(window.APP_CONFIG!.supabaseUrl, window.APP_CONFIG!.supabaseAnonKey);
  try {
    var s = await SB.auth.getSession();
    USER = s.data && s.data.session ? s.data.session.user : null;
  } catch (e) {
    USER = null;
  }
  SB.auth.onAuthStateChange(function (_e: any, sess: any) {
    var was = USER;
    USER = sess ? sess.user : null;
    if (USER && !was) {
      gate(false);
      pull().then(function () {
        renderToday();
        renderProgress();
      });
    }
    if (!USER) MODE = localProbe() ? "browser" : "memory";
    stamp();
  });
}

/* pull remote, merge into DB. Newer updated_at wins per day. */
async function pull(): Promise<void> {
  if (!SB || !USER) return;
  try {
    var e = await SB.from("entries").select("day,data,updated_at").eq("user_id", USER.id);
    if (e.error) throw e.error;
    (e.data || []).forEach(function (row: any) {
      var local = DB.logs[row.day];
      if (!local || !local._ts || new Date(row.updated_at) > new Date(local._ts)) {
        DB.logs[row.day] = Object.assign({}, row.data, { _ts: row.updated_at });
      }
    });
    var p = await SB.from("profile").select("start_date,best").eq("user_id", USER.id).maybeSingle();
    if (!p.error && p.data) {
      if (p.data.start_date) DB.start = p.data.start_date;
      DB.best = Object.assign({}, p.data.best || {}, DB.best);
    }
    MODE = "cloud";
    localSave();
  } catch (err) {
    MODE = localProbe() ? "browser" : "memory";
  }
}

/* push the days marked dirty plus the profile */
async function push(): Promise<boolean> {
  if (!SB || !USER || SYNCING) return false;
  var days = Object.keys(DIRTY);
  if (!days.length) return true;
  SYNCING = true;
  try {
    var rows = days.map(function (d) {
      var c: DayLog = Object.assign({}, DB.logs[d]);
      delete c._ts;
      return { user_id: USER.id, day: d, data: c, updated_at: new Date().toISOString() };
    });
    var r = await SB.from("entries").upsert(rows, { onConflict: "user_id,day" });
    if (r.error) throw r.error;
    var p = await SB.from("profile").upsert(
      { user_id: USER.id, start_date: DB.start, best: DB.best, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
    if (p.error) throw p.error;
    DIRTY = {};
    MODE = "cloud";
    SYNCING = false;
    return true;
  } catch (err) {
    SYNCING = false;
    MODE = localProbe() ? "browser" : "memory";
    return false;
  }
}

async function load(): Promise<void> {
  await sbInit();
  var l = localLoad();
  if (l) DB = Object.assign(DB, l);
  else if (mem) DB = Object.assign(DB, mem);
  MODE = localProbe() ? "browser" : "memory";
  if (USER) await pull();
  if (!DB.start) DB.start = todayISO();
  gate(configured() && !USER);
}

async function save(quiet?: boolean): Promise<boolean> {
  if (configured()) DIRTY[cur] = 1;
  else DIRTY = {};
  var ok = localSave();
  if (!ok && MODE !== "cloud") MODE = "memory";
  stamp(true);
  if (USER) {
    var s = await push();
    stamp(true);
    return s;
  }
  return ok;
}

function stamp(justSaved?: boolean): void {
  var el = $("status");
  var pending = configured() ? Object.keys(DIRTY).length : 0;
  if (el) {
    if (MODE === "memory") {
      el.className = "stamp bad";
      el.textContent = "Not saving. This browser will not store data. Download a backup from the Progress tab before you close the tab.";
    } else if (justSaved) {
      var n = new Date();
      el.className = "stamp ok";
      el.textContent =
        "Saved " +
        String(n.getHours()).padStart(2, "0") +
        ":" +
        String(n.getMinutes()).padStart(2, "0") +
        (MODE === "cloud" && !pending ? " · synced" : " · on this device" + (pending ? ", " + pending + " to sync" : ""));
    } else {
      el.className = "stamp";
      el.textContent = MODE === "cloud" ? "Synced to your account" : "Saving to this browser";
    }
  }
  var w = $("storeWhere");
  if (w) {
    w.innerHTML = {
      cloud: "<b>Synced to your account.</b> Entries are written to this browser first so the page works with no signal, then pushed to the database. They come back on any device you sign in from.",
      browser: "<b>Saving to this browser only.</b> " + (configured() ? "Sign in to sync across devices. " : "No database is configured, so there is nothing to sync to. ") + "Clearing site data or switching device loses everything, so take a backup now and then.",
      memory: "<b>Nothing is being saved.</b> This browser is blocking storage, most likely private browsing. Download a backup before closing.",
    }[MODE];
  }
  var b = $("btnAuth");
  if (b) b.textContent = USER ? "Sign out " + accountName(USER) : "Sign in to sync";
}

/* --- sign-in gate ---
   Username/password. Register is a Postgres function (no Auth mailer).
   Sign-in still uses Auth sessions so RLS on entries/profile works. */
function accountEmail(username: string): string {
  return String(username).toLowerCase() + ".traininglog@gmail.com";
}
function accountName(user: any): string {
  if (!user) return "";
  var meta = user.user_metadata || {};
  if (meta.username) return meta.username;
  var e = user.email || "";
  var suf = ".traininglog@gmail.com";
  var cut = e.indexOf(suf);
  return cut > 0 ? e.slice(0, cut) : e;
}
function gate(show: boolean): void {
  var g = $("gate");
  if (!g) return;
  g.style.display = show ? "flex" : "none";
}
function authErr(e: any, fallback?: string): string {
  var msg = (e && e.message) || fallback || "Something went wrong.";
  if (/could not find the function|schema cache|does not exist/i.test(msg))
    return "Run the updated schema.sql in the Supabase SQL editor, then try Register again.";
  if (/rate limit/i.test(msg)) return "Too many attempts. Wait a minute and try again.";
  if (/already|exists|taken|duplicate|unique/i.test(msg)) return "That username is taken. Sign in instead.";
  if (/invalid login/i.test(msg)) return "Wrong username or password.";
  if (/email/i.test(msg)) return "Could not complete that. Try again.";
  return msg;
}
function readGate(): Creds | null {
  var u = ($<HTMLInputElement>("gateUser").value || "").trim().toLowerCase();
  var p = $<HTMLInputElement>("gatePass").value || "";
  var m = $("gateMsg");
  if (!/^[a-z0-9_]{3,24}$/.test(u)) {
    m.textContent = "Username: 3–24 letters, numbers, or underscore.";
    return null;
  }
  if (p.length < 6) {
    m.textContent = "Password must be at least 6 characters.";
    return null;
  }
  return { username: u, password: p, email: accountEmail(u) };
}
async function signInAccount(creds?: Creds): Promise<void> {
  if (!SB) return;
  var a = creds || readGate();
  if (!a) return;
  var m = $("gateMsg");
  m.textContent = "Signing in…";
  try {
    var r = await SB.auth.signInWithPassword({ email: a.email, password: a.password });
    if (r.error) throw r.error;
    m.textContent = "";
  } catch (e) {
    m.textContent = authErr(e, "Could not sign in.");
  }
}
async function registerAccount(): Promise<void> {
  if (!SB) return;
  var a = readGate();
  if (!a) return;
  var m = $("gateMsg");
  m.textContent = "Creating account…";
  try {
    var r = await SB.rpc("register_account", { p_username: a.username, p_password: a.password });
    if (r.error) throw r.error;
    await signInAccount(a);
  } catch (e) {
    m.textContent = authErr(e, "Could not register.");
  }
}

/* ---------------- plan data ---------------- */
var HOLDS: Hold[] = [
  { k: "plank", n: "Hard plank", t: 180 },
  { k: "handstand", n: "Wall handstand", t: 60 },
  { k: "hang", n: "Dead hang", t: 60 },
  { k: "hollow", n: "Hollow hold", t: 60 },
  { k: "sideplank", n: "Side plank", t: 45 },
  { k: "squat", n: "Deep squat hold", t: 60 },
  { k: "free", n: "Free timer", t: 0 },
];

// prescription per phase (1,2,3)
function P(a: string, b?: string, c?: string): Prescription {
  return { 1: a, 2: b || a, 3: c || b || a };
}

var SESS: Record<number, Session> = {
 1:{title:'Session A — Push',ex:[
   ['Incline push-up',P('4 × 8–12 · bench','—','—')],
   ['Push-up · floor',P('—','4 × 6–10','—')],
   ['Push-up · feet elevated',P('—','—','4 × 8–12')],
   ['DB bench press',P('—','3 × 8','3 × 8')],
   ['DB overhead press',P('3 × 8–10')],
   ['Goblet squat',P('3 × 10','3 × 8 loaded','4 × 8 loaded')],
   ['DB Romanian deadlift',P('3 × 10','3 × 10','3 × 8 loaded')],
   ['Wall walk',P('3 × 3','—','—')],
   ['Chest-to-wall handstand',P('—','4 × 20–40s','4 × 30–50s')],
   ['Hollow hold',P('4 × 20s','4 × 30s straight','4 × 40s')],
   ['Hard plank',P('3 × 30s','3 × 60s','2 × 90s')]
 ]},
 3:{title:'Session B — Pull',ex:[
   ['Pull-up attempts',P('—','—','5 singles · 90s rest')],
   ['Dead hang',P('3 × max · aim 30s','3 × max · aim 45s','3 × max · aim 60s')],
   ['Scapular pull-up',P('3 × 8','3 × 10','3 × 10')],
   ['Negative pull-up',P('4 × 3 · 5s lower','—','—')],
   ['Band-assisted pull-up',P('—','4 × 4','4 × 5')],
   ['DB row',P('4 × 10 each','4 × 10 loaded','4 × 8 loaded')],
   ['Bulgarian split squat',P('3 × 8 each','3 × 8 loaded','3 × 8 loaded')],
   ['Band face pull',P('3 × 15')],
   ['Side plank',P('3 × 20s each','3 × 30s each','3 × 45s each')],
   ['Dead bug',P('3 × 10 each')]
 ]},
 6:{title:'Session C — Legs & Abs',ex:[
   ['DB front squat',P('4 × 8','4 × 8 loaded','4 × 6 loaded')],
   ['Reverse lunge',P('3 × 10 each','3 × 10 loaded','3 × 8 loaded')],
   ['DB hip thrust',P('3 × 12','3 × 12 loaded','3 × 10 loaded')],
   ['Single-leg RDL',P('3 × 8 each','3 × 8 loaded','3 × 8 loaded')],
   ['Farmer carry',P('3 × 40 m heavy')],
   ['Hanging knee raise',P('3 × 8','3 × 12','3 × 12 straight leg')],
   ['Copenhagen plank',P('—','2 × 15s each','2 × 25s each')],
   ['Hollow rock',P('3 × 10','3 × 12','3 × 15')],
   ['Hard plank',P('3 × 40s','3 × 60s','2 × 90s')]
 ]},
 2:{title:'Mobility B — Shoulders & wrists',ex:[
   ['Wrist prep · 6 positions',P('20s each')],
   ['Wall slides',P('3 × 10')],
   ['Band dislocates',P('3 × 10')],
   ['Prone Y-T-W raises',P('3 × 8 each')],
   ['Chest-to-wall handstand',P('4 × 20–40s')],
   ['Hollow hold',P('3 × 30s')],
   ['Hard plank',P('2 × current max')]
 ]},
 4:{title:'Swim',ex:[
   ['Freestyle · easy',P('4 × 100 m')],
   ['Backstroke',P('4 × 50 m · opens the chest')],
   ['Moderate set',P('4 × 50 m')],
   ['Cool down',P('200 m')]
 ]},
 0:{title:'Hyrox',ex:[
   ['Run',P('800 m easy · legs are pre-fatigued')],
   ['SkiErg',P('500 m')],
   ['Run',P('400 m')],
   ['Wall balls 4 kg',P('10 · depth over speed')],
   ['Run',P('400 m')],
   ['Burpee step-outs',P('20 · no jump')],
   ['Run',P('400 m')],
   ['Farmer carry',P('40 m')],
   ['Run',P('400 m')],
   ['Row',P('500 m')],
   ['Cool down + couch stretch',P('10 min')]
 ]},
 5:{title:'Mobility A — Hips & spine',ex:[
   ['Couch stretch',P('90s each side')],
   ['90/90 hip switch + lean',P('10 each')],
   ['Deep squat hold',P('3 × 60s')],
   ['Thread the needle',P('10 each')],
   ['Thoracic extension over roller',P('90s')],
   ['Jefferson curl · light DB',P('3 × 5')],
   ['Brisk walk',P('12–15 min')]
 ]}
};

var BENCH: Bench[] = [
  { k: "pushup", n: "Push-ups strict", s: 8, t: 25, u: "reps" },
  { k: "pullup", n: "Pull-ups", s: 0, t: 3, u: "reps" },
  { k: "hang", n: "Dead hang", s: 15, t: 60, u: "s" },
  { k: "hollow", n: "Hollow hold", s: 10, t: 60, u: "s" },
  { k: "plank", n: "Hard plank", s: 30, t: 180, u: "s" },
  { k: "handstand", n: "Wall handstand", s: 0, t: 60, u: "s" },
];

/* ---------------- helpers ---------------- */
function $<T extends Element = HTMLElement>(id: string): T {
  return document.getElementById(id) as unknown as T;
}
var cur = todayISO();

var FIELD_MAP: readonly (readonly [string, LogFieldKey])[] = [
  ["mWeight", "weight"],
  ["mWaist", "waist"],
  ["mSleep", "sleep"],
  ["mProtein", "protein"],
  ["mCals", "cals"],
  ["mSteps", "steps"],
];

function weekOf(iso: string): number {
  var d = (new Date(iso).getTime() - new Date(DB.start!).getTime()) / 864e5;
  return Math.max(1, Math.min(12, Math.floor(d / 7) + 1));
}
function phaseOf(w: number): 1 | 2 | 3 {
  return w <= 4 ? 1 : w <= 8 ? 2 : 3;
}

function toast(m: string): void {
  var t = $("toast");
  t.textContent = m;
  t.classList.add("up");
  clearTimeout((t as any)._x);
  (t as any)._x = setTimeout(function () {
    t.classList.remove("up");
  }, 2200);
}

function fmt(s: number): string {
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

/* ---------------- render today ---------------- */
function renderToday(): void {
  var d = new Date(cur + "T12:00:00"), wd = d.getDay(), w = weekOf(cur), ph = phaseOf(w);
  var s = SESS[wd], log = DB.logs[cur] || {};

  $("hSession").textContent = s.title;
  $("hMeta").textContent = "WEEK " + String(w).padStart(2, "0") + " · PHASE " + ph + " · " +
    d.toLocaleDateString(undefined, { weekday: "long" }) + (w === 6 ? " · DELOAD — HALVE THE SETS" : "") +
    ([4, 8, 12].indexOf(w) > -1 ? " · TEST WEEK" : "");
  $<HTMLInputElement>("dateIn").value = cur;
  $("exTitle").textContent = (wd === 2 || wd === 5) ? "The block" : ((wd === 4 || wd === 0) ? "The workout" : "The session");

  var html = "";
  s.ex.forEach(function (e, i) {
    var pres = e[1][ph]; if (pres === "—") return;
    var v: ExerciseLog = (log.ex && log.ex[e[0]]) || {};
    html += '<div class="ex' + (v.done ? " done" : "") + '" data-n="' + i + '">' +
      '<input type="checkbox" data-ex="' + e[0] + '"' + (v.done ? " checked" : "") + ' aria-label="Done">' +
      '<div class="exmain"><b>' + e[0] + "</b><span>" + pres + "</span></div>" +
      '<input type="text" data-exv="' + e[0] + '" value="' + (v.v || "").replace(/"/g, "&quot;") + '" placeholder="log" aria-label="Result">' +
      "</div>";
  });
  $("exList").innerHTML = html;

  FIELD_MAP.forEach(function (p) {
    $<HTMLInputElement>(p[0]).value = log[p[1]] || "";
  });
  $<HTMLTextAreaElement>("mNotes").value = log.notes || "";
  var eh = ""; for (var i = 1; i <= 5; i++) eh += '<button data-e="' + i + '" aria-pressed="' + (log.energy === i) + '">' + i + "</button>";
  $("energy").innerHTML = eh;
}

/* ---------------- timer ---------------- */
var C = 2 * Math.PI * 52, tSec = 0, tRun: ReturnType<typeof setInterval> | null = null, tKey = "plank";

function holdOpts(): void {
  $("holdSel").innerHTML = HOLDS.map(function (h) { return '<option value="' + h.k + '">' + h.n + "</option>"; }).join("");
  $<HTMLSelectElement>("holdSel").value = tKey;
}
function holdMeta(): Hold {
  return HOLDS.filter(function (h) { return h.k === tKey; })[0];
}

function paintTimer(): void {
  var m = holdMeta(), tgt = m.t;
  $("tTime").textContent = fmt(tSec);
  $("tTarget").textContent = tgt ? "target " + tgt + "s" : "no target";
  var f = tgt ? Math.min(1, tSec / tgt) : 0;
  $("arc").setAttribute("stroke-dasharray", (f * C).toFixed(1) + " " + C.toFixed(1));
  var b = DB.best[tKey] || 0;
  $("tBest").textContent = b ? "best " + fmt(b) : "no record yet";
  $("dial").classList.toggle("pr", tgt > 0 && tSec >= tgt);
}
function tick(): void { tSec++; paintTimer(); }

function stopTimer(): void {
  if (tRun !== null) clearInterval(tRun);
  tRun = null; $("btnGo").textContent = "Start";
  if (tSec <= 0) return;
  var b = DB.best[tKey] || 0;
  if (tSec > b) {
    DB.best[tKey] = tSec;
    var bm = BENCH.filter(function (x) { return x.k === tKey; })[0];
    if (bm) {
      DB.logs[cur] = DB.logs[cur] || {};
      DB.logs[cur].bm = DB.logs[cur].bm || {};
      DB.logs[cur].bm![tKey] = tSec;
    }
    $("prTag").textContent = "Personal record · " + fmt(tSec);
    save(); renderProgress();
  } else {
    $("prTag").textContent = "";
  }
  paintTimer();
}

/* ---------------- charts ---------------- */
function series(field: LogFieldKey): SeriesPoint[] {
  return Object.keys(DB.logs).sort().filter(function (k) { return !!DB.logs[k][field]; })
    .map(function (k) { return { d: k, v: parseFloat(DB.logs[k][field] as string) }; })
    .filter(function (p) { return !isNaN(p.v); });
}
function roll(pts: SeriesPoint[], n: number): SeriesPoint[] {
  return pts.map(function (p, i) {
    var s = pts.slice(Math.max(0, i - n + 1), i + 1);
    return { d: p.d, v: s.reduce(function (a, b) { return a + b.v; }, 0) / s.length };
  });
}
function drawChart(el: SVGSVGElement, pts: SeriesPoint[], avg: SeriesPoint[] | null, color: string): void {
  var W = 520, H = 132, PL = 34, PR = 8, PT = 10, PB = 20;
  if (pts.length < 2) {
    el.innerHTML = '<text x="10" y="66" font-family="IBM Plex Mono" font-size="11" fill="#7C8B90">Two readings needed before a line appears</text>';
    el.setAttribute("viewBox", "0 0 " + W + " " + H); return;
  }
  var vs = pts.map(function (p) { return p.v; }).concat(avg ? avg.map(function (p) { return p.v; }) : []);
  var mn = Math.min.apply(null, vs), mx = Math.max.apply(null, vs);
  if (mx - mn < 1) { mx += 0.5; mn -= 0.5; }
  var pad = (mx - mn) * 0.15; mn -= pad; mx += pad;
  var X = function (i: number): number { return PL + (W - PL - PR) * (pts.length < 2 ? 0 : i / (pts.length - 1)); };
  var Y = function (v: number): number { return PT + (H - PT - PB) * (1 - (v - mn) / (mx - mn)); };
  var g = "";
  [0, 0.5, 1].forEach(function (f) {
    var y = PT + (H - PT - PB) * f, v = (mx - (mx - mn) * f);
    g += '<line x1="' + PL + '" y1="' + y + '" x2="' + (W - PR) + '" y2="' + y + '" stroke="#D3DAD9" stroke-width="1"/>' +
       '<text x="0" y="' + (y + 3.5) + '" font-family="IBM Plex Mono" font-size="9.5" fill="#7C8B90">' + v.toFixed(1) + "</text>";
  });
  pts.forEach(function (p, i) { g += '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(p.v).toFixed(1) + '" r="2.4" fill="' + color + '" opacity=".3"/>'; });
  if (avg && avg.length > 1) {
    g += '<polyline fill="none" stroke="' + color + '" stroke-width="2.2" stroke-linejoin="round" points="' +
      avg.map(function (p, i) { return X(i).toFixed(1) + "," + Y(p.v).toFixed(1); }).join(" ") + '"/>';
  }
  g += '<text x="' + PL + '" y="' + (H - 5) + '" font-family="IBM Plex Mono" font-size="9" fill="#7C8B90">' + pts[0].d.slice(5) + "</text>" +
     '<text x="' + (W - PR) + '" y="' + (H - 5) + '" text-anchor="end" font-family="IBM Plex Mono" font-size="9" fill="#7C8B90">' + pts[pts.length - 1].d.slice(5) + "</text>";
  el.setAttribute("viewBox", "0 0 " + W + " " + H);
  el.innerHTML = g;
}

/* ---------------- progress ---------------- */
function renderProgress(): void {
  var wt = series("weight"), wa = series("waist");
  drawChart($<SVGSVGElement>("cWeight"), wt, roll(wt, 7), "#D6437A");
  drawChart($<SVGSVGElement>("cWaist"), wa, roll(wa, 3), "#8C4A63");

  var keys = Object.keys(DB.logs).sort();
  var last7 = keys.slice(-7);
  var pr = last7.map(function (k) { return parseFloat(DB.logs[k].protein as string); }).filter(function (v) { return !isNaN(v); });
  var sl = last7.map(function (k) { return parseFloat(DB.logs[k].sleep as string); }).filter(function (v) { return !isNaN(v); });
  var done = keys.filter(function (k) { var l = DB.logs[k].ex; return !!l && Object.keys(l).some(function (x) { return !!l![x].done; }); }).length;
  var avg7 = roll(wt, 7), latest = avg7.length ? avg7[avg7.length - 1].v : null;
  var first = avg7.length ? avg7[0].v : null;

  var boxes: [string, string | number, string][] = [
    ["7-day weight", latest !== null ? latest.toFixed(1) + " kg" : "—", (first !== null && avg7.length > 3) ? ((latest! - first >= 0 ? "+" : "") + (latest! - first).toFixed(1) + " kg since start") : "need a week of data"],
    ["Protein avg", pr.length ? Math.round(pr.reduce(function (a, b) { return a + b; }, 0) / pr.length) + " g" : "—", "target 130 g"],
    ["Sleep avg", sl.length ? (sl.reduce(function (a, b) { return a + b; }, 0) / sl.length).toFixed(1) + " h" : "—", "floor is 7 h"],
    ["Sessions done", done, "of " + weekOf(todayISO()) * 5 + " scheduled so far"],
  ];
  $("statBoxes").innerHTML = boxes.map(function (b) {
    return '<div class="stat"><div class="eyebrow">' + b[0] + "</div><b>" + b[1] + "</b><i>" + b[2] + "</i></div>";
  }).join("");

  $("bmList").innerHTML = BENCH.map(function (b) {
    var v = DB.best[b.k] !== undefined ? DB.best[b.k] : b.s;
    var pct = Math.max(0, Math.min(100, ((v - b.s) / (b.t - b.s)) * 100));
    return '<div class="bm"><div class="bmtop"><b>' + b.n + "</b>" +
      '<span class="v">' + v + " " + b.u + " → " + b.t + " " + b.u + "</span></div>" +
      '<div class="track"><div style="width:' + pct.toFixed(0) + '%"></div></div>' +
      '<div class="bmedit"><input data-bm="' + b.k + '" value="' + v + '" inputmode="numeric" aria-label="' + b.n + ' record">' +
      "<span>current record in " + b.u + "</span></div></div>";
  }).join("");

  var g = "", st = new Date(DB.start! + "T12:00:00");
  for (var i = 0; i < 84; i++) {
    var dd = new Date(st.getTime() + i * 864e5), k = todayISO(dd);
    g += '<div class="' + (DB.logs[k] ? "log" : "") + (k === todayISO() ? " today" : "") + '" title="' + k + '"></div>';
  }
  $("grid84").innerHTML = g;
}

/* ---------------- collect + save ---------------- */
function collect(): void {
  var l: DayLog = DB.logs[cur] || {}; l.ex = l.ex || {};
  document.querySelectorAll<HTMLInputElement>("[data-ex]").forEach(function (c) {
    var k = c.dataset.ex!;
    l.ex![k] = l.ex![k] || {}; l.ex![k].done = c.checked;
  });
  document.querySelectorAll<HTMLInputElement>("[data-exv]").forEach(function (c) {
    var k = c.dataset.exv!;
    l.ex![k] = l.ex![k] || {}; l.ex![k].v = c.value;
  });
  FIELD_MAP.forEach(function (p) {
    var v = $<HTMLInputElement>(p[0]).value.trim();
    if (v) l[p[1]] = v; else delete l[p[1]];
  });
  var n = $<HTMLTextAreaElement>("mNotes").value.trim(); if (n) l.notes = n; else delete l.notes;
  var e = $("energy").querySelector('[aria-pressed="true"]') as HTMLElement | null;
  if (e) l.energy = parseInt(e.dataset.e as string, 10);
  DB.logs[cur] = l;
}

/* ---------------- events ---------------- */
document.addEventListener("click", function (ev: MouseEvent) {
  var t = ev.target as HTMLElement;

  if (t.id && t.id.indexOf("tab-") === 0) {
    (["today", "progress", "plan"] as const).forEach(function (k) {
      var on = ("tab-" + k) === t.id;
      $("tab-" + k).setAttribute("aria-selected", String(on));
      $("p-" + k).classList.toggle("on", on);
    });
    if (t.id === "tab-progress") renderProgress();
    window.scrollTo(0, 0); return;
  }
  if (t.dataset && t.dataset.e) {
    $("energy").querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", String(b === t)); }); return;
  }
  if ((t as HTMLInputElement).type === "checkbox" && t.dataset.ex) { t.closest(".ex")!.classList.toggle("done", (t as HTMLInputElement).checked); return; }

  if (t.id === "btnGo") {
    if (tRun) { stopTimer(); }
    else { $("prTag").textContent = ""; tRun = setInterval(tick, 1000); t.textContent = "Stop"; }
    return;
  }
  if (t.id === "btnReset") {
    if (tRun !== null) clearInterval(tRun);
    tRun = null; tSec = 0; $("btnGo").textContent = "Start"; $("prTag").textContent = ""; paintTimer(); return;
  }

  if (t.id === "gateIn") { signInAccount(); return; }
  if (t.id === "gateUp") { registerAccount(); return; }
  if (t.id === "gateSkip") { gate(false); toast("Offline mode — backup regularly"); return; }
  if (t.id === "btnAuth") {
    if (!configured()) { toast("No database configured — see the README"); return; }
    if (USER) { SB.auth.signOut().then(function () { USER = null; stamp(); toast("Signed out"); }); }
    else { gate(true); }
    return;
  }

  if (t.id === "btnBackup") {
    collect();
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(DB, null, 1)], { type: "application/json" }));
    a.download = "training-log-" + todayISO() + ".json"; a.click(); URL.revokeObjectURL(a.href);
    toast("Backup downloaded"); return;
  }
  if (t.id === "btnRestore") { $("fileIn").click(); return; }

  if (t.id === "btnCsv") {
    var cols = ["date", "weight", "waist", "sleep", "protein", "cals", "steps", "energy", "notes", "completed"] as const;
    var rows = [cols.join(",")];
    Object.keys(DB.logs).sort().forEach(function (k) {
      var l = DB.logs[k], done = l.ex ? Object.keys(l.ex).filter(function (x) { return !!l.ex![x].done; }).length : 0;
      rows.push(cols.map(function (c) {
        var v: any = c === "date" ? k : (c === "completed" ? done : ((l as any)[c] === undefined ? "" : (l as any)[c]));
        return '"' + String(v).replace(/"/g, '""') + '"';
      }).join(","));
    });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }));
    a.download = "training-log.csv"; a.click(); URL.revokeObjectURL(a.href);
    toast("CSV downloaded"); return;
  }

  if (t.id === "btnSave") {
    collect();
    save().then(function () {
      t.classList.add("ok"); t.textContent = "Saved";
      setTimeout(function () { t.classList.remove("ok"); t.textContent = "Save today"; }, 1600);
      renderProgress();
    });
    return;
  }
});

document.addEventListener("keydown", function (ev: KeyboardEvent) {
  if (ev.key !== "Enter") return;
  var target = ev.target as HTMLElement;
  if (target && (target.id === "gateUser" || target.id === "gatePass")) {
    ev.preventDefault();
    signInAccount();
  }
});
$<HTMLSelectElement>("holdSel").addEventListener("change", function (this: HTMLSelectElement) {
  tKey = this.value; tSec = 0;
  if (tRun !== null) clearInterval(tRun);
  tRun = null; $("btnGo").textContent = "Start"; $("prTag").textContent = ""; paintTimer();
});
$<HTMLInputElement>("dateIn").addEventListener("change", function (this: HTMLInputElement) {
  collect(); save(); cur = this.value; renderToday();
});
$<HTMLInputElement>("startIn").addEventListener("change", function (this: HTMLInputElement) {
  DB.start = this.value; save(); renderToday(); renderProgress();
});
$<HTMLInputElement>("fileIn").addEventListener("change", function (ev: Event) {
  var input = ev.target as HTMLInputElement;
  var f = input.files && input.files[0]; if (!f) return;
  var rd = new FileReader();
  rd.onload = function () {
    try {
      var inc = JSON.parse(rd.result as string);
      if (!inc || typeof inc !== "object" || !inc.logs) throw 0;
      DB.logs = Object.assign({}, inc.logs, DB.logs);
      DB.best = Object.assign({}, inc.best || {}, DB.best);
      if (inc.start) DB.start = inc.start;
      save(); $<HTMLInputElement>("startIn").value = DB.start!; renderToday(); renderProgress();
      toast("Backup restored");
    } catch (e) { toast("That file is not a backup from this page"); }
  };
  rd.readAsText(f); input.value = "";
});

/* autosave — never lose an entry to a forgotten button */
var au: ReturnType<typeof setTimeout>;
document.addEventListener("input", function (ev: Event) {
  var target = ev.target as HTMLElement;
  if (target.closest && target.closest("#p-today")) {
    clearTimeout(au);
    au = setTimeout(function () { collect(); save(true); }, 900);
  }
});

document.addEventListener("change", function (ev: Event) {
  var target = ev.target as HTMLInputElement;
  if (target.closest && target.closest("#p-today") && target.type === "checkbox") {
    collect(); save(true);
  }
  if (target.dataset && target.dataset.bm) {
    var v = parseFloat(target.value);
    if (!isNaN(v)) { DB.best[target.dataset.bm] = v; save(); renderProgress(); paintTimer(); }
  }
});

/* ---------------- autosave ---------------- */
var saveTimer: ReturnType<typeof setTimeout> | null = null;
function autosave(): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(function () {
    collect(); save();
    var s = $("btnSave");
    if (s) {
      s.textContent = "Saved automatically";
      clearTimeout((s as any)._x);
      (s as any)._x = setTimeout(function () { s.textContent = "Save today"; }, 1800);
    }
  }, 600);
}
$("p-today").addEventListener("input", autosave);
$("p-today").addEventListener("change", autosave);
$("p-today").addEventListener("click", function (ev: MouseEvent) {
  var t = ev.target as HTMLElement;
  if ((t as HTMLInputElement).type === "checkbox" || (t.dataset && t.dataset.e)) autosave();
});
window.addEventListener("pagehide", function () { collect(); save(); });
document.addEventListener("visibilitychange", function () {
  if (document.visibilityState === "hidden") { collect(); save(); }
});

/* ---------------- boot ---------------- */
(async function () {
  await load();
  $<HTMLInputElement>("startIn").value = DB.start!;
  holdOpts(); paintTimer(); renderToday(); renderProgress();
  stamp();
})();

})();
