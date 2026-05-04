# Research — Audio classification for canvas / strike detection (Phase BJ Component 4)

**Capability:** Real-time or post-recording classification of swing impact sounds — distinguishing flush vs. fat vs. thin vs. heel vs. toe contact, and detecting "ball hits canvas" events in cage mode.

**Verdict: QUEUE — training data and DSP scope exceeds bounded build window**

## Technical reason

Audio strike classification is genuine ML / DSP engineering, not a library install. The work splits into three independent problems, none of which has a turnkey solution for golf:

1. **Onset detection** — finding the impact peak in continuous audio. Solvable with FFT + peak-pair time-of-arrival math. The existing `services/acousticBallSpeed.ts` honestly admits this in its comment: *"Real-time audio impact detection with peak-pair time-of-arrival math is genuinely real engineering — single-peak detection alone needs careful onset detection, noise filtering, and cage-acoustic calibration."*
2. **Feature extraction** — MFCC / mel-spectrogram per impact, then either ship to a server-side classifier (Sonnet vision can't do audio classification well) or run an on-device model.
3. **On-device classification** — TensorFlow Lite / Core ML models for golf-specific impact sound. **No off-the-shelf golf model exists** — every commercial golf sensor (Arccos, Garmin Approach, Shot Scope) uses IMU not audio, and the closed source ones that do use audio (FlightScope Mevo+ for example) keep their models proprietary. SmartPlay would have to:
   - Collect a labeled dataset (1000s of swings × multiple clubs × multiple cage acoustics × multiple impact types)
   - Train a classifier
   - Deploy via TFLite / Core ML
   - Monitor drift across cages

Two stubs in the current codebase explicitly acknowledge this:
- `services/acousticEngine.ts` (6 LOC, both legacy + current) — `analyze: () => null`, `isAvailable: () => false`
- `services/acousticBallSpeed.ts` — ships a hard-coded MPH-by-club lookup tagged `confidence: 0.3, source: 'club_typical_stub'`

## What would have to change for BUILD TODAY

Either:
1. SmartPlay acquires (or pays a vendor for) a pre-trained golf strike classifier — none currently known. Effort to evaluate vendors: 4-8h research + procurement.
2. SmartPlay builds the classifier — multi-week ML project with data collection.
3. Reframe scope to *just* onset detection (ball-hits-canvas yes/no) without feel classification — much smaller. Effort: 6-12h with realistic empirical tuning. **This is the only viable BUILD TODAY scope.**

## Recommendation

**QUEUE** the full classification ambition. If Tim wants the *onset-detection* slice (binary "did the ball hit the canvas"), that could be a focused phase later — useful for triggering "did you get that?" hero-moment capture, even without feel classification. It would replace the current `acousticBallSpeed.ts` `null` return with a real "yes a strike happened" signal. Effort estimate ~10h. **Not a v1.0 ship blocker.**

The existing Phase K pose-detection pipeline already handles feel classification visually. Audio is a redundant signal for v1.0; pose is the primary path.

## Useful libraries (for the eventual build)

- `react-native-audio-recorder-player` — stable recording wrapper.
- `tensorflow-lite-react-native` (now `@tensorflow/tfjs-react-native` family) — for on-device inference. Compatibility with new architecture should be re-verified at build time.
- For server-side classification, an Anthropic Sonnet call won't help (no audio input); would need to send to a custom hosted endpoint or use OpenAI Whisper-derived embeddings as a feature vector.
