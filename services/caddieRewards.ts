/**
 * Caddie reward speech — celebrates a 250+ measured drive or a 1-putt.
 *
 * Design rules (per spec):
 *   - Persona-aware: routes through the user's selected persona (TTS
 *     voiceGender follows persona via settingsStore). Text is neutral
 *     so any caddie can deliver it.
 *   - Trust-gated: only fires at L2 (Companion) and above. L1 (Quiet)
 *     and L5 (Cockpit minimal-surface) inherit silent treatment via
 *     voiceService.isVoiceAllowed; we also short-circuit here for
 *     cleanliness so we don't burn a queue slot.
 *   - Measured-only for drives: distance_yards must be a real number AND
 *     the shot must have been logged_via (voice or tap). Synth GPS-only
 *     shots don't carry distance_yards, so they naturally don't qualify.
 *   - Variety: ≥4 short lines per event, randomized, no immediate repeat.
 *   - Reuse the existing proactive-speech path — voiceService.speak with
 *     opts undefined (proactive, not userInitiated).
 *   - Event dedupe: each shot id + each (hole:putts) pair rewards at
 *     most once. Survives store re-emits and React re-renders.
 *
 * Wiring: app/_layout.tsx calls initCaddieRewards() once at root.
 */

import { useRoundStore, type ShotResult } from '../store/roundStore';
import { useSettingsStore } from '../store/settingsStore';
import { useTrustLevelStore } from '../store/trustLevelStore';
import * as voiceService from './voiceService';

export const REWARD_DRIVE_YARDS = 250;
export const REWARD_PUTTS = 1;

// Neutral, short, genuine — works in any of the four caddie voices.
// "Hammered" / "Stuck" / etc. are intentionally compact so the TTS rhythm
// carries the celebration. No "Kevin says…" framing — the voice IS the
// persona.
const DRIVE_VARIANTS: readonly string[] = [
  'Hammered. That one\'s going.',
  'Pured it. Two-fifty plus.',
  'Stepped on that drive. Good number.',
  'That ball had a tag on it. Nice strike.',
  'Long and online. Take a breath.',
];

const ONE_PUTT_VARIANTS: readonly string[] = [
  'One-putt. Stroke is on.',
  'Drained it. That counts twice.',
  'Clean roll. Move on.',
  'That\'s a stat — one-putt logged.',
  'Buried it. Onto the next.',
];

let lastDriveVariant = -1;
let lastPuttVariant = -1;
const firedShotIds = new Set<string>();
const firedPuttKeys = new Set<string>();

let lastShotsLen = 0;
const lastPuttsByHole: Record<number, number> = {};
let unsubShots: (() => void) | null = null;
let unsubPutts: (() => void) | null = null;

function pickVariant(pool: readonly string[], lastIdx: number): { text: string; idx: number } {
  if (pool.length === 1) return { text: pool[0], idx: 0 };
  let idx = Math.floor(Math.random() * pool.length);
  if (idx === lastIdx) idx = (idx + 1) % pool.length;
  return { text: pool[idx], idx };
}

function trustAllowsReward(): boolean {
  const level = useTrustLevelStore.getState().level;
  // L1 (Quiet) silent. L5 (Cockpit) inherits L1 minimal-surface treatment
  // per proactiveKevin comments. L2+ allowed.
  return level >= 2 && level <= 4;
}

async function fireReward(text: string): Promise<void> {
  const s = useSettingsStore.getState();
  if (!s.voiceEnabled) return;
  if (s.discreteMode) return;
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
  try {
    await voiceService.speak(text, s.voiceGender, s.language, apiUrl);
  } catch (e) {
    console.log('[caddieRewards] speak failed (non-fatal):', e);
  }
}

function evaluateShot(shot: ShotResult): void {
  if (!shot.id || firedShotIds.has(shot.id)) return;
  // Tee shot only — shot_in_hole_index === 1.
  if (shot.shot_in_hole_index !== 1) return;
  // Measured distance — voice or tap logged AND distance_yards > threshold.
  if (!shot.logged_via) return;
  if (typeof shot.distance_yards !== 'number') return;
  if (shot.distance_yards <= REWARD_DRIVE_YARDS) return;
  if (!trustAllowsReward()) return;

  firedShotIds.add(shot.id);
  const pick = pickVariant(DRIVE_VARIANTS, lastDriveVariant);
  lastDriveVariant = pick.idx;
  console.log('[caddieRewards] drive reward — shot', shot.id, shot.distance_yards, 'yds');
  void fireReward(pick.text);
}

function evaluatePutts(hole: number, putts: number): void {
  if (putts !== REWARD_PUTTS) return;
  const key = `${hole}:${putts}`;
  if (firedPuttKeys.has(key)) return;
  if (!trustAllowsReward()) return;

  firedPuttKeys.add(key);
  const pick = pickVariant(ONE_PUTT_VARIANTS, lastPuttVariant);
  lastPuttVariant = pick.idx;
  console.log('[caddieRewards] one-putt reward — hole', hole);
  void fireReward(pick.text);
}

export function initCaddieRewards(): () => void {
  if (unsubShots || unsubPutts) {
    return stopCaddieRewards;
  }

  lastShotsLen = useRoundStore.getState().shots.length;
  Object.assign(lastPuttsByHole, useRoundStore.getState().putts);

  unsubShots = useRoundStore.subscribe((s) => {
    if (s.shots.length === lastShotsLen) return;
    // Evaluate only NEWLY appended shots since last emit. Slice covers
    // multi-shot bursts (e.g. backfill or rapid logging) without re-firing
    // older shots; per-id dedupe is the final safety net.
    const fresh = s.shots.slice(lastShotsLen);
    lastShotsLen = s.shots.length;
    fresh.forEach(evaluateShot);
  });

  unsubPutts = useRoundStore.subscribe((s) => {
    for (const [holeStr, puttCount] of Object.entries(s.putts)) {
      const hole = Number(holeStr);
      if (!Number.isFinite(hole)) continue;
      if (lastPuttsByHole[hole] === puttCount) continue;
      lastPuttsByHole[hole] = puttCount;
      evaluatePutts(hole, puttCount);
    }
  });

  return stopCaddieRewards;
}

export function stopCaddieRewards(): void {
  if (unsubShots) { unsubShots(); unsubShots = null; }
  if (unsubPutts) { unsubPutts(); unsubPutts = null; }
}

// Reset per-round state — called when a new round starts so previous-round
// shot ids / putt keys don't suppress this round's rewards.
export function resetCaddieRewardsForRound(): void {
  firedShotIds.clear();
  firedPuttKeys.clear();
  lastDriveVariant = -1;
  lastPuttVariant = -1;
  lastShotsLen = useRoundStore.getState().shots.length;
  for (const k of Object.keys(lastPuttsByHole)) delete lastPuttsByHole[Number(k)];
  Object.assign(lastPuttsByHole, useRoundStore.getState().putts);
}
