/**
 * 2026-09-30 (review) — services/analytics.track sends its props to Sentry as breadcrumbs, with no
 * opt-in gate. atBallHandler passed the ball's precise lat/lng and swingCommentaryService the player's
 * matched phrase. The usage pipe's field strip (sanitizeUsageProps) now applies here too.
 */
const crumbs: { message?: string; data?: Record<string, unknown> }[] = [];
jest.mock('../../services/sentryDsn', () => ({ HAS_SENTRY_DSN: true }));
jest.mock('@sentry/react-native', () => ({
  addBreadcrumb: (c: { message?: string; data?: Record<string, unknown> }) => crumbs.push(c),
  setUser: jest.fn(), withScope: jest.fn(), captureException: jest.fn(),
}));

import { track } from '../../services/analytics';

// analytics starts a 30s flush interval on first track(); a real one keeps the runner alive.
beforeAll(() => jest.useFakeTimers());
afterAll(() => { jest.clearAllTimers(); jest.useRealTimers(); });

it('location, scores and free text are stripped before the breadcrumb; counts survive', () => {
  track('at_ball', { lat: 33.7, lng: -116.9, hole: 4 });
  track('swing_cue', { phrase: 'my grip feels weak', chars: 18 });
  for (let i = 0; i < 50; i++) track('filler'); // overflow flush
  const byName = Object.fromEntries(crumbs.map((c) => [c.message, c.data]));
  expect(byName.at_ball).toEqual({ hole: 4 });
  expect(byName.swing_cue).toEqual({ chars: 18 });
  expect(JSON.stringify(crumbs)).not.toMatch(/33\.7|116\.9|grip feels/);
});
