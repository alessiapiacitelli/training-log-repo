# 12-Week Log

A single-page training and body-composition log for a 12-week calisthenics
recomposition block. No build step, no framework, no dependencies to install.
Static HTML on GitHub Pages, Postgres on Supabase.

- **Offline first.** Every entry is written to the browser immediately, so the
  page works in a gym with no signal, then pushes to the database when it can.
- **Phase aware.** The session shown depends on the weekday and on how many
  weeks have passed since your start date, so the prescription changes with you.
- **Installable.** Add to home screen on iOS or Android and it runs full screen.

---

## Setup

Roughly twenty minutes, most of it waiting for Supabase to finish provisioning.

### 1. Fork or push this repository

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin git@github.com:YOUR_USERNAME/12-week-log.git
git push -u origin main
```

### 2. Create the Supabase project

New project at [supabase.com](https://supabase.com), free tier. This app writes
roughly one row per day, so you will not approach any limit.

### 3. Create the tables

Database → SQL Editor → New query. Paste all of `supabase/schema.sql` and run it.

The last statement is a check. **Both rows must come back with
`rowsecurity = true`.** If they do not, stop and fix it before going further —
see the security note below.

### 4. Fill in `config.js`

Settings → API. Copy the Project URL and the `anon` `public` key.

```js
window.APP_CONFIG = {
  supabaseUrl:     "https://xxxxxxxx.supabase.co",
  supabaseAnonKey: "eyJhbGciOi..."
};
```

Commit it. Both values are meant to be public — see below.

### 5. Turn on GitHub Pages

Settings → Pages → Source → **GitHub Actions**. Push to `main` and the workflow
in `.github/workflows/deploy.yml` publishes the site.

Your URL will be `https://YOUR_USERNAME.github.io/12-week-log/`.

### 6. Point Supabase Auth at that URL

Authentication → URL Configuration:

- **Site URL** — your Pages URL
- **Redirect URLs** — add the same URL

Sign-in links will not work until this matches. This is the step people miss.

### 7. Open it and sign in

Enter your email, follow the link, and you are done. Open the same URL on your
phone, sign in with the same email, and both devices share one log.

---

## Security

`config.js` is committed to a public repository on purpose. The `anon` key is a
public client key — it is designed to ship in browser code and identifies the
project, not you.

**What keeps your data private is row-level security, not secrecy of that key.**
The policies in `supabase/schema.sql` restrict every row to `auth.uid() = user_id`,
so a stranger holding the anon key can read nothing. Without those policies, the
tables are world-readable to anyone who views source.

Never put the `service_role` key in this repository. It bypasses RLS entirely.

---

## Running it without a database

Leave the placeholders in `config.js` alone. The page falls back to browser
storage, tells you so under the Save button, and works completely — you simply
lose cross-device sync. Take the JSON backup from the Progress tab periodically.

---

## Layout

```
index.html               the whole application
config.js                Supabase URL and anon key
manifest.webmanifest     home-screen install
assets/                  icons
supabase/schema.sql      tables, RLS policies, triggers
supabase/queries.sql     analysis queries for your own data
.github/workflows/       Pages deployment
```

## Data model

`entries` holds one row per person per day, with the whole day's log as `jsonb`.
Keeping it schemaless means adding a field to the page needs no migration.
`profile` holds the start date and personal records.

## Changing the programme

The training plan lives in the `SESS` object near the top of the script in
`index.html`, keyed by weekday, `0` = Sunday. Each exercise carries a
prescription per phase via `P(phase1, phase2, phase3)`.

```js
['DB front squat', P('4 × 8', '4 × 8 loaded', '4 × 6 loaded')],
```

Benchmarks and their Week 12 targets are in `BENCH`; the hold timer options and
their targets are in `HOLDS`.

## Local development

No toolchain. Any static server:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`. To let sign-in work locally, add
`http://localhost:8000` to the Supabase redirect URLs.
