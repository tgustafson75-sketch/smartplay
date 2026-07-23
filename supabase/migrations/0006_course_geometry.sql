-- 2026-07-23 — Course Cloud: crowd-sourced hole geometry (api/course-geometry-share.ts).
--
-- The first player to open a course derives its hole geometry (one AI-vision pass over a
-- satellite tile, services/holeGeometryDerivation) and — with consent — uploads it here.
-- Every later player reads it back instantly (api/course-geometry reads this table BEFORE
-- falling back to the golfcourseapi/OSM proxy), so the AI pass happens once per course, not
-- once per user. Accuracy compounds as more contributors corroborate a hole.
--
-- Privacy: COORDS ONLY. No PII, no round data. `contributor_hash` is an opaque
-- sha256(email + server salt) used only to de-dupe/rate a contributor — never reversible to
-- an identity here. Isolation: `smartplay` schema (never `public`/SmartManage). RLS on with
-- NO client policies — only the Vercel service key touches it.

create schema if not exists smartplay;

-- Canonical, merged geometry per (course, hole) — this is what clients read.
create table if not exists smartplay.course_geometry (
  course_id          text        not null,
  hole               int         not null,
  par                int,
  yardage            int,
  tee_lat            double precision,
  tee_lng            double precision,
  green_lat          double precision,   -- green center
  green_lng          double precision,
  green_front_lat    double precision,
  green_front_lng    double precision,
  green_back_lat     double precision,
  green_back_lng     double precision,
  source             text        not null default 'ai_vision', -- ai_vision | osm | bundled | user_walk
  confidence         real        not null default 0.5,          -- 0..1 (from hole-scan)
  contributor_count  int         not null default 1,
  updated_at         timestamptz not null default now(),
  primary key (course_id, hole)
);

-- Raw per-contribution log — keeps every submission so the canonical row can be
-- re-merged/audited later without trusting a single write. One row per (course,hole,contributor).
create table if not exists smartplay.course_geometry_reports (
  course_id          text        not null,
  hole               int         not null,
  contributor_hash   text        not null,
  tee_lat            double precision,
  tee_lng            double precision,
  green_lat          double precision,
  green_lng          double precision,
  green_front_lat    double precision,
  green_front_lng    double precision,
  green_back_lat     double precision,
  green_back_lng     double precision,
  source             text        not null default 'ai_vision',
  confidence         real        not null default 0.5,
  created_at         timestamptz not null default now(),
  primary key (course_id, hole, contributor_hash)
);

create index if not exists course_geometry_course_idx on smartplay.course_geometry (course_id);

-- Consented issue reports (api/issue-report.ts) — the auto-send half of the same community
-- consent toggle. A consenting tester's user-reported issues land here so the team sees them
-- centrally instead of relying on a manual mailto. `reporter` is whatever email the tester set
-- in their profile (they typed it; it's how we reach them about the bug) — not derived silently.
create table if not exists smartplay.issue_reports (
  id           text primary key,          -- client entry id (dedupe on resend)
  reporter     text,
  platform     text,
  text         text not null,
  context      jsonb,
  details      jsonb,
  reported_at  timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists issue_reports_created_idx on smartplay.issue_reports (created_at desc);

alter table smartplay.course_geometry          enable row level security;
alter table smartplay.course_geometry_reports  enable row level security;
alter table smartplay.issue_reports            enable row level security;

-- Service role bypasses RLS; no client-facing policies on purpose (default-deny).
revoke all on smartplay.course_geometry          from anon, authenticated;
revoke all on smartplay.course_geometry_reports  from anon, authenticated;
revoke all on smartplay.issue_reports            from anon, authenticated;
