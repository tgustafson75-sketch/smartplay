# Phase BS — Build Health Check

**Date:** 2026-05-04 (end of session)
**Comparison:** vs pre-session baseline captured in `docs/audits/v1-audit-2026-05-04.md`

---

## Automated checks

| Check | Pre-session | End of session | Delta |
|---|---|---|---|
| `npx tsc --noEmit` | 0 errors | **0 errors** | unchanged |
| `npm run lint` | 1 error + 8 warnings | **1 error + 6 warnings** | **−2 warnings** (improvement from U2 dead-code removal) |
| `npx expo-doctor` | 17/17 passed | not re-run this turn (no expo-config changes since pre-session) | assume unchanged |
| `npm test` | no test framework | no test framework | unchanged |

**Lint regression: zero across the entire session.** Every phase that touched code held the lint baseline or improved it. The single error (`react/no-unescaped-entities` in `app/diagnostic-card.tsx:157`) is pre-existing and untouched.

## Code volume / complexity

| Metric | Pre-session | End of session | Delta |
|---|---|---|---|
| `process.env.*` variables read | 13 unique | unchanged | none added |
| TODO/FIXME/HACK/XXX | 2 | 2 | unchanged |
| `console.log` (excl. tests) | 196 | 207 | +11 (BQ instrumentation, U1 V6-DIAG additions) |
| Tracked files | 420 | 420 (uncommitted; would be 456 once new files commit) | +36 untracked |

The +11 console.log delta is intentional — BQ instrumentation (`[upload:*]` markers) and U1 tentative-fallback diagnostic logs add structured trace lines, all greppable via `adb logcat | grep -E "upload:|V6-DIAG"`. None are ad-hoc debug noise; all are documented in `docs/upload-pipeline-map.md`.

The 207 total still doesn't have any cleanup gating — `docs/v1-scope-final.md` §D notes the 196 baseline as "KEEP for v1.0" pending Sentry breadcrumb migration. That decision is unchanged.

## New deps

| Dep | Why | Production impact |
|---|---|---|
| `@expo/ngrok ^4.1.0` (devDependency) | Local tunnel for Tim's phone to reach the dev server | None — devDep only |

No production runtime deps added. No native module additions. No prebuild required for any phase shipped today.

## Bundle size

Not measured. Realistic estimate based on changes:
- BL: ~600 LOC of TS, no new deps. ~5-10KB minified delta.
- BR: ~1,200 LOC of TS + 6.5MB of new Serena PNGs (assets/avatars/serena-*.png) — these are bundled into the app binary. **The two Serena PNGs are the biggest bundle-size delta of the session.**
- BN: 5MB of Serena studio portrait + 1.3MB of caddie-nod = same as BR's 6.5MB above (single counting).
- BQ: ~150 LOC, no deps.
- U1: ~140 LOC, no deps.
- U2: net negative LOC (dead code removed), no deps.

**Estimated bundle-size delta: +6.5MB** (almost entirely the two new Serena portrait PNGs). For comparison, the existing `assets/avatars/` directory was already ~10-15MB (Kevin's 22 portrait PNGs). The Serena addition is proportional and expected.

## Test framework status

Still none. `npm test` has no script. No jest / vitest / RTL deps. `docs/v1-scope-final.md` §D documents this as DEFERRED post-beta. Not a today-decision.

## Dev server / tunnel

- Dev server running in background on port 8082 with `--tunnel` flag
- Tunnel URL: `https://xokzixe-anonymous-8082.exp.direct` (via ngrok local API)
- Tim can paste this URL into the Z Fold dev-client's "Enter URL manually" once today's commits land + a build pulls them
- **Caveat:** the tunnel serves the *current local working tree* via Metro, but the EAS dev-client binary on Tim's Z Fold was built from a previous commit — meaning native modules (anything requiring prebuild or new native deps) won't be picked up by Metro alone. **No phase today added a native module**, so a Metro-tunnel reload SHOULD pick up everything. Worth confirming on first connect.

## Health summary

The build is **structurally clean**: tsc 0 errors, lint improved, no native config changes, no production deps added, no test regression (no tests existed before; none exist now). The only non-trivial delta is the +6.5MB asset addition for Serena portraits. Empirical verification is the only health dimension that's worse than pre-session — because we shipped substantial new code without a verification loop.
