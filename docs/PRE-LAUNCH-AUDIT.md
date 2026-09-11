# Pre-launch audit — five passes over the frozen surface

**Date:** 2026-09-11 · **HEAD:** `82b755b9` · **Binaries under review:** iOS build 26 (`9fdeda03`),
Android versionCode 26 (`ebf26637`)

Framing, from Tim: *"Treat the first-run surface as closed: onboarding, splash, first round start,
paywall. If any of those is wrong in 26, the OTA won't save you."*

That is the right lens, and it changes the question from *"is HEAD correct"* to **"what did we fix
after the freeze that a day-one user still hits on launch #1"**. `fallbackToCacheTimeout: 0` means
the first session runs the EMBEDDED bundle; the OTA applies on the second launch. So the exposure is
exactly one session, and only for things on that path.

---

## Audit 1 — the first-run route · **PASS**

**The first-run route is byte-identical between build 26 and HEAD.** Verified by diffing the path:

```
git diff 9fdeda03..HEAD -- services/firstRunRoute.ts app/welcome.tsx app/permissions.tsx \
                            app/quick-start.tsx app/greeting.tsx components/onboarding/
  -> empty
```

Nothing on that path has been fixed since the freeze, so there is nothing a day-one user misses.
`app/_layout.tsx` did gain 213 lines, but they are the owner-checklist reminder (owner-gated), the
watch bridge, Sentry self-context and flag sync — none first-run-facing. `app/paywall.tsx` changed by
two characters (`'` → `&apos;`).

### Finding 1a — light-mode text, in both binaries, NOT a first-run blocker

`3f7e0e51` ("Light mode: text was frozen at dark values") landed **2026-09-04 23:36**, roughly a day
after both builds were cut. Neither shipped binary contains it. It is a real defect: the Play hero
card's text was hardcoded to dark-theme values, plus 57 more across SmartFinder, the caddie tab,
lie-analysis and setup-check, and brand yellow at ~1.1:1 contrast on white.

**It does not reach launch #1.** `store/settingsStore.ts:500` sets `theme_preference: 'dark'` as the
default for a fresh install (Tim, 2026-07-29) — so a day-one user gets dark regardless of their
phone's setting, even though `app.json` says `userInterfaceStyle: "automatic"`. Only a user who goes
into Settings and switches to light before the OTA lands sees it, and their next launch fixes it.
Same shape as the language relabel, and accepted on the same reasoning.

---

## Audit 2 — billing · **PASS**

Subscriptions are live and have never been exercised by a real purchase, so this was checked value by
value rather than by inspection.

| Check | Result |
|---|---|
| Product IDs in code vs both stores | **match** — `…full.monthly` / `…full.annual` (`lib/pricing.ts:23,59`; `_handoff/state.md:22-23,73-74`) |
| Entitlement id | `smartplay_caddie_pro` (`services/billing/purchases.ts:75`), pinned by a test |
| RevenueCat keys | real `appl_` / `goog_` — **no `test_` key**, which a sim LOCK forbids once billing is on |
| Prices / trial | $9.99 · $79 · 14 days — identical in build 26 and HEAD |

**Every billing value in the shipped binary equals HEAD and equals both stores.** The 30-line
`lib/pricing.ts` diff since the freeze is entirely the founding-price rationale comment; no value
moved. `services/featureAccess.ts` has **zero** non-comment changes since build 26.

---

## Audit 3 — launch-crash risk · **PASS**

The one class an OTA cannot rescue, because a crash on launch cannot download the fix.

- **16 KB page sizes:** the Android bundle in review IS commit `ebf26637`, which is the
  `MP_VERSION 0.10.14 → 0.10.29` bump itself. The fix Play rejected bundle 25 for is present.
- **Root error boundary:** `app/_layout.tsx:1900` wraps the tree, unchanged since build 26.
- **Sentry init:** guarded by `if (sentryDsn)` (`app/_layout.tsx:145`), unchanged since build 26. A
  missing DSN degrades; it does not throw at module scope.

### Finding 3a — both shipped binaries report the WRONG build number to Sentry

| | commit | bundled value | artifact / store |
|---|---|---|---|
| iOS 26 | `9fdeda03` | `ios.buildNumber = 25` | **26** |
| Android 26 | `ebf26637` | `android.versionCode = 25` | **26** |

`NATIVE_BUILD_NUMBER` (`app/_layout.tsx:139`) reads `Constants.expoConfig`, so Sentry's `dist` is
`"25"` for binaries both stores call **26**. Triaging a launch crash by filtering for build 26 finds
nothing, and 25 is a real, different, **rejected** Android bundle — the tag points at the wrong
artifact rather than at no artifact.

Fourth instance of the pattern `_handoff/from-code.md` logged three times on 09-04/05: *a label
diverged from the artifact*. **Self-healing** — the OTA manifest carries HEAD's 26/26, so only
first-session crashes are mistagged.

---

## Audit 4 — persistence · **PASS for launch**

45 stores use `persist` with a `migrate`. A fresh install has no persisted state, so `migrate` never
runs on day one; this is an upgrade-path concern for existing TestFlight testers only.

**Stated honestly:** the check was a file-level grep for `try {`, not per-function analysis, so
"guarded / unguarded" below is indicative, not proof. Roughly half the stores show no try/catch near
their migrate. Worth a real pass post-launch; not a launch blocker.

---

## Audit 5 — the OTA path itself · **ONE DEFECT FOUND AND FIXED**

`scripts/ota-preflight.mjs` fingerprinted `ios/` and `android/`, which `.easignore:35-36` excludes
from every EAS build. Deleting stray local copies of those dirs — a cleanup that cannot change any
artifact — moved the hash and **refused the cleanup OTA**.

That is worse than a false alarm: the only documented ways past the refusal are "ship a store build"
or "re-record the baseline", and re-recording for a reason the note does not cover is how a guard
becomes a rubber stamp. Fixed by reading `.easignore` and skipping what it excludes, so the
fingerprint covers exactly what can reach a build. 157 files → 70; every authored native directory
(`android-native/`, `ios-native/`, `plugins/`, `targets/`, `wear-os-app/`, `patches/`) is still
hashed. Committed as `82b755b9`.

---

## What shipped tonight

OTA to **preview** (`b2f86071`) then **production** (`5cf6cc5e`), sequentially, both via
`npm run ota:production` so the preflight ran. Runtime version 1.0.0, commit `82b755b9`.

Contents — prose and guards only, zero runtime behaviour change:

1. **Stale prose deleted, not updated.** Six files asserted `SUBSCRIPTIONS_ENABLED` was false; it is
   true. `edition-matrix.test.ts` pins the flag and is left as the statement of truth. Four
   conditionals ("while X is false…") were kept because they stay accurate either way.
2. **`runtimeVersion` pinned** by `runtimeversion-must-stay-a-literal.test.ts`.
3. **The i18n gate fixed** to lint changed LINES, not changed files.
4. **The OTA preflight scoped** to build-reachable files.

## What did NOT ship, and why

**Track A (full UI localization) and Track B (tier language system).**

Track A is the 158-file codemod rewrite — 2,044 strings, `en.json` 178 → 2,088 keys. It is parked on
`release/1.5-localization` (`a0687084`, pushed). It is **not ready**: 18 sim guards are still red,
and ja/ko do not exist yet. Shipping it would have put an unverified 158-file rewrite in front of
176 countries overnight, against a frozen binary, with no device check. Track B is WIP on
`feature/tier-language-system`, undeployed, and changes compute-budget gating of pose/biomech —
behaviour, not prose, four days before launch.

Both are one merge away when you want them. Neither belonged in tonight's OTA.
