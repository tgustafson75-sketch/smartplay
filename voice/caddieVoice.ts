/**
 * voice/caddieVoice.ts
 *
 * Caddie Voice Facade — the single source of truth for WHEN and HOW the
 * AI caddie speaks during a round.
 *
 * This module is the "personality layer".  All voice output in the app should
 * route through these four trigger points:
 *
 *   caddieVoice.onHoleLoad(hole, par, dist, club, mode)
 *   caddieVoice.onYardageUpdate(newYards, prevYards, club, mode)
 *   caddieVoice.onShotRecorded(result, club, recentResults)
 *   caddieVoice.onMicTap(dist, club, mode)   ← always speaks, bypasses guards
 *   caddieVoice.cancel()
 *
 * SPEAK RULES (enforced here):
 *   ✓ New hole loads
 *   ✓ GPS yardage changes > 5 yards (walking threshold)
 *   ✓ After every shot
 *   ✓ User taps mic (always fires)
 *   ✗ On every render / minor state changes (enforced by VoiceIntelligence cooldown)
 *   ✗ When audio is already playing (VoiceEngine handles this)
 *   ✗ Mic is active / user is speaking
 *
 * PHRASE FORMAT:
 *   [Distance] [Club variation] [Instruction]
 *   "150 middle.  Nice easy 7.  Favor left side."
 *
 * TONE CONTROL:
 *   safe mode       → calmer verbs, "smooth / easy / comfortable"
 *   aggressive mode → more assertive verbs, "fire / commit hard / go for it"
 *   neutral mode    → balanced
 *
 * No React, no imports from the app — pure JS/TS.
 */

import {
  shouldSpeak,
  record,
  autoSpeak,
  setListening,
  getPreShotMessage,
  getShotFeedback,
  PRIORITY,
} from '../services/VoiceIntelligence';
import { cancelAll, speakJob } from '../services/VoiceEngine';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CaddieVoiceMode = 'safe' | 'neutral' | 'aggressive';

export interface CaddieVoiceContext {
  /** Yards to target (plays-like or raw) */
  distance:    number;
  /** Club name, e.g. "7 Iron" */
  club?:       string;
  /** Pin position label, e.g. "middle", "front" */
  pin?:        'front' | 'middle' | 'back';
  /** Play mode from situationEngine */
  mode?:       CaddieVoiceMode;
  /** Aim instruction, e.g. "Aim Slight Left" */
  aimLabel?:   string;
  /** One-line caddie note */
  note?:       string;
}

// ─── Phrase pools (variation engine) ─────────────────────────────────────────

// Club descriptors by mode — 5 variations each
const CLUB_SAFE: string[] = [
  'Nice easy {club}.',
  'Comfortable {club} here.',
  'Smooth {club} swing.',
  'Simple {club} — easy tempo.',
  'Relaxed {club}.',
];

const CLUB_NEUTRAL: string[] = [
  '{club}.',
  'Go with the {club}.',
  'Club up to the {club}.',
  '{club} all day here.',
  'Trust the {club}.',
];

const CLUB_AGGRESSIVE: string[] = [
  'Fire the {club}.',
  'Commit to {club} — go for it.',
  '{club} — full send.',
  'Attack with the {club}.',
  'Flush the {club}.',
];

// Hole-start intros
const HOLE_START_SAFE: string[] = [
  'Hole {hole}. Par {par}. Smart targets — play to the middle.',
  'Hole {hole}, par {par}. Stay patient out here.',
  'New hole. {hole}. Par {par}. Calm swing, solid target.',
  'Hole {hole}. Par {par}. One step at a time.',
  'Tee box. Hole {hole}, par {par}. Breathe and commit.',
];

const HOLE_START_NEUTRAL: string[] = [
  'Hole {hole}. Par {par}. Let\'s go.',
  'Hole {hole}. Par {par}. {dist} yards to the middle.',
  'New hole — {hole}. Par {par}. Pick your line.',
  'Hole {hole}. Par {par}. {club} looks right. Go.',
  'Tee box. Hole {hole}, par {par}. Stay with your routine.',
];

