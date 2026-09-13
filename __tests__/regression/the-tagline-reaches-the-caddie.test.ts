/**
 * 2026-09-13 (Tim) — "SmartPlay is not really a tool like SmartFinder (Garmin clone like
 * Rangefinder but better). It's our 'what's the play here' phrase as a tool. When the user asks for
 * the SmartPlay, Caddie analyzes the situation in that moment under our myriad of conditions and
 * factors and provides user-centric strategy for the shot... it's our answer to every other app and
 * company's plays-like feature."
 *
 * THE APP'S OWN TAGLINE WAS THE ONE PHRASE THAT NEVER REACHED THE CADDIE.
 *
 * `"what's the play"` routed to query_status { shot_strategy } → route_to_brain, and the brain
 * answered with the whole payload: lie, wind, elevation, plays-like, the bag, the player's
 * tendencies, the hole and the pin.
 *
 * `"what's the SMART play"` was deliberately intercepted BEFORE the brain and navigated to
 * `/smartfinder?autoread=1` — which opens a camera, waits 1,500ms for hardware warmup and takes a
 * picture. The comment that used to sit above the pattern admitted the intent outright: *"'smart
 * play' also appears in Haiku's shot_strategy examples, causing it to explain verbally instead of
 * opening SmartFinder."* The model wanted to answer strategically and was overridden into a screen.
 *
 * So adding the app's own tagline word made the answer WORSE. A camera read is one input; the
 * phrase is supposed to be the decision. Everyone else says "plays like 165" — the whole point of
 * this phrase is that it says what to do about it.
 *
 * A question intercepted before the brain is a question the caddie never heard. The precheck
 * matches COMMANDS, and this was never a command.
 * [[orphans-are-live-bugs-not-dead-code]] [[two-owners-is-the-root-cause]]
 */
import fs from 'fs';
import path from 'path';
import { precheckLocalIntent } from '../../services/localIntentPrecheck';

const root = path.resolve(__dirname, '../..');
const code = (rel: string) =>
  fs.readFileSync(path.join(root, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

const routed = (utterance: string) => {
  const i = precheckLocalIntent(utterance);
  return { type: i?.intent_type ?? null, topic: String(i?.parameters?.query_topic ?? ''), tool: String(i?.parameters?.tool_name ?? '') };
};

describe('the tagline reaches the caddie', () => {
  const PHRASINGS = [
    "what's the smart play",
    'whats the smart play',
    "what's the smart play here",
    'give me the smart play',
    'the smart play',
    'smartplay here',
  ];

  it.each(PHRASINGS)('"%s" asks the caddie for strategy, not a camera', (u) => {
    const r = routed(u);
    expect(r.type).toBe('query_status');
    expect(r.topic).toBe('shot_strategy');
    expect(r.tool).not.toMatch(/smart_?play/);
  });

  it('lands in exactly the same place as the phrasing without "smart"', () => {
    expect(routed("what's the smart play").topic).toBe(routed("what's the play").topic);
  });

  it('never navigates to the rangefinder camera for the phrase', () => {
    for (const u of PHRASINGS) expect(routed(u).type).not.toBe('open_tool');
    expect(code('services/localIntentPrecheck.ts')).not.toMatch(/tool_name: 'smartplay'/);
  });

  it('is still not triggered by talking ABOUT the feature', () => {
    // The NOT_ABOUT_TOOL guard has to survive the reroute.
    for (const u of ['log an issue with the smart play', 'the smart play feature is broken']) {
      const r = routed(u);
      expect(r.topic).not.toBe('shot_strategy');
    }
  });

  it('shot_strategy hands the question to the brain rather than answering thin', () => {
    expect(code('services/intents/queryStatusHandler.ts'))
      .toMatch(/query:shot_strategy:route_to_brain/);
  });
});

describe('the phrase is taught where players learn, not sold as a button', () => {
  it('the Tools menu no longer lists it as a screen', () => {
    const menu = code('components/tools/GlobalToolsMenu.tsx');
    expect(menu).not.toMatch(/label\.smart_play/);
    expect(menu).not.toMatch(/smartfinder\?autoread=1/);
  });

  it('onboarding says the phrase', () => {
    expect(code('app/welcome.tsx')).toMatch(/smart_play_primer/);
    const en = JSON.parse(fs.readFileSync(path.join(root, 'i18n/locales/en.json'), 'utf8'));
    expect(en.welcome.welcome_screen.smart_play_primer).toMatch(/smart play/i);
  });

  it('the quick-start guide leads with it', () => {
    const qs = code('app/quick-start.tsx');
    /**
     * Assert the CARD ORDER, not "the words appear early" — the first version of this checked
     * indexOf('smart play') and passed even with the card retitled, because the body text still
     * mentioned the phrase further up. A guard that the mutation cannot fail is not a guard.
     * [[break-test-every-guard-you-write]]
     */
    const titles = [...qs.matchAll(/title:\s*(?:'([^']*)'|"((?:[^"\\]|\\.)*)")/g)]
      .map((m) => (m[1] ?? m[2] ?? '').replace(/\\"/g, '"'));
    expect(titles.length).toBeGreaterThan(3);
    expect(titles[0]).toMatch(/smart play/i);
    expect(titles.indexOf(titles[0])).toBeLessThan(titles.findIndex((x) => /Your Caddie Team/.test(x)));
  });

  it('tutorials open on it, and stop calling it a tool', () => {
    const tut = code('app/tutorials.tsx');
    expect(tut).toMatch(/id: 'smart_play'/);
    expect(tut.indexOf("id: 'smart_play'")).toBeLessThan(tut.indexOf("id: 'voice'"));
    // the Tools card used to list "Smart Play" among screens you can open
    expect(tut).not.toMatch(/SmartFinder, Smart Play, or TightLie/);
  });
});
