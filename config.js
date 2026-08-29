/* ---------------------------------------------------------------
   Supabase connection.

   Both values below are safe to commit to a public repository —
   the anon key is a public client key, and row-level security in
   supabase/schema.sql is what actually keeps your rows private.
   If you skip the RLS step, this table is readable by anyone.

   Leave the placeholders untouched and the page runs offline,
   saving to this browser only.
--------------------------------------------------------------- */
window.APP_CONFIG = {
  supabaseUrl:     "https://afvgjtfnxmbsymuvskgg.supabase.co",
  supabaseAnonKey: "sb_publishable_11bEHrS4QA8wez4I_19NlQ_7eV8D7yM"
};
