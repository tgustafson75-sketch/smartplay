/**
 * CommandEngine — maps STT transcript → gameplay action command.
 *
 * Design rules:
 *   • Pure function — no state, no side-effects, always synchronous
 *   • Substring matching only — no regex, no NLP, < 1 ms per call
 *   • Returns the highest-priority match or null (no match)
 *   • Complements voiceCommandParser (settings commands); this file
 *     covers in-round gameplay commands
 *
 * Usage:
 *   import { detectCommand, CommandKey } from './CommandEngine';
 *   const cmd = detectCommand(transcript);
 *   if (cmd) dispatch(cmd);
 */

// ─────────────────────────────────────────────────────────────────────────────
// Command keys
// ─────────────────────────────────────────────────────────────────────────────

export type CommandKey =
  | 'GET_DISTANCE'
  | 'GET_CLUB'
  | 'GET_ADVICE'
  | 'RECORD_SHOT'
  | 'START_VIDEO'
  | 'TAKE_PHOTO'
  | 'LOG_SHOT'
  | 'NEXT_HOLE'
  | 'PREV_HOLE'
  | 'PUTT_MODE'
  | 'SHOW_SCORECARD'
  | 'SHOW_MAP';

// ─────────────────────────────────────────────────────────────────────────────
// Command table — built from CommandLibrary; first match wins per entry
// ─────────────────────────────────────────────────────────────────────────────

import { COMMAND_LIBRARY } from './CommandLibrary';

const COMMAND_TABLE: Array<{ command: CommandKey; phrases: string[] }> =
  (Object.keys(COMMAND_LIBRARY) as CommandKey[]).map((command) => ({
    command,
    phrases: COMMAND_LIBRARY[command],
  }));

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect a command from a raw STT transcript.
 *
 * @param text  Raw transcript from expo-speech-recognition or sttService
 * @returns     The matched CommandKey, or null if no command detected
 */
export function detectCommand(text: string | null | undefined): CommandKey | null {
  if (!text?.trim()) return null;
  const t = text.toLowerCase().trim();

  for (const entry of COMMAND_TABLE) {
    if (entry.phrases.some((phrase) => t.includes(phrase))) {
      return entry.command;
    }
  }

  return null;
}
