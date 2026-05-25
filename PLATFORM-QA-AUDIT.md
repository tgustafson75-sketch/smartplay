# Platform / Responsive QA Audit — iOS + Tablet + Fold

**Date:** 2026-05-24
**Scope:** Read-only code audit. iOS-sim, tablet, and fold-form-factor live runs are the complement, not a replacement.
**Method:** static inspection of permissions config, audio session config, `Platform.OS` branching, responsive layout primitives, safe-area handling, keyboard handling, hardcoded dimensions.
**Result headline:** **0 P0 crash findings.** 3 P1 beta findings (responsive gaps on Play/Dashboard/SwingLab tabs, keyboard-hidden inputs on iOS, one notch-collision badge). ~6 P2 polish findings.

---

## P0 — Crash on platform launch / first prompt

_None._

The high-blast-radius things we worried about all came back clean:

- **iOS permission strings (app.json:14-25)** — every permission the code actually requests has its `NS*UsageDescription` declared: camera, mic, photo-library read, location (when-in-use + always), and the bluetooth string is added by `plugins/withMetaWearablesDAT.js:379-381`. No `saveToLibraryAsync` write paths in use, so `NSPhotoLibraryAddUsageDescription` is not required. **No first-prompt crashes.**
- **Audio session config (6 call sites)** — every site that records sets `allowsRecordingIOS: true`, every site that plays sets `playsInSilentModeIOS: true`. Specifically: `services/voiceService.ts:24-37` (TTS + recording, with `InterruptionModeIOS.DoNotMix`), `services/acousticImpactDetector.ts:177-181`, `hooks/useVoiceActivityDetection.ts:97-100`, `services/audioLifecycle.ts:42-48` (cold teardown), `app/intro-video.tsx:82-85`, `services/audioRoutingService.ts:59-64`. None are Android-shaped.
- **Platform.OS branching** — no Android-only branches without a safe iOS fallback. `services/backgroundLocationTask.ts:64` early-returns `true` on iOS (POST_NOTIFICATIONS is Android-13+ only). `services/metaWearablesBridge.ts:58-60` forces native module null on iOS by design (no Apple Developer Program enrollment yet — documented at lines 25-28). `services/mediaKeyBridge.ts` / `services/earbudControl.ts` are pure event buses with no platform branches; they no-op identically on both until a native BT bridge ships. **No crash paths.**

---

## P1 — Beta blockers (silent breakage or visible mislayout under common conditions)

### P1.1 — Three tab screens have no `useWindowDimensions` adoption → no fold / tablet adaptation at all
**Files:** [app/(tabs)/play.tsx](app/(tabs)/play.tsx), [app/(tabs)/dashboard.tsx](app/(tabs)/dashboard.tsx), [app/(tabs)/swinglab.tsx](app/(tabs)/swinglab.tsx)
**Issue:** Caddie tab + Scorecard tab read `useWindowDimensions` and branch (Caddie has `W >= 540` Fold-open detection and `_preRoundBudget = W >= 540 ? 280 : 200`). Play / Dashboard / SwingLab don't subscribe to dimensions at all — content stretches uniformly across phone, fold-open, and tablet widths. Fold-unfold mid-session does NOT re-evaluate layout.
**Form factors broken:** fold-open, tablet-portrait, tablet-landscape.
**Fix shape:** Add `useWindowDimensions()` + at minimum a `W >= 540` wide-mode style branch on the three tabs' top-level grid/list containers.

