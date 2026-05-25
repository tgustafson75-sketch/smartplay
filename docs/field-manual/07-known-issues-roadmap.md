# 07 — Known issues & roadmap

## Deferred P2s (post-beta polish)

From SHIP-QA-AUDIT + PLATFORM-QA-AUDIT P2 buckets:

| Item | Source | Notes |
|---|---|---|
| KevinCoachBox.tsx rename → CaddieCoachBox | SHIP-QA P2.2 | Touches import sites; defer to cleanup pass. |
| coach-mode.tsx:398 multi-line TODO | SHIP-QA P2.4 | Cosmetic comment. |
| CaddieAvatar.tsx:850 asset re-crop TODO | SHIP-QA P2.5 | Not code work — asset task. |
| meta-voice+api.ts:131 TODO in prompt template | SHIP-QA P2.6 | Inert; reword later. |
| paywallGuard allow-all | SHIP-QA P2.7 | Intentional for beta; real wiring at Step 2. |
| /api/swing-tempo 501 stub | SHIP-QA P2.8 | Intentional v1.2.3 placeholder. Vercel Edge can't bundle ffmpeg <50 MB; needs external worker. |
| /api/pose-analysis 200-with-null | SHIP-QA P2.9 | Intentional Fix H. Wired when pose-detection key configured. |
| Caddie tab inset deltas (fixed phone-height) | PLATFORM-QA P2.1 | Scale by W / aspect ratio in polish pass. |
| CaddieAvatar single-threshold isFolded | PLATFORM-QA P2.2 | Tablet portrait vs fold-open both land in same branch. |
| Cage Mode width-only fold detection | PLATFORM-QA P2.3 | Add aspect-ratio guard alongside W ≥ 540. |
| BT media-button native bridge | PLATFORM-QA P2.4 | Worktree complete; needs EAS Build cut. |
| Debug/setup screens fixed `height: 220/240` | PLATFORM-QA P2.5 | Not in user flow. |
| Hole-View overlay fixed 10-12px offsets | PLATFORM-QA P2.6 | Tablet-landscape only; minor. |

## 1.x — first post-launch wave

- **Real pose detection** — RapidAPI bridge wired (`/api/pose-analysis`); needs key + integration verification. SmartMotion already gates skeleton on real keypoints.
- **Galaxy Watch IMU** — `services/watchService.ts` has the FUTURE SDK HOOK comment block. Native module needs EAS Build cut. Once wired, club_speed becomes truth-grade (`source: 'watch'`).
- **Putting parity** — `/api/putting-analysis` shipped; surface parity with full-swing analysis (per-putt feedback, stroke trace) is in scope for 1.x. See [docs/PUTTINGLAB-INTEGRATION.md](../PUTTINGLAB-INTEGRATION.md).
- **Cloud backup roadmap** — memory [[cloud-backup-roadmap]]. Library + videos are device-local only today; uninstall wipes them. Cloud sync of sessionHistory + mp4 files needed before V1.0. AsyncStorage keys + Supabase / S3 / Cloudflare R2 path documented in SPRINT-LOG.md.
- **Feel-vs-real flagship** — owner-only feel-capture dataset growing now. Once we have a labeled corpus, build the feel-vs-real comparison UI for users (real GolfFix-killer feature: AI tells you what FEELS like you did vs what you REALLY did).
- **BT media-button worktree** — `.claude/worktrees/bt-media-button` native module ready; needs EAS Build to ship.
- **Coach markup (manual telestration)** — pen + line + circle + caption annotations on swing detail, per-frame. V1 scope: single-frame annotation anchored to `fault_frame_index`. SPRINT-LOG:1557.
- **Deals/booking concierge** — promo surfacing via caddie voice. Validation step: hand-curated pilot before building aggregator. SPRINT-LOG:1666.

## 1.1 — Play tab / multi-player

- **Play tab social** — arena drills with leaderboards.
- **Multi-player** — `roundStore.shots[].player_id` + `speaker_id` reserved fields are the foundation. Voice biometric for speaker ID (research-voice-biometric.md).
- **Serena specialization** — Coach-register fluency on round + practice; currently shares the same brain prompt as Kevin. Custom register-aware system prompts post-1.0.

## v2+

- **AR overlay** — research-ar-overlay.md. SmartVision AR pin overlay on the live camera feed.
- **Hand tracking** — research-hand-tracking.md.
- **MediaPipe pose** — research-mediapipe.md. Local pose alternative to RapidAPI.
- **Live activities** — research-live-activities.md.
- **Streaming TTS** — research-streaming-tts.md. Lower-latency caddie speech.
- **Voice biometric** — research-voice-biometric.md.

## Deferred TODOs

- **Sentry on MacBook** — set `EXPO_PUBLIC_SENTRY_DSN` + Sentry org/project in `eas.json` build profiles, then remove `SENTRY_DISABLE_AUTO_UPLOAD=true`. Comment in [app/_layout.tsx:79-80](../../app/_layout.tsx).
- **Whisper round-trip in feel capture** — currently the harness scenario H12 exercises the WRITE half only; the network round-trip belongs to the in-app pipeline, not the harness.

## Billing (Step 4, parked this week)

- Paywall surface scaffolded but allow-all (`services/paywallGuard.ts`).
- Pricing tier copy lives at [lib/pricing.ts](../../lib/pricing.ts).
- Subscription wiring + RevenueCat integration deferred to launch-week sprint.

## Known issues (rolling)

From BUILD-STATE-AUDIT + SPRINT-LOG:

- **Phantom round on APK reinstall** — mitigated by boot guard in `_layout.tsx`. Flag if regresses.
- **discardRound asymmetry with walkingDetector ticker** — needs verification; if discard happens mid-tick, ticker may carry stale state.
- **12 stores missing version/migrate** — low risk but noted during recap diffs. Add migrations when next persisting a schema change.
- **4 remaining Palms-image leak sites** — track which still need fixing. See SPRINT-LOG.
- **iOS-sim + fold device verification** — code review can't catch layout regressions on real glass. Run before beta cut.
- **PrimaryIssueCard catalogs** — two separate components: [components/PrimaryIssueCard.tsx](../../components/PrimaryIssueCard.tsx) (Phase 111, PrimaryIssueEntry catalog) and [components/swinglab/PrimaryIssueCard.tsx](../../components/swinglab/PrimaryIssueCard.tsx) (GolfFix-shape PrimaryIssue). Document the distinction; consider consolidation in 1.x.

## Out-of-scope for harness

Per the scenario-harness sketch — these genuinely need hardware and can't be simulated:

- holeDetection H14→H15 cart-path GPS trace timing
- BUG #1 frame-extraction quality on real swing video
- Whisper transcription quality on real ES/ZH audio
- ElevenLabs voice quality on `eleven_multilingual_v2` (ear test)
- BT button hardware tap
- Meta glasses → iPhone Photos sync (needs glasses + Meta View app)

These ship to verification via real-device sessions, not synthetic state.
