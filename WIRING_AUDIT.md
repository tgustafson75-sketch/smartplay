# v2 Wiring Audit — Caddie Brain / Voice / Tools
Date: 2026-05-03
Branch: fix/v2-wiring

## Executive summary
- The voice **facade is correct and complete**, but **most active screens still bypass it** by importing `services/VoiceEngine` and `services/voiceService` directly. Functionally fine (same underlying code), facade discipline is broken.
- `useVoiceController` (mounted in `app/tabs/caddie.tsx`, drives the mic + free-form Q&A) routes voice through `core/voice/VoiceManager`, **not** the new `services/voice` facade — also functionally fine, just a third in-app voice surface.
- A **type / value mismatch** exists between `roundStore.Shot.result` (`'center'`) and `RoundShot.result` declared in `useShotTracking.ShotResult` (`'good'`). caddie.tsx writes `'center'` into `addRoundShot(...)` (line 1470) — the value type-asserts but is wrong vs the declared `RoundShot` enum. Currently harmless because the only consumer (`RoundAnalysis.clubIndex`) doesn't read `result`, but it is a latent bug for any future consumer.
- The `Round Setup` bottom-sheet (`showRoundSetup`, lines 3288–3301) is **dead UI** — its content is a placeholder string telling the user to "open round options from the main panel". The button at line 1926 ("Round" navRow) opens it.
- Unused / dead imports in `app/tabs/caddie.tsx`: `speakCaddieIntro` (imported line 92, never invoked).

---

## 1. Caddie brain

### Active call graph (modules actually executed from `app/tabs/caddie.tsx`)

| Module | Used at | Notes |
|---|---|---|
| `services/caddieRecommendationEngine.buildRecommendation` | caddie.tsx:1029 (inside `getContextualAdvice`) | Primary brain, sync, pure. |
| `features/caddie/personalities.applyPersonality` / `scoreAdvice` | caddie.tsx:1043, 1048, 1850 | Wraps recommendation with personality voice. |
| `services/localLearning.deriveLocalBias` | caddie.tsx:1025 | In-round miss bias. |
| `services/localLearning.buildRoundSummary` | caddie.tsx:1689 (inside `handleEndRound`) | Persisted round summary. |
| `services/roundAnalyzer.analyzeRoundInBackground` | caddie.tsx:1681 | Fire-and-forget AI analysis. |
| `features/smartCaddie/engine/RoundAnalysis.analyzeRound` | caddie.tsx:1684 | Local synchronous analysis for the post-round modal. |
| `features/smartCaddie/engine/InsightEngine.generateInsights` | caddie.tsx:1685 | Driven by `analyzeRound` output. |
| `features/smartCaddie/hooks/useSmartCaddie` | caddie.tsx:808 | Provides `caddie.recommendedClub`. |
| `features/smartCaddie/engine/PlayerLearning.buildPlayerModel` + `CombinedPlayerModel.combineModels` | caddie.tsx:793, 802 | Feed `useSmartCaddie`. |
| `engine/contextBuilder.buildFocusContext` | caddie.tsx:1572 | Free-form mic queries only. |
| `engine/focusEngine.handleFocusInput` | caddie.tsx:1579 | Free-form mic queries only. |

**NOT** referenced by active path:
- `engine/caddieEngine.getCaddieRecommendation` — only used by `app/PlayScreenClean.tsx` (dead screen).
- `engine/situationEngine.getSituationDecision` — only `app/PlayScreenClean.tsx`.
- `engine/knowledgeEngine` — reachable only via `handleFocusInput` default branch.
- `services/caddieBrain.js`, `services/caddieBrainV2.ts`, `services/caddieController.ts`, `services/caddieMessageEngine.ts`, `services/caddieOrchestrator.js`, `services/caddieResponseBuilder.js` — none imported from `app/tabs/caddie.tsx`.

### Bugs found

