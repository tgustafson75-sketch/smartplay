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

// Local-course slug map mirrors the LOCAL_COURSES array in
// app/(tabs)/play.tsx. Matching is substring + case-insensitive so
// "lakes", "menifee lakes", "the lakes course" all resolve. Listed
// most-specific-first so "menifee lakes — palms" doesn't get caught
// by the bare "lakes" matcher.
const LOCAL_COURSE_SLUGS: { needles: string[]; id: string; displayName: string }[] = [
  { needles: ['palms', 'menifee palms'],            id: 'local:palms',             displayName: 'Menifee Lakes — Palms' },
  { needles: ['menifee lakes', 'the lakes'],        id: 'local:lakes',             displayName: 'Menifee Lakes — Lakes' },
  { needles: ['lakes'],                             id: 'local:lakes',             displayName: 'Menifee Lakes — Lakes' },
  { needles: ['rancho california', 'rancho'],       id: 'local:rancho-california', displayName: 'Rancho California' },
  { needles: ['crystal springs', 'crystal'],        id: 'local:crystal-springs',   displayName: 'Crystal Springs' },
  { needles: ['mariners point', 'mariners'],        id: 'local:mariners-point',    displayName: 'Mariners Point' },
  { needles: ['san jose muni', 'san jose'],         id: 'local:san-jose-muni',     displayName: 'San Jose Municipal' },
  { needles: ['sunnyvale'],                         id: 'local:sunnyvale',         displayName: 'Sunnyvale Golf Course' },
  { needles: ['maplewood'],                         id: 'local:maplewood',         displayName: 'Maplewood Golf Club' },
  { needles: ['pembroke pines', 'pembroke'],        id: 'local:pembroke-pines',    displayName: 'Pembroke Pines Country Club' },
];

function resolveLocalCourse(hint: string): { id: string; displayName: string } | null {
  const needle = hint.trim().toLowerCase();
  if (!needle) return null;
  for (const entry of LOCAL_COURSE_SLUGS) {
    if (entry.needles.some(n => needle.includes(n))) return entry;
  }
  return null;
}

function listJoin(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
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

    if (courseHint) {
      const local = resolveLocalCourse(courseHint);
      if (local) {
        courseId = local.id;
        courseDisplayName = local.displayName;
      } else {
        try {
          const results = await searchCourses(courseHint);
          const real = results.find(r => !r._error && r.id);
          if (real) {
            courseId = real.id;
            courseDisplayName = real.club_name || real.course_name || courseHint;
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
    return {
      success: true,
      voice_response: `Starting a ${holeWord}quick round at ${courseDisplayName}${guestSuffix}.`,
      side_effects: [
        `quick_round:course=${courseId}`,
        `quick_round:hole_count=${holeCount}`,
        ...(mintedGuests.length > 0 ? [`quick_round:guests=${mintedGuests.length}`] : []),
      ],
      follow_up_needed: false,
    };
  },
};
