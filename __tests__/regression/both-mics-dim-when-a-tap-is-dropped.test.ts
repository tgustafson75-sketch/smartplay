/**
 * 2026-10-28 (recheck VC-R2-5) — THE BOTTOM-BAR MIC STAYED BRIGHT WHILE ITS TAPS WERE DROPPED.
 *
 * While the caddie thinks (session 'thinking'), listeningSession.toggle() drops a tap
 * (swallowedTap('session_in_flight') — a buzz, and a tap_swallowed in the issue log). Round 1 (VC-4)
 * made the header badge dim for exactly that state; the bottom-bar mic — the bar's own header calls it
 * THE talk surface — kept full opacity and a "Tap to talk" label, so the player kept tapping a control
 * that was ignoring him. Both mics now take their look from one rule, micTapLook.
 *
 * Mounted for real in __tests__/components/the-mic-badge-is-bright-when-it-is-the-stop-button.test.tsx
 * (the badge and the bar); this pins the rule and that both controls render through it.
 */
import fs from 'fs';
import path from 'path';
import { micTapLook, tapIsDroppedIn } from '../../services/voice/tapIsDroppedIn';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8');

describe('both primary mics dim exactly when a tap is dropped', () => {
  it("THE BUG: 'thinking' dims the mic", () => {
    expect(micTapLook('thinking')).toEqual({ opacity: 0.4, dropped: true });
  });

  it('full opacity wherever a tap still acts', () => {
    for (const st of ['idle', 'opening', 'listening', 'responding']) expect(micTapLook(st)).toEqual({ opacity: 1, dropped: false });
  });

  it('is the same rule toggle() drops taps by', () => {
    for (const st of ['idle', 'opening', 'listening', 'thinking', 'responding']) expect(micTapLook(st).dropped).toBe(tapIsDroppedIn(st));
  });

  it('the bottom-bar mic and the header badge both render through it', () => {
    const bar = read('components/caddie/CaddieBottomBar.tsx');
    expect(bar).toContain('const micLook = micTapLook(listeningState);');
    expect(bar).toMatch(/style=\{\[s\.mic, isListening && s\.micActive, \{ opacity: micLook\.opacity \}\]\}/);
    expect(bar).toMatch(/accessibilityLabel=\{micLook\.dropped\s*\? t\('caddie_caddie_bottom_bar\.accessibility_label\.caddie_is_thinking'\)/);
    const badge = read('components/caddie/CaddieMicBadge.tsx');
    expect(badge).toContain('const badgeOpacity = micTapLook(listeningState).opacity;');
  });

  it('the label is a real string', () => {
    const en = JSON.parse(read('i18n/locales/en.json')) as { caddie_caddie_bottom_bar: { accessibility_label: Record<string, string> } };
    expect(en.caddie_caddie_bottom_bar.accessibility_label.caddie_is_thinking).toBe('Your caddie is thinking');
  });
});
