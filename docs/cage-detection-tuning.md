# Cage Swing Detection — Tuning Guide

**Phase:** BY-quick
**Constants:** [constants/cageDetection.ts](../constants/cageDetection.ts)
**Detection logic:** [components/CageSessionOverlay.tsx](../components/CageSessionOverlay.tsx) `handleMeterReading`

## What changed in BY-quick

Phase BU's empirical observation: background noise (claps, voices, machinery) triggered false swing detections in cage sessions. Phase BY-quick adds a **two-sample multi-criterion validation** to reduce false positives without sacrificing true positives.

**Before BY-quick:** every audio sample above `noise_floor + 14 dB` immediately fired a detection. Single-modality, no spectral check, no profile validation.

**After BY-quick:** a sample above `noise_floor + 18 dB` becomes a CANDIDATE peak. The NEXT sample (~100ms later) verifies:
- ≥ 5 dB drop AND below threshold → SHARP transient → emit detection
- still above threshold → SUSTAINED sound → reject (voice, machinery)
- minor drop → SLOW decay → reject (clap, distant boom)

Detection latency increases by ~100ms (one metering interval). Acceptable for cage practice.

## Tunable constants

| Constant | Default | Effect | Tune up to | Tune down to |
|---|---|---|---|---|
| `METER_INTERVAL_MS` | 100 | Audio meter callback cadence | Lower latency / higher CPU | Higher latency / lower CPU |
| `METER_BUFFER_SAMPLES` | 20 | Rolling-buffer size (2s at 100ms) | Wider noise-floor smoothing | Faster noise-floor adaptation |
| `NOISE_FLOOR_MIN_SAMPLES` | 20 | Samples required before threshold logic engages | Steadier baseline | Faster startup |
| `TRANSIENT_THRESHOLD_DB` | 18 | Required dB above noise floor for candidate | Fewer false positives, may miss soft swings | Catches softer impacts, more false positives |
| `DECAY_MIN_DB_PER_SAMPLE` | 5 | Required dB drop from peak to next sample | Stricter sharpness — rejects more claps but may miss real impacts in echo-y rooms | Looser — catches more real impacts but admits more sustained-noise false positives |
| `DEBOUNCE_MS` | 1500 | Min ms between two emitted detections | Prevents double-counting | Risk of double-counting fast swings |

## Calibration scenarios

Run cage session, introduce each scenario, count emitted detections (expected: 0 or 1) vs rejected events.

### Scenario 1 — real golf swing
- 5 real swings, well-spaced (≥ 2s apart).
- **Expected:** 5 emitted detections (`[path3:cage:swing-detected status=ok]`).
- **Failure mode 1** (TPR < 5/5): threshold too high or decay too strict. Tune `TRANSIENT_THRESHOLD_DB` down OR `DECAY_MIN_DB_PER_SAMPLE` down.
- **Failure mode 2** (TPR > 5/5, e.g. 6 detections): debounce too short for echo / re-strike. Tune `DEBOUNCE_MS` up.

### Scenario 2 — single hand clap
- 1 sharp clap, ~1m from device.
- **Expected:** 0 emitted detections, 1 `[path3:cage:swing-rejected reason=slow-decay]` (claps decay fast but typically less sharply than golf impact).
- **Failure mode** (clap detected): tune `DECAY_MIN_DB_PER_SAMPLE` up. If still firing, the clap was sharper than the threshold tolerates — try `TRANSIENT_THRESHOLD_DB` up by 2-3 dB.

### Scenario 3 — voice (single word)
- "Hello, this is a test."
- **Expected:** 0 emitted detections, 1+ `[path3:cage:swing-rejected reason=sustained-loudness]`.
- Voice is sustained over multiple samples → next sample after the candidate is ALSO above threshold → rejected.
- **Failure mode** (voice detected): voice was unusually short and decayed sharply (rare). Try `TRANSIENT_THRESHOLD_DB` up.

### Scenario 4 — bag rustling / fabric noise
- Crinkle a plastic bag, brush against gear bag.
- **Expected:** 0 emitted detections.
- These tend to have moderate amplitude and slow decay → caught by either threshold or sharp-decay gate.
- **Failure mode** (rustling detected): tune `DECAY_MIN_DB_PER_SAMPLE` up.

### Scenario 5 — distant machinery (HVAC, traffic, range)
- Steady ambient at moderate level.
- **Expected:** 0 emitted detections. Steady ambient raises the noise floor; brief peaks should still need to clear `noise_floor + 18 dB`.
- **Failure mode** (intermittent detection): if a sudden machinery spike (compressor cycle) clears threshold, it should fail the decay check (machinery is sustained, not transient). If detection still fires, the spike was unusually short — tune `DECAY_MIN_DB_PER_SAMPLE` up.

## Logcat recipes

### Capture detection events + rejections
```bash
adb logcat | grep -E "\[path3:cage:(swing-detected|swing-rejected)"
```

Emitted detections show as `swing-detected status=ok` with peak/decay/threshold metadata. Rejected candidates show as `swing-rejected status=partial` with the rejection reason (`sustained-loudness` or `slow-decay`).

### Compute true-positive vs false-positive rate
```bash
adb logcat | grep "swing-detected" | wc -l   # emitted
adb logcat | grep "swing-rejected" | wc -l   # rejected
```

Combined with manual recall of how many real swings vs noises occurred during the session, you can calculate:
- **TPR (true-positive rate)** = (emitted detections during real swings) / (total real swings)
- **FPR (false-positive rate)** = (emitted detections during non-swings) / (total non-swing events)

Target for BY-quick: **TPR ≥ 0.9, FPR ≤ 0.1** in a controlled test environment.

## Known limitations

1. **Single modality.** Audio-only. A real-time pose / motion validation layer (BU phase CC) is deferred — requires running pose detection on the live camera frames, which today only runs at extraction time.

2. **No spectral filter.** A real spectral check (FFT → 1-4 kHz transient detection) would distinguish golf impact from other sharp sounds at the same dB level. `expo-av` Recording does not expose FFT data; would require a native module or routing through `services/acousticEngine.ts` (already exists for the upload pipeline, not yet wired for live detection). Phase BY-proper covers this if BY-quick proves insufficient.

3. **Per-club thresholds.** Driver impact and putter tap have different transient widths and dominant frequencies, but BY-quick uses a single threshold for all clubs. Phase CA covers this.

4. **Decay-window resolution.** `DECAY_MIN_DB_PER_SAMPLE` checks ONE sample after the peak (~100ms later). Some sharp non-swings (sneeze, single tongue-click) can decay 5+ dB in 100ms and slip through. A longer verification window (2-3 samples, voting) would help; defer to BY-proper.

## When to escalate to BY-proper

If empirical testing on Galaxy Z Fold shows:
- FPR > 0.2 with reasonable thresholds
- TPR drops below 0.85 after FPR tuning
- Specific noise types (reproducibly) bypass the multi-criterion gate

Then BY-quick has hit its ceiling. BY-proper (route live mic through `services/acousticEngine.ts` for spectral classification) becomes the next phase.
