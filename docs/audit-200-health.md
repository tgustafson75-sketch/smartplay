# Phase 200 — Component 4: Build Health

**Audit date:** 2026-05-05
**Bundle SHA:** `c170ec5` (Phase 110 ship)
**Working tree:** clean (this audit doc series is the only in-flight work)

## TypeScript

```
$ npx tsc --noEmit
(exit 0, no output)
```
**Status: 0 errors. CLEAN.**

## ESLint

```
$ npm run lint
(no problems reported)
```
**Status: 0 errors, 0 warnings. CLEAN.**

## expo-doctor

```
$ npx expo-doctor
17/17 checks passed. No issues detected!
```
**Status: ALL GREEN.**

## File counts

| Category | Count |
|---|---|
| `.ts` + `.tsx` source files (excl. node_modules + api dirs) | 290 |
| `console.*` calls in source | 262 |
| `TODO` / `FIXME` / `XXX` comments | 3 |
| Untracked files | 0 |
| Modified-uncommitted files | 0 (audit docs in flight) |

### Console calls

262 calls (up from 250 at Phase 100). The 12 added are telemetry markers from Phases 105-110 (team handoff logs, cage trigger logs, GPS outlier rejection, log_shot/media handler events). Phase 100 / F4 console hygiene was applied — every untagged call was either removed or promoted to a `[tag]` marker. Spot-check confirms the new entries follow the `[scope:event]` convention.

### TODOs

3 in source (was 2 at Phase 100; added 1). Per `docs/v1.2-deferred.md`:
- TODO #1 `app/_layout.tsx:57` — Sentry env wire-up (Tim setup task)
- TODO #2 `services/intents/queryStatusHandler.ts:563` — driver-yardage default (needs accumulated club distances pipeline)
- TODO #3 `lib/pricing.ts:7` — Stripe product ID alignment (Stripe deferred to v1.2)

All documented as deferred. None actionable in v1.1 scope.

## Bundle size

Not measured automatically. EAS build artifact size is the operational reading. No new native deps added since Phase 100; bundle delta should be JS-only across the 8 shipped phases.

## Native dependency check

No new native modules added across Phases 105-110. Metro reload picks up everything; no new EAS build required for the testing pass beyond whatever Tim last built.

## Test framework

Per `package.json` scripts: lint, build, vercel-build, start, android, ios, web. **No `test` script.** Intentional per CLAUDE.md "Honest scope discipline" — Tim chose empirical Z Fold verification as the testing discipline rather than unit/integration tests.

## Asset orphans (carried from audit-100-health.md)

24 PNG/JPG files in `assets/avatars/` with zero references in code (~5.1 MB unused bundle weight). Documented in `docs/v1.2-deferred.md` "Asset orphan inventory" — Tim walks per-row and decides KEEP / DELETE / RENAME in a v1.2 cleanup commit. Not blocking v1.1.

## Health verdict

**A across all checks.** This is the cleanest baseline since Phase 100. No shipped Phase introduced lint or type regressions. Console hygiene maintained. expo-doctor stays green.