const HOLE_START_AGGRESSIVE: string[] = [
  'Hole {hole}. Par {par}. Back yourself — attack the green.',
  'New hole. {hole}. Par {par}. You\'re dialed in — keep pressing.',
  'Hole {hole}. Par {par}. {dist} yards — {club}. Fire.',
  'Tee it up. Hole {hole}. You\'re in form — take it on.',
  'Hole {hole}. Par {par}. Commit hard. You\'ve got this.',
];

// Post-shot additions (tacked onto VoiceIntelligence base feedback)
const BOUNCE_BACK: string[] = [
  'Reset. One smooth swing.',
  'Let that one go. Clean slate.',
  'Shake it off. Next shot only.',
  'Stay with your routine.',
  'One shot at a time. You\'ve got this.',
];

const HOT_STREAK: string[] = [
  'Keep that feeling going.',
  'That\'s your swing right there.',
  'Stay in the zone.',
  'Same routine. Trust it.',
  'You\'re locked in.',
];

// Mic-tap intro lines (bypass guards)
const MIC_TAP_LINES: string[] = [
  '{dist} to the middle. {club}. {aim}',
  '{dist} yards. {club}. {aim}',
  '{dist} middle. {club}. {aim}',
  'You\'re at {dist}. {club}. {aim}',
  '{dist} out. {club} — {aim}',
];

// ─── Cursor cycling (dedup / variation) ──────────────────────────────────────

const _cursors: Record<string, number> = {};
function cycle(key: string, pool: string[]): string {
  const i = (_cursors[key] ?? 0) % pool.length;
  _cursors[key] = i + 1;
  return pool[i];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}

function clubPhrase(club: string | undefined, mode: CaddieVoiceMode): string {
  if (!club || club === '?') return '';
  const pool = mode === 'safe' ? CLUB_SAFE : mode === 'aggressive' ? CLUB_AGGRESSIVE : CLUB_NEUTRAL;
  return fill(cycle(`club_${mode}`, pool), { club });
}

function pinLabel(pin: CaddieVoiceContext['pin']): string {
  if (!pin || pin === 'middle') return 'middle';
  if (pin === 'front') return 'front';
  return 'back';
}

/**
 * Build the structured caddie phrase:
 *   "{distance} {pin}. {club variation}. {instruction}"
 *
 * Example: "150 middle. Nice easy 7 Iron. Favor left side."
 */
function buildPhrase(ctx: CaddieVoiceContext): string {
  const mode = ctx.mode ?? 'neutral';
  const dist = Math.round(ctx.distance);
  const pin  = pinLabel(ctx.pin);
  const club = clubPhrase(ctx.club, mode);
  const aim  = ctx.aimLabel ?? '';
  const note = ctx.note ?? '';

  const parts: string[] = [];
  parts.push(`${dist} ${pin}.`);
  if (club) parts.push(club);
  if (aim && aim !== 'Aim Center') parts.push(aim + '.');
  if (note) parts.push(note);

  return parts.join(' ').trim();
}

/** True when yardage change is significant enough to trigger an auto-voice update */
function isSignificantYardageChange(
  newYards: number,
  prevYards: number | null,
  threshold = 5,
): boolean {
  if (prevYards === null) return true; // first reading always speaks
  return Math.abs(newYards - prevYards) > threshold;
}

// ─── SpeakFn type (matches voiceSpeak signature in PlayScreenClean) ────────────

type SpeakFn = (text: string, opts?: string | null | { priority?: number }) => Promise<void> | void;

// ─── Public facade ────────────────────────────────────────────────────────────

/**
 * onHoleLoad — speaks once when the player advances to a new hole.
 *
 * @param hole        1-based hole number
 * @param par         hole par
 * @param ctx         distance + club + mode context
 * @param speakFn     voiceSpeak from PlayScreenClean
 */
export async function onHoleLoad(
  hole: number,
  par: number,
  ctx: CaddieVoiceContext,
  speakFn: SpeakFn,
): Promise<void> {
  const mode = ctx.mode ?? 'neutral';
  const pool =
    mode === 'safe'       ? HOLE_START_SAFE :
    mode === 'aggressive' ? HOLE_START_AGGRESSIVE :
                            HOLE_START_NEUTRAL;

  const template = cycle(`hole_start_${mode}`, pool);
  const dist     = Math.round(ctx.distance);
  const club     = ctx.club ?? '';
  const raw      = fill(template, { hole, par, dist, club });
  const msg      = raw.trim();

  await autoSpeak(PRIORITY.STRATEGY, msg, (text: string) => Promise.resolve(speakFn(text)));
}

