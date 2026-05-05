# Phase 100 — Component 9: v1.1 Readiness Verdict

**Audit date:** 2026-05-05
**Bundle SHA at Phase 100 start:** `94e7d29` (BZ-v1)
**Empirical bar:** Galaxy Z Fold dev-client.

## Tl;dr

**v1.1 ship verdict: FIX FIRST.**

**Internal beta: GO** (Tim has been on it; knows the rough edges).
**External beta: NOT YET.**

Phase 100 shipped 7 code commits + 4 audit / docs commits (10 commits total) closing a class of empirical failures that surfaced during F1 verification. Foundation is now FUNCTIONAL and lint/health baselines are clean. But three of four critical paths are still empirically unverified end-to-end on Z Fold, and one open empirical failure (F12 voice timeout) needs to be resolved before PATH 4 is sign-off-able.

## Foundation

**FUNCTIONAL.**

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run lint` | 0 errors, 0 warnings (was 1 err, 6 warns) |
| `npx expo-doctor` | 17 / 17 checks passed |
| Cold launch on Z Fold | reaches React Native + Metro reload (Phase 100 F1) |
| AbortSignal.timeout polyfill | shipped (services/polyfills.ts) |
| Hydration gate | works for the 2 of 13 persisted stores it covers; 11 stores not gated (audit-100-personas.md flagged) |
| Console-log hygiene | 249 calls, all `[tag]` prefixed |
| Asset orphans | 24 PNG/JPG (~5.1 MB) inventoried in v1.2-deferred.md, not deleted |

## Critical paths

| Path | Pre-100 | Post-100 | Notes |
|---|---|---|---|
| PATH 1 ONBOARD | DEGRADED suspected | DEGRADED suspected ↗ | Cold launch reaches the app on Z Fold (F1 partial evidence). Full hydration-race re-test (BV-PREP Test Group B, 3 personas) not yet run. Hydration gate covers 2 of 13 stores — the deeper race may still surface in a stress test. |
| PATH 2 ROUND | DEGRADED suspected | DEGRADED suspected | No empirical activity in this Phase 100 session. Status unchanged. |
| PATH 3 CAGE | UNKNOWN (BU said BROKEN, fixes shipped post-BU) | UNKNOWN (still not exercised) | The five phases since BU (BV/BX/BW/BY-quick/BZ-v1) all aimed at Marcus's failures; whether they stick is the single highest-value MIN VERIFY left. |
| PATH 4 VOICE | DEGRADED suspected | DEGRADED — empirically failing | F12 evidence: `[voice] speak timeout` in Metro logs. Root cause unconfirmed (Vercel sync vs ElevenLabs key vs persona body field). Blocks PATH 4 sign-off. |

## Personas

| Persona | Pre-100 | Post-100 | Delta |
|---|---|---|---|
| Dave | AT RISK | AT RISK | Unchanged. PATH 2 + PATH 4 unverified; PATH 4 actively failing per F12. |
| Marcus | AT RISK | AT RISK | PATH 3 still unexercised. Marcus's verdict pivots on a single 30-min Cage Mode session. |
| Sarah | AT RISK | AT RISK | Same as Dave — depends on PATH 2 + PATH 4. |
| James | AT RISK | AT RISK ↗ | F1 cold launch passed partial (no java.io, no Kevin flash on the Kevin default). Full BV-PREP Test Group B (3 non-Kevin personas) not yet run. |

Phase 100 client-side persona-correctness sweep (F2 + F13) closes a real visible bug for Tank/Harry users (`getCaddieName(voiceGender)` collapsed both to "Kevin" across ~30 surfaces). 11 client-side files patched; Tank/Harry now render their own names.

## What Phase 100 actually fixed

In sequence (commit order):

1. **audit-1-5** (5 docs, 864 lines) — Components 1–5 deliverables.
2. **F11 — AbortSignal.timeout polyfill (Hermes)** — closed `[weather] fetch exception` and the silent same-class failures across 12 fetch sites (course content, course geometry, golf course api, cage upload, pose detection, cv scoring, context synthesis).
3. **F2 + F13 — persona-correctness sweep** — 11 client-side `getCaddieName(voiceGender)` → `getCaddieName(caddiePersonality)`. Resolves the JSX apostrophe lint error in `app/diagnostic-card.tsx` AND the systemic Tank/Harry → Kevin name collapse.
4. **F3 — lint baseline** — 1 error + 6 warnings → 0 errors + 0 warnings.
5. **F4 — console.log hygiene** — 250 → 249 calls; all remaining tagged.
6. **F5 — TODO resolution** — 3 in-source TODOs documented as v1.2-deferred (Sentry env, driver-yardage default, Stripe IDs).
7. **Component 7 cleanup** — `expo-doctor` 17/17, asset orphan inventory (24 files / ~5.1 MB) documented for v1.2 cleanup.
8. **Component 8 docs refresh** — CLAUDE.md adds Phase 100 conventions (polyfill discipline, persona resolution rule, deferred-doc pointer); README.md replaced from default Expo template; new `docs/INDEX.md` navigation hub.

10 commits, all local. **Push to `origin/main` is gated on Tim's explicit approval** (Phase 100 spec says push per fix; the harness deferred all `git push` calls pending user OK).

## What's still required to ship v1.1

### Tim-only actions

| Item | Effort | What it unblocks |
|---|---|---|
| **F1 full BV-PREP run on Z Fold** (Test Groups A–F) | 60–90 min | Resolves PATH 1, PATH 2, PATH 3, PATH 4 status from suspected → verified-or-failed |
| **F7 Vercel sync check** (smartplay-beta dashboard) | 5 min | Confirms server-side persona routing is deployed; very likely root cause of F12 |
| **F12 voice timeout diagnosis** (after F11 polyfill is loaded; rerun voice path with persona switch) | 15–30 min once F1 is in flight | Resolves PATH 4 status |
| **Decide on F6** — `app/cage/summary.tsx` deletion (only after F1 Test Group E confirms it's unreachable) | 15 min | Closes orphan-route debt |

### Pending code work that's ready to land but gated by F1 evidence

- F12 voice timeout fix — **scope unknown until diagnostic completes.** Probable: Vercel redeploy + nothing else. Pessimistic: server-side persona body wiring across api/* (broader than v1.1 scope).
- Server-side `getCaddieName(voiceGender)` sweep across `api/*` — flagged in F13 commit body, deferred.

### Truly deferred (v1.2)

See `docs/v1.2-deferred.md`:
- TODO #1 Sentry wire-up
- TODO #2 Driver-yardage default
- TODO #3 Stripe product IDs
- F8 Per-clip mp4 extraction (BW deferred Option A)
- F14 Web SSR / Zustand-rehydrate (only matters if web is a target)
- Asset orphan deletion (Tim walks the 24-file list)

## Internal beta

**GO.** Tim is the only user. The known sharp edges are documented. Continued use is fine.

## External beta

**NOT YET.** Blockers, in priority:

1. **PATH 4 VOICE empirically failing** (F12). If F11 polyfill + Vercel sync resolve it: trivial. If not: real fix needed.
2. **PATH 3 CAGE empirically unverified** (the path Phase BU said BROKEN; structural fixes shipped but not Z-Fold-confirmed).
3. **PATH 2 ROUND empirically unverified.**
4. **PATH 1 ONBOARD partially verified** (cold launch passes; hydration race in non-default personas not stress-tested).

**Single highest-leverage action:** Tim runs `docs/verification-BV-PREP.md` on Z Fold, fills `verification-BV-PREP-results.md`. ~60–90 min. Resolves three blockers.

## v1.1 ship verdict

**FIX FIRST.**

The code work Phase 100 was supposed to do has been done — every BLOCKING and SIGNIFICANT issue identifiable from static + audit-driven analysis is either shipped, opened with diagnostic plan, or explicitly deferred with reasoning.

The empirical work Phase 100 was supposed to provoke — F1 full BV-PREP — is partially in flight (F11 + F12 evidence captured this session) but not complete.

v1.1 ships when:
1. F1 BV-PREP results template is filled
2. F12 voice timeout is RESOLVED (verified, not just hypothesised)
3. F7 Vercel sync is confirmed in-sync
4. PATH 3 MIN VERIFY pass (12/12 or ≥10/12 with documented gaps) per `audit-100-critical-paths.md`
5. Tim approves the batch of 10 local commits and pushes to `origin/main`

Estimated remaining work to ship: **~2–3 hours** if F12 root cause is Vercel sync (likeliest). **~6–10 hours** if F12 is a deeper persona-body wiring issue requiring server-side sweep.