- **caddie.tsx:756–762 / 1466–1472 — `addRoundShot.result` type drift.** Caller passes `missResult` (roundStore `ShotResult` = `'left'|'right'|'center'|'short'|'long'`) into `addRoundShot`, but the target `RoundShot.result` is `useShotTracking.ShotResult` = `'short'|'long'|'left'|'right'|'good'`. `'center'` is therefore not a member of the declared enum. Severity: medium (latent — only `clubIndex` is read today). Fix: in `features/smartCaddie/hooks/useRoundStore.ts`, change `import type { ShotResult } from './useShotTracking'` to import `ShotResult` from `store/roundStore`, OR map `'center' → 'good'` before calling `addRoundShot`.
- **caddie.tsx:1684 — `analyzeRound(completedShots, completedRoundShots)` signature OK** (Shot[] + RoundShot[]). No bug. Cited because the prompt asked.
- **caddie.tsx:1027–1050 — `getContextualAdvice` never returns empty.** `buildRecommendation` always returns from `_base()` (≥ one branch), and the `catch` branch returns a personality-wrapped fallback. Confirmed safe.
- **caddie.tsx:1030 — `displayDistance ?? 0` produces "0 yards. Chip — pick your landing zone." when GPS not yet ready.** Severity: low. The post-shot path also passes `0` if `displayDistance` is null. Functionally degrades silently but is misleading copy. Suggest: bail early to `'Stay smooth and commit.'` when `yardage <= 0` rather than hitting the chip branch.
- **caddie.tsx:797–802 + 808 — `useSmartCaddie` is fed `roundShots` from `useCaddieRoundStore` (`RoundShot[]`), which is in-memory only.** A cold-start mid-round (e.g. app killed) leaves it empty, causing TodaySwing/PlayerLearning to fall back to a basic model. This is by-design, not a bug, but called out per the brief.
- **engine/focusEngine.ts:27 — `handleFocusInput` returns `''` on empty/whitespace queries.** Caller in caddie.tsx:1579 returns this directly to `useVoiceController.onFreeformQuery`, which will then try to speak an empty string. Severity: low. `core/voice/VoiceManager.speak` short-circuits on empty text (line 77 of VoiceManager.ts), so end-effect is silent — no crash.

### Dead imports / unused modules

- `app/tabs/caddie.tsx:92` — `speakCaddieIntro` imported, never called. Remove.
- `engine/caddieEngine.ts`, `engine/situationEngine.ts` — no live consumer outside `app/PlayScreenClean.tsx` (dead).
- `services/caddieBrain.js`, `caddieBrainV2.ts`, `caddieController.ts`, `caddieMessageEngine.ts`, `caddieOrchestrator.js`, `caddieResponseBuilder.js` — unreachable from active screens.

---

## 2. Voice routing

### Facade integrity (`services/voice/index.ts`)

All re-exports resolve:
- `speakJob, cancelAll, PRIORITY, getEngineState, onStateChange, startListening, stopListening, forceStop, canSpeak` — declared in `services/VoiceEngine.d.ts` lines 1–9. ✅
- `setGlobalGender, getGlobalGender, configureAudioForSpeech, speak` — runtime grab from `services/voiceService` via `_voiceService as VoiceServiceModule`. Trust-only (no `.d.ts`); the four names are referenced in `voiceService.js` exports — confirmed by grep of `voiceService.js` (`setGlobalGender`, `getGlobalGender`, `configureAudioForSpeech`, `speak` are all live exports).
- `VoiceTimingController` — re-exported from `services/voiceTimingController.ts`. ✅
- `VoiceController` — adapter from `services/VoiceController.js`. ✅
- `speakCaddie` shim — defined inline in facade. Used only by the dead `app/PlayScreenClean.tsx`.

### `speakJob` call sites in active screens (priorities)

- `app/tabs/caddie.tsx`
  - 919: `AMBIENT` (tip)
  - 1129: `STRATEGY` (Ask Caddie)
  - 1253, 1260, 1265: `STRATEGY`
  - 1493: `SHOT` (post-shot via `VoiceTimingController.afterShot`) ✅
  - 1519: `AMBIENT` ("Got it.")
  - 1525: `STRATEGY` (post-shot next-advice)
  - 2158: `SHOT` (penalty sheet) — **questionable**: penalty/log confirmations are typically AMBIENT, not SHOT. SHOT preempts AMBIENT/STRATEGY. Severity: low.
  - 2483: `STRATEGY`
