# SmartPlay Caddie — Autonomous QA & Regression System

This directory is the persistent brain of the QA system. Each run **loads** what's here,
adds only new findings, and confirms prior fixes still hold — it does not restart from zero.

## Layout
- `model/` — living application model (nav, state, api, voice, camera, feature deps). Regenerate when architecture shifts.
- `history/`
  - `resolved-issues.json` — fixed bugs + the guard that protects each.
  - `known-issues.json` — `open` (parked, patch documented in `QA_REPORT.md`) + `refuted` (verified-not-real).
  - `regression-tests.json` — bug → permanent guard map.
  - `qa-knowledge.json` — fragile subsystems, next-run priorities, hard-won rules. **Read this first each run.**
  - `runs.json` — one row per pass.
- `../QA_REPORT.md` — human-facing report for the latest run.

## Re-run protocol (each pass)
1. Read `history/qa-knowledge.json` + `known-issues.json` (open items = start here).
2. `npm run test:logic` — confirm every prior regression guard still passes (Phase 15).
3. `npm run lint` — confirms `react-hooks/rules-of-hooks` (guards H5-class crashes).
4. Run the audit workflow (5 mappers + N finders → adversarial verify). Diff new findings against `resolved`/`refuted` so nothing is re-reported.
5. Fix + write a guard for each new confirmed bug. Park only genuine product/security-risk items — with WHY.
6. Append to `runs.json`, update the JSON DBs, regenerate `QA_REPORT.md`.

## Hard constraints (do not violate)
- **Voice path is FROZEN.** Audit read-only; never edit `useVoiceCaddie`, `usePipecatVoice`, VAD, `api/voice*`, `api/pipecat-*`, `app/api/voice*`, `transcribe`. Flag for Tim instead.
- **No fabricated metrics.** This harness can't run the app on a device — never invent CPU/battery/FPS/crash-rate numbers. Device-only phases (perf, a11y, live-session sim) are deferred and must be labeled as such.
- **Root-cause only.** No band-aids.

## Tests
- `npm test` — all projects. `npm run test:logic` — fast node suite (stores, api helpers, guards).
- Regression tests live in `__tests__/regression/`; component tests (jest-expo) in `__tests__/components/`.
