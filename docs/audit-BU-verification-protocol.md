# Phase BU — Component 6: Empirical Verification Protocol

**Audit date:** 2026-05-04

Specific empirical checks per fix type. Not "looks correct" — measurable observations against known inputs. All verification on Galaxy Z Fold dev-client, both Fold-closed and Fold-open postures unless otherwise specified.

## Universal precondition

Before any verification: cold launch the app (kill from recents), confirm `[path3:cage]` markers fire on cage entry. If not, BX (telemetry) hasn't shipped — verification cannot proceed via log grep, must inspect source.

```
adb logcat -c                      # clear log
adb logcat | grep -E "\[path3:cage\]|\[V6-DIAG\]"   # tail expected markers
```

## Verification per fix

### BV — Reconcile dual live-session UIs

**Inputs:**
- Cold launch.
- Tap SwingLab → Cage Mode card.
- Confirm distance, tap Start.

**Empirical checks:**
1. **Single UI renders.** No second screen overlapping or appearing after a delay. Visual confirmation: take screenshots at recording-active state on Fold-closed and Fold-open.
2. **All canonical controls visible without scrolling.** Stop button, flip-camera, swing count, club label, cancel/exit affordance. Measure: top edge of any control ≥ insets.top, bottom edge of last control ≤ screen height − insets.bottom.
3. **Tap each control once.** Stop should end session. Flip should swap front/back camera. Cancel should return to setup.
4. **No "ghost" old UI.** Navigate to all known cage entry points (Caddie tab Tools menu cage, SwingLab Cage Mode card, voice intent "open practice"). All should land on the same canonical UI.
5. **Logcat:** `[path3:cage] session-start` fires once per Start tap. No double markers.

**Pass:** 5/5 checks. **Fail:** any check fails → BV not shipped.

---

### BW — Per-detection clip extraction + Phase K reshape

**Inputs:**
- Indoor practice space with controlled audio environment (no background noise during test).
- 5 real swings spaced 8–10 seconds apart (clearly above debounce window).
- End session.

**Empirical checks:**
1. **Detection count.** Logcat: count of `[path3:cage] swing-detected` markers = 5 (±0). No false positives because the environment is controlled.
2. **Library entry created.** Library shows the new entry within 30 seconds of End. Source badge shows CAGE.
3. **CageShots count.** Open the entry. The session detail should reflect 5 swings (multi-swing scrubber if BZ shipped, or shot count badge).
4. **Phase K result.** Within 60 seconds of End: status transitions `pending` → `analyzing_frames` → `analyzing_pose` → `ok`. Primary issue and drill recommendation render.
5. **Per-swing analysis (if Option A/C of BW shipped).** Each of the 5 swings has its own `detected_issue` value or contributes to the per-session classifier. Verify by inspecting the underlying session in Zustand persist (AsyncStorage dump or debug screen).
6. **No `no_data` exit.** Logcat must NOT contain `[V6-DIAG] STAGE 6 FINAL — no_data`.
7. **Correlation primitive present.** The CageShots in the library entry have non-null `clipUri` values. Verify by inspecting the entry detail UI or via a debug log dump.

**Pass:** 7/7 checks. **Fail:** any check fails → BW not shipped or has a regression.

