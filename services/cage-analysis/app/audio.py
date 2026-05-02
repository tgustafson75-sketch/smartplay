"""
Audio pipeline — stages 1-3 of the analyze flow.

Stage 1 — Audio extraction
    ffmpeg -i input.mp4 -vn -acodec pcm_s16le -ar 48000 -ac 1 audio.wav

Stage 2 — Strike detection
    Butterworth high-pass at 3000 Hz (order 4, sosfilt)
    5 ms RMS frames, 2 ms hop
    Robust threshold: median + 8 * MAD
    find_peaks with min distance 1.2 s
    Keep peaks whose amplitude >= 10 * threshold
        (this rejects speech consonants — validated 2026-05-02)

Stage 3 — Spectral features per strike
    200 ms window centered on each peak
    True peak sample + peak amplitude (dB)
    Post-impact 100 ms: hanning + rfft
    Spectral centroid, decay ratio, sustain/attack ratio
"""

from __future__ import annotations

import logging
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, find_peaks, sosfilt

log = logging.getLogger(__name__)

SAMPLE_RATE_HZ = 48_000

# Stage 2 — strike detection params
HIGHPASS_CUTOFF_HZ = 3000
HIGHPASS_ORDER = 4
RMS_FRAME_MS = 5.0
RMS_HOP_MS = 2.0
ROBUST_K = 8.0                     # median + ROBUST_K * MAD
PEAK_AMPLITUDE_FLOOR_X = 10.0      # peak >= floor * threshold
MIN_PEAK_DISTANCE_S = 1.2

# Stage 3 — per-strike windows
PEAK_WINDOW_MS = 200.0
POST_IMPACT_MS = 100.0
DECAY_REF_MS = 5.0                 # tiny window for "RMS at peak"
DECAY_OFFSET_MS = 30.0             # tiny window centered at +30 ms
ATTACK_WINDOW = (0.0, 10.0)        # ms, energy(0-10)
SUSTAIN_WINDOW = (10.0, 50.0)      # ms, energy(10-50)


@dataclass
class StrikeFeatures:
    timestamp_s: float
    peak_db: float
    spectral_centroid_hz: float
    decay_ratio: float
    sustain_attack_ratio: float


# ─── Stage 1 ──────────────────────────────────────────────────────────