- `app/tabs/scorecard.tsx:429` — `AMBIENT`. ✅
- `app/tabs/history.tsx:108` — `AMBIENT`. ✅
- `app/tabs/dashboard.tsx`, `app/cage/*.tsx`, `app/rangefinder.tsx`, `app/arena.tsx`, `app/rangebook.tsx` — all import `speakJob` directly from `services/VoiceEngine` (bypassing facade) but use sane priorities (mostly AMBIENT/STRATEGY).
- `features/smartCaddie/hooks/useCaddieVoice.ts:21,45` — `AMBIENT`; line 49,53 — `STRATEGY` ("hole intro", "stay composed"). All reasonable.

No `AMBIENT` priority being used for safety/critical cues was found. No `CRITICAL` use anywhere outside `VoiceController.speak`.

### `cancelAll` call sites

- `app/tabs/caddie.tsx:1128` — `Ask Caddie` re-tap: pre-clears dedup before fresh `speakJob`. Safe.
- `app/tabs/caddie.tsx:1140` — explicit `stop()` button. Safe.
- `app/tabs/caddie.tsx:1676` — start of `handleEndRound`. Will preempt any in-progress critical speech. Severity: low — by design; round is ending.
- `app/tabs/_layout.tsx:96` — `VoiceController.cancel(setVoiceState)` triggered only by `VoiceOverlay.onCancel` while phase is `LISTENING`. Routes `VoiceController.cancel` → `cancelAll(setVoiceState)` (`VoiceController.js:117`) → resets `setVoiceState('IDLE')` from VoiceEngine. ✅

No place calls `cancelAll` while a CRITICAL message is mid-flight in normal play.

### Dead direct imports bypassing the facade

Active code that imports from `services/VoiceEngine` / `voiceService` / `VoiceController` / `voiceTimingController` directly (NOT through facade):

