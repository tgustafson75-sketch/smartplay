import type { IntentHandler, IntentResult, VoiceIntent, AppContext } from '../../types/voiceIntent';
import { useRoundStore } from '../../store/roundStore';
import { track } from '../analytics';

/**
 * 2026-05-19 — Score-by-voice intent. The shot-by-shot logShotHandler
 * captures individual swings ("I hit 7-iron 165 left"); this handler
 * captures the FINAL total for a hole ("I made a five", "I shot a 7
 * on hole 4", "score me 6"). Previously the user could only tap the
 * scorecard or use cockpit steppers — voice score never landed because
 * no intent handler matched.
 *
 * Hole number defaults to roundStore.currentHole; user can override with
 * "on hole N". Strokes must be 1..12 (gates against transcription
 * artifacts like "score me one hundred").
 */

function parseStrokes(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isInteger(raw) && raw >= 1 && raw <= 12 ? raw : null;
  }
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase();
  // Digit form first.
  const m = s.match(/\b(\d{1,2})\b/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 12) return n;
  }
  // Word forms.
  const words: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
    seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  };
  for (const [word, n] of Object.entries(words)) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(s)) return n;
  }
  return null;
}

function parseHole(raw: unknown, fallback: number): number {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= 18) return raw;
  if (typeof raw === 'string') {
    const m = raw.match(/\b(1[0-8]|[1-9])\b/);
    if (m) return parseInt(m[1], 10);
  }
  return fallback;
}

function scoreLabel(strokes: number, par: number | null | undefined): string {
  if (par == null) return `${strokes}`;
  const diff = strokes - par;
  if (diff === 0) return 'par';
  if (diff === 1) return 'bogey';
  if (diff === 2) return 'double bogey';
  if (diff === 3) return 'triple bogey';
  if (diff === -1) return 'birdie';
  if (diff === -2) return 'eagle';
  if (diff === -3) return 'albatross';
  if (diff > 3) return `${diff} over`;
  return `${Math.abs(diff)} under`;
}

export const logScoreHandler: IntentHandler = {
  intent_type: 'log_score',

  parameter_schema: {
    strokes: 'integer 1..12, or word ("five", "seven")',
    hole_number: 'optional integer 1..18; defaults to current hole',
  },

  examples: [
    'I made a five',
    'I shot a 7',
    'I had a five',
    'score me a six',
    'put me down for a 4',
    'five on this hole',
    'score me a 5 on hole 7',
    'I bogeyed seven',
  ],

  async execute(intent: VoiceIntent, _context: AppContext): Promise<IntentResult> {
    const round = useRoundStore.getState();
    if (!round.isRoundActive) {
      return {
        success: false,
        voice_response: 'Start a round and I can keep score.',
        side_effects: ['logScore:no_active_round'],
        follow_up_needed: false,
      };
    }
    const params = (intent.parameters ?? {}) as Record<string, unknown>;
    const strokes = parseStrokes(params.strokes) ?? parseStrokes(intent.raw_text);
    if (strokes == null) {
      return {
        success: false,
        voice_response: "How many strokes? Tell me a number.",
        side_effects: ['logScore:unparsable'],
        follow_up_needed: true,
      };
    }
    const hole = parseHole(params.hole_number, round.currentHole);
    const par = round.courseHoles.find(h => h.hole === hole)?.par ?? null;
    round.logScore(hole, strokes);
    track('log_score_voice', { hole, strokes, par });
    const label = scoreLabel(strokes, par);
    const holePart = hole === round.currentHole ? `Got it` : `Got it, hole ${hole}`;
    const reply = par != null
      ? `${holePart} — ${strokes} (${label}).`
      : `${holePart} — ${strokes}.`;
    return {
      success: true,
      voice_response: reply,
      side_effects: [`logScore:hole_${hole}:strokes_${strokes}`],
      follow_up_needed: false,
    };
  },
};
