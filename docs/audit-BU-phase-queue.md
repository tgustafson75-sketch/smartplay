# Phase BU — Component 7: Updated Phase Queue

**Audit date:** 2026-05-04

Reorganized phase queue informed by Phase BU findings. Cage Mode is BLOCKING for any cage-dependent persona work and must reach FUNCTIONAL before broader phase work continues.

## IMMEDIATE — Cage Mode foundation. Pause other phase work until these ship + verify.

| Phase | Title | Source | Hours | Verification |
|---|---|---|---|---|
| **BX** | `[path3:cage]` telemetry markers | Component 5, P1 | 1–2 | Logcat trace per Component 6 |
| **BV** | Reconcile dual live-session UIs | Component 5, P1 | 3–4 | UI checks per Component 6 |
| **BW** | Per-detection clip extraction + Phase K reshape | Component 5, P1 | 5–8 | 5-swing controlled session + library + Phase K result |
| **BY-quick** | Detection signal-to-noise quick win | Component 5, P2 | 2–3 | TP ≥80%, FP ≤20% per Component 6 |
| **BZ-v1** | Review UI must-haves (re-analyze, edit-tags, scrubber) | Component 5, P2 | 4 | Per-feature checks per Component 6 |

**Total:** 15–21 hours of work to bring Cage Mode from BROKEN → FUNCTIONAL.

**Standing rule:** No other phase ships until BX/BV/BW/BY-quick/BZ-v1 all PASS Component 6 verification on Galaxy Z Fold (closed + open).

## SHORT TERM — After Cage is functional, pre-beta polish.

| Phase | Title | Status | Hours | Notes |
|---|---|---|---|---|
| **BO** | Haptic notifications | Not started | TBD | Earbud / wake-word feedback layer |
| **BP** | TTS sentence pipeline | Not started | TBD | Streaming sentence-level TTS to reduce TTFA |
| **BA-BC** | Voice register differentiation closures | Partially shipped | TBD | Universal failure handling on uncertainty register paths |
| **BU-followup** | Empirical verification of all uncommitted persona fixes (Kevin/Serena/Harry/Tank, hydration race) | Coded; not verified | 1–2h verification only | Cold-launch each persona, verify greeting + caddie tab + filler clips per recent persona audit |

## MEDIUM TERM — After cage + voice polish.

| Phase | Title | Status | Hours | Notes |
|---|---|---|---|---|
| **BR2** | Tutorial transcript via Whisper + recap reinforcement + Haiku/Sonnet routing | BR shipped manual notes; BR2 deferred | TBD | Builds on BR. Ships after Cage works because tutorials reference cage-found patterns. |
| **BL** | Auto club recognition empirical verification + active-session integration | Scaffolding shipped in `6dff9f3`; not wired into live UI | 4–6h | **Depends on BV** (canonical UI to wire into) |
| **BN** | Serena character empirical verification | Scaffolding + character spec shipped + uncommitted persona widening | 1h verification | **Already coded; needs Galaxy Z Fold smoke test per BU-followup** |
| **BD/BE/BF** | Persona depth (mode selector refinements, filler context awareness) | Not started | TBD | After Serena/Harry/Tank are empirically verified (BU-followup) |

## LATER — Post-functional polish + end-of-day features.

| Phase | Title | Status | Notes |
|---|---|---|---|
| **CA** | Per-club detection thresholds | Builds on BY | Polish, not foundation |
| **CB** | Per-clip mp4 file extraction | Builds on BW (Option D → A/C upgrade) | Required only if share/export becomes a feature |
| **CC** | Pose-confirmation for detection | Multi-modal infra not present today | Significant effort; deferred |
| **BT** | Splash video | Not started | Polish — does not block any feature |
| **BK** | End-of-day verdict | Not started | Polish — does not block any feature |
| **BZ-v2/v3** | Review UI comparison view + share/export | Builds on BZ-v1 | Nice-to-haves |

## Phase reordering rationale

### What changed vs the BS-audit phase queue

The BS audit (`docs/audits/BS/audit-BS-phase-queue.md`) listed cage-related work as ready or near-ready. The studio session demonstrated that Cage Mode is empirically broken in 3 BLOCKING dimensions (UI, save/routing, correlation) plus 2 SIGNIFICANT (false positives, review UI). The Phase BU re-prioritization:

1. **Pulls cage foundation work to the front of the queue.** Was: scattered. Now: BX→BV→BW→BY-quick→BZ-v1 as a non-negotiable block.
2. **Pauses BL until BV ships.** BL needs a canonical live UI to wire its three-tier club detection into. Without BV, BL would fork the UI further.
3. **Defers persona depth (BD/BE/BF).** Persona work is coded but unverified. Verification (BU-followup, 1–2h) must happen before deepening, not in parallel with deepening.
4. **Keeps BO/BP available** because they're independent of cage and add value to PATH 4 VOICE.

### Internal beta readiness gate (per CLAUDE.md)

External beta-readiness requires all four critical paths verified end-to-end on a real device within the last 7 days. Current state:

| Path | Last verified | Status |
|---|---|---|
| PATH 1 ONBOARD | Pre-studio (BS audit era) | Likely OK; persona widening introduced changes that need re-verify |
| PATH 2 ROUND | Pre-studio (3-round Palms simulation in `84bfc76`) | Predictive only, not real-device |
| **PATH 3 CAGE** | Studio session — FAILED across 5 dimensions | **BROKEN** |
| PATH 4 VOICE | Pre-studio (BH in-round diagnostic shipped) | Likely OK |

**Internal beta is not blocked** by the PATH 3 status (it's still personal/internal). **External beta IS blocked** — cannot announce externally until PATH 3 reaches FUNCTIONAL with a Galaxy Z Fold MIN VERIFY pass within 7 days.

## Phase queue as a single sequence

```
NOW:
1.  BX  telemetry markers              [1–2h]
2.  BV  reconcile UIs                  [3–4h]
3.  BW  per-detection clips + Phase K  [5–8h]
4.  BY-quick  detection hardening      [2–3h]
5.  BZ-v1  review UI must-haves        [4h]
6.  ---- PATH 3 CAGE MIN VERIFY (Galaxy Z Fold) ----
7.  BU-followup  persona empirical verify  [1–2h]
8.  BN  Serena empirical                  [included in 7]

THEN:
9.  BO  haptic notifications
10. BP  TTS sentence pipeline
11. BA-BC  voice register closures
12. BL  auto club recognition wired into BV's canonical UI

LATER:
13. BR2  tutorial transcript / recap reinforcement / model routing
14. BD/BE/BF  persona depth
15. CA  per-club thresholds
16. CB  per-clip mp4
17. BZ-v2/v3  review UI deeper
18. BT/BK  polish
```

## Phases removed or reframed

- **BS audit** (committed `6dff9f3`): considered closed. BU is its successor for the cage-specific re-verification.
- **U1** (committed): U1 fallback shipped in `6dff9f3`. Will be re-tested as part of BW verification — if Phase K returns `none`/`failed` on per-clip extraction, U1 fallback should still kick in.
- **U2** (committed): avatar dual-import audit shipped. Persona widening reuses the same canonical avatar path; verification covered by BU-followup.

## What this queue does NOT include

- Cloud sync / cross-device library — explicitly deferred to v1.x per `services/videoUpload.ts` L14.
- ML-based impact classifier — research phase, not a 1.0 feature.
- Multi-player / shared rounds — out of scope.
- Watch-as-IMU integration for swing detection — `services/watchService.ts` exists but not wired to cage detection; see Component 5 phase CC for deferred-sketch.
