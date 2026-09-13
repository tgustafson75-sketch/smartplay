/**
 * 2026-09-13 (Tim) — "if there was a focus that day which we built caddie context for — like if I am
 * working on irons or tempo or driver — a quick focus and analysis of the session. Then make sure
 * this context is discoverable by the brain."
 *
 * THE FOCUS WAS RECORDED AND NEVER LEFT THE STORE.
 *
 * `PracticeSession.focus` has existed since the session runner shipped — irons, wedges,
 * driver_speed, putting — and the ONLY thing that ever reached the caddie from practice was
 * `practiceImpactBlock`, which maps each session to `{ startedAt, balls }` and throws the rest away.
 * So the app knew he spent Tuesday on tempo and Thursday on wedges, and the caddie could not be
 * asked about either. Measured, stored, drawn on a dashboard row, and unaskable — the half that
 * keeps being missing. [[smartplay-defect-class-unwired-halves]]
 *
 * A DAY IS A SESSION (Tim, same conversation). The store opens a session per bout of work, so an
 * afternoon with three analyses is three rows; nobody practises in "bouts", they practise on a day.
 * Everything here groups by local calendar date first.
 *
 * Honest by construction: this reports what was logged — focuses, balls, how many goes — and never
 * concludes that practice worked. Whether it showed up in scoring is practiceImpact's job, and that
 * one measures it. A summary that editorialises about improvement it has not measured is exactly the
 * kind of confident sentence this app keeps having to take back.
 */

export type PracticeDay = {
  /** Local calendar key, newest-first ordering handled by the caller. */
  key: string;
  /** Epoch ms of the latest bout that day — for display and sorting. */
  at: number;
  /** Total balls/reps credited across every bout that day. */
  balls: number;
  /** How many separate goes made up the day. */
  bouts: number;
  /** Distinct focuses worked that day, in the order they were first seen. */
  focuses: string[];
};

type SessionLike = {
  startedAt?: number;
  swingCount?: number | null;
  swings?: unknown[];
  focus?: string | null;
  label?: string | null;
  kind?: string | null;
};

/** "driver_speed" → "Driver Speed". Labels already read naturally and pass through. */
export function prettyFocus(raw: string): string {
  return raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** What a bout was ABOUT: its explicit focus, else its label, else the kind of session it was. */
function focusOf(s: SessionLike): string | null {
  if (s.focus && s.focus.trim()) return prettyFocus(s.focus.trim());
  if (s.label && s.label.trim()) return s.label.trim();
  if (s.kind === 'open_range') return 'Open Range';
  return null;
}

/** Group raw practice sessions into DAYS, newest first. */
export function groupPracticeByDay(sessions: readonly SessionLike[], limit = 6): PracticeDay[] {
  const byDay = new Map<string, PracticeDay>();
  for (const s of sessions) {
    if (typeof s.startedAt !== 'number' || !Number.isFinite(s.startedAt)) continue;
    const d = new Date(s.startedAt);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const balls = s.swingCount ?? (Array.isArray(s.swings) ? s.swings.length : 0);
    const focus = focusOf(s);
    const row = byDay.get(key);
    if (row) {
      row.balls += balls;
      row.bouts += 1;
      row.at = Math.max(row.at, s.startedAt);
      if (focus && !row.focuses.includes(focus)) row.focuses.push(focus);
    } else {
      byDay.set(key, { key, at: s.startedAt, balls, bouts: 1, focuses: focus ? [focus] : [] });
    }
  }
  return [...byDay.values()].sort((a, b) => b.at - a.at).slice(0, limit);
}

/** One line for a day card: what the day was about, and what it added up to. */
export function describePracticeDay(day: PracticeDay): string {
  const what = day.focuses.length > 0 ? day.focuses.join(' · ') : 'Practice';
  const goes = day.bouts === 1 ? 'one go' : `${day.bouts} goes`;
  return `${what} — ${day.balls} balls, ${goes}`;
}

/**
 * The block the caddie reads. Null when there is nothing logged, because a heading with no days
 * under it is prompt weight that teaches the model the player never practises.
 *
 * Stable for a whole round: it is built from COMPLETED sessions, and a session completes off the
 * course. That is what makes it safe to sit in the cached block rather than rebuilt per turn.
 */
export function buildPracticeFocusBlock(sessions: readonly SessionLike[], limit = 5): string | null {
  const days = groupPracticeByDay(sessions, limit);
  if (days.length === 0) return null;

  const lines = days.map((d) => {
    const when = new Date(d.at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    return `- ${when}: ${describePracticeDay(d)}`;
  });

  /** The thread across the window — counted, not inferred. */
  const tally = new Map<string, number>();
  for (const d of days) for (const f of d.focuses) tally.set(f, (tally.get(f) ?? 0) + 1);
  const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  const lead = ranked[0];
  const thread = lead && lead[1] > 1
    ? `He has come back to ${lead[0]} on ${lead[1]} of the last ${days.length} practice days.`
    : null;

  return [
    'RECENT PRACTICE (a day of work is one session):',
    ...lines,
    ...(thread ? [thread] : []),
    'This is what he has been WORKING ON. Use it when he asks what he has been practising, and when a'
    + ' shot calls for something he has put reps into — reference the work, do not congratulate him on'
    + ' improvement you have not measured.',
  ].join('\n');
}
