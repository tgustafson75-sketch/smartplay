-- 0003_backups.sql
-- Off-device data layer · Phase B — cloud backup / restore.
--
-- Purpose: give every SmartPlay user a single per-account snapshot of their
-- structured data (rounds, bag, CNS/caddie memory, profile, custom courses,
-- settings, stats) so a phone swap / reinstall never wipes it again (Tim's
-- Wachusett warranty-swap total loss). Identity = Supabase Auth (email OTP);
-- the row is keyed by auth.uid() and RLS makes each user's snapshot readable
-- + writable ONLY by that user. Media (clips/photos) is a later phase.
--
-- Isolation: this table lives in the `smartplay` schema (never `public` —
-- that's SmartManage). See api/_supabase.ts for the hard-isolation rule.

create schema if not exists smartplay;

create table if not exists smartplay.backups (
  -- One row per authenticated user. auth.uid() is the identity; the row is
  -- deleted if the auth user is deleted.
  user_id        uuid primary key references auth.users(id) on delete cascade,
  -- Denormalised email for support/debugging only (never trusted for auth).
  email          text,
  -- Bump when the snapshot SHAPE changes so restore can migrate/skip cleanly.
  schema_version int         not null default 1,
  -- App + device that wrote this snapshot (last-writer-wins diagnostics).
  app_version    text,
  device_id      text,
  -- The snapshot itself: { "<persist-store-key>": "<raw JSON string>", ... }.
  -- One compact JSON blob = one round-trip. Structured stores only (no media).
  payload        jsonb       not null,
  updated_at     timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

-- ── Row-Level Security ──────────────────────────────────────────────────────
-- Each authenticated user can touch ONLY their own row (user_id = auth.uid()).
-- No anon access at all. The service key (server) still bypasses RLS if ever
-- needed for support, but the client path is fully user-scoped.
alter table smartplay.backups enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='smartplay' and tablename='backups' and policyname='backups_select_own') then
    create policy backups_select_own on smartplay.backups
      for select to authenticated using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='smartplay' and tablename='backups' and policyname='backups_insert_own') then
    create policy backups_insert_own on smartplay.backups
      for insert to authenticated with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='smartplay' and tablename='backups' and policyname='backups_update_own') then
    create policy backups_update_own on smartplay.backups
      for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end
$$;

-- The client uses the `smartplay` schema (createClient db.schema='smartplay').
-- authenticated needs USAGE on the schema + row-level grants on this table.
grant usage on schema smartplay to authenticated;
grant select, insert, update on smartplay.backups to authenticated;

-- 2026-07-01 (re-audit — defense in depth) — 0002 set ALTER DEFAULT PRIVILEGES
-- granting anon select/insert/update on every future table in `smartplay`, so anon
-- auto-received a table grant on `backups` at creation. RLS (authenticated-only
-- policies, no anon policy) already denies anon every row, but revoke the grant
-- outright so the table never depends solely on RLS to keep anon out.
revoke all on smartplay.backups from anon;

-- ── Security hardening: lock down smartplay.messages (audit 0002 fix) ────────
-- 0002_messages.sql granted select/insert/update to anon + authenticated with
-- NO RLS, so any client holding the anon key could read/write ANY user's DMs.
-- The app only ever reaches messages through /api/messages (server service_role,
-- which bypasses RLS), so revoking the client grants + enabling deny-all RLS
-- closes the hole without breaking the app. (Full per-user auth on messages is
-- a later refactor once messaging is account-scoped.)
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='smartplay' and table_name='messages') then
    execute 'revoke select, insert, update, delete on smartplay.messages from anon, authenticated';
    execute 'alter table smartplay.messages enable row level security';
    if not exists (select 1 from pg_policies where schemaname='smartplay' and tablename='messages' and policyname='deny_public_access') then
      execute 'create policy deny_public_access on smartplay.messages for all to anon, authenticated using (false) with check (false)';
    end if;
  end if;
end
$$;
