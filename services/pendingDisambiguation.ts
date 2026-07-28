/**
 * Pending course disambiguation — ephemeral, turn-scoped.
 *
 * 2026-07-27 (tester UX). When a voice "quick round" utterance matches SEVERAL distinct courses
 * (golfcourseapi returns many namesakes for "Riverside" / "Pine Valley"), quickRoundHandler asks
 * "which one?" and stashes the candidate list HERE. The user's NEXT utterance ("the New Jersey one"
 * / "Austin" / "the first one") is matched against these candidates in the voice follow-up loop and
 * starts the round directly — instead of being re-classified from scratch (which drops the list) or
 * sent to the brain (which never had it). This is the multi-turn half of the wrong-course fix.
 *
 * Mirrors services/conversationState.ts exactly: module-level, NO persistence, decays after a short
 * window and evicts on round-state change so an abandoned choice never hijacks a later utterance.
 * matchCourseChoice is PURE (no store) so it's unit-testable in isolation.
 */

import { useRoundStore } from '../store/roundStore';
import { useGuestProfileStore } from '../store/guestProfileStore';

export interface CourseChoice {
  /** golfcourseapi course id — the value handed to setPendingStartCourse. */
  id: string;
  /** Club/course name, for the spoken confirmation. */
  name: string;
  /** Already-shortened "City, ST" (country trimmed), for matching + confirmation. */
  location: string;
}

export interface PendingCourseFactors {
  nineHole: boolean;
  /** Raw spoken guest names, minted into guest profiles only once a choice is made. */
  guestNames: string[];
}

// 90s: long enough for the caddie to ask + the user to answer at a normal pace (even after the
// 30s follow-up mic window times out and they re-tap), short enough that a forgotten choice never
// resolves a much later, unrelated utterance.
const DECAY_MS = 90_000;

let choices: CourseChoice[] = [];
let factors: PendingCourseFactors | null = null;
let setAt = 0;
let lastRoundActiveSeen: boolean | null = null;

export function setPendingCourseChoices(next: CourseChoice[], f: PendingCourseFactors): void {
  choices = next.slice(0, 5);
  factors = f;
  setAt = Date.now();
  try { lastRoundActiveSeen = useRoundStore.getState().isRoundActive; } catch { lastRoundActiveSeen = null; }
}

/** The live candidate list, or null when there's nothing pending (expired / never set). */
export function getPendingCourseChoices(): { choices: CourseChoice[]; factors: PendingCourseFactors } | null {
  evictIfStale();
  if (choices.length === 0 || !factors) return null;
  return { choices: [...choices], factors };
}

export function clearPendingCourseChoices(reason?: string): void {
  if (choices.length > 0 && reason) console.log(`[disambig] cleared (${reason})`);
  choices = [];
  factors = null;
  setAt = 0;
}

function evictIfStale(): void {
  if (setAt > 0 && Date.now() - setAt > DECAY_MS) { clearPendingCourseChoices('decay'); return; }
  try {
    const active = useRoundStore.getState().isRoundActive;
    if (lastRoundActiveSeen != null && lastRoundActiveSeen !== active) { clearPendingCourseChoices('round_state_change'); return; }
    lastRoundActiveSeen = active;
  } catch { /* round store not ready (test / cold boot) — skip the soft check */ }
}

// ─── Matching ───────────────────────────────────────────────────────────────

// Positional answers ONLY — deliberately NOT bare cardinals ("one"/"two"), because "the New Jersey
// ONE" would then falsely resolve to candidate #1. "first"/"second"/"1st"/a standalone digit are
// unambiguous position references; "the ___ one" falls through to the location/name match below.
const ORDINALS: Record<string, number> = {
  first: 0, '1st': 0,
  second: 1, '2nd': 1,
  third: 2, '3rd': 2,
  fourth: 3, '4th': 3,
  fifth: 4, '5th': 4,
};

