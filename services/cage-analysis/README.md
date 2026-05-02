# SmartPlay Cage Analysis Service

FastAPI service that powers two endpoints the RN app calls during a Cage Drill:

| Endpoint | Purpose |
|---|---|
| `POST /api/cage/check-bullseye` | Live preview validity gate — single still frame, returns whether the bullseye is detected in the spec'd valid region |
| `POST /api/cage/analyze` | Full 12 s video pipeline — extracts strikes from audio, computes spectral features, localizes each impact on the canvas, returns `features.json` |
| `GET /health` | Liveness probe |

This service does **not** call the Claude API. It only extracts features and returns JSON. Coach-voice interpretation lives in the next prompt's service.

## Pipeline stages

| Stage | What it does | Module |
|---|---|---|
| 1 | `ffmpeg` extract → mono 48 kHz `s16le` WAV | [audio.py](app/audio.py) |
| 2 | High-pass at 3 kHz, RMS frames, MAD threshold, peak-floor filter (rejects speech) | [audio.py](app/audio.py) |
| 3 | Per-strike spectral features (peak dB, centroid, decay ratio, sustain/attack) | [audio.py](app/audio.py) |
| 4 | Bullseye on a clean reference frame at `t = first_strike - 1.0s` | [bullseye.py](app/bullseye.py) |
| 5 | White-mask canvas region, erode 9×9, derive `inches_per_px` from 30-inch width | [canvas.py](app/canvas.py) |
| 6 | Per-strike disturbance — `absdiff` reference vs candidate post-frames, masked to canvas, argmax = impact pixel | [disturbance.py](app/disturbance.py) |
| 7 | Inter-strike gaps (tempo signal) | [pipeline.py](app/pipeline.py) |

## Local dev

```bash
cd services/cage-analysis
python -m venv .venv
source .venv/bin/activate    # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# ffmpeg needs to be on your PATH. macOS: `brew install ffmpeg`.
# Ubuntu: `apt-get install -y ffmpeg`.

uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

## Container

```bash
cd services/cage-analysis
docker build -t cage-analysis:latest .
docker run --rm -p 8000:8000 cage-analysis:latest
```

`ffmpeg`, `libgl1`, `libglib2.0-0` are baked into the image so OpenCV-headless and the audio extract step both work.

## Wire-up

Once deployed (Cloud Run / Fly / Railway / EC2 — any container host), point the RN app at it via:

```
EXPO_PUBLIC_CAGE_API_URL=https://<your-host>
```

…and update `services/cageApi.ts` to call that base URL instead of the existing gateway. For now the client uses the project's main API URL with `/api/cage/*` paths — wire whichever pattern you want.

## Response shape

`/api/cage/check-bullseye`:

```json
{ "detected": true, "location": [534, 887], "canvas_visible": true }
```

`/api/cage/analyze`:

```json
{
  "session_id": "<uuid>",
  "video_duration_s": 12.04,
  "strike_count": 5,
  "strikes": [
    {
      "index": 1,
      "timestamp_s": 77.230,
      "peak_db": -2.1,
      "spectral_centroid_hz": 2523,
      "decay_ratio": 0.459,
      "sustain_attack_ratio": 1.42,
      "impact_offset_inches": { "horizontal": 0.2, "vertical": 0.2 },
      "impact_radius_inches": 0.3,
      "detection_confidence": "high"
    }
  ],
  "bullseye_pixel": [534, 887],
  "canvas_calibration_in_per_px": 0.052,
  "inter_strike_gaps_s": [16.76, 15.40, 16.21, 12.52],
  "warnings": []
}
```

`errors[]` field is appended if any stage failed but a partial result is still returned.

## Out of scope (deferred)

- Pose estimation (v1.5)
- Ball speed via TDOA (waits for canvas mic)
- Tim-masking via pose (canvas-only mask is good enough for v1)
