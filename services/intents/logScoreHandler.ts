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

/**
 * 2026-05-21 — Fix P: par-relative score name parser. Resolves "par",
 * "bogey", "birdie", "double bogey", etc. against the known par for
 * the current hole. Returns null when par is unknown or no score name
 * matches. The classifier emits these as string `strokes` values
 * ("par", "bogey", "birdie", "eagle", "double_bogey", "triple_bogey");
 * we also accept the natural-language verbatim ("made par",
 * "I bogeyed", "triple", etc.) as a fallback via the raw_utterance.
 *
 * Order of checks matters — "double_bogey" is matched before "bogey"
 * so a phrase like "double bogey" doesn't resolve to just bogey.
 */
function parseScoreName(raw: unknown, par: number | null): number | null {
  if (par == null) return null;
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase();
  // Canonical token names emitted by the classifier (strict matches first).
  if (s === 'eagle') return Math.max(1, par - 2);
  if (s === 'birdie') return Math.max(1, par - 1);
  if (s === 'par') return par;
  if (s === 'bogey') return par + 1;
  if (s === 'double_bogey' || s === 'double-bogey') return par + 2;
  if (s === 'triple_bogey' || s === 'triple-bogey') return par + 3;
  // Loose natural-language matches (longer phrases first so "double
  // bogey" doesn't mismatch on the inner "bogey"). Bounded by Math.min
  // to the handler's 1..12 valid range.
  if (/\b(triple[\s-]?bogey|tripled|triple)\b/.test(s)) return Math.min(12, par + 3);
  if (/\b(double[\s-]?bogey|doubled|double)\b/.test(s)) return Math.min(12, par + 2);
  if (/\b(eagled|eagle)\b/.test(s)) return Math.max(1, par - 2);
  if (/\b(birdied|birdie)\b/.test(s)) return Math.max(1, par - 1);
  if (/\bpar\b/.test(s)) return par;
  if (/\b(bogeyed|bogey)\b/.test(s)) return Math.min(12, par + 1);
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
    // 2026-05-21 — Fix P: par lookup MUST happen before strokes parsing
    // now, because the par-relative score-name parser ("par" / "bogey" /
    // "birdie" / "double_bogey" / "triple_bogey" / "eagle") needs the
    // par to resolve to a stroke count. Numeric strokes parsing
    // (parseStrokes) doesn't need par; we just want par available for
    // BOTH branches.
    const params = (intent.parameters ?? {}) as Record<string, unknown>;
    const hole = parseHole(params.hole_number, round.currentHole);
    const par = round.courseHoles.find(h => h.hole === hole)?.par ?? null;
    // Numeric parsing first (params.strokes is the classifier's primary
    // emit; raw_text is the verbatim utterance fallback). If neither
    // yields a number, fall through to par-relative score-name parsing
    // for "par" / "bogey" / "birdie" / "double_bogey" / "triple_bogey"
    // / "eagle" — both as the classifier's canonical string strokes
    // value AND as a verbatim hit on the user's utterance.
    let strokes = parseStrokes(params.strokes) ?? parseStrokes(intent.raw_text);
    if (strokes == null) {
      strokes = parseScoreName(params.strokes, par) ?? parseScoreName(intent.raw_text, par);
    }
    if (strokes == null) {
      // Genuine ambiguity — classifier saw a log_score but couldn't
      // pin a number or score name. ONE brief clarifier; the user's
      // next utterance will be parsed fresh. (Tim's Fix P spec: clear
      // score reports like "I got a 4" must NOT trigger this; only
      // genuinely ambiguous "score me" / "log a score" do.)
      return {
        success: false,
        voice_response: "How many strokes? Tell me a number.",
        side_effects: ['logScore:unparsable'],
        follow_up_needed: true,
      };
    }
    round.logScore(hole, strokes);
    track('log_score_voice', { hole, strokes, par });
    const label = scoreLabel(strokes, par);
    const holePart = hole === round.currentHole ? `Got it` : `Got it, hole ${hole}`;
    const scoreText = par != null
      ? `${holePart} — ${strokes} (${label}).`
      : `${holePart} — ${strokes}.`;

    // If the classifier already extracted num_putts, log them now and skip the follow-up.
    const inlinePutts = typeof params.num_putts === 'number' && params.num_putts >= 0 && params.num_putts <= 6
      ? params.num_putts
      : null;
    if (inlinePutts !== null) {
      round.logPutts(hole, inlinePutts);
      track('log_putts_voice', { hole, putts: inlinePutts, source: 'inline' });
      return {
        success: true,
        voice_response: scoreText,
        side_effects: [`logScore:hole_${hole}:strokes_${strokes}`, `logPutts:hole_${hole}:putts_${inlinePutts}`],
        follow_up_needed: false,
      };
    }

    return {
      success: true,
      voice_response: `${scoreText} How many putts?`,
      side_effects: [`logScore:hole_${hole}:strokes_${strokes}`],
      follow_up_needed: true,
    };
  },
};
