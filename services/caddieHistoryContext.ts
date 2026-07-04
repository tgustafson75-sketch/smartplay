/**
 * 2026-07-04 (Tim — comprehensive voice coverage: "history of past practice sessions
 * and courses played"). A compact block of the player's recent rounds, courses played,
 * and practice focus, folded into the caddie context so it can answer conversationally —
 * "how was my last round?", "what courses have I played?", "what have I been working on?"
 * — from real data instead of a blank. Read via getState(); safe from services.
 */

import { useRoundStore } from '../store/roundStore';
import { usePracticePointsStore } from '../store/practicePointsStore';

export function historyPromptBlock(): string {
  const parts: string[] = [];

  try {
    const rounds = useRoundStore.getState().roundHistory;
    if (rounds.length > 0) {
      const recent = [...rounds]
        .slice(-4)
        .reverse()
        .map((r) => {
          const vs = r.scoreVsPar > 0 ? `+${r.scoreVsPar}` : `${r.scoreVsPar}`;
          const course = r.courseName ?? 'a course';
          const when = r.endedAt ? new Date(r.endedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
          const holes = r.holesPlayed === 9 ? ' (9)' : '';
          return `${r.totalScore} (${vs})${holes} at ${course}${when ? `, ${when}` : ''}`;
        });
      parts.push(`Recent rounds (newest first): ${recent.join('; ')}.`);
      const courses = Array.from(new Set(rounds.map((r) => r.courseName).filter((c): c is string => !!c))).slice(-12);
      if (courses.length > 0) parts.push(`Courses played: ${courses.join(', ')}.`);
    }
  } catch { /* history is additive */ }

  try {
    const byDrill = usePracticePointsStore.getState().byDrill;
    const focuses = Object.entries(byDrill)
      .map(([key, rec]) => ({ label: (rec.label ?? key).replace(/_/g, ' '), sessions: rec.sessions }))
      .filter((f) => f.sessions > 0)
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, 6)
      .map((f) => `${f.label} (${f.sessions})`);
    if (focuses.length > 0) parts.push(`Recent practice focus (sessions): ${focuses.join(', ')}.`);
  } catch { /* practice history is additive */ }

  if (parts.length === 0) return '';
  return `PLAYER HISTORY (use to answer "how was my last round / what courses have I played / what have I been working on" — reference naturally, don't recite the whole list):\n${parts.join('\n')}`;
}
