/**
 * Quick Round voice intent handler.
 *
 * 2026-05-24 — Built alongside guestProfileStore as the natural-language
 * pair to Tournament Mode. Voice-only path to start a round in one
 * utterance: course hint + optional playing partners + optional 9-hole
 * flag, all resolved server-side by the LLM classifier and reduced to
 * a single setPendingStartCourse signal that Caddie tab picks up.
 *
 * Examples (LLM-classified upstream — see app/api/voice-intent+api.ts):
 *   "let's play a quick round at Maplewood"
 *   "Tim is playing with Bob and Sarah at Pembroke Pines today"
 *   "9-hole quick round at the Lakes"
 *
 * No new round-start machinery: reuses the exact same pendingStart
 * signal that the Play tab uses, so Caddie's existing runStartRound
 * handler launches the round identically whether the trigger was a
 * tap or a voice command. Pure additive.
 */

import type { IntentHandler, IntentResult, VoiceIntent, AppContext } from '../../types/voiceIntent';
import { useRoundStore } from '../../store/roundStore';
import { useGuestProfileStore } from '../../store/guestProfileStore';
import { searchCourses } from '../golfCourseApi';
import { resolveSpokenCourse } from '../courseNameResolver';
import { setPendingCourseChoices } from '../pendingDisambiguation';

// 2026-07-24 (final QA — "start a round at <course>"). This handler used to keep its OWN
// stale 9-course slug list, so "start a round at Highland / Miccosukee / Pembroke / Doral /
// Redlands / Killian / Greenhill / Spessard / Webster" all missed it and fell through to the
// NETWORK search — a dead-end offline and a wrong-course risk online (it could resolve to a
// non-bundled API course). The handler's own advertised example ("...at Pembroke Pines") wasn't
// even in its list. Now it uses the SAME resolver "take me to <course>" uses (resolveSpokenCourse,
// which covers every bundled course by name), so open-a-course and start-a-round behave identically.
function resolveLocalCourse(hint: string): { id: string; displayName: string } | null {
  const spoken = resolveSpokenCourse(hint);
  return spoken ? { id: spoken.previewId, displayName: spoken.label } : null;
}

