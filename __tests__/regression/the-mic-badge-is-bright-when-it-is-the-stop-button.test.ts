/**
 * 2026-10-28 (recheck VC-4) — THE HEADER MIC BADGE DIMMED TO 40% EXACTLY WHEN IT WAS THE STOP BUTTON.
 *
 * CaddieMicBadge dimmed for opening / listening / thinking, "mirroring sessionInFlight". But
 * listeningSession.toggle() handles 'listening' BEFORE that guard — a tap there is "I'm done"
 * (endCaptureEarly + the got-it cue), and the badge's own label says "Stop talking to caddie" — and a
 * genuine tap during 'opening' is queued as that same endpoint. So the control read as locked at the
 * one moment tapping it was the right thing to do, and the player waited on VAD in the wind instead.
 * e3a6e54f (06-24) fixed it once ("listening no longer DIMS the badge — backwards"); a rollback put
 * the 0.4 back. 'thinking' is the only state where toggle() drops the tap.
 */
import fs from 'fs';
import path from 'path';

// Native modules the voice graph reaches; the rule under test is pure.
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(async () => undefined), ImpactFeedbackStyle: {} }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() } }));
jest.setTimeout(120_000);

describe('the mic badge dims only when a tap would really be dropped', () => {
  const { tapIsDroppedIn } = require('../../services/listeningSession') as typeof import('../../services/listeningSession'); // re-exported from services/voice/tapIsDroppedIn
  // What the badge renders for a state (CaddieMicBadge: `tapIsDroppedIn(listeningState) ? 0.4 : 1`).
  const badgeOpacityFor = (st: string) => (tapIsDroppedIn(st) ? 0.4 : 1);

  it('THE BUG: full opacity while LISTENING — tapping now is "I\'m done"', () => {
    expect(badgeOpacityFor('listening')).toBe(1);
  });

  it('full opacity while OPENING — a tap is queued as the endpoint, not swallowed', () => {
    expect(badgeOpacityFor('opening')).toBe(1);
  });

  it('dims while THINKING, the one state toggle() swallows (session_in_flight)', () => {
    expect(badgeOpacityFor('thinking')).toBeLessThan(1);
  });

  it('full opacity at rest and while the caddie speaks (a tap there shushes it)', () => {
    expect(badgeOpacityFor('idle')).toBe(1);
    expect(badgeOpacityFor('responding')).toBe(1);
  });

  it('the dim is the one the badge renders, and toggle() still takes listening/opening taps', () => {
    const badge = fs.readFileSync(path.resolve(__dirname, '../../components/caddie/CaddieMicBadge.tsx'), 'utf-8');
    expect(badge).toContain('const badgeOpacity = tapIsDroppedIn(listeningState) ? 0.4 : 1;');
    expect(badge).toContain('opacity: badgeOpacity');
    // The rule's owner is the function that drops the tap: listening and opening are endpoint taps.
    const ls = fs.readFileSync(path.resolve(__dirname, '../../services/listeningSession.ts'), 'utf-8');
    expect(ls).toMatch(/if \(state === 'listening'\) \{[\s\S]*?endCaptureEarly\(\);/);
    expect(ls).toMatch(/if \(!isEcho && state === 'opening'\) \{\s*skipOpenCue = true;/);
  });
});
