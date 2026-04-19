/**
 * voiceCommandParser — Maps STT transcripts to CADDIE settings commands.
 *
 * Rules:
 *  - Simple substring matching (no regex, no AI)
 *  - Returns a command key or null (no match)
 *  - Must run before the AI pipeline so commands short-circuit normal flow
 */

export type VoiceCommand =
  | 'bright'
  | 'dark'
  | 'auto'
  | 'short'
  | 'detailed';

const COMMAND_MAP: Record<VoiceCommand, string[]> = {
  bright:   ['bright mode', 'turn on bright mode', 'enable bright mode', 'sunlight mode'],
  dark:     ['play mode', 'dark mode', 'turn off bright mode', 'disable bright mode'],
  auto:     ['auto brightness', 'automatic mode', 'auto mode'],
  short:    ['short responses', 'be brief', 'keep it short', 'shorter responses'],
  detailed: ['more detail', 'longer responses', 'give me more', 'more info'],
};

/**
 * parseVoiceCommand — returns the command key if the transcript matches,
 * null otherwise.
 *
 * @param transcript  Raw STT text from the user
 */
export function parseVoiceCommand(transcript: string): VoiceCommand | null {
  if (!transcript) return null;
  const lower = transcript.toLowerCase().trim();

  for (const key of Object.keys(COMMAND_MAP) as VoiceCommand[]) {
    if (COMMAND_MAP[key].some((phrase) => lower.includes(phrase))) {
      return key;
    }
  }

  return null;
}
