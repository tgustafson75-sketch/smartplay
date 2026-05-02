"""
Pipeline — orchestrates stages 1-7 of the analyze flow.

Each stage logs entry/exit + key metrics. On error inside a stage, a partial
features.json is returned with an `errors` field rather than raising — the
client app should surface what we DID compute even if a later stage failed.
"""

from __future__ import annotations

import logging
import uuid
from pathlib import Path
from typing import Any

import cv2

from .audio import detect_strikes, extract_audio, per_strike_features
from .bullseye import detect_bullseye
from .canvas import calibrate_canvas
from .disturbance import localize_strike

log = logging.getLogger(__name__)


def _video_duration_s(cap: cv2.VideoCapture) -> float:
    fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
    n = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0.0
    if fps <= 0 or n <= 0:
        return 0.0
    return float(n) / float(fps)


def analyze_video(video_path: Path, work_dir: Path) -> dict[str, Any]:
    session_id = str(uuid.uuid4())
    log.info("[pipeline] start session=%s path=%s", session_id, video_path)

    response: dict[str, Any] = {
        "session_id": session_id,
        "video_duration_s": 0.0,
        "strike_count": 0,
        "strikes": [],
        "bullseye_pixel": None,
        "canvas_calibration_in_per_px": None,
        "warnings": [],
    }
    errors: list[str] = []

    # ── Stage 1 — audio extraction
    wav_path = work_dir / f"{session_id}.wav"
    try:
        extract_audio(video_path, wav_path)
    except Exception as exc:  # noqa: BLE001
        log.exception("[pipeline] stage1 audio extract failed")
        errors.append(f"audio_extract: {exc}")
        response["errors"] = errors
        return response

    # ── Stage 2 — strike detection
    try:
        strike_times, raw_samples, sample_rate = detect_strikes(wav_path)
    except Exception as exc:  # noqa: BLE001
        log.exception("[pipeline] stage2 strike detection failed")
        errors.append(f"strike_detection: {exc}")
        response["errors"] = errors
        return response

    response["strike_count"] = len(strike_times)
    if not strike_times:
        response["warnings"].append("no_strikes_detected")
        log.info("[pipeline] no strikes — short-circuit return")
        if errors:
            response["errors"] = errors
        return response

    # ── Stage 3 — per-strike spectral features
    try:
        spectral = per_strike_features(raw_samples, sample_rate, strike_times)
    except Exception as exc:  # noqa: BLE001
        log.exception("[pipeline] stage3 spectral features failed")
        errors.append(f"spectral_features: {exc}")
        spectral = []

    # ── Open the video for frame seeks (Stages 4, 5, 6)
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        log.error("[pipeline] cv2.VideoCapture failed to open %s", video_path)
        errors.append("video_open_failed")
        response["errors"] = errors
        # Return what we have from audio
        response["strikes"] = [_strike_dict_audio_only(i, s) for i, s in enumerate(spectral, start=1)]
        return response

    try:
        response["video_duration_s"] = round(_video_duration_s(cap), 3)

        # ── Stage 4 — bullseye on a clean reference frame (1.0 s before first strike)
        ref_ts_ms = max(0.0, (strike_times[0] - 1.0) * 1000.0)
        cap.set(cv2.CAP_PROP_POS_MSEC, ref_ts_ms)
        ok, ref_frame = cap.read()
        bullseye_pixel: tuple[int, int] | None = None
        if not ok or ref_frame is None:
            response["warnings"].append("reference_frame_unreadable")
        else:
            bull = detect_bullseye(ref_frame)
            if bull.detected and bull.location is not None:
                bullseye_pixel = bull.location
                response["bullseye_pixel"] = list(bullseye_pixel)
            else:
                response["warnings"].append("bullseye_not_found")

        # ── Stage 5 — canvas calibration (uses the same reference frame)
        calib = None
        if ok and ref_frame is not None:
            try:
                calib = calibrate_canvas(ref_frame)
            except Exception as exc:  # noqa: BLE001
                log.exception("[pipeline] stage5 canvas calibration failed")
                errors.append(f"canvas_calibration: {exc}")
        if calib is not None:
            response["canvas_calibration_in_per_px"] = round(calib.inches_per_px, 4)
        else:
            response["warnings"].append("canvas_not_calibrated")

        # ── Stage 6 — per-strike disturbance localization (and merge with Stage 3)
        strike_objects: list[dict[str, Any]] = []
        can_localize = bullseye_pixel is not None and calib is not None
        for i, sf in enumerate(spectral, start=1):
            obj: dict[str, Any] = {
                "index": i,
                "timestamp_s": round(sf.timestamp_s, 3),
                "peak_db": sf.peak_db,
                "spectral_centroid_hz": sf.spectral_centroid_hz,
                "decay_ratio": sf.decay_ratio,
                "sustain_attack_ratio": sf.sustain_attack_ratio,
                "impact_offset_inches": None,
                "impact_radius_inches": None,
                "detection_confidence": "low",
            }
            if can_localize:
                try:
                    impact = localize_strike(
                        cap=cap,
                        strike_time_s=sf.timestamp_s,
                        canvas_mask=calib.mask,         # type: ignore[union-attr]
                        bullseye_px=bullseye_pixel,     # type: ignore[arg-type]
                        inches_per_px=calib.inches_per_px,  # type: ignore[union-attr]
                    )
                except Exception as exc:  # noqa: BLE001
                    log.exception("[pipeline] stage6 localize_strike failed for index=%d", i)
                    errors.append(f"localize_strike[{i}]: {exc}")
                    impact = None
                if impact is not None:
                    obj["impact_offset_inches"] = {
                        "horizontal": impact.horizontal_inches,
                        "vertical": impact.vertical_inches,
                    }
                    obj["impact_radius_inches"] = impact.radius_inches
                    obj["detection_confidence"] = impact.confidence
            strike_objects.append(obj)

        response["strikes"] = strike_objects

        # ── Stage 7 — inter-strike timing (gaps in seconds)
        if len(strike_times) >= 2:
            gaps = [round(strike_times[i + 1] - strike_times[i], 3) for i in range(len(strike_times) - 1)]
            response["inter_strike_gaps_s"] = gaps

    finally:
        cap.release()
        # Best-effort cleanup of the extracted WAV
        try:
            wav_path.unlink(missing_ok=True)
        except Exception:  # noqa: BLE001
            pass

    if errors:
        response["errors"] = errors

    log.info(
        "[pipeline] done session=%s strikes=%d warnings=%s errors=%s",
        session_id, response["strike_count"], response["warnings"], errors,
    )
    return response


def _strike_dict_audio_only(index: int, sf: Any) -> dict[str, Any]:
    return {
        "index": index,
        "timestamp_s": round(sf.timestamp_s, 3),
        "peak_db": sf.peak_db,
        "spectral_centroid_hz": sf.spectral_centroid_hz,
        "decay_ratio": sf.decay_ratio,
        "sustain_attack_ratio": sf.sustain_attack_ratio,
        "impact_offset_inches": None,
        "impact_radius_inches": None,
        "detection_confidence": "low",
    }
