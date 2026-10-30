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

  /**
   * 2026-10-28 (recheck VC-R3-3) — the pair above was a HAND-MADE list, and SmartMotion's talk button
   * (a third control that taps toggle()) was not on it. Every component that imports toggle() from the
   * listening session is found by walking components/, and each must take its look from micTapLook.
   */
  it('EVERY component that taps toggle() renders through micTapLook (found by walking, not listed)', () => {
    const root = path.resolve(__dirname, '../..');
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.join(dir, e.name)) : /\.tsx$/.test(e.name) ? [path.join(dir, e.name)] : []);
    const tappers = walk(path.join(root, 'components')).filter((f) =>
      /import\s*\{[^}]*\btoggle\b[^}]*\}\s*from\s*'[./]*\/services\/listeningSession'/.test(fs.readFileSync(f, 'utf8')));
    const rel = tappers.map((f) => path.relative(root, f).split(path.sep).join('/')).sort();
    // A walk that finds nothing certifies nothing — the known three must be among them.
    expect(rel).toEqual(expect.arrayContaining([
      'components/caddie/CaddieBottomBar.tsx',
      'components/caddie/CaddieMicBadge.tsx',
      'components/smartmotion/TalkToCaddieButton.tsx',
    ]));
    const missing = rel.filter((f) => !/\bmicTapLook\(/.test(read(f)));
    expect(missing).toEqual([]);
  });

  it("SmartMotion's talk button says why it is dim, and is marked disabled", () => {
    const btn = read('components/smartmotion/TalkToCaddieButton.tsx');
    expect(btn).toContain('const micLook = micTapLook(state);');
    expect(btn).toContain('opacity: micLook.opacity');
    expect(btn).toContain("t('smartmotion_talk_to_caddie_button.accessibility_label.caddie_is_thinking')");
    expect(btn).toContain('accessibilityState={{ disabled: micLook.dropped }}');
  });

  it('the label is a real string', () => {
    const en = JSON.parse(read('i18n/locales/en.json')) as Record<'caddie_caddie_bottom_bar' | 'smartmotion_talk_to_caddie_button', { accessibility_label: Record<string, string> }>;
    expect(en.caddie_caddie_bottom_bar.accessibility_label.caddie_is_thinking).toBe('Your caddie is thinking');
    expect(en.smartmotion_talk_to_caddie_button.accessibility_label.caddie_is_thinking).toBe('Your caddie is thinking');
  });
});
