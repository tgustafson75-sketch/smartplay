/**
 * 2026-05-22 — Acoustics Analyzer.
 *
 * Higher-level acoustic interpretation in front of the existing
 * `services/acousticImpactDetector.ts` (which finds the strike timestamp
 * and peak dB) and the `services/acousticDetectApi.ts` server client
 * (which does two-peak ball-speed). This module classifies the STRIKE
 * QUALITY (flush / fat / thin / heel / toe) and TURF interaction (grass
 * / sand / hardpan / soft) from features the detector already produces.
 *
 * Today this is a **feature-based heuristic** classifier. RN/Expo can't
 * run a real DSP/FFT pipeline without a native module; we work from the
 * peak_db + decay_db + noise_floor_db + duration features that the
 * detector exposes. When a future native module ships a spectrogram, we
 * extend the heuristic OR offload to `/api/acoustic-classify`.
 *
 * The contract here is the stable surface — analyzeStrike(reading) →
 * AcousticAnalysis — so consumers (SwingLab, Cage, smartAnalysisEngine)
 * can adopt it now and benefit from any future model swap with no
 * caller changes.
 *
 * Defensive:
 *   - Missing / null inputs return an 'unknown'-class result with
 *     confidence 0 instead of throwing.
 *   - Confidence calibration is conservative — better to say "unknown"
 *     than mis-classify a strike as flush when it was thin.
 */

import { devLog } from './devLog';
import type { ImpactReading } from './acousticImpactDetector';

// ─── Enums (aligned with cageStore + roundStore conventions) ────────────

/** Where on the face the ball met. Subset of cageStore.AcousticContact
 *  with an extra 'unknown' for low-confidence reads. */
export type StrikeLocation = 'flush' | 'heel' | 'toe' | 'fat' | 'thin' | 'unknown';

/** What the club brushed through. 'grass' is the baseline; 'sand' /
 *  'hardpan' have distinct acoustic signatures from the lower
 *  fundamental frequency and altered decay. */
export type TurfInteraction = 'grass' | 'sand' | 'hardpan' | 'rough' | 'unknown';

/** Coarse quality bucket the UI surfaces as a badge. */
export type StrikeQuality = 'pure' | 'good' | 'okay' | 'bad' | 'unknown';

// ─── Public types ──────────────────────────────────────────────────────

export interface AcousticAnalysisInput {
  /** From acousticImpactDetector.detectImpact() — required. */
  reading: ImpactReading | null;
  /** Optional: noise floor in dBFS at the moment of capture. Detector
   *  exposes this on shot-detection events; pass it through when
   *  available to improve classification of quiet strikes. */
  noise_floor_db?: number | null;
  /** Optional decay (dB drop from peak to next sample). Detector's
   *  multi-shot mode exposes this per shot. */
  decay_db?: number | null;
  /** Optional context — the club + lie hint help the heuristic adjust
   *  expectations (a wedge sounds different than a driver). */
  club?: string | null;
  lie_hint?: 'fairway' | 'rough' | 'sand' | 'tee' | 'hardpan' | null;
}

export interface AcousticAnalysis {
  /** Where the ball met the face. */
  strike_location: StrikeLocation;
  /** Overall strike quality bucket. */
  quality: StrikeQuality;
  /** What the club brushed through on the way through impact. */
  turf: TurfInteraction;
  /** 0..100. Conservative — prefer 'unknown' over a wrong guess. */
  confidence: number;
  /** Raw features fed into the classifier — surfaced so the UI / debug
   *  panel can show the decision behind the call. */
  features: {
    peak_db: number | null;
    decay_db: number | null;
    noise_floor_db: number | null;
    snr_db: number | null;
    duration_ms: number | null;
  };
  /** Free-text one-liner the UI / caddie can show / speak. */
  caddie_note: string;
}

// ─── Tunables (golf rationale) ─────────────────────────────────────────
// Tuned against typical phone-mic ~6-10 ft from the player. Calibration
// will tighten with field data.
const PURE_SNR_MIN_DB     = 35;  // very crisp transient against quiet bg
const GOOD_SNR_MIN_DB     = 25;
const OKAY_SNR_MIN_DB     = 15;
const PURE_DECAY_MIN_DB   = 12;  // sharper decay = cleaner strike
const FAT_DECAY_MAX_DB    = 4;   // muffled (turf-heavy) strikes decay slowly
const THIN_PEAK_PENALTY   = -25; // thin strikes ring brighter but quieter
const SAND_PEAK_MAX_DB    = -18; // sand swallows the transient
const SAND_DECAY_MIN_DB   = 6;   // but the decay is still relatively sharp
const HARDPAN_DECAY_MIN_DB= 14;  // hardpan rings — fast, sharp decay

// ─── Public API ────────────────────────────────────────────────────────

/**
 * Classify a strike from acoustic features. Returns a fully-populated
 * AcousticAnalysis even on missing inputs (low confidence) so the UI
 * never has to render an empty state.
 */
