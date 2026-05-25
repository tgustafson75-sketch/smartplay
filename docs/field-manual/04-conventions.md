# 04 — Conventions & standing rules

## Git workflow

- **Every prompt is a commit** — at the end of each work batch: `git add .` → `git commit -m "..."` → `git push origin main`. The user has authorized `git push origin main` in `~/.claude/settings.json` so pushes don't prompt.
- **Co-author footer** on every commit: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- **Never `--no-verify`** unless explicitly asked. Hooks failing means investigate, not bypass.
- **Never amend or force-push** without explicit ask. Default is always a new commit on top.
- **OTA-first policy** (memory: [[ota-first-policy]]) — default to `eas update`, not new APK builds. Native builds only for: plugins / native modules / native deps / new manifest entries / new bundled assets.
- **Never uninstall the app** (memory: [[never-uninstall-app]]) — always update in place. Uninstall wipes library + videos + all local data irrecoverably.

## Persona equality

- Branding line is **"Built by SmartPlay AI"** (the company), never a single caddie name.
- All four caddies are equal. UI surfaces don't elevate any one as "the face." The canonical avatar component is [components/CaddieAvatar.tsx](../../components/CaddieAvatar.tsx); the dead `KevinAvatar.tsx` was removed in commit `532fbe5`.
- Per-pillar caddie assignment lives in `settingsStore.caddieAssignments`. Three-register interpretation (Caddie / Coach / Psychologist) is built into each character spec.
- Tank is scoped to `ask_golf_father` to keep his volume aligned with the character; he doesn't drive proactive cadence on the round surface unless the user explicitly assigns him.

## No fake precision / honest degradation

- Every metric carries a `source` + `confidence` tag (Section 2 metrics framework).
- Estimates render with a leading `~`; truth-grade values drop the prefix.
- Suppress over print — when confidence is too low to honestly print a number, render `—` and explain why.
- Server APIs follow the same rule:
  - `/api/swing-analysis` can return `primary_fault: 'inconclusive'` / `'no_dominant_fault'`.
  - `/api/acoustic-detect` returns `ball_speed_mph: null` when no club is posted (no silent 7I fallback).
  - `/api/pose-analysis` returns 200-with-null when unconfigured.
  - `queryStatusHandler` carry-check returns an honest "I don't have your driver number locked in yet" when `practiceStore.avgCarryDriver === 0`, not a hardcoded 230y comparison.
- Skeleton overlays gated to `__DEV__` so production never renders the placeholder.

## Responsive layout

- Use [hooks/useDeviceLayout.ts](../../hooks/useDeviceLayout.ts) for form-factor classification. Exports:
  - `width`, `height`, `aspect` (W/H)
  - `orientation: 'portrait' | 'near-square' | 'landscape'`
  - `isLandscape: boolean`
  - `isFoldOpen: boolean` (width ≥ 540 AND not portrait)
  - `isWide: boolean` (aspect ≥ 0.6 — phone-portrait + fold-closed are narrow; everything else is wide)
- `WIDE_CONTENT_MAX_WIDTH = 700` — centered max-width for wide-form-factor tab content. Phone/narrow renders unchanged.
- Per-screen pattern (this sprint): when `isWide`, set ScrollView's `contentContainerStyle` to `{ alignItems: 'center' }` and wrap children in a `<View style={{ width: '100%', maxWidth: 700 }}>`.
- **Locked canonical layout** — `CaddieAvatar.tsx:375-413` is the photoreal Kevin / persona portrait layout. Comments at `:383-403` explicitly forbid horizontal/vertical shifts, scale multipliers, or aspect-ratio branches at THIS layer. Adjustments happen at the parent frame, never inside the avatar.

## Diagnose before fix

- Standing rule (memory: [[standing-rules]]) — every multi-step change is preceded by a read-only audit. The repo is full of `audit-*.md` and `*DIAGNOSIS*.md` artifacts where the diagnosis happened before the fix.
- For complex fixes, the audit + fix land as two separate commits with the audit commit pushed first so its reasoning is preserved.

## Audit-then-fix

- Audits are catalogued by P0 / P1 / P2 severity. Pre-beta the bar is "0 P0 + P1 fixed." See [SHIP-QA-AUDIT.md](../../SHIP-QA-AUDIT.md) and [PLATFORM-QA-AUDIT.md](../../PLATFORM-QA-AUDIT.md).
- P2 polish items defer until post-beta with real form-factor screenshots in hand.

## Branding lock

- App name: **SmartPlay Caddie**
- Built by: **SmartPlay AI**
- Social: **@SmartPlayCaddie**
- Support: **support@smartplaycaddie.com**
- App icon + splash + intro video all reflect the four-caddie equality.

## Cart is the default

- Memory [[cart-is-default]] — ~95% of golfers ride. GPS, hole-detection, shot-detection, and round-flow logic are designed cart-first.
- Verification needs a real cart round; walker or harness-only is insufficient.
- Auto-fire suppression above 4 m/s drives this — cart speeds are treated as "transit," not shot context.

## Voice + L1 rule

- Memory [[voice-userinitiated-rule]] — `speak()` / `playLocalFile()` at launch or in response to a user tap MUST pass `{ userInitiated: true }` or it goes silent at L1 (Quiet).
- Proactive paths (`caddieRewards`, `gpsConfidenceAsk`, etc.) deliberately omit `userInitiated` so L1 stays silent.

## Trust slider order

- Memory [[trust-slider-order]] — UI cyclers MUST use `TRUST_LEVEL_SLIDER_ORDER` (=[1,5,2,3,4]), never modulo on the numeric value. L5 (Cockpit) and L1 (Quiet) sit visually adjacent because both are minimal-surface; L2/L3/L4 are the proactive-cadence ramp.

## Don't mock-fill missing data

- Memory + repeated user feedback: improve, don't break. When a real source isn't available, return null + render honestly; don't fake an answer to make a UI cell look populated.

## App-state hygiene

- Phantom-round boot guard at [app/_layout.tsx](../../app/_layout.tsx) — any persisted round >8 hours old without `currentRoundId` / `activeCourse` / `roundStartTime` is discarded at boot to prevent stale rounds waking up the full GPS + shot-detection stack at launch.
- Settings store version 7+ migrate handles persona soft-removes (Harry → Kevin) cleanly.
