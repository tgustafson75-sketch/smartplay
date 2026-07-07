-- 2026-07-06 — Server-mediated data backup table (api/backup.ts).
--
-- Keyed by a user-owned string (their email, lower-cased) rather than auth.uid(),
-- so backup/restore works WITHOUT Supabase email-auth being enabled — the app never
-- signs in; our Vercel function writes here with the service key. Same value on a new
-- phone restores the data.
--
-- Isolation: lives in the `smartplay` schema (never `public`/SmartManage). RLS is
-- enabled with NO anon/authenticated policies, so only the service key (server) can
-- read/write — a client that somehow reached this table is default-denied.

create schema if not exists smartplay;

create table if not exists smartplay.device_backups (
  backup_key  text primary key,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

alter table smartplay.device_backups enable row level security;

-- Service role bypasses RLS; no client-facing policies on purpose.
revoke all on smartplay.device_backups from anon, authenticated;
