/**
 * Phase BR — Format active tutorial context for Kevin's system prompt.
 *
 * Two output shapes (Component 13 — token budget management):
 *
 *   - **Full** for Sonnet calls (conversational / reasoning paths) —
 *     teaching focus + key cues + target clubs + situations + instructor.
 *     Roughly 100-300 tokens per active tutorial; with the 3-tutorial
 *     cap, total is bounded ~900 tokens worst-case.
 *
 *   - **Compressed** for Haiku calls (low-latency direct handlers) —
 *     just key cues + target clubs as a comma-joined line. Roughly
 *     30-60 tokens per active tutorial.
 *
 * Both forms emit nothing when no tutorials are active, so the existing
 * Kevin prompts work unchanged for users without active practice context.
 */

import { useTutorialStore, type TutorialEntry } from '../store/tutorialStore';

/** Returns the currently-active tutorials (capped at 3 by the store). */
export function getActiveTutorials(): TutorialEntry[] {
  return useTutorialStore.getState().getActive();
}

/**
 * Full practice context for Sonnet system prompt. Multi-paragraph,
 * naturally readable so Kevin can reference it conversationally.
 * Returns null when no tutorials are active so the caller can skip
 * the "PLAYER PRACTICE CONTEXT:" header entirely.
 */
export function buildFullPracticeContext(): string | null {
  const active = getActiveTutorials();
  if (active.length === 0) return null;

  const lines: string[] = ['PLAYER PRACTICE CONTEXT (private; reference naturally during relevant shots, never read aloud verbatim):'];
  lines.push('The player is currently working on:');

  for (const t of active) {
    const head = t.instructor
      ? `- ${t.teaching_focus} (from ${t.instructor})`
      : `- ${t.teaching_focus}`;
    lines.push(head);
    if (t.key_cues.length > 0) {
      lines.push(`  Key cues: ${t.key_cues.join(' / ')}`);
    }
    if (t.target_clubs.length > 0) {
      lines.push(`  Target clubs: ${t.target_clubs.join(', ')}`);
    }
    if (t.target_situations.length > 0) {
      lines.push(`  When it applies: ${t.target_situations.join('; ')}`);
    }
  }

  lines.push('');
  lines.push('Factor this learning into shots that match. Do NOT override the coach\'s instruction. Reinforce when shot calls for the technique being practiced. Hold back unrelated swing thoughts during shots involving practiced techniques.');

  return lines.join('\n');
}

/**
 * Compressed practice context for Haiku tactical paths. One line per
 * active tutorial, formatted for fast injection without bloating the
 * tactical-response prompt. Returns null when none active.
 */
export function buildCompressedPracticeContext(): string | null {
  const active = getActiveTutorials();
  if (active.length === 0) return null;

  const summaries = active.map(t => {
    const cues = t.key_cues.length > 0 ? t.key_cues.slice(0, 3).join(' / ') : '';
    const clubs = t.target_clubs.length > 0 ? `[${t.target_clubs.join(',')}]` : '';
    return `${t.teaching_focus}${clubs ? ' ' + clubs : ''}${cues ? ' — ' + cues : ''}`.trim();
  });

  return `PRACTICE CUES (silent; respect during matching shots): ${summaries.join(' || ')}`;
}