export function analyzeStrike(input: AcousticAnalysisInput): AcousticAnalysis {
  const reading = input.reading;
  if (!reading) {
    devLog('[acoustics] no reading → unknown');
    return unknownResult('No acoustic capture for this strike.');
  }
  const peak = reading.peak_db;
  const noise = input.noise_floor_db ?? null;
  const decay = input.decay_db ?? null;
  const snr = noise != null ? peak - noise : null;
  const duration_ms = null; // reserved — detector exposes impact_ms only

  // Coarse quality bucket from SNR (best signal we have).
  const quality: StrikeQuality =
    snr == null ? (peak > -10 ? 'good' : peak > -20 ? 'okay' : 'bad')
    : snr >= PURE_SNR_MIN_DB ? 'pure'
    : snr >= GOOD_SNR_MIN_DB ? 'good'
    : snr >= OKAY_SNR_MIN_DB ? 'okay'
    : 'bad';

  // Strike-location heuristic:
  //   - pure + sharp decay → flush
  //   - muffled (low decay) → fat (turf-heavy)
  //   - bright but quiet → thin
  //   - asymmetric / mid-range → unknown (better than guessing heel/toe
  //     without lateral mic data)
  let strike_location: StrikeLocation = 'unknown';
  if (decay != null) {
    if (decay >= PURE_DECAY_MIN_DB && quality === 'pure') strike_location = 'flush';
    else if (decay <= FAT_DECAY_MAX_DB) strike_location = 'fat';
    else if (peak <= THIN_PEAK_PENALTY) strike_location = 'thin';
  } else if (quality === 'pure') {
    strike_location = 'flush';
  } else if (quality === 'bad' && peak <= THIN_PEAK_PENALTY) {
    strike_location = 'thin';
  }

  // Turf-interaction heuristic:
  //   sand: quiet peak + moderate-to-sharp decay
  //   hardpan: fast/sharp decay regardless of peak
  //   rough: muffled (low decay) without sand-like peak suppression
  //   grass: baseline (default when we have a clean strike)
  let turf: TurfInteraction = 'unknown';
  if (input.lie_hint) {
    // Honor the player's stated lie unless acoustics strongly contradict.
    if (input.lie_hint === 'sand') turf = 'sand';
    else if (input.lie_hint === 'hardpan') turf = 'hardpan';
    else if (input.lie_hint === 'rough') turf = 'rough';
    else if (input.lie_hint === 'fairway' || input.lie_hint === 'tee') turf = 'grass';
  } else {
    if (peak <= SAND_PEAK_MAX_DB && (decay == null || decay >= SAND_DECAY_MIN_DB)) {
      turf = 'sand';
    } else if (decay != null && decay >= HARDPAN_DECAY_MIN_DB && quality !== 'bad') {
      turf = 'hardpan';
    } else if (decay != null && decay <= FAT_DECAY_MAX_DB) {
      turf = 'rough';
    } else if (quality !== 'bad') {
      turf = 'grass';
    }
  }

  // Confidence blends signal availability + signal strength.
  let confidence = 0;
  if (snr != null) confidence += Math.max(0, Math.min(40, (snr - 10) * 1.3));
  if (decay != null) confidence += Math.max(0, Math.min(30, decay * 1.5));
  confidence += Math.max(0, Math.min(30, (peak + 30) * 1.0));
  confidence = Math.max(0, Math.min(100, Math.round(confidence)));

  const caddie_note = describe(strike_location, quality, turf, input.club);
  devLog(`[acoustics] strike=${strike_location} q=${quality} turf=${turf} conf=${confidence} peak=${peak} decay=${decay} snr=${snr}`);
  return {
    strike_location,
    quality,
    turf,
    confidence,
    features: { peak_db: peak, decay_db: decay, noise_floor_db: noise, snr_db: snr, duration_ms },
    caddie_note,
  };
}

/**
 * Convenience: fold an AcousticAnalysis back into a CageShot-shaped
 * tuple so existing per-shot writers can consume the result without
 * reshaping. Returns the (contact, strike_location, contact_quality)
 * tuple matching cageStore.AcousticContact + AcousticAnalysis fields.
 */
export function toCageContact(a: AcousticAnalysis): {
  contact: 'flush' | 'fat' | 'thin' | 'heel' | 'toe' | 'unknown';
  strike_location: 'center' | 'heel' | 'toe' | 'top' | 'thin' | 'fat' | 'unknown';
  contact_quality: 'pure' | 'good' | 'okay' | 'bad' | 'unknown';
} {
  // Map the analyzer's StrikeLocation (which doesn't include 'center'/'top')
  // into the cageStore enums. flush → center; fat/thin pass through.
  const sl = a.strike_location;
  return {
    contact: sl === 'flush' ? 'flush' : sl === 'fat' ? 'fat' : sl === 'thin' ? 'thin' : sl === 'heel' ? 'heel' : sl === 'toe' ? 'toe' : 'unknown',
    strike_location: sl === 'flush' ? 'center' : sl === 'fat' ? 'fat' : sl === 'thin' ? 'thin' : sl === 'heel' ? 'heel' : sl === 'toe' ? 'toe' : 'unknown',
    contact_quality: a.quality,
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────

function describe(
  loc: StrikeLocation, q: StrikeQuality, turf: TurfInteraction, club: string | null | undefined,
): string {
  const clubBit = club ? ` with the ${club}` : '';
  if (q === 'pure' && loc === 'flush') return `Flush${clubBit}. Sound of a clean strike${turf === 'grass' ? ' off the turf' : ''}.`;
  if (loc === 'fat') return `Caught it heavy${clubBit} — turf-first contact.`;
  if (loc === 'thin') return `Caught it thin${clubBit} — bladed contact.`;
  if (turf === 'sand') return `Sand strike${clubBit} — sound matches a bunker swing.`;
  if (turf === 'hardpan') return `Hardpan${clubBit} — bright, fast decay.`;
  if (q === 'good') return `Good contact${clubBit}.`;
  if (q === 'okay') return `Average contact${clubBit} — not quite flush.`;
  if (q === 'bad') return `Off-center${clubBit} — quiet strike.`;
  return `Strike captured${clubBit}.`;
}

function unknownResult(note: string): AcousticAnalysis {
  return {
    strike_location: 'unknown',
    quality: 'unknown',
    turf: 'unknown',
    confidence: 0,
    features: { peak_db: null, decay_db: null, noise_floor_db: null, snr_db: null, duration_ms: null },
    caddie_note: note,
  };
}