def extract_audio(video_path: Path, out_wav_path: Path) -> Path:
    """Run ffmpeg to extract mono 48 kHz s16le PCM WAV. Raises on failure."""
    log.info("[audio] extract: %s -> %s", video_path, out_wav_path)
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-i", str(video_path),
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", str(SAMPLE_RATE_HZ),
        "-ac", "1",
        str(out_wav_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg extract failed: {proc.stderr.strip()}")
    return out_wav_path


# ─── Stage 2 ──────────────────────────────────────────────────────────

def _highpass_sos(sample_rate_hz: int, cutoff_hz: int, order: int) -> np.ndarray:
    nyq = sample_rate_hz * 0.5
    return butter(order, cutoff_hz / nyq, btype="highpass", output="sos")


def _short_time_rms(samples: np.ndarray, frame_len: int, hop_len: int) -> np.ndarray:
    """Return RMS energy per frame (1-D float32)."""
    if samples.size < frame_len:
        return np.zeros(0, dtype=np.float32)
    n_frames = 1 + (samples.size - frame_len) // hop_len
    out = np.empty(n_frames, dtype=np.float32)
    for i in range(n_frames):
        start = i * hop_len
        frame = samples[start:start + frame_len].astype(np.float32)
        out[i] = float(np.sqrt(np.mean(frame * frame)))
    return out


def detect_strikes(wav_path: Path) -> tuple[list[float], np.ndarray, int]:
    """
    Returns (timestamps_seconds, raw_int16_samples, sample_rate_hz).

    Raw samples are also returned so Stage 3 can pull windows around each
    detected peak without re-reading the file.
    """
    log.info("[audio] detect_strikes: %s", wav_path)
    sr, raw = wavfile.read(str(wav_path))
    if sr != SAMPLE_RATE_HZ:
        log.warning("[audio] unexpected sample rate %d (expected %d)", sr, SAMPLE_RATE_HZ)
    if raw.ndim > 1:
        raw = raw[:, 0]

    # Float for processing, int16 retained for Stage 3 dB calc
    samples = raw.astype(np.float32)

    # High-pass at 3 kHz
    sos = _highpass_sos(sr, HIGHPASS_CUTOFF_HZ, HIGHPASS_ORDER)
    hp = sosfilt(sos, samples).astype(np.float32)

    # Short-time RMS
    frame_len = int(round(sr * RMS_FRAME_MS / 1000.0))
    hop_len = int(round(sr * RMS_HOP_MS / 1000.0))
    rms = _short_time_rms(np.abs(hp), frame_len, hop_len)
    if rms.size == 0:
        log.warning("[audio] no RMS frames computed (audio too short)")
        return [], raw, sr

    # Robust threshold: median + ROBUST_K * MAD
    median = float(np.median(rms))
    mad = float(np.median(np.abs(rms - median)))
    threshold = median + ROBUST_K * mad
    log.info("[audio] median=%.4f mad=%.4f threshold=%.4f", median, mad, threshold)

    # Peak picking with 1.2 s minimum spacing between peaks
    min_distance_frames = int(round(MIN_PEAK_DISTANCE_S * 1000.0 / RMS_HOP_MS))
    peaks, props = find_peaks(rms, height=threshold, distance=max(1, min_distance_frames))

    # Reject speech consonants — keep peaks whose amplitude is at least
    # PEAK_AMPLITUDE_FLOOR_X * threshold (ratio test, not delta)
    amplitude_floor = threshold * PEAK_AMPLITUDE_FLOOR_X
    kept = [int(p) for p, h in zip(peaks, props["peak_heights"]) if h >= amplitude_floor]

    timestamps = [float(p) * RMS_HOP_MS / 1000.0 for p in kept]
    log.info("[audio] strikes: %d (raw peaks=%d, after floor=%d)", len(kept), len(peaks), len(kept))
    return timestamps, raw, sr


# ─── Stage 3 ──────────────────────────────────────────────────────────

def _slice_ms(samples: np.ndarray, sample_rate_hz: int, center_s: float, span_ms: float) -> np.ndarray:
    half = int(round(sample_rate_hz * (span_ms / 2000.0)))
    center = int(round(center_s * sample_rate_hz))
    start = max(0, center - half)
    end = min(samples.size, center + half)
    return samples[start:end]


def _slice_after_ms(samples: np.ndarray, sample_rate_hz: int, anchor_sample: int, offset_ms: float, span_ms: float) -> np.ndarray:
    start = anchor_sample + int(round(sample_rate_hz * offset_ms / 1000.0))
    span = int(round(sample_rate_hz * span_ms / 1000.0))
    end = min(samples.size, start + span)
    start = max(0, min(start, samples.size))
    return samples[start:end]


def _rms(x: np.ndarray) -> float:
    if x.size == 0:
        return 0.0
    x = x.astype(np.float32)
    return float(np.sqrt(np.mean(x * x)))


def _energy(x: np.ndarray) -> float:
    if x.size == 0:
        return 0.0
    x = x.astype(np.float32)
    return float(np.sum(x * x))


def per_strike_features(
    raw_samples: np.ndarray,
    sample_rate_hz: int,
    strike_times: Iterable[float],
) -> list[StrikeFeatures]:
    """Compute the Stage 3 spectral feature set for each strike."""
    features: list[StrikeFeatures] = []
    int_max = float(np.iinfo(np.int16).max)

    for ts in strike_times:
        # 200 ms window centered on the peak
        window = _slice_ms(raw_samples, sample_rate_hz, ts, PEAK_WINDOW_MS)
        if window.size == 0:
            features.append(StrikeFeatures(ts, -120.0, 0.0, 0.0, 0.0))
            continue

        # True peak sample inside window
        local_peak_idx = int(np.argmax(np.abs(window)))
        peak_amplitude = float(abs(window[local_peak_idx]))
        peak_db = 20.0 * float(np.log10(max(peak_amplitude, 1.0) / int_max))

        # Map true-peak local index back to sample index in the full raw stream
        window_start_sample = max(0, int(round(ts * sample_rate_hz)) - window.size // 2)
        peak_sample = window_start_sample + local_peak_idx

        # Post-impact 100 ms: hanning + rfft
        post = _slice_after_ms(raw_samples, sample_rate_hz, peak_sample, 0.0, POST_IMPACT_MS)
        if post.size >= 8:
            window_func = np.hanning(post.size).astype(np.float32)
            spectrum = np.abs(np.fft.rfft(post.astype(np.float32) * window_func))
            freqs = np.fft.rfftfreq(post.size, d=1.0 / sample_rate_hz)
            power = spectrum * spectrum
            denom = float(np.sum(power))
            spectral_centroid = float(np.sum(freqs * power) / denom) if denom > 0 else 0.0
        else:
            spectral_centroid = 0.0

        # Decay ratio: RMS at +30 ms vs RMS at peak (use small DECAY_REF_MS windows)
        rms_peak = _rms(_slice_after_ms(raw_samples, sample_rate_hz, peak_sample, 0.0, DECAY_REF_MS))
        rms_decay = _rms(_slice_after_ms(raw_samples, sample_rate_hz, peak_sample, DECAY_OFFSET_MS, DECAY_REF_MS))
        decay_ratio = (rms_decay / rms_peak) if rms_peak > 0 else 0.0

        # Sustain/attack: energy(10-50 ms) / energy(0-10 ms)
        attack_energy = _energy(_slice_after_ms(
            raw_samples, sample_rate_hz, peak_sample, ATTACK_WINDOW[0], ATTACK_WINDOW[1] - ATTACK_WINDOW[0],
        ))
        sustain_energy = _energy(_slice_after_ms(
            raw_samples, sample_rate_hz, peak_sample, SUSTAIN_WINDOW[0], SUSTAIN_WINDOW[1] - SUSTAIN_WINDOW[0],
        ))
        sustain_attack_ratio = (sustain_energy / attack_energy) if attack_energy > 0 else 0.0

        features.append(StrikeFeatures(
            timestamp_s=float(ts),
            peak_db=round(peak_db, 2),
            spectral_centroid_hz=round(spectral_centroid, 1),
            decay_ratio=round(decay_ratio, 4),
            sustain_attack_ratio=round(sustain_attack_ratio, 4),
        ))
    return features