- `app/tabs/swinglab.tsx:11–12` — `VoiceEngine`, `voiceService`.
- `app/tabs/scorecard.tsx:12` — `VoiceEngine`.
- `app/tabs/history.tsx:14` — `VoiceEngine`.
- `app/tabs/dashboard.tsx:15` — `VoiceEngine`.
- `app/rangefinder.tsx:16` — `VoiceEngine`.
- `app/arena.tsx:26` — `VoiceEngine`.
- `app/rangebook.tsx:22–23` — `VoiceEngine`, `voicePriority` (orphan).
- `app/hole-view.tsx:43` — `voiceService.speak`.
- `app/cage/session.tsx:31–32` — `VoiceEngine`, `voiceService`.
- `app/cage/summary.tsx:25` — `VoiceEngine`.
- `context/RoundContext.tsx:18` — `voiceTimingController`.
- `core/voice/VoiceManager.ts:41,45` — `VoiceEngine`, `voiceService` (intentional internal — VoiceManager is the alt facade powering `useVoiceController`).
- `voice/caddieVoice.ts:45,46` — `VoiceIntelligence` + `VoiceEngine` (called by `hooks/useVoiceCaddie.ts`).
- `engine/voiceUXEngine.ts:79` — `VoiceEngine`.
- `features/voice/useVoiceController.ts:47` — imports `speak, PRIORITY` from `core/voice/VoiceManager` (the third surface; bypasses both `services/VoiceEngine` and the new facade).
- `features/voice/useVoiceInput.ts:13` + `useVoiceController.ts:46` — pull `voiceCommandParser` directly (it's an orphan per facade comment).

`PlayScreenClean.tsx`, `inspect_archive/*`, `__trash/*` — dead/archived; not flagged.

### Voice gender propagation
- `app/_layout.tsx:76` calls `setGlobalGender(useSettingsStore.getState().voiceGender)` at boot — through facade. ✅
- `app/tabs/caddie.tsx:329` syncs every render that `voiceGender` changes — through facade.
- `app/splash.tsx`, `app/onboarding.tsx`, `app/profile-setup.tsx`, `app/settings.tsx` — none call `setGlobalGender` (grep confirmed). No path overwrites the boot value before Caddie tab.
- `app/tabs/swinglab.tsx:5265` calls `setGlobalGender(next)` — bypasses facade but routes to same `voiceService` singleton, value is the user's manual toggle.
- `app/PlayScreenClean.tsx:8371` — dead screen.

### Bugs found

- **app/tabs/caddie.tsx:2158 — `speakJob(msg, ENGINE_PRIORITY.SHOT, …)` for penalty sheet confirmation.** Should be AMBIENT. Severity: low. Fix: `ENGINE_PRIORITY.AMBIENT`.
- **Facade discipline broken.** Multiple active `app/tabs/*.tsx` and `app/*.tsx` screens import directly from `services/VoiceEngine`/`voiceService`. This will not break runtime, but the prior-work claim "Voice has been routed through a single facade" is overstated. Severity: low (organizational).
- **`features/voice/useVoiceController.ts:47` uses `core/voice/VoiceManager` instead of facade.** Three voice surfaces now exist (services/voice, core/voice/VoiceManager, direct VoiceEngine). Severity: low. They share the underlying VoiceEngine singleton, so they cooperate correctly via the engine's lock.
- **`hooks/useVoiceCaddie.ts` and `voice/caddieVoice.ts` (live in `hooks/`) reference `services/VoiceIntelligence` (an orphan per facade comment).** `useVoiceCaddie.ts` is grep-imported only by `app/PlayScreenClean.tsx` and `app/intro.tsx` — verify if `intro.tsx` is reachable (probably is on first launch). Severity: medium **only if `intro.tsx` is alive** — `VoiceIntelligence` is listed in the facade as "orphan, slated for removal".

---

## 3. Tools menu wiring

### Menu inventory (Caddie tab)

#### NavRow (caddie.tsx:1925–1938)
| Label | onPress | Status |
|---|---|---|
| Round (⛳) | `setShowRoundSetup(true)` | **DEAD-UI** — opens placeholder modal at lines 3288–3301 that just says "Open round options from the main panel". Real Round Setup is the inline `!isRoundActive` block at line 2255+. |
| Shot Card (🏌️) | `setShowShotCard(true)` | WORKING — modal at lines 3222–3286, six shot buttons each calling `recordShot(...) + handleShot(...)`. |
| More (···) | `setShowMoreMenu(true)` | WORKING — modal at lines 3303–3341 with two items. |

#### CaddieToolsStrip (caddie.tsx:1917–1922)
| Label | onPress | Status |
|---|---|---|
| SmartFinder | `openRangefinder` → `router.push('/rangefinder', …)` | WORKING — `app/rangefinder.tsx` exists. |
| Pointfinder | `setPointA(null); setPointB(null); setShowPointRanger(true)` | WORKING — modal at line 2837. |
| SmartVision | `openSmartVision` (caddie.tsx:1282) | WORKING. |
| SwingLab | `router.push('/tabs/swinglab')` | WORKING — `app/tabs/swinglab.tsx` exists. |

#### More menu (caddie.tsx:3303–3341)
| Label | onPress | Status |
|---|---|---|
| Tools (⚙️) | close + `setShowToolsMenu(true)` | WORKING — opens the GlobalMenu below. |
| SmartVision (🛰️) | close + `openSmartVision()` | WORKING. (Duplicates the strip + tools menu item.) |

#### GlobalMenu / `showToolsMenu` (caddie.tsx:2175–2246)
| Label | onPress | Status |
|---|---|---|
| Save Progress (guest only) | `setShowSaveProgress(true) + close` | WORKING — `SaveProgressModal` is mounted (import line 26). |
| End Round (round active only) | close + `handleEndRound()` | WORKING. |
| AR Rangefinder | close + `router.push('/rangefinder')` | WORKING. **Duplicate** of strip's SmartFinder. |
| SmartVision | `openSmartVision` | WORKING. **Duplicate** of strip + More-menu items. |
| Voice On/Off | `setVoiceEnabled(!voiceEnabled)` | WORKING — `voiceEnabled` gates all `speakJob` calls. |
| Calm/Aggressive Voice | `setVoiceStyle(...)` | WORKING (state-only — the value is consumed by `caddiePersonality` selection elsewhere). |
| Male/Female Voice | local set + `setGlobalGender(g)` | WORKING. |
| Earbuds On/Off | `setEarbudMode(v=>!v)` | WORKING (toggles audio routing). |
| Focus Mode On/Off | `setFocusMode(v=>!v)` | WORKING. |
| High Contrast / Normal | `setHighContrast(...)` | WORKING. |
| Bright Mode On/Off | `setBrightMode(...)` | WORKING. |
| Profile | close + `router.push('/profile-setup')` | WORKING — `app/profile-setup.tsx` exists. |
| Settings | close + `router.push('/settings')` | WORKING — `app/settings.tsx` exists. |
| Face ID On/Off | local + `BiometricLayoutControls._setBiometricEnabled?.(next)` | WORKING — visible at app boot. |
| Validation On/Off | `setValidationMode(v=>!v)` | WORKING — `ValidationPanel` rendered conditionally. |

#### Round Setup (caddie.tsx:3288–3301) — **DEAD UI**
Just a label and a one-line subtitle. No interactive controls. Triggered by NavRow "Round" button.

#### GlobalMenu component — only mounted on Caddie tab (used here as the tools sheet via `showToolsMenu`). No other Caddie-tab mount.

### Bugs found

- **caddie.tsx:3288–3301 — `showRoundSetup` modal is dead UI** (placeholder text only). Severity: high (user reports "menu items don't do what their label says"). Fix sketch: either route `setShowRoundSetup(true)` to scroll to / focus the inline Round-Setup card at line 2255+, or copy the inline Round-Setup card body inside this modal.
- **caddie.tsx:1926 — "Round" navRow button opens the dead modal above.** Same fix as above.
- **Duplicate Rangefinder + SmartVision entries** — strip + GlobalMenu + More menu all expose the same two routes. Per brief, this is intentional. Flagged: GlobalMenu's "AR Rangefinder" (line 2193) and "SmartVision" (line 2196) can now be removed once `CaddieToolsStrip` is the canonical surface.

---

## Top fixes (ranked)

1. **caddie.tsx:3288–3301** — Round Setup modal is dead UI. Replace placeholder body with the inline Round-Setup card content (lines 2255–2421+) or remove the modal and have `setShowRoundSetup(true)` scroll the ScrollView to that card. **Highest user-visible impact.**
2. **features/smartCaddie/hooks/useRoundStore.ts** — change `import type { ShotResult } from './useShotTracking'` to `import type { ShotResult } from '../../../store/roundStore'`. Fixes the `'center'` value drift caddie.tsx:1470 writes today.
3. **caddie.tsx:2158** — `ENGINE_PRIORITY.SHOT` → `ENGINE_PRIORITY.AMBIENT` for penalty-sheet voice confirmation (penalty toggling shouldn't preempt strategy speech).
4. **caddie.tsx:92** — drop unused `speakCaddieIntro` import.
5. **caddie.tsx:1030** — when `(displayDistance ?? 0) <= 0`, return `'Stay smooth and commit.'` directly instead of producing the literal "0 yards. Chip — pick your landing zone." copy.
6. **app/tabs/scorecard.tsx:12, history.tsx:14, dashboard.tsx:15, rangefinder.tsx:16, arena.tsx:26, rangebook.tsx:22, hole-view.tsx:43, cage/session.tsx:31–32, cage/summary.tsx:25, swinglab.tsx:11–12** — change `from '../../services/VoiceEngine'` and `from '../../services/voiceService'` to `from '../../services/voice'`. Restores facade discipline; no behavior change.
7. **engine/focusEngine.ts:27** — when query is empty, return a friendly default like `'I didn\'t catch that.'` instead of `''`, so the mic UX never goes silent on a blank STT result.
8. **caddie.tsx GlobalMenu items at lines 2193–2199** — remove "AR Rangefinder" and "SmartVision" from the GlobalMenu now that `CaddieToolsStrip` exposes them; reduces duplicate-action confusion.
9. **app/PlayScreenClean.tsx (dead)** — physically delete the file (and `voice/caddieVoice.ts`, `services/caddieController.ts`, `caddieBrainV2.ts`, `caddieMessageEngine.ts`, `caddieOrchestrator.js`, `caddieResponseBuilder.js`, `engine/caddieEngine.ts`, `engine/situationEngine.ts`) so future audits don't re-flag them.
10. **features/voice/useVoiceController.ts:47** — switch `speak, PRIORITY` import from `core/voice/VoiceManager` to `services/voice`. Same engine, fewer surfaces. (Cosmetic but completes the facade story.)
