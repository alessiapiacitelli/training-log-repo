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
  supabaseUrl:     "PASTE_YOUR_PROJECT_URL",
  supabaseAnonKey: "PASTE_YOUR_ANON_PUBLIC_KEY"
};
