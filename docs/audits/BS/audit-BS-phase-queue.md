# Phase BS — Phase Queue Current State

**Date:** 2026-05-04

---

## IMMEDIATE (next 1-3 actions, today/tomorrow)

1. **COMMIT today's work.** Nothing is in main. `audit-BS-commits.md` is the commit-strategy table. **Without this, nothing else in this queue produces buildable output.**
2. **EAS dev-client build + install on Z Fold.** Required to pick up everything shipped today (no native modules added → Metro tunnel reload may suffice as a faster alternative for non-asset code).
3. **Empirical verification of today's work** — abbreviated, ~1 hr:
   - **Path 2** (15 min): start a round on home course, watch SmartFinder + SmartVision update with movement, tap Mark, walk to next hole and confirm transition.
   - **Path 3** (20 min): cage session, take ID-club photo of one club (BL), let one swing fail intentionally to force U1 heuristic-fallback, view summary.
   - **Path 4** (10 min): with a tutorial activated, ask Kevin a wedge question; confirm response references the practice cue. Then end round → check recap.
   - **BR negative test** (5 min): add tutorial with off-topic title → confirm "Doesn't look like a golf lesson" alert + Cage Mode option.

If those 4 hold → internal beta GO. If any fail → focused diagnostic via `[upload:*]` / `[V6-DIAG]` / `[path*]` markers.

---

## SHORT TERM (this week)

These are scoped, ready-to-build, awaiting Tim's empirical verification of today's work first.

- **BO — Round-state haptic notifications** (~6-9h). BUILD-TODAY candidate from BJ research. `expo-notifications` + GPS threshold-watcher + per-event vibration patterns. Cross-platform pivot of "background haptics" since iOS prohibits direct background haptics.
- **BP — TTS sentence pipeline** (~11h). BUILD-TODAY candidate from BJ research. Sentence-chunked parallel OpenAI TTS calls + sequential `Audio.Sound` chain. TTFA improvement from ~3-6s to ~600ms-1.2s. No new deps. Voice latency is the single most-felt "is this app useful" signal.
- **BR2 — Audio transcription stream** (~6-10h). The Whisper integration deferred from BR. Picks up on the `transcript` field already accepted by `api/tutorial-analysis.ts`. Needs file-extraction-from-video + Vercel function body-size handling.
- **BR Component 7 polish — Haiku/Sonnet token-budget routing** (~1-2h). Wire `buildCompressedPracticeContext()` (already written in `services/tutorialContext.ts`) into the Haiku tactical-response path inside `api/kevin.ts`. Currently all calls use full context; for tactical Haiku calls that's wasteful.
- **BA-BC — Voice register differentiation** (per persona AT RISK closure). Closes James's primary gap. Scope estimate per CLAUDE.md notes: medium.
- **U2 follow-up** — Phase AT recompose-pipeline residue cleanup in `CaddieAvatar.tsx` (BI URGENT-H2). Per the audit, the file is 935 LOC vs legacy's 467 LOC; some of that is legitimate (Fold-aware layout, emotion map), but a focused diff to confirm no `PORTRAIT_OFFSET_F` / `kevinShiftFraction` residue is worth ~2-3h.

---

## MEDIUM TERM (this week+)

- **BN emotional-state portraits** — gated on Tim generating the 14-17 missing Serena PNGs via chatly.ai. Currently 5 Serena assets in repo (3 legacy + 2 new from earlier this session). Once assets land, the mapping in `CaddieAvatar.tsx:SERENA_AVATARS` needs ~30 min of one-line-per-emotion edits.
- **BM — Pre-beta blockers (full)**. Privacy policy hosting + AV scenario verification + iOS-IAP-vs-Stripe billing decision. The architectural decision is the long pole; once decided, implementation falls in BR2-tier (~12-20 hours for whichever pattern wins).
- **BK — End-of-day verdict + forward plan** (per BS prompt mention). This is meta-work; `audit-BS-recommendations.md` largely covers it.
- **Onboarding routing canonicalization** (BI URGENT-H1). Both `app/intro.tsx` and `app/onboarding/_layout.tsx` exist; clarify which ships and delete or guard the other. ~1 hour.

---

## LATER (post-foundation, post-beta)

These are queued behind empirical verification + external beta + persona feedback. Documented with concrete reasons for each in `docs/research-summary.md`.

- **BD — Drill library expansion** (per project memory).
- **BE — Tournament / low-handicap mode** (per project memory).
- **BF — Emotional-state proactive trigger** (per project memory).
- **BG — In-round diagnostic Coach** — partially shipped per `api/kevin.ts` `inRoundDiagnostic` flag and `app/diagnostic-card.tsx`. Full polish queued.
- **MediaPipe pose detection** — QUEUE per `docs/research-mediapipe.md`. Re-evaluate when the React Native MediaPipe ecosystem stabilizes against the project's Expo SDK 54 + worklets 0.5.1 stack (currently no compatible mature library; closest option `@quickpose` is 22-30h scope, exceeds the 8h BUILD-TODAY threshold).
- **Watch IMU** — QUEUE. Separate native build (WatchKit / Wear OS).
- **AR overlay** — QUEUE. Multi-week feature; competitor pattern shows AR underperforms after launch. Mapbox satellite tiles already cover most of the value.
- **Voice biometric** — QUEUE. Bound to multi-player phase (which is itself queued for 1.1 per `store/roundStore.ts:83` "reserved for Phase 1.1 multi-player").
- **Live Activities (iOS)** — QUEUE. Tim has no iOS device.
- **Health Kit / Google Fit** — QUEUE. Low priority pre-beta; revisit post-external-beta.
- **Audio classification / hand tracking** — QUEUE per BJ research.
- **Phase BL extension (motion-sensed approach detection)** — gated on `react-native-vision-camera` being viable, which BJ research QUEUE'd.

---

## Phase queue summary

| Tier | Count | Estimated effort to ship all |
|---|---|---|
| IMMEDIATE | 3 actions | ~1.5-2 hr (commit + build + verification) |
| SHORT TERM | 6 phases | ~30-45 hr code; gated on empirical verification of today's work |
| MEDIUM TERM | 4 work-items | weeks (legal review + billing + asset gen) |
| LATER | 12+ items | months / 1.x cycles |

The tier transitions are gated, not just sequential:
- IMMEDIATE → SHORT TERM gate: today's work verifies on Z Fold
- SHORT TERM → MEDIUM TERM gate: external beta enrollment readiness
- MEDIUM TERM → LATER gate: post-public-launch usage data

---

## Standing recommendation

Until IMMEDIATE clears (commit + EAS build + Z Fold verification), do not start any SHORT TERM phase. The cost of building on uncommitted, unverified foundation is exactly the BR-style "rebuild what was built last week because we didn't know the failure mode" pattern that's already cost the session significant time.
