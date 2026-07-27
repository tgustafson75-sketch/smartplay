-- 0007 — Default-privilege lockdown (deep audit 2026-07-26, S3)
--
-- 0002_messages.sql:45 set a schema-wide DEFAULT PRIVILEGE that auto-grants
-- `select, insert, update` to anon + authenticated on EVERY new table created
-- afterward in schema smartplay. No table is exposed today (0003 + 0006 each
-- explicitly `revoke ... from anon, authenticated`), but the next table added by
-- anyone who forgets that revoke line would be silently client-writable. That's a
-- latent footgun, not a live hole — this migration removes the trap at the source.
--
-- After this runs, new smartplay tables default to service-role-only (which
-- bypasses RLS); client access must be granted deliberately + gated by RLS policy.
-- Existing tables are unaffected (their grants were set explicitly).

-- Stop auto-granting client write on future tables. service_role default stays.
alter default privileges in schema smartplay revoke select, insert, update on tables from anon, authenticated;

-- Belt-and-suspenders: keep the service_role default explicit so new tables are usable
-- by the server without a manual grant each time.
alter default privileges in schema smartplay grant all on tables to service_role;