**Failure-mode investigation:**
- If checks 1–3 pass but 4 fails: Phase K shape mismatch (Option D wasn't fully wired or sample fractions still wrong). Check `[V6-DIAG]` for the `STAGE 4 returned` payload.
- If check 1 fails: detection threshold issue, verify BX markers, then BY may need to ship first.
- If check 7 fails: `clipUri` is still null or pointing at master video — extraction step missing.

---

### BX — `[path3:cage]` telemetry markers

**Inputs:**
- Cold launch.
- Cage Mode session (any duration, any swings, even cancel).

**Empirical checks:**
1. **Marker presence at every stage.** Logcat must contain `[path3:cage]` for: session-start, camera-grant, swing-detected (≥0 events), session-end, finalize-clips, library-write, phase-k-start, phase-k-result.
2. **Marker payload sane.** session-start log includes session id; swing-detected includes offset_seconds + dB; phase-k-result includes `detected_issue` + confidence.
3. **No silent stages.** Every state transition has a corresponding marker.

**Pass:** 3/3. **Fail:** missing marker → BX has gaps.

---

### BY — Detection signal-to-noise hardening

**Inputs:**
- Indoor practice space.
- Test sequence (≥3 trials, randomized order, written down):
  - 5 real swings (impact must hit a real ball or net at expected force)
  - 5 known background noises:
    - 1× clap at 1m distance
    - 1× club drop on floor
    - 1× voice ("hello, this is a test")
    - 1× footstep on hollow surface
    - 1× door close

**Empirical checks:**
1. **True-positive rate.** Out of 5 real swings: ≥4/5 detected. (Threshold: 80%.)
2. **False-positive rate.** Out of 5 known background noises: ≤1/5 triggered detection. (Threshold: 20%.)
3. **Total detection count.** Sum of detections from logcat ≤ 6 (4 true + 2 max false).
4. **Threshold not too aggressive (real swings rejected).** If real-swing detection rate <80%, BY is over-tuned; revert.
5. **Threshold not too loose (background noise accepted).** If FP rate >20%, BY is under-tuned; iterate.

**Pass:** TP ≥80% AND FP ≤20% AND counts make sense. **Fail:** outside thresholds → BY not shipped.

**Quantitative goal post-proper-fix (per-club spectral classifier):**
- TP ≥90%, FP ≤10%.

---

### BZ — Review UI capability uplift

Per-feature checks:

#### Re-analyze button
- **Input:** Open a library entry where Phase K returned `failed` or `no_data`.
- **Check:** A "Re-analyze" affordance is visible. Tap it. Status transitions back to `pending`/`analyzing_*`. Logcat shows fresh `[V6-DIAG] STAGE 0`. Final state changes (new analysis result OR honest `failed` again).
- **Pass:** Affordance present, transitions visible, completes within 60s.

#### Editable tags
- **Input:** Open a library entry from a live cage session.
- **Check:** Tap a CageShot's feel/shape/contact tag. An edit affordance opens (popover, modal, or inline picker). Change the value. Verify the new value persists (close detail, reopen, value should match).
- **Pass:** Edit completes, persists across navigation.

#### Multi-swing scrubber
- **Input:** Open a multi-swing live cage entry (5 swings).
- **Check:** A horizontal timeline component with 5 markers at the detected swing offsets. Tap marker 3. Video player jumps to the swing 3 timestamp (within ±0.5s).
- **Pass:** Markers count matches detection count, taps scrub correctly.

#### Comparison view (v2)
- **Input:** Open a swing where a "Compare with previous" affordance exists.
- **Check:** Two video panes appear side-by-side. Both autoplay synchronized. Pause one — both pause.
- **Pass:** Sync confirmed, both controls visible.

---

### CA — Per-club detection thresholds

- **Input:** Same controlled-environment swing test as BY, but one trial per club (driver, 7-iron, putter).
- **Check:** Each club's TP rate ≥90%, FP rate from cross-club noise (e.g., putter taps during driver session) ≤5%.

---

### CB — Per-clip mp4 file extraction

- **Input:** Multi-swing session of 5 swings.
- **Check:** Filesystem contains `cage_sessions/<id>/clip_0.mp4` through `clip_4.mp4`. Each file is 4–6 seconds duration, plays back correctly. Library entry references each `clip_N.mp4` as the CageShot's clipUri.

---

## Galaxy Z Fold-specific checks

For UI fixes (BV, BZ): every check must pass on **both** Fold-closed (~9:21 aspect) and Fold-open (~8:9 aspect). Document any aspect-specific divergence as a regression — the fix is not shipped until both work.

## Critical-path log marker convention (per CLAUDE.md)

The audit notes that PATH 3 CAGE has not been verified end-to-end on a real device since the studio session. Per the verification protocol section of CLAUDE.md:

> "External beta-readiness requires all four paths verified working end-to-end on a real device within the last 7 days, on a real round (not just simulated). Until that's true: internal personal beta only."

PATH 3 CAGE re-verification is required before:
- Phase BV/BW/BX/BY/BZ being declared shipped.
- Beta readiness asserted.

**The MIN VERIFY scenario for PATH 3 is:**
1. Cold launch → SwingLab → Cage Mode → confirm distance.
2. Run a 3-swing session (real swings, controlled environment).
3. End session.
4. Within 60s, verify session in library (cage badge).
5. Tap entry, verify Phase K result is `ok` with primary issue + drill (or honest `failed`/`no_data` with non-trivial reason).
6. `adb logcat | grep "\[path3:cage\]"` shows the full lifecycle with no silent stages.

If MIN VERIFY fails, the touched fix phase is **not shipped** — it's pending targeted re-fix.

## What "verified" requires

Per the standing operating principle: "Empirical verification is the bar." Every fix listed in Component 5 is in **CODED ONLY** state until Tim runs the corresponding check above on Galaxy Z Fold and the markers + UI behavior match the protocol. No commit message claims "shipped" until the protocol passes.
