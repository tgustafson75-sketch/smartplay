# 06 — Ship status

## Launch spine: verify → bill → submit

Three-step path from "feature-complete" to "in users' hands":

### Step 1 — VERIFY (in progress, this week)
Pre-beta verification on real device. Bar = "no P0 / no P1 open."

- **SHIP-QA-AUDIT.md** — bug catalog landed. Headline: 0 P0, 2 P1, 9 P2.
  - **P1.1 — server `acoustic-detect` 7I fallback** → FIXED (commit `532fbe5`). Returns `ball_speed_mph: null` when no club.
  - **P1.2 — `queryStatusHandler` hardcoded 230y driver** → FIXED (commit `532fbe5`). Reads `practiceStore.avgCarryDriver` with honest fallback.
  - P2 polish items deferred to post-beta.
- **PLATFORM-QA-AUDIT.md** — iOS + tablet + fold audit. Headline: 0 P0, 3 P1, 6 P2.
  - **P1.1 — Play/Dashboard/SwingLab tabs no `useWindowDimensions`** → FIXED (commit `538cfb3`). `isWide` + `WIDE_CONTENT_MAX_WIDTH = 700`.
  - **P1.2 — KeyboardAvoidingView on iOS** → FIXED (commit `213f79e`). 6 screens wrapped.
  - **P1.3 — CaddieAvatar `top: 84` Dynamic Island risk** → FIXED (commit `213f79e`). Now `insets.top + 60`; Z Fold visual-no-op preserved.
  - P2 polish items deferred.
- **Field validation** — Tank lesson at Prunridge (2026-05-21) + on-course Nick Chertok demo (in scope before public beta).
- **Real cart round** required for [[cart-is-default]] verification — walker / harness-only is insufficient.
- **Scenario harness** at `/harness` runs 17 scenarios against real stores; useful for the "shipped-unverified" bucket from BUILD-STATE-AUDIT §B.

### Step 2 — BILL (parked this week)
Subscription / paywall wiring. Currently paywallGuard is intentionally allow-all for beta (commit context: P2.7). Real billing surfaces remain stubbed; see `docs/v1-scope-final.md`.

### Step 3 — SUBMIT
App Store + Play Store submission. Standing TODO (Wednesday MacBook): add `EXPO_PUBLIC_SENTRY_DSN` + Sentry org/project to `eas.json`, then remove `SENTRY_DISABLE_AUTO_UPLOAD=true` from build profiles. Pre-existing iOS deployment notes at [docs/IOS-DEPLOYMENT.md](../IOS-DEPLOYMENT.md).

---

## Beta vs first-release split

| Layer | Beta | First release |
|---|---|---|
| **Caddie brain** | All 4 personas active (Harry dormant, type-valid, one-line re-enable) | Same |
| **Voice + hands-free** | ✅ shipped (auto ES/ZH, Meta ingest, watch-this, quick-record) | Same + BT media-button native bridge (worktree → EAS Build) |
| **GPS / hole detection** | ✅ shipped + truth-first resolver + Flow A/B/C verify | Same; real cart round validation required |
| **SmartMotion** | ✅ real Sonnet read + S1.1 evidence-gated + acoustic ball speed + structured fault | Same + pose-detection wiring (post 1.0) |
| **SmartVision** | ✅ Golfshot + Vector renderers | Same |
| **TightLie** | ✅ shipped, single-frame Sonnet | Same |
| **PLAY pillar** | ✅ Play + Dashboard tabs + Recap | + Arena drills social / sharing |
| **Coach Mode** | ✅ player scan + calibration profile (beta foundation) | + multi-player + Coach markup |
| **Subscription** | Paywall allow-all (beta) | Real billing wiring + tiers |
| **Library cloud backup** | ❌ device-local only | Cloud sync of sessionHistory + mp4 files |
| **Galaxy Watch IMU** | ❌ scaffolded + reserved | Wired (needs native module + EAS Build) |

---

## Gap-closer campaign (S1-S5 / V1-V4)

Tracked across SPRINT-LOG.md. Status as of `017e56b`:

### S — Swing analysis honesty / structure

- **S1.1 — evidence-gated fault selection** → DONE (`f468c52`). PrimaryIssueCard renders `inconclusive` / `no_dominant_fault` when evidence is weak.
- **S2 — TEMPORAL ANALYSIS prompt** → DONE. Anti-frame-1-anchoring at `api/swing-analysis.ts:145-151`.
- **S3 — `__DEV__`-gated stub skeleton** → DONE (`57aaa90`). Production never renders fake pose.
- **S4 — acoustic = estimate tier** → DONE (`ae58836`). `~` + range + med, not truth-grade.
- **S5 — club wiring** → DONE (`0ac173c`). Real club into SmartMotion + Quick Record; no fake 7I default.

### V — Verify slices (GPS-verify)

- **V1 — Flow A: speak raw yardage to pin** → DONE (`a347e0b`).
- **V2 — Flow B: confidence-gated proactive hole ask** → DONE (`98511a6`).
- **V3 — Flow C: declared-position cross-check + Mark on divergence** → DONE (`406ab3a`).
- **V4 — Voice spine extensions** (one-phrase-one-path, ES/ZH TTS model, platform perms, CourseTruth truth-first, Meta ingest, tee geofence, ask_golf_father) → DONE (`ecf57d9`).

### Beta-prep extensions (this sprint)

- **SHIP-QA P1 fixes** → DONE (`532fbe5`).
- **Platform P1 fixes** → DONE (`213f79e`, `538cfb3`).
- **Caddie rewards** (250+ drive, 1-putt) → DONE (`437a907`).
- **Scenario harness** (17 scenarios) → DONE (`017e56b`).
- **Field manual + verification checklist** → DONE (this commit).

---

## Current step status

**Step 1 (VERIFY)** is the active step. Bar to advance:

1. ✅ 0 P0 open across SHIP-QA + PLATFORM-QA.
2. ✅ All P1 items closed.
3. ⏳ Real cart round verification on Z Fold + iPhone (cart-is-default rule).
4. ⏳ iOS-sim run for PLATFORM-QA visual confirmation (real-device only catches code-level findings).
5. ⏳ Real fold form-factor run for tablet/fold visual confirmation.
6. ⏳ Owner verification-checklist sweep (field-manual checklist surface, this commit).

Once 3–6 are green, advance to Step 2.
