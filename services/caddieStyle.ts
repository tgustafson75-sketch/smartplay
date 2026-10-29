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
 * what they actually say to the caddie beats a toggle they set once and forgot — but not one they
 * set AFTER saying it (the newest choice wins, see learnedStyleInForce).
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
  'get to the point', 'cut to the chase',
  'quick rundown', 'quick version', 'short version', 'spare me', 'stop explaining',
  'don’t need the explanation', "don't need the explanation", 'no need to explain',
  'too wordy', 'too long winded', 'long winded', 'wrap it up',
];

/**
 * 2026-10-28 (Brain recheck R7) — the "more" side was the one place this file broke its own rule.
 * "Tell me more", "walk me through", "elaborate", "more detail" are how a player asks about ONE
 * thing — tell me more about that layup — and each of them left him on long answers for good. So
 * only phrases about his answers IN GENERAL count. ("Just give me the number" left the brief side for
 * the same reason; the header has always named it as the remark that must not silence him.)
 */
const FULLER = [
  'longer answers', 'more detailed answers', 'more detail in your answers', 'more detail from now on',
  'explain your thinking', 'you can talk more', 'you can say more', 'too brief', 'too curt',
  'don’t be so brief', "don't be so brief", 'stop being so brief',
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
  // One signal per utterance. The lists share no phrase; briefer first only settles a mixed sentence.
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

export type ResponseMode = 'short' | 'neutral' | 'detailed';

const MODE_OF: Record<CaddieStyle, ResponseMode> = { brief: 'short', balanced: 'neutral', full: 'detailed' };
const STYLE_OF: Record<ResponseMode, CaddieStyle> = { short: 'brief', neutral: 'balanced', detailed: 'full' };

/**
 * The learned style, or null once the player has CHOSEN a length since saying it.
 *
 * 2026-10-28 (Brain recheck R7) — the newest choice wins, whichever way he made it. This used to
 * assume the spoken one was always newer, so one "tell me more" outranked every Quiet / Short / Detailed
 * he picked afterwards, on every route, and nothing on the picker said why. `storedAt` is
 * settingsStore.responseModeSetAt; 0 (never chosen) leaves the learned style in force.
 */
export function learnedStyleInForce(learned: LearnedStyle | null, storedAt = 0): LearnedStyle | null {
  if (!learned) return null;
  return learned.at > storedAt ? learned : null;
}

/**
 * The response length the brain should actually use: whichever the player expressed MOST RECENTLY,
 * out loud or on a picker. With nothing learned, the setting stands — so a player who never says
 * anything about it is exactly where they were.
 */
export function effectiveResponseMode(
  stored: ResponseMode,
  learned: LearnedStyle | null,
  storedAt = 0,
): ResponseMode {
  const live = learnedStyleInForce(learned, storedAt);
  return live ? MODE_OF[live.style] : stored;
}

/** One plain sentence for the settings card — what he learned, in the player's own words. Null
 *  when nothing learned is in force, so the card never credits a hint a later choice replaced. */
export function describeLearnedStyle(learned: LearnedStyle | null, storedAt = 0): string | null {
  learned = learnedStyleInForce(learned, storedAt);
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

/**
 * 2026-10-28 (Brain recheck R9) — would the learner TODAY still have moved him on these words?
 *
 * R7 narrowed the lists, but a style the old lists learned was already on disk: "tell me more about
 * that layup" had saved {style:'full'}, and his earlier Quiet / Short pick carries no
 * responseModeSetAt (it predates the stamp), so the stale 'full' outranked it on every route and the
 * card kept quoting a phrase that no longer counts. A stored style must still be EARNED by its own
 * words: 'full' by a fuller signal, 'brief' by a briefer one, 'balanced' by either. `heard` is cut
 * at 80 characters, so a cut quote cannot be judged and is kept.
 */
function stillASignal(v: LearnedStyle): boolean {
  if (typeof v.heard !== 'string' || v.heard.length >= 80) return true;
  const sig = detectStyleSignal(v.heard);
  if (v.style === 'full') return sig === 'fuller';
  if (v.style === 'brief') return sig === 'briefer';
  return sig !== null;
}

export async function loadLearnedStyle(): Promise<LearnedStyle | null> {
  try {
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    let out = v && typeof v.style === 'string' ? v as LearnedStyle : null;
    if (out && !stillASignal(out)) {
      // Forget it on disk too, so the settings card stops quoting it.
      await AsyncStorage.removeItem(KEY);
      out = null;
    }
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
 *
 * `stored` is the player's chosen length and when he chose it. The step is taken from where he
 * actually IS — a "be brief" after picking Detailed moves him to balanced, not from a stale
 * learned "full" a later choice already replaced.
 */
export async function noteUtterance(
  utterance: string,
  stored?: { mode: ResponseMode; at: number },
): Promise<LearnedStyle | null> {
  const sig = detectStyleSignal(utterance);
  if (!sig) return null;
  const live = learnedStyleInForce(await loadLearnedStyle(), stored?.at ?? 0);
  const cur = live?.style ?? (stored ? STYLE_OF[stored.mode] : 'balanced');
  const next = applySignal(cur, sig);
  if (cur === next) return null;      // already there — nothing to say
  const learned: LearnedStyle = { style: next, at: Date.now(), heard: (utterance || '').trim().slice(0, 80) };
  await saveLearnedStyle(learned);
  return learned;
}
