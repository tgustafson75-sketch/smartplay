/**
 * 2026-09-11 (Tim) — THE CADDIE TAKES A HINT. BE SMART, NOT TOGGLE-HEAVY.
 *
 * "That whole way we originally designed levels — users don't quite understand it, especially
 *  looking through the settings, it's not intuitive. That whole premise needs to be simplified into
 *  one simple card, or even just dynamically learning user preferences and responses and
 *  frustrations. The user says 'listen, I don't wanna talk this much, let's be more brief, let's get
 *  to the point, give me a quick rundown' — the caddie can take a hint and adjust accordingly. We
 *  wanna be smart, not toggle heavy."
 *
 * A real caddie is not configured. You tell him once that you don't want a lecture over every shot
 * and he remembers — for the rest of the round and the rest of the season. He does not hand you a
 * settings screen with a Trust Spectrum on it.
 *
 * So this listens for the player SAYING it, in their own words, and remembers. The stored
 * `responseMode` preference stays as the starting point and the floor of what they explicitly chose;
 * what they actually say to the caddie beats a toggle they set once and forgot.
 *
 * WHY IT IS DELIBERATELY DEAF TO MOST THINGS. A caddie who goes quiet because you said "just tell me
 * the number" once, about one shot, is worse than one who never listens — you cannot tell what you
 * did wrong, and getting him back means finding the settings screen this exists to replace. So the
 * matcher only fires on statements that are plainly ABOUT the talking, never on ordinary golf talk.
 * "Why did that go right?" is a question about a shot. "You're talking too much" is about him.
 *
 * PURE detection + a small persisted memory. [[feels-like-a-real-caddie]] [[no-push-nagging-no-ads]]
 */

export type CaddieStyle = 'brief' | 'balanced' | 'full';
export type StyleSignal = 'briefer' | 'fuller' | null;

/**
 * Phrases that are unmistakably about HOW MUCH he talks. Kept narrow on purpose — see the header.
 * Each must be a thing a person says TO someone, not a thing they say about golf.
 */
const BRIEFER = [
  'talking too much', 'talk too much', 'too much talking', 'too much chatter', 'too chatty',
  'be brief', 'be briefer', 'more brief', 'keep it brief', 'keep it short', 'keep it shorter',
  'shorter answers', 'short answers', 'less detail', 'less talking', 'talk less', 'say less',
  'get to the point', 'cut to the chase', 'just the number', 'just give me the number',
  'quick rundown', 'quick version', 'short version', 'spare me', 'stop explaining',
  'don’t need the explanation', "don't need the explanation", 'no need to explain',
  'too wordy', 'too long winded', 'long winded', 'wrap it up',
];

const FULLER = [
  'tell me more', 'more detail', 'more details', 'explain more', 'go deeper', 'elaborate',
  'walk me through', 'full rundown', 'full version', 'longer answer', 'talk me through it',
  'give me the detail', 'more information',
];

/** Normalise for matching: lowercase, collapse whitespace, strip most punctuation. */
function norm(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9’' ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Does this utterance ask him to say more or less? Null for the overwhelming majority of things a
 * player says, which is the point.
 */
export function detectStyleSignal(utterance: string): StyleSignal {
  const u = norm(utterance);
  if (!u) return null;
  // Longer phrases first so "more detail" cannot be swallowed by a shorter accidental match.
  if (BRIEFER.some((p) => u.includes(norm(p)))) return 'briefer';
  if (FULLER.some((p) => u.includes(norm(p)))) return 'fuller';
  return null;
}

export interface LearnedStyle {
  style: CaddieStyle;
  /** When the player last said something that moved it. */
  at: number;
  /** Their own words, so the card can show what it heard rather than a category. */
  heard: string;
}

/**
 * Apply a signal to the current style. One step at a time — a single "be brief" moves balanced to
 * brief, not to silence, and the player can always push further by saying it again.
 */
export function applySignal(current: CaddieStyle, signal: Exclude<StyleSignal, null>): CaddieStyle {
  const order: CaddieStyle[] = ['brief', 'balanced', 'full'];
  const i = order.indexOf(current);
  const next = signal === 'briefer' ? Math.max(0, i - 1) : Math.min(order.length - 1, i + 1);
  return order[next];
}

/**
 * The response length the brain should actually use.
 *
 * The learned style WINS over the stored setting, because the player said it out loud and more
 * recently than they touched a toggle. With nothing learned, the setting stands — so a player who
 * never says anything about it is exactly where they were.
 */
export function effectiveResponseMode(
  stored: 'short' | 'neutral' | 'detailed',
  learned: LearnedStyle | null,
): 'short' | 'neutral' | 'detailed' {
  if (!learned) return stored;
  return learned.style === 'brief' ? 'short' : learned.style === 'full' ? 'detailed' : 'neutral';
}

/** One plain sentence for the settings card — what he learned, in the player's own words. */
export function describeLearnedStyle(learned: LearnedStyle | null): string | null {
  if (!learned) return null;
  const when = new Date(learned.at).toLocaleDateString();
  return learned.style === 'brief'
    ? `You asked me to keep it short (“${learned.heard}”, ${when}), so I stick to the answer.`
    : learned.style === 'full'
      ? `You asked for more detail (“${learned.heard}”, ${when}), so I explain my thinking.`
      : `You asked me to level it out (“${learned.heard}”, ${when}).`;
}

// ── the small persisted memory ───────────────────────────────────────────────────────────────────
const KEY = '@smartplay/caddie_style';

/**
 * In-memory mirror, so the payload builder can resolve the effective mode SYNCHRONOUSLY.
 *
 * services/caddieRequestBody is sync by design and is the one place that should decide what
 * `responseMode` the brain is told — otherwise each of the five askCaddie call sites resolves it
 * itself and they drift, which is the defect this codebase keeps digging out. `undefined` means
 * "not loaded yet" and is deliberately distinct from `null`, which means "loaded, nothing learned".
 */
let cached: LearnedStyle | null | undefined;

/** The learned style without awaiting. Null until primeStyleCache has run, which is honest: with
 *  nothing loaded the stored setting stands, exactly as it did before any of this existed. */
export function learnedStyleSync(): LearnedStyle | null {
  return cached ?? null;
}

/** Hydrate the mirror once at boot. Never throws. */
export async function primeStyleCache(): Promise<void> {
  cached = await loadLearnedStyle();
}

export async function loadLearnedStyle(): Promise<LearnedStyle | null> {
  try {
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    const out = v && typeof v.style === 'string' ? v as LearnedStyle : null;
    cached = out;
    return out;
  } catch { return null; }
}

export async function saveLearnedStyle(v: LearnedStyle | null): Promise<void> {
  try {
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    cached = v;
    if (v == null) await AsyncStorage.removeItem(KEY);
    else await AsyncStorage.setItem(KEY, JSON.stringify(v));
  } catch { /* a caddie that cannot remember simply keeps the setting */ }
}

/**
 * Hear one utterance. Returns the new style when it moved, else null — the caller can acknowledge
 * it, which is the difference between a caddie who adjusts and an app that silently changed a
 * setting on you.
 */
export async function noteUtterance(utterance: string): Promise<LearnedStyle | null> {
  const sig = detectStyleSignal(utterance);
  if (!sig) return null;
  const cur = await loadLearnedStyle();
  const next = applySignal(cur?.style ?? 'balanced', sig);
  if (cur && cur.style === next) return null;      // already there — nothing to say
  const learned: LearnedStyle = { style: next, at: Date.now(), heard: (utterance || '').trim().slice(0, 80) };
  await saveLearnedStyle(learned);
  return learned;
}
