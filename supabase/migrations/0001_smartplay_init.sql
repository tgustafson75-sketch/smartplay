-- ============================================================================
-- SmartPlay Caddie — off-device data layer · Phase A (usage telemetry)
-- Migration 0001 — schema + usage_events table
--
-- RUN THIS in the Supabase SQL editor of Tim's EXISTING project.
--
-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ ISOLATION — READ FIRST                                                    │
-- │                                                                          │
-- │ This Supabase project is SHARED with another app, "SmartManage", whose   │
-- │ data lives in the `public` schema (events_state, shifts_state, …).       │
-- │                                                                          │
-- │ EVERYTHING SmartPlay creates lives in its OWN `smartplay` schema. This    │
-- │ migration must NEVER create/alter/reference any object in `public` or     │
-- │ name a SmartManage table. The app's server client (api/_supabase.ts) is   │
-- │ pinned to this `smartplay` schema, so it physically cannot read or write  │
-- │ SmartManage's data. Keep that boundary: new SmartPlay tables go HERE.     │
-- └──────────────────────────────────────────────────────────────────────────┘
--
-- Idempotent: safe to run more than once (IF NOT EXISTS throughout).
-- ============================================================================

-- ── Schema ──────────────────────────────────────────────────────────────────
create schema if not exists smartplay;

-- ── usage_events ────────────────────────────────────────────────────────────
-- One row per anonymous (opt-in) usage event from the client. Low-volume,
-- coarse signals only (round_started, swing_analyzed, …) — NOT a fingerprint.
create table if not exists smartplay.usage_events (
  id          bigint generated always as identity primary key,
  anon_id     text,
  user_id     text,
  event       text not null,
  props       jsonb not null default '{}'::jsonb,
  ts          timestamptz not null default now(),
  inserted_at timestamptz not null default now()
);

comment on table smartplay.usage_events is
  'SmartPlay opt-in anonymous usage telemetry (Phase A). SmartPlay-only; never references public/SmartManage tables.';

-- Query helpers: by event name and by event time.
create index if not exists usage_events_event_idx on smartplay.usage_events (event);
create index if not exists usage_events_ts_idx    on smartplay.usage_events (ts);

-- ── Privileges ──────────────────────────────────────────────────────────────
-- The service_role (used by api/_supabase.ts) needs to reach the schema and
-- write rows. service_role BYPASSES RLS, so the policy below doesn't gate it.
grant usage on schema smartplay to service_role;
grant insert, select on smartplay.usage_events to service_role;
-- Future identity-owned tables: keep defaults flowing to service_role too.
alter default privileges in schema smartplay
  grant insert, select on tables to service_role;

-- ── Row-Level Security ──────────────────────────────────────────────────────
-- Lock the table down: enable RLS and DENY anon/authenticated by adding NO
-- permissive policy for them. With RLS on and no policy, anon/public get zero
-- rows and zero writes. Writes happen ONLY via the service key (which bypasses
-- RLS) from our server. This makes the table unreachable from any client that
-- somehow gets the anon key.
alter table smartplay.usage_events enable row level security;

-- Explicit deny-all for the public roles (documents intent; with RLS enabled
-- and no permissive policy these roles are already denied, but a named policy
-- makes the "no public access" decision visible in the schema).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'smartplay'
      and tablename  = 'usage_events'
      and policyname = 'deny_public_access'
  ) then
    create policy deny_public_access
      on smartplay.usage_events
      for all
      to anon, authenticated
      using (false)
      with check (false);
  end if;
end
$$;