function listJoin(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

// 2026-07-27 (tester UX — wrong-course trap) — golfcourseapi search returns MANY courses for a
// common name ("Riverside", "Pine Valley", "Lakes"). The old code silently started the round at
// the FIRST result, so a tester who meant the Riverside in their town could get dropped onto a
// namesake three states away — wrong yardages, wrong everything, trust gone on hole 1. These two
// helpers let us (a) collapse the same physical club appearing as multiple tees/nines so we don't
// ask "the one in NJ, or the one in NJ?", and (b) speak a clean location so a single confident
// match is still AUDITABLE ("Starting at Pine Valley in Pine Valley, NJ" — the user hears a wrong
// hit immediately). Country is dropped when it's the US (the common case) to keep speech tight.
type SearchHit = { id: string; club_name: string; course_name: string; location: string; _error?: string };

function shortLoc(loc: string): string {
  const parts = loc.split(',').map(p => p.trim()).filter(Boolean);
  if (parts.length && /^(us|usa|united states)$/i.test(parts[parts.length - 1])) parts.pop();
  return parts.join(', ');
}

/** Collapse hits that are the same club in the same place (multiple tees/9s) to one, preserving order. */
function dedupeCourses(hits: SearchHit[]): SearchHit[] {
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const h of hits) {
    const key = `${(h.club_name || h.course_name).toLowerCase().trim()}|${shortLoc(h.location).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  return out;
}

export const quickRoundHandler: IntentHandler = {
  intent_type: 'quick_round',

  parameter_schema: {
    course_hint: 'free-text course name or local slug (optional)',
    hole_count: '9 or 18 (optional, defaults to 18)',
    guest_names: 'string[] of playing-partner names (optional)',
  },

  examples: [
    "let's play a quick round at Maplewood",
    'quick round at the Lakes',
    '9-hole quick round at Sunnyvale',
    'Tim is playing with Bob and Sarah at Pembroke Pines today',
    'start a round at Crystal Springs with Mike',
    'fast round at the Palms',
  ],

  async execute(intent: VoiceIntent, _context: AppContext): Promise<IntentResult> {
    const courseHint = String(intent.parameters.course_hint ?? '').trim();
    const holeCountRaw = intent.parameters.hole_count;
    const holeCount: 9 | 18 = holeCountRaw === 9 || holeCountRaw === '9' ? 9 : 18;
    const guestNamesRaw = intent.parameters.guest_names;
    const guestNames: string[] = Array.isArray(guestNamesRaw)
      ? guestNamesRaw.filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
      : [];

    // 1) Course resolution — local-first, API fallback.
    let courseId: string | null = null;
    let courseDisplayName: string | null = null;
    let courseLocationSpoken: string | null = null; // set only for API hits, to voice back for auditability

    if (courseHint) {
      const local = resolveLocalCourse(courseHint);
      if (local) {
        courseId = local.id;
        courseDisplayName = local.displayName;
      } else {
        try {
          const results = await searchCourses(courseHint);
          const reals = dedupeCourses(results.filter((r): r is SearchHit => !r._error && !!r.id));
          if (reals.length > 1) {
            // Ambiguous — DON'T silently pick the first (wrong-course trap). Name the top few with
            // their cities, HOLD the candidate list, and ask. The user's next utterance ("the New
            // Jersey one" / "Austin" / "the first one") resolves against the held list directly in
            // the voice follow-up loop (services/pendingDisambiguation.ts) — no need to re-issue the
            // whole command. nineHole + guest names carry through so the resolved start keeps them.
            const top = reals.slice(0, 3);
            const options = top.map(r => {
              const nm = r.club_name || r.course_name;
              const loc = shortLoc(r.location);
              return loc ? `${nm} in ${loc}` : nm;
            });
            setPendingCourseChoices(
              top.map(r => ({ id: r.id, name: r.club_name || r.course_name, location: shortLoc(r.location) })),
              { nineHole: holeCount === 9, guestNames },
            );
            return {
              success: false,
              // Must end with a question so the pipeline auto-opens the mic for the answer.
              voice_response: `I found a few courses like "${courseHint}" — ${listJoin(options)}. Which one — say the city or state, or "the first one"?`,
              side_effects: [`quick_round:ambiguous_course=${reals.length}`],
              follow_up_needed: true,
            };
          }
          const real = reals[0];
          if (real) {
            courseId = real.id;
            courseDisplayName = real.club_name || real.course_name || courseHint;
            courseLocationSpoken = shortLoc(real.location) || null;
          }
        } catch (e) {
          console.log('[quickRoundHandler] searchCourses failed (non-fatal):', e);
        }
      }
    }

    // No course resolvable — ask once instead of guessing.
    if (!courseId) {
      const guestSuffix = guestNames.length > 0 ? ` with ${listJoin(guestNames)}` : '';
      return {
        success: false,
        voice_response: courseHint
          ? `I couldn't find "${courseHint}". Which course${guestSuffix}?`
          : `Which course do you want to play${guestSuffix}?`,
        side_effects: ['quick_round:unresolved_course'],
        follow_up_needed: true,
      };
    }

    // 2) Mint / refresh guest profiles. addGuest is dedupe-safe and
    //    auto-prunes expired entries, so a fresh round never carries
    //    stale strangers' names.
    const mintedGuests: string[] = [];
    if (guestNames.length > 0) {
      const guestStore = useGuestProfileStore.getState();
      for (const name of guestNames) {
        const g = guestStore.addGuest(name);
        if (g) mintedGuests.push(g.displayName);
      }
    }

    // 3) Signal the round start. setPendingStartCourse is the same
    //    surface the Play tab uses; Caddie tab consumes it on focus and
    //    fires runStartRound. setPendingStartFactors carries the
    //    nine-hole flag through. Mode + mental default to a sensible
    //    starting point since the voice path skipped the Play-tab
    //    setup chips — user can adjust mid-round via existing voice
    //    intents (change_setting:round_mode).
    const round = useRoundStore.getState();
    round.setPendingStartCourse(courseId);
    round.setPendingStartFactors({
      mode: 'free_play',
      nineHole: holeCount === 9,
      isCompetition: false,
      mentalState: 'neutral',
      notes: '',
    });

    // 4) Best-effort nav to Caddie — that tab's focus listener consumes
    //    the pending signal. Non-fatal if router import fails (the
    //    pending signal still fires the next time Caddie gains focus).
    try {
      const { router } = await import('expo-router');
      router.push('/(tabs)/caddie' as never);
    } catch (e) {
      console.log('[quickRoundHandler] caddie nav failed (non-fatal):', e);
    }

    const holeWord = holeCount === 9 ? '9-hole ' : '';
    const guestSuffix = mintedGuests.length > 0 ? ` with ${listJoin(mintedGuests)}` : '';
    // Voice the city for API-resolved courses so a wrong single match is caught by ear before hole 1.
    const locationSuffix = courseLocationSpoken ? ` in ${courseLocationSpoken}` : '';
    return {
      success: true,
      voice_response: `Starting a ${holeWord}quick round at ${courseDisplayName}${locationSuffix}${guestSuffix}.`,
      side_effects: [
        `quick_round:course=${courseId}`,
        `quick_round:hole_count=${holeCount}`,
        ...(mintedGuests.length > 0 ? [`quick_round:guests=${mintedGuests.length}`] : []),
      ],
      follow_up_needed: false,
    };
  },
};
