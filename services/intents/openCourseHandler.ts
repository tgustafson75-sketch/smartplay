import type { IntentHandler, IntentResult, VoiceIntent, AppContext } from '../../types/voiceIntent';
import { useRoundStore } from '../../store/roundStore';
import { resolveSpokenCourse } from '../courseNameResolver';

/**
 * 2026-07-23 (Tim — "tell the Caddie what course and where and the caddie pulls it up in the play tab").
 * The precheck (services/localIntentPrecheck) has already resolved the spoken name to a bundled course
 * id (course_id = "local:<slug>") — it only emits this intent when the name RESOLVED, so we never land
 * here for an unknown course. We set it as the Play-tab preview selection and navigate there. Offline-
 * capable: bundled course data + local navigation, no network. Step 2 (booking a tee time) is future.
 */
export const openCourseHandler: IntentHandler = {
  intent_type: 'open_course',

  parameter_schema: {
    course_id: 'a bundled course id, e.g. "local:highland-links"',
    course_label: 'the human course name for the spoken confirmation',
  },

  examples: [
    'take me to Highland Links',
    'pull up Pebble Beach',
    'load Highland Links in Truro',
    'go to Miccosukee',
  ],

  async execute(intent: VoiceIntent, _context: AppContext): Promise<IntentResult> {
    let courseId = String(intent.parameters.course_id ?? '');
    let label = String(intent.parameters.course_label ?? 'that course');
    // 2026-07-25 (deep audit) — the CLOUD classifier can now emit open_course too, but it only knows
    // the spoken name (course_label), not a bundled id — the precheck path pre-resolves the id, the
    // classifier path doesn't. Resolve the label here so a brain-classified "pull up Mines" isn't a
    // dead "which course?" It only resolves KNOWN bundled courses; an unknown name degrades honestly.
    if (!courseId) {
      const spoken = String(intent.parameters.course_label ?? intent.raw_text ?? '').trim();
      const resolved = spoken ? resolveSpokenCourse(spoken) : null;
      if (resolved) { courseId = resolved.previewId; label = resolved.label; }
    }
    if (!courseId) {
      return { success: false, voice_response: "Which course? I've got the ones in your list.", side_effects: ['open_course:no_id'], follow_up_needed: true };
    }

    // Preview selection so the Play tab surfaces this course (card + SmartVision preview) before the
    // user taps Start Round. Guarded — a store hiccup must not swallow the navigation.
    try { useRoundStore.getState().setPreviewCourse(courseId); } catch { /* non-fatal */ }

    let routerMod: typeof import('expo-router') | null = null;
    try { routerMod = await import('expo-router'); } catch { /* unavailable in test envs */ }
    try { routerMod?.router.replace('/(tabs)/play' as never); } catch { /* no-op */ }

    return { success: true, voice_response: `Pulling up ${label}.`, side_effects: ['open_course:' + courseId], follow_up_needed: false };
  },
};
