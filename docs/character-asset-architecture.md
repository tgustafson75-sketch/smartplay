# Character Asset Architecture (Phase U2)

**Date:** 2026-05-04
**Companion to:** [docs/migration-gap-analysis.md](migration-gap-analysis.md) URGENT-2

---

## Audit finding

Phase BI URGENT-2 flagged a "dual-import" pattern in `app/(tabs)/caddie.tsx` for the avatar/Kevin character. Direct audit shows the framing was slightly off: it was an **orphaned import**, not a dual-render.

| | Before U2 | After U2 |
|---|---|---|
| `import CaddieAvatar` | line 24 — used in 4 JSX renderings (one per trust level: lines 1384, 1424, 1495, 1534) | unchanged — canonical |
| `import KevinAvatar` + `AvatarState` type | line 59 — orphan; **zero JSX renderings**. Phase AU residue from when L1's SmartPlay-badge mic-trigger was wrapped in a `KevinAvatar` liveliness ring; that wrapper got removed but the import + type weren't cleaned | removed |
| `kevinAvatarState: AvatarState` variable | line 651 — assigned but never used (pre-existing lint warning) | removed |
| Stale comment at line 1554 ("KevinAvatar wraps it for the liveliness ring") | inaccurate — referred to removed pattern | rewritten to point at the current dropdown-mic pattern |

Net result: **CaddieAvatar is the single canonical character renderer in caddie.tsx.** No actual rendering changes.

`components/kevin/KevinAvatar.tsx` (154 LOC) is **preserved** — it's a documented liveliness-ring component (per `services/README.md`) intended for future re-use even though there are no consumers today. Deleting it would be a structural change beyond U2 scope.

---

## Lint impact

| | Before | After |
|---|---|---|
| Errors | 1 | 1 (unchanged — apostrophe in `app/diagnostic-card.tsx:157`) |
| Warnings | 8 | **6** |

The 2 removed warnings:
- `'KevinAvatar' is defined but never used` (`app/(tabs)/caddie.tsx:59`)
- `'kevinAvatarState' is assigned a value but never used` (`app/(tabs)/caddie.tsx:651`)

This is a **net improvement** vs the pre-U2 baseline. The remaining 6 warnings (Image, SmartFinderCard, saverActive, handleChangeModePress, useMemo markTick, projectToPixels) are unrelated and stay for a future cleanup phase.

---

## Other surfaces audited (per U2 Component 4)

The U2 prompt asked to check splash, Kevin badge, and trust-spectrum visual treatments for the same dual-import pattern.

- **Splash screen**: `app.json` declares `assets/images/splash-icon.png` as a static OS-level asset. Not a React-renderable component. No import path issue.
- **Kevin badge** (`components/KevinBadge.tsx` + `assets/avatars/smartplay_caddie_badge.png`): six call sites use the asset (some via `<KevinBadge />` component, some via inline `require()` for the same PNG). This is **distinct components sharing one asset**, not dual-rendering of the same component. Correct usage. No fix needed.
- **Trust spectrum visual treatments**: render through `CaddieAvatar` per the trust-level branches in `caddie.tsx`. Already canonicalized in this audit.
- **Phase BN Serena portraits**: parameterization to the female character is handled inside `CaddieAvatar.tsx` (`SERENA_AVATARS` map keyed identically to the Kevin map; `computeSource` picks based on `voiceGender`). Same canonical render path; no parallel import.

No other dual-import patterns found.

---

## Standing rule

> **Character asset rendering uses a single canonical import path.**
>
> Future character additions (Serena, additional voices) parameterize via `voiceGender` or `characterId` inside the existing `CaddieAvatar` component map (Kevin map → Serena map → ...). Do NOT add a parallel character-specific component or a parallel import path in consumer screens. Consumers always render `<CaddieAvatar gender={voiceGender} ... />`; character-specific assets live behind that single component.

This rule is the contract; any future regression should treat parallel character imports as a code-review block.

---

## What changed (file-level)

```
app/(tabs)/caddie.tsx
  -import KevinAvatar, { type AvatarState } from '../../components/kevin/KevinAvatar';
  +// Phase U2 — KevinAvatar import removed. ...

  // Phase F comment block updated to reflect the removal.

  -const kevinAvatarState: AvatarState = ...
  +// Phase U2 — kevinAvatarState removed (dead code).

  Stale L1 comment at line 1554 rewritten.
```

`components/kevin/KevinAvatar.tsx` — untouched (preserved for future re-use).

No other files modified. tsc clean. Lint **improved by 2 warnings** vs baseline.
