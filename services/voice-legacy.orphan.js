/**
 * voice.js — Caddie voice output wrapper
 *
 * Thin adapter over voiceService.js so caddieBrain callers don't need to know
 * the internal ElevenLabs API. Voice IDs and profiles are owned by voiceService
 * and are NOT modified here.
 *
 * Usage:
 *   import { speakCaddie } from '../services/voice';
 *   await speakCaddie('Take dead aim at the flag.');
 */

import { speakJob, PRIORITY } from './VoiceEngine';

/**
 * Speak caddie advice at SHOT priority via VoiceEngine.
 * Returns a promise that resolves when audio finishes (or silently on error).
 *
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export const speakCaddie = (text) => speakJob(text, PRIORITY.SHOT, 'male');