### P1.2 — Multiple TextInput screens missing `KeyboardAvoidingView` → iOS keyboard hides the input field
**Files (TextInput present, no `KeyboardAvoidingView` wrapper):**
- [app/(tabs)/play.tsx:750](app/(tabs)/play.tsx#L750) and [:951](app/(tabs)/play.tsx#L951) — course search, notes
- [app/(tabs)/caddie.tsx:2797](app/(tabs)/caddie.tsx#L2797) — Notes for caddie
- [app/settings.tsx:365](app/settings.tsx#L365), [:419](app/settings.tsx#L419), [:429](app/settings.tsx#L429), [:439](app/settings.tsx#L439), [:449](app/settings.tsx#L449), [:464](app/settings.tsx#L464), [:473](app/settings.tsx#L473) — profile form (name, handicap, goal, etc.)
- [app/reference.tsx](app/reference.tsx)
- [app/cage/index.tsx](app/cage/index.tsx)
- [app/profile/custom-caddie.tsx](app/profile/custom-caddie.tsx)
**Issue:** Welcome / camera-setup / range correctly wrap with `KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}` ([app/welcome.tsx:152](app/welcome.tsx#L152), [app/swinglab/camera-setup.tsx:128](app/swinglab/camera-setup.tsx#L128), [app/swinglab/range.tsx:104](app/swinglab/range.tsx#L104)). The above don't. On iOS the keyboard will cover the input.
**Form factors broken:** iOS phone, iOS tablet (Android usually auto-resizes — less critical there).
**Fix shape:** Wrap each input cluster in `KeyboardAvoidingView` with iOS-aware behavior.

### P1.3 — `CaddieAvatar` state badge uses hardcoded `top: 84` instead of `insets.top + delta` → may collide with Dynamic Island
**File:** [components/CaddieAvatar.tsx:1054](components/CaddieAvatar.tsx#L1054)
**Issue:** The state-tag style uses `top: 84` literally. Everywhere else in Caddie tab follows the `insets.top + 38 / 78 / 100` convention ([app/(tabs)/caddie.tsx:2026](app/(tabs)/caddie.tsx#L2026), [:2066](app/(tabs)/caddie.tsx#L2066), [:2102](app/(tabs)/caddie.tsx#L2102), [:2141](app/(tabs)/caddie.tsx#L2141)). The 84px value was bumped from 14 to clear topnav on Fold-open, but it doesn't move with the safe-area inset. Phones with Dynamic Island (iPhone 15/16 Pro) have ~59pt inset; 84-59 = 25pt margin between the inset bottom and the badge — visually tight, may overlap the Island UI.
**Form factors broken:** iOS notch / Dynamic Island devices.
**Fix shape:** Replace `top: 84` with computed `top: insets.top + N` (N ≈ 30–35 to preserve the post-Phase-AU Fold-open clearance) via inline style passed from the parent.

---

## P2 — Polish (visible issues but non-blocking; degrade gracefully)

### P2.1 — Caddie tab vertical-offset literals are inset-aware but use fixed phone-height deltas
**Files:** [app/(tabs)/caddie.tsx:2026](app/(tabs)/caddie.tsx#L2026) (`+38`), [:2066](app/(tabs)/caddie.tsx#L2066), [:2102](app/(tabs)/caddie.tsx#L2102), [:2112](app/(tabs)/caddie.tsx#L2112) (`+78`), [:2141](app/(tabs)/caddie.tsx#L2141) (`+100`), [:2164](app/(tabs)/caddie.tsx#L2164) (`+160 / +240` conditional)
**Issue:** All correctly add `insets.top`, but the deltas (38, 78, 100, 160, 240) assume phone-height proportions. On tablet landscape the safe-area is very shallow and the stacks may compress or visually overlap.
**Form factors broken:** tablet-landscape (compression), tablet-portrait (cosmetic gap).
**Fix shape:** Either scale the deltas by `W` / aspect ratio, or convert to flex layout where possible.

### P2.2 — `aspectRatio` fold detection in CaddieAvatar uses a single threshold
**File:** [components/CaddieAvatar.tsx:380](components/CaddieAvatar.tsx#L380) (`const isFolded = aspectRatio > 1.6`)
**Issue:** Single H/W ratio split. Tablet portrait (~1.33) and fold-open (~1.13) both land in the "not folded" branch, but they're materially different layouts. Cap formula on line 408-413 (`isFolded ? W * 1.1 : H * 0.52`) gives the same answer for both.
**Form factors broken:** tablet-portrait (avatar undersized vs available height).
**Fix shape:** Add a tablet-portrait branch or use both width AND aspect ratio.

### P2.3 — Cage Mode fold-detection threshold is width-only
**File:** [app/swinglab/cage-mode.tsx:143](app/swinglab/cage-mode.tsx#L143) (`const isFoldOpen = W >= 540`)
**Issue:** Width-only threshold. A tablet in portrait (W ≈ 768) and a Fold in open mode (W ≈ 673) both trigger `isFoldOpen` — same layout — even though the available vertical space is very different.
**Form factors broken:** tablet-portrait (wide-layout selected when tall layout would fit better).
**Fix shape:** Add an aspect-ratio guard alongside the width check.

### P2.4 — BT media-button native bridge currently no-op on both platforms (architectural state)
**File:** [services/mediaKeyBridge.ts](services/mediaKeyBridge.ts) (lines 4-8 comment)
**Issue:** Not a bug — design state. `react-native-track-player` was removed (New-Arch incompatibility). Earbud-tap is currently a no-op on iOS AND Android until a native bridge ships. On-screen tap still works. Worktree at `.claude/worktrees/bt-media-button/` holds the in-progress native module.
**Form factors affected:** all (hands-free path is mic+voice, not BT taps).
**Fix shape:** ship the worktree's native module behind an EAS Build cut. Tracked separately.

### P2.5 — Debug/setup screens have fixed `height` literals
**Files:** [app/cage-debug.tsx:716](app/cage-debug.tsx#L716) (`height: 220`), [app/swinglab/camera-setup.tsx:351](app/swinglab/camera-setup.tsx#L351) (`height: 240`)
**Issue:** Not in main user flow. Cage-debug is a developer screen; camera-setup is a one-time onboarding step.
**Form factors broken:** fold-closed (squeezes), tablet (looks underfilled).
**Fix shape:** Only if these screens get user-facing in the beta — convert to percentage or aspect-ratio based.

### P2.6 — Hole-View distance / drag-hint overlays use fixed pixel offsets (10-12px)
**Files:** [app/hole-view.tsx:1537](app/hole-view.tsx#L1537), [app/hole-view.tsx:1550](app/hole-view.tsx#L1550)
**Issue:** Small offsets (10-12px) so absolute mislayout risk is low. Image height itself is responsive (`IMAGE_HEIGHT_SAT` caps at `H * 0.42`, `IMAGE_HEIGHT_BUNDLED` at `H * 0.55`). The overlays sit at fixed-margin from the image edge regardless of form factor.
**Form factors broken:** tablet-landscape (overlay may visually pinch the image).
**Fix shape:** Lift to `useSafeAreaInsets`-aware bottom margin if the image dominates a wide viewport.

---

## What's already responsive (don't touch)

These were verified solid:

- **CaddieAvatar canonical layout** — [components/CaddieAvatar.tsx:375-413](components/CaddieAvatar.tsx#L375-L413) reads `useWindowDimensions`, branches on aspect ratio for fold detection, computes height via `Math.min(availableHeight, isFolded ? W * 1.1 : H * 0.52)`. Comment at [:383-403](components/CaddieAvatar.tsx#L383-L403) explicitly forbids horizontal/vertical shifts and scale multipliers at this layer. Persona-specific `resizeMode` override for Tank at [:855](components/CaddieAvatar.tsx#L855) is documented and intentional. **Locked — leave alone.**
- **Hole-View image sizing** — [app/hole-view.tsx:140-162](app/hole-view.tsx#L140-L162) branches on `isLandscape = W > H`, caps image height at `H * 0.42` (satellite) or `H * 0.55` (bundled). Adapts cleanly to fold + tablet.
- **Caddie tab pre-round avatar frame** — [app/(tabs)/caddie.tsx:135-137](app/(tabs)/caddie.tsx#L135-L137) computes `_preRoundBudget = W >= 540 ? 280 : 200` and `avatarFrameHeight = Math.min(W * 16 / 9, _avatarMaxH)`. Good responsive shape.
- **Audio session config** — all 6 sites pass iOS-required flags. Locking `staysActiveInBackground: false` on acoustic-detect is intentional (foreground-only metering during video record). `InterruptionModeIOS.DoNotMix` in voiceService prevents Spotify mixing during mic capture.
- **Safe-area on full-screen surfaces** — [app/hole-view.tsx:1259](app/hole-view.tsx#L1259), [app/smartfinder.tsx:199](app/smartfinder.tsx#L199), [app/settings.tsx:341](app/settings.tsx#L341) all use `SafeAreaView edges={['top']}` correctly. Caddie tab uses `useSafeAreaInsets()` directly.

---

## Priority order for the fix pass

1. **P1.2** — KeyboardAvoidingView wrapping on Play / Caddie notes / Settings / Reference / Cage / Custom Caddie. Mechanical; one wrapper per screen; low regression risk.
2. **P1.3** — Replace `CaddieAvatar.tsx:1054` `top: 84` with inset-aware offset. One-line change passed through as an inline style.
3. **P1.1** — Add `useWindowDimensions` + a wide-mode breakpoint on Play / Dashboard / SwingLab tabs. Visual-only, no logic change.
4. **P2.1-P2.6** — Defer; visible but non-blocking. Group into a single post-beta polish PR after we have real form-factor screenshots in hand.

iOS-sim run and a fold device check should follow this audit before beta — code review only catches what's grep-able; layout regressions on real glass need eyes.
