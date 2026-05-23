/**
 * 2026-05-22 — Watch Bridge.
 *
 * Bidirectional contract between the SmartPlay phone app and a paired
 * smartwatch companion (Galaxy Watch primary, Apple Watch future).
 * Mirrors earbudControl's shape: an event bus for INBOUND taps, plus
 * outbound functions for sending text + score updates TO the watch.
 *
 * Wire reality check:
 *   - Galaxy Watch (Wear OS) companion app would push tap events to the
 *     phone over the Wear data layer; this file is the JS receiver
 *     surface that a native bridge would call into.
 *   - Apple Watch companion would push via WatchConnectivity sendMessage.
 *   - Neither bridge is shipped yet. The contract here is what those
 *     native modules will plug into. Manual injection via
 *     notifyWatchTap() in dev / tests already works.
 *
 * Outbound:
 *   - sendNotification(text) — short text the watch displays as a
 *     glanceable notification ("Hole 3 · 156y to pin")
 *   - sendLiveScore({ vsPar, hole, totalScore }) — updates the
 *     persistent watch face complication when configured
 *   - sendVoicePrompt(text) — read this aloud on watch speaker if
 *     available (Galaxy Watch supports TTS over Bluetooth audio)
 *
 * All outbound functions are NO-OPs today (the native bridge isn't
 * registered) but devLog every call so the integration trail is
 * visible the moment a bridge wires in.
 */

import type { TapPattern } from './earbudControl';
import { devLog } from './devLog';

// ─── Inbound: taps + voice ───────────────────────────────────────────────

type TapListener = (pattern: TapPattern) => void;
type VoiceListener = (utterance: string) => void;

const tapListeners: Set<TapListener> = new Set();
const voiceListeners: Set<VoiceListener> = new Set();

/** Subscribe to watch tap-pattern events. Returns cleanup. */
export function subscribeWatchTap(cb: TapListener): () => void {
  tapListeners.add(cb);
  return () => { tapListeners.delete(cb); };
}

/** Subscribe to watch-relayed voice utterances. The watch records via
 *  its mic, sends transcribed text here, and the phone routes it
 *  through the regular voice-intent classifier. */
export function subscribeWatchVoice(cb: VoiceListener): () => void {
  voiceListeners.add(cb);
  return () => { voiceListeners.delete(cb); };
}

/**
 * Called by the native bridge when a watch tap is detected. pattern
 * is one of 'single' | 'double' | 'triple' | 'long_press' — same shape
 * as the earbud bus so consumers can subscribe to both without
 * branching.
 */
export function notifyWatchTap(pattern: TapPattern): void {
  devLog(`[watchBridge] tap inbound: ${pattern}`);
  tapListeners.forEach((cb) => {
    try { cb(pattern); } catch (e) { devLog('[watchBridge] tap listener err: ' + String(e)); }
  });
}

/** Called by the native bridge with the transcribed text of a watch-
 *  mic utterance ("how far to the pin"). The orchestrator routes it
 *  through the regular voice-intent pipeline. */
export function notifyWatchVoice(utterance: string): void {
  devLog(`[watchBridge] voice inbound: "${utterance.slice(0, 80)}"`);
  voiceListeners.forEach((cb) => {
    try { cb(utterance); } catch (e) { devLog('[watchBridge] voice listener err: ' + String(e)); }
  });
}

// ─── Outbound: phone → watch ─────────────────────────────────────────────

type Sender = (payload: OutboundPayload) => Promise<void>;

export type OutboundPayload =
  | { kind: 'notification'; text: string; subtitle?: string | null }
  | { kind: 'score'; vsPar: number; hole: number; totalScore: number }
  | { kind: 'voice_prompt'; text: string }
  | { kind: 'state'; round_active: boolean; current_hole: number | null };

let activeSender: Sender | null = null;

/**
 * Native bridge registers a sender that ships payloads to the watch.
 * Galaxy Watch companion → DataMap; Apple Watch → WatchConnectivity.
 */
export function registerWatchSender(sender: Sender): void {
  activeSender = sender;
  devLog('[watchBridge] sender registered');
}

export function isSenderRegistered(): boolean {
  return activeSender != null;
}

/** Send a short glanceable notification to the watch. No-op when no
 *  sender is registered. */
export async function sendNotification(text: string, subtitle?: string | null): Promise<void> {
  if (!activeSender) {
    devLog(`[watchBridge] notification (no sender): ${text}`);
    return;
  }
  try {
    await activeSender({ kind: 'notification', text, subtitle: subtitle ?? null });
  } catch (e) {
    devLog('[watchBridge] notification send failed: ' + String(e));
  }
}

/** Push the current round score to the watch face complication. */
export async function sendLiveScore(input: { vsPar: number; hole: number; totalScore: number }): Promise<void> {
  if (!activeSender) {
    devLog(`[watchBridge] live score (no sender): hole ${input.hole} ${input.vsPar >= 0 ? '+' : ''}${input.vsPar}`);
    return;
  }
  try {
    await activeSender({ kind: 'score', ...input });
  } catch (e) {
    devLog('[watchBridge] score send failed: ' + String(e));
  }
}

/** Read a short prompt aloud on the watch speaker (Galaxy Watch
 *  supports TTS). Useful for hands-free "On hole 3 · 156 to pin"
 *  read-outs the phone can fire silently when phone speaker is off. */
export async function sendVoicePrompt(text: string): Promise<void> {
  if (!activeSender) {
    devLog(`[watchBridge] voice prompt (no sender): ${text.slice(0, 60)}`);
    return;
  }
  try {
    await activeSender({ kind: 'voice_prompt', text });
  } catch (e) {
    devLog('[watchBridge] voice prompt failed: ' + String(e));
  }
}

/** Mirror round state to the watch — drives the "in a round" face
 *  state + the active-hole complication. */
export async function sendRoundState(round_active: boolean, current_hole: number | null): Promise<void> {
  if (!activeSender) {
    devLog(`[watchBridge] round state (no sender): active=${round_active} hole=${current_hole}`);
    return;
  }
  try {
    await activeSender({ kind: 'state', round_active, current_hole });
  } catch (e) {
    devLog('[watchBridge] state send failed: ' + String(e));
  }
}