/**
 * onYardageUpdate — fires when GPS yardage changes > 5 yards.
 *
 * @param newYards    current GPS middle yardage
 * @param prevYards   last spoken yardage (null = first reading)
 * @param ctx         club, pin, mode, aimLabel
 * @param speakFn     voiceSpeak from PlayScreenClean
 * @returns true if speech was triggered
 */
export async function onYardageUpdate(
  newYards: number,
  prevYards: number | null,
  ctx: Omit<CaddieVoiceContext, 'distance'>,
  speakFn: SpeakFn,
): Promise<boolean> {
  if (!isSignificantYardageChange(newYards, prevYards)) return false;
  if (newYards < 5 || newYards > 700) return false;

  const phrase = buildPhrase({ ...ctx, distance: newYards });
  return autoSpeak(PRIORITY.STRATEGY, phrase, (text: string) => Promise.resolve(speakFn(text)));
}

/**
 * onShotRecorded — fires immediately after a shot result is logged.
 *
 * Uses VoiceIntelligence getShotFeedback for varied, pattern-aware feedback.
 * Appends bounce-back or hot-streak suffix when appropriate.
 *
 * @param result        'left' | 'right' | 'straight'
 * @param recentResults last 5 results for pattern detection
 * @param situation     play mode / situationEngine output
 * @param speakFn       voiceSpeak from PlayScreenClean
 */
export async function onShotRecorded(
  result: string,
  recentResults: string[],
  situation: { playMode: CaddieVoiceMode; trigger: string } | null,
  speakFn: SpeakFn,
): Promise<void> {
  // VoiceIntelligence handles dedup, cooldown, and pattern detection
  const baseFeedback = getShotFeedback(result as 'left' | 'right' | 'straight', recentResults);
  if (!baseFeedback) return;

  // Append situational suffix
  let msg = baseFeedback;
  if (situation?.trigger === 'bounce_back' || situation?.trigger === 'back_to_back_misses') {
    msg += ' ' + cycle('bounce_back', BOUNCE_BACK);
  } else if (situation?.trigger === 'hot_streak') {
    msg += ' ' + cycle('hot_streak', HOT_STREAK);
  }

  await autoSpeak(PRIORITY.SHOT, msg, (text: string) => Promise.resolve(speakFn(text)));
}

/**
 * onMicTap — user-initiated, ALWAYS speaks regardless of cooldown.
 * Bypasses shouldSpeak() guard.
 *
 * @param ctx       full context: distance, club, pin, aimLabel
 * @param speakFn   voiceSpeak from PlayScreenClean
 */
export async function onMicTap(
  ctx: CaddieVoiceContext,
  speakFn: SpeakFn,
): Promise<void> {
  if (!ctx.distance) return;

  const dist = Math.round(ctx.distance);
  const club = ctx.club ?? 'a club';
  const aim  = ctx.aimLabel && ctx.aimLabel !== 'Aim Center' ? ctx.aimLabel : 'center of the green';
  const template = cycle('mic_tap', MIC_TAP_LINES);
  const msg = fill(template, { dist, club, aim }).trim();

  // Always speaks — use CRITICAL priority to bypass cooldown
  if (shouldSpeak(msg, PRIORITY.CRITICAL) || true) {
    cancelAll(); // stop whatever is playing
    await (speakFn(msg, { priority: PRIORITY.CRITICAL }) ?? Promise.resolve());
    record(msg, PRIORITY.CRITICAL);
  }
}

/**
 * cancel — interrupt and silence current speech.
 * Call when the player takes a shot quickly.
 */
export function cancel(): void {
  cancelAll();
}

/**
 * setMicActive — suppress all auto-speech while mic is listening.
 * VoiceIntelligence.setListening() is the underlying guard.
 */
export { setListening as setMicActive };

/** Export the significance check for direct use in GPS watcher */
export { isSignificantYardageChange };
