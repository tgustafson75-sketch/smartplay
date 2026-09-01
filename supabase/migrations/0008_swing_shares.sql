-- 2026-08-31 — Shareable swing links (api/swing-share.ts).
--
-- Tim: "I want to be able to send out, even if it's by link form, exactly what you would get from
-- swing library analysis — the reports, the video playback. Maybe better ways to have that linkable,
-- instead of exporting PDFs or photos."
--
-- A PDF is a dead end: it cannot move, it cannot be updated, and nobody forwards one. A link is the
-- product doing its own marketing — a coach opens it on a phone, sees the swing MOVING with the
-- skeleton and club trace on it, reads the same analysis the player got, and there is a button to
-- get the app.
--
-- WHAT IS STORED, AND WHY IT IS NOT VIDEO. The clip itself is 60-120 seconds and 60-200MB — far too
-- slow to upload from a golf course and a real bandwidth bill. But the analysis already extracts
-- 3-8 KEYFRAMES around the swing, and the pose is already computed. So the share carries the frames
-- and the pose, and the page animates them into a loop with the overlay drawn on top. Under ~1MB,
-- seconds to upload on cellular, and it MOVES — which is the half a PDF can never do. Real video is
-- a later native build (trimming a clip needs a module we do not ship).
--
-- Frames ride as base64 in a jsonb payload rather than in object storage on purpose: no Storage
-- bucket exists in this project yet, and adding one for ~600KB a share would be new infrastructure
-- for no gain at this size. If shares ever carry video, that is the moment to add a bucket.
--
-- PRIVACY. Tim's call: an UNLISTED link with no expiry. Anyone with the URL can open it; nothing is
-- listed, enumerable or searchable. The id is 16 bytes of crypto randomness rendered base62url, so
-- it cannot be guessed or walked. No email, no account id and no round data are stored — a share
-- carries the swing and its analysis and nothing that identifies the player beyond a display name
-- they chose to include.
--
-- Isolation: `smartplay` schema (never `public`/SmartManage). RLS on with NO client policies — only
-- the Vercel service key touches it. Reads go through api/swing-share, never straight from a client.

create schema if not exists smartplay;

create table if not exists smartplay.swing_shares (
  -- Opaque, unguessable, URL-safe. Generated server-side; never derived from anything about the user.
  id              text        primary key,
  created_at      timestamptz not null default now(),
  -- Everything the page renders: frames (base64), pose keyframes, the analysis report, the caddie's
  -- read, tempo/biomech numbers, the swing window to loop, and a display name if one was included.
  -- One document because the page reads it once and renders it whole; splitting it would buy nothing.
  payload         jsonb       not null,
  -- Opaque per-device hash, ONLY to rate-limit one device's shares. sha256(app key + salt + device),
  -- never reversible to an identity, never shown, never joined to anything.
  creator_hash    text,
  -- Cheap operational counters. `views` is the only reason to care that a share was opened at all.
  views           int         not null default 0,
  last_viewed_at  timestamptz,
  -- Set when a share is withdrawn. A revoked row is KEPT rather than deleted so the link returns an
  -- honest "this swing was removed" instead of a 404 that reads like the product is broken.
  revoked_at      timestamptz
);

-- Rate-limiting reads one creator's recent rows; nothing else queries by creator.
create index if not exists swing_shares_creator_idx
  on smartplay.swing_shares (creator_hash, created_at desc);

alter table smartplay.swing_shares enable row level security;
-- Deliberately NO policies: the service key bypasses RLS, and nothing else may reach this table.