const STATE_ABBREV: Record<string, string> = {
  alabama: 'al', alaska: 'ak', arizona: 'az', arkansas: 'ar', california: 'ca', colorado: 'co',
  connecticut: 'ct', delaware: 'de', florida: 'fl', georgia: 'ga', hawaii: 'hi', idaho: 'id',
  illinois: 'il', indiana: 'in', iowa: 'ia', kansas: 'ks', kentucky: 'ky', louisiana: 'la',
  maine: 'me', maryland: 'md', massachusetts: 'ma', michigan: 'mi', minnesota: 'mn', mississippi: 'ms',
  missouri: 'mo', montana: 'mt', nebraska: 'ne', nevada: 'nv', 'new hampshire': 'nh', 'new jersey': 'nj',
  'new mexico': 'nm', 'new york': 'ny', 'north carolina': 'nc', 'north dakota': 'nd', ohio: 'oh',
  oklahoma: 'ok', oregon: 'or', pennsylvania: 'pa', 'rhode island': 'ri', 'south carolina': 'sc',
  'south dakota': 'sd', tennessee: 'tn', texas: 'tx', utah: 'ut', vermont: 'vt', virginia: 'va',
  washington: 'wa', 'west virginia': 'wv', wisconsin: 'wi', wyoming: 'wy',
};

const NAME_STOP = new Set(['golf', 'club', 'course', 'country', 'national', 'links', 'the', 'at']);

function normalize(s: string): string {
  return ` ${s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()} `;
}

/**
 * Resolve a spoken answer to one of the offered course choices, or null when it's unclear (the
 * caller then asks again rather than guessing). Priority: explicit position → unique location → unique
 * distinctive name word. Location beats name; either only wins when EXACTLY ONE candidate matches.
 */
export function matchCourseChoice(utterance: string, list: CourseChoice[]): CourseChoice | null {
  if (!utterance || list.length === 0) return null;
  const u = normalize(utterance);

  // 1) Position — "the last one", "the second", "1st", a standalone digit.
  if (/\blast\b/.test(u)) return list[list.length - 1];
  for (const [word, idx] of Object.entries(ORDINALS)) {
    if (new RegExp(`\\b${word}\\b`).test(u) && idx < list.length) return list[idx];
  }
  const digit = u.match(/\b([1-9])\b/);
  if (digit) {
    const idx = parseInt(digit[1], 10) - 1;
    if (idx >= 0 && idx < list.length) return list[idx];
  }

  // 2) Location — a full state name spoken ("new jersey" → nj), or the stored city / state token.
  const locHits = list.filter(c => {
    const [cityRaw, stRaw] = c.location.toLowerCase().split(',').map(p => p.trim());
    const city = cityRaw ?? '';
    const st = stRaw ?? '';
    for (const [name, abbr] of Object.entries(STATE_ABBREV)) {
      if (u.includes(` ${name} `) && st === abbr) return true;
    }
    if (city.length >= 3 && u.includes(` ${city} `)) return true;
    if (st && u.includes(` ${st} `)) return true;
    return false;
  });
  if (locHits.length === 1) return locHits[0];

  // 3) A distinctive word from the club name (ignoring generic golf words).
  const nameHits = list.filter(c =>
    normalize(c.name).trim().split(' ').some(w => w.length >= 4 && !NAME_STOP.has(w) && u.includes(` ${w} `)),
  );
  if (nameHits.length === 1) return nameHits[0];

  return null; // ambiguous or no match → caller re-asks
}

/**
 * Match a spoken answer against the pending choices and, on a hit, commit the round start exactly
 * as quickRoundHandler's success path does (mint guests → setPendingStartCourse → factors → clear).
 * Returns the spoken confirmation line, or null when there's nothing pending or the answer is unclear
 * (the caller falls through to normal handling / re-asks). Best-effort nav to the caddie tab for parity.
 */
export function resolvePendingCourseUtterance(utterance: string): { confirmLine: string } | null {
  const pending = getPendingCourseChoices();
  if (!pending) return null;
  const choice = matchCourseChoice(utterance, pending.choices);
  if (!choice) return null;

  const minted: string[] = [];
  try {
    const gs = useGuestProfileStore.getState();
    for (const n of pending.factors.guestNames) {
      const g = gs.addGuest(n);
      if (g) minted.push(g.displayName);
    }
  } catch { /* guest store not ready — non-fatal, start the round anyway */ }

  const round = useRoundStore.getState();
  round.setPendingStartCourse(choice.id);
  round.setPendingStartFactors({
    mode: 'free_play',
    nineHole: pending.factors.nineHole,
    isCompetition: false,
    mentalState: 'neutral',
    notes: '',
  });
  clearPendingCourseChoices('resolved');

  void import('expo-router').then(m => m.router.push('/(tabs)/caddie' as never)).catch(() => {});

  const holeWord = pending.factors.nineHole ? '9-hole ' : '';
  const loc = choice.location ? ` in ${choice.location}` : '';
  const guests = minted.length ? ` with ${minted.join(', ')}` : '';
  return { confirmLine: `Starting a ${holeWord}quick round at ${choice.name}${loc}${guests}.` };
}
