# SHIP-QA AUDIT — Prioritized bug/risk catalog for beta

**Date:** 2026-05-24
**Mode:** Read-only. No source files modified. Only this doc is written.
**Scope:** What's actually broken / risky for beta, sorted by severity. Walks by risk, not file-by-file.
**Tags:** `P0` = crash / ship-blocker · `P1` = ship-quality bug for beta · `P2` = polish / defer to 1.x.

## Headline

**Zero P0 findings.** The "improve don't break" discipline of this sprint paid off — error boundary in place, critical-path try/catch coverage, timeouts on every user-facing fetch, graceful 200-with-null fallbacks on env-gated endpoints, validity gates suppressing fabrication. Two P1s with concrete fixes; the rest are P2 polish that can ride into 1.x.

---

## P0 — None

No genuine crash / ship-blocking surfaces found. Critical paths are guarded.

---

## P1 — Ship-quality bugs for beta

### P1.1 — Server silently assumes 7-iron when client posts no club
- **File:** [api/acoustic-detect.ts:108-109](api/acoustic-detect.ts#L108-L109)
- **Issue:** `const clubKey = body.club ?? '7I'; const clubTypical = CLUB_TYPICAL[clubKey] ?? CLUB_TYPICAL['7I'];` — when SmartMotion + Quick Record's new untagged-honest path posts NO `club` field, the server quietly calibrates ball speed against 7-iron. The client did the right thing (no fake assumption); the server still bakes one in.
- **User-visible symptom:** Untagged driver swing → server returns ball-speed calibrated as if it were a 7-iron → SmartMotion card shows wrong number with the existing `~` prefix masking it.
- **Fix:** When `body.club` is absent, either return `ball_speed_mph: null` (let the client fall back to pose-derivation) OR use a club-average constant + return `confidence: 'low', source: 'club_average'` so the metric synthesizer can label it honestly. Single-line server change.

### P1.2 — `carry_check` voice intent hardcodes 230y driver carry
- **File:** [services/intents/queryStatusHandler.ts:895](services/intents/queryStatusHandler.ts#L895)
- **Issue:** `const driverYards = 230; // TODO: read from accumulated club distances when wired` — answers "can I carry the bunker?" against a fake 230y driver number for every user.
- **User-visible symptom:** Voice "can I carry the trees" returns yes/no based on a number that has nothing to do with the player's actual driver carry. Confidently wrong.
- **Fix:** Read `usePracticeStore.getState().avgCarryDriver` when populated (now wired post-feel-capture sprint). When zero / unset, return honest fallback: `"I don't have your driver carry locked in yet — what do you usually hit it?"`. ~10 lines.

---

## P2 — Polish / defer to 1.x

### P2.1 — KevinAvatar is dead-imported (cleanup, NOT a persona-equality bug)
- **File:** [components/kevin/KevinAvatar.tsx](components/kevin/KevinAvatar.tsx)
- **Status:** Component file exists; **zero live imports**. Only references in [app/(tabs)/caddie.tsx:74,78,125,126,866](app/(tabs)/caddie.tsx#L74) are COMMENTS describing the historical Phase U2 removal. No JSX renders it. No `import KevinAvatar` statement anywhere.
- **Conclusion:** Not a P1 persona-equality bug. The canonical persona-aware avatar is `CaddieAvatar` (live in [components/caddie/CockpitCaddieScreen.tsx](components/caddie/CockpitCaddieScreen.tsx), [cockpit/BrandHeader.tsx](components/caddie/cockpit/BrandHeader.tsx), [cockpit/AskCaddieButton.tsx](components/caddie/cockpit/AskCaddieButton.tsx)). KevinAvatar.tsx is orphan code.
- **Fix:** Delete the file + delete the historical comment block in caddie.tsx referring to it.

### P2.2 — `KevinCoachBox` file/component name persists persona-specific branding
- **File:** [components/swinglab/KevinCoachBox.tsx](components/swinglab/KevinCoachBox.tsx)
- **Issue:** File + component named after one of four equal caddies, contradicting the v1.2 branding lock ("no single caddie is the face"). Rendered content may already be persona-aware internally; the NAME isn't.
- **Fix:** Rename to `CoachBox.tsx` / `CoachBox` component. Update import sites. Pure rename, no behavior change. Bundle with P2.1 in a single cleanup pass.

### P2.3 — `services/watchService.ts:77` exports `simulateSwing`
- **File:** [services/watchService.ts:77](services/watchService.ts#L77)
- **Status:** Function defined and exported; **zero production callers** (grep across `app/ services/ components/` returned only the definition + a comment). Cannot accidentally surface simulated watch data as real — no consumer exists.
- **Fix:** Remove the export when the Galaxy Watch IMU native module lands. Safe to leave as-is today.

### P2.4 — `coach-mode.tsx:398` multi-line TODO (Coach Mode v2)
- **File:** [app/swinglab/coach-mode.tsx:398-404](app/swinglab/coach-mode.tsx#L398-L404)
- **Status:** Multi-line TODO comment inside JSX (wrapped in `{/* */}`) listing v2 enhancements: multi-swing review walkthrough, voice-to-text coach notes, coached_member_id tag at ingest. **Renders nothing to the user** (comment, not text).
- **Fix:** Remove or move to a SPRINT-LOG entry. Cosmetic.

### P2.5 — `components/CaddieAvatar.tsx:850` re-crop TODO
- **File:** [components/CaddieAvatar.tsx:850](components/CaddieAvatar.tsx#L850)
- **Status:** Comment-only TODO about re-cropping `tank_v2_*.png` assets to 9:16. Asset cosmetics; not user-facing logic.
- **Fix:** Re-crop assets, drop the TODO. Cosmetic.

### P2.6 — `app/api/meta-voice+api.ts:131` prompt-template TODO
- **File:** [app/api/meta-voice+api.ts:131](app/api/meta-voice+api.ts#L131)
- **Status:** TODO embedded in a template-literal prompt body: `${body.image_base64 ? '/* TODO: vision frame attached — multimodal path when Meta opens camera API */' : ''}`. The string IS sent to the model when an image is attached, but reads as a code comment — inert.
- **Fix:** Either remove the placeholder string or wire the multimodal path. Low priority.

### P2.7 — `paywallGuard` with `SUBSCRIPTIONS_ENABLED = false`
- **File:** [services/featureAccess.ts:10](services/featureAccess.ts#L10), [services/paywallGuard.ts:55-96](services/paywallGuard.ts#L55-L96)
- **Behavior today:** All `triggerPaywall()` calls short-circuit to "allow" because the kill-switch is off. No paywall fires for any user. **Working as intended for beta** — free access, no billing wired.
- **1.0 blocker (separately tracked in BUILD-STATE-AUDIT.md §C):** Real Stripe / RevenueCat wiring needed before public release.
- **Fix (1.0):** Wire real billing SDK. Beta-fine as-is.

### P2.8 — `/api/swing-tempo` returns 501 stub
- **File:** [app/api/swing-tempo+api.ts](app/api/swing-tempo+api.ts)
- **Behavior:** Intentional v1.2.3 placeholder. Client (`services/metaGlasses/videoAudioService.ts`) recognizes 501 and surfaces an honest "backend not deployed yet" message via tank_advice. Honest UX, ship.
- **Fix (post-beta):** Build the ffmpeg-based audio extraction + tempo analysis pipeline (Vercel Edge can't bundle ffmpeg under 50MB — needs external worker or service).

### P2.9 — `/api/pose-analysis` returns 200-with-null when env-gated off
- **File:** Fix H — `/api/pose-analysis` returns `{ data: null, configured: false }` when `POSE_API_KEY` / `POSE_API_HOST` env vars are unset. Client falls through to null pose data.
- **Behavior:** Honest by design. SmartMotion's RealSkeletonOverlay falls through to null (StubSkeletonOverlay is now `__DEV__`-only, so production renders nothing — confirmed below). No fabrication.
- **Fix:** Wire RapidAPI MoveNet subscription + env vars OR ship the TFJS/MoveNet native module with the next EAS Build. Either lights up real pose overlay.

---

## Confirmed CLEAN — known loose ends checked

| Item | Status |
|---|---|
| **StubSkeletonOverlay** production gate | ✅ `: __DEV__ ? <StubSkeletonOverlay … /> : null` at [smartmotion.tsx:766](app/swinglab/smartmotion.tsx#L766) (commit `57aaa90`). Production NEVER renders the hardcoded-joint stub. |
| **`watchService.simulateSwing`** production callers | ✅ Zero. Function defined, no consumer. Cannot accidentally render fake watch data. |
| **KevinAvatar live rendering** | ✅ Zero JSX usages. Only comments mentioning it. Dead-import candidate, not a runtime risk. |
| **ErrorBoundary in place** | ✅ [app/_layout.tsx:924](app/_layout.tsx#L924) wraps the entire tree. Crash → graceful surface, not white screen. |
| **Critical-path fetch timeouts** | ✅ voiceCommandParser (8s), captureUtterance (12s), speak (12s) all use AbortController. Server 5xx propagates as honest failure strings via `speakHonestFailure`. |
| **Graceful degradation on env-gated endpoints** | ✅ pose-analysis returns null, transcribe defaults Whisper auto-detect, swing-tempo returns 501 stub with honest message, kevin/brain have localized fallbacks (Fix I). |
| **`as` casts in critical paths** | ✅ Limited to `intent.parameters as Record<string, unknown>` in logScoreHandler, sequenceHandler, declareHoleHandler — loose-by-design (untyped intent params from classifier). Acceptable. |
| **Array `[0]` accesses in user paths** | ✅ Sampled hits in videoUpload, swinglab uploads, profile, play tab — every one I traced is guarded by `result.canceled` check OR optional chaining (`?.[0]?.uri`). No unguarded crash candidates surfaced. |

---

## Graceful-degradation matrix

| Failure mode | Endpoint | UI behavior today | Verdict |
|---|---|---|---|
| No network | any API | speakHonestFailure → "I'm having trouble connecting — try that again" (en/es/zh) | ✅ honest |
| LLM timeout | `/api/kevin` `/api/brain` | 30s maxDuration + AbortController on client + HTTP 200 with localized fallback string from server outer catch | ✅ honest (Fix I) |
| pose-analysis env-gated off | `/api/pose-analysis` | Returns `{ data: null, configured: false }`; client renders no skeleton (StubSkeleton is __DEV__-only) | ✅ honest |
| swing-tempo backend stub | `/api/swing-tempo` | Returns 501 with honest message; client surfaces "backend not deployed yet" | ✅ honest |
| swing-analysis low confidence | `/api/swing-analysis` | S1.1 evidence-gate → `no_dominant_fault` or `inconclusive`; PrimaryIssueCard renders honest empty state | ✅ honest |
| Acoustic detection failure | `/api/acoustic-detect` | Client try/catch → pose-only fallback for ball speed | ✅ honest |
| Meta album not present | expo-media-library | importService catches → returns `[]` → no banner | ✅ honest |
| Whisper language mismatch | `/api/transcribe` | Auto-detect when settings is default `'en'` (Option A hybrid fix) | ✅ honest |
| GolfCourseAPI 503 | `/api/kevin/...` (proxy) | Bubbles to localized fallback | ✅ honest |

**No silent hangs identified.** Every observed failure path either speaks honestly or surfaces an Alert / Toast / empty state.

---

## Dead / duplicate inventory

| Item | Status |
|---|---|
| `components/CaddieAvatar.tsx` vs `components/kevin/KevinAvatar.tsx` | CaddieAvatar = canonical, live in 4 places. KevinAvatar = orphan, zero live imports. **P2 cleanup: delete KevinAvatar.** |
| `components/swinglab/KevinCoachBox.tsx` | Persona-specific name, all-caddies-equal rule says rename to `CoachBox.tsx`. **P2 cleanup.** |
| `kevin/` directory | Naming holdover from pre-multi-persona era. **P2 directory rename.** |
| Duplicate routes | None identified. Phase 420 audit verified all 14 "orphan" routes are reached; zero true orphans. |

---

## Type-safety holes (critical paths only)

| File:line | Concern | Verdict |
|---|---|---|
| `services/intents/logScoreHandler.ts:134` | `(intent.parameters ?? {}) as Record<string, unknown>` | Acceptable — intent.parameters is intentionally untyped from the classifier |
| `services/intents/declareHoleHandler.ts:82` | same | Acceptable |
| `services/intents/sequenceHandler.ts:74` | `as IntentConfidence` cast | Acceptable — confidence guards above the cast |
| **No `@ts-ignore` or `@ts-expect-error` in critical paths.** | — | ✅ Strict TS holding |

---

## Beta-readiness summary

| Bucket | Count | Action |
|---|---|---|
| **P0** | 0 | None |
| **P1** | 2 | Fix before beta (acoustic-detect 7I server fallback + carry_check hardcoded 230y) |
| **P2** | 9 | Defer to 1.x cleanup pass — none surface to a production beta user as a bug |
| **Confirmed clean** | 8 known loose ends verified | None outstanding |

**Recommendation:** ship the two P1 fixes (~1 hour total), then run Claude QA against the result + verify on hardware. P2 cleanup pass post-beta. Native build cut (BT module + expo-media-library + Android manifest perms) when ready to light up the dormant native paths.

---

**End of audit. Repo is source of truth. Change no source.**
