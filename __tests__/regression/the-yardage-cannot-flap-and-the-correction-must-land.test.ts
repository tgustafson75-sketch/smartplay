/**
 * 2026-09-10 — Tim, on the tee at Hemet, mid-round: "the right number goes in and out" and
 * "I'm telling Kevin the correction and he keeps repeating the wrong yardage."
 *
 * TWO defects, both structural, both invisible to every existing test.
 *
 * 1. THE FLAP. yardageResolver gated live GPS on `fixAge < 10_000`. gpsManager's walking mode polls
 *    at EXACTLY 10_000ms. The gate was tied with the cadence feeding it, so a fix stayed healthy for
 *    9.9s and aged out at the instant the next was due — dropping to the static card, which is the
 *    FROZEN tee→green scorecard number, not a slightly older live reading. Next fix flipped it back.
 *    Every ten seconds. gpsManager already owns staleness (30s, sized as "walking (10s) + 3 missed
 *    ticks"), degrades at 60s while KEEPING the position, and hard-clears at 5 min. The resolver had
 *    invented a second, tighter rule one layer up.
 *
 * 2. THE CORRECTION THAT COULD NOT LAND. The follow-up bypass skipped the ENTIRE intent router while
 *    the caddie awaited a reply — all 35 handlers, `state_yardage` among them. That is the intent
 *    whose most natural moment is the instant after the caddie says a number you disagree with. So
 *    setUserStatedYardage was never called, Tier 3 stayed empty, the next context build re-derived
 *    the same wrong number, and Kevin repeated it. Stating it as a fresh utterance always worked;
 *    correcting him with it never did.
 */
import fs from 'fs';
import path from 'path';
import { carriesYardageCorrection } from '../../services/intents/stateYardageHandler';

const root = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the live-yardage tier does not flap against the GPS poll cadence', () => {
  it('yardageResolver holds no staleness gate of its own', () => {
    const src = code(read('services/yardageResolver.ts'));
    // The gate that tied with walking mode. Any private age arithmetic in front of the live tier is
    // a second owner of staleness and will re-create the flap.
    expect(src).not.toContain('fixAge < 10_000');
    const gate = /const gpsHealthy =[\s\S]{0,240}?;/.exec(src);
    expect(gate).not.toBeNull();
    expect(gate![0]).not.toMatch(/fixAge/);
    expect(gate![0]).not.toMatch(/isSimulatedActive/);
  });

  it('gpsManager is still the one owner, and still sized above its own walking cadence', () => {
    const gps = read('services/gpsManager.ts');
    const walking = /walking:\s*\{\s*intervalMs:\s*([\d_]+)/.exec(gps);
    const staleness = /const FIX_STALENESS_MS = ([\d_]+)/.exec(gps);
    expect(walking).not.toBeNull();
    expect(staleness).not.toBeNull();
    const cadence = parseInt(walking![1].replace(/_/g, ''), 10);
    const stale = parseInt(staleness![1].replace(/_/g, ''), 10);
    // The bug in one line: a staleness bound must never be <= the cadence that feeds it.
    expect(stale).toBeGreaterThan(cadence);
  });
});

describe('a yardage correction reaches the router even mid-conversation', () => {
  it('the follow-up bypass is no longer a blanket skip', () => {
    const src = code(read('hooks/useVoiceCaddie.ts'));
    expect(src).not.toMatch(/const skipIntentRouter = isAwaitingFollowUp\(\);/);
    expect(src).toContain('carriesYardageCorrection(transcript)');
  });

  it('routes the corrections a player actually says', () => {
    for (const said of ['no, it’s 165', "it's 165", 'I’m 165', '165 not 190', 'call it 145', 'Golfshot says 156']) {
      expect(carriesYardageCorrection(said)).toBe(true);
    }
  });

  it('still bypasses the answer the bypass was written for', () => {
    // 2026-05-16: "send it home" after "lay up or send it home?" was being read as `navigate home`.
    expect(carriesYardageCorrection('send it home')).toBe(false);
    expect(carriesYardageCorrection('lay up')).toBe(false);
    expect(carriesYardageCorrection('yeah go for it')).toBe(false);
  });

  it('does not mistake an answer to the caddie’s own numeric question for a yardage', () => {
    // These are what small numbers mean in a follow-up: holes, scores, putts, clubs.
    expect(carriesYardageCorrection('12')).toBe(false);       // "what hole are you on?"
    expect(carriesYardageCorrection('hole 12')).toBe(false);
    expect(carriesYardageCorrection('I made a 5')).toBe(false);
    expect(carriesYardageCorrection('two putts')).toBe(false);
    expect(carriesYardageCorrection('7 iron')).toBe(false);
    expect(carriesYardageCorrection('18')).toBe(false);
  });

  it('state_yardage is still a registered intent, so routing it can do something', () => {
    expect(read('api/voice-intent.ts')).toContain("'state_yardage'");
  });
});

describe('the watch tracks the fix, not just a timer', () => {
  const bridge = code(read('services/watchCaddieBridge.ts'));

  it('subscribes to the same GPS fan-out every other yardage surface reads', () => {
    expect(bridge).toContain('subscribeFixChange');
    expect(bridge).toMatch(/fixSub = subscribeFixChange\(/);
  });

  it('keeps the slow tick as a backstop rather than replacing one blind spot with another', () => {
    // The fan-out has a known gap (round teardown/reconnect) — the reason Cockpit kept its poll.
    expect(bridge).toContain('YARDAGE_TICK_MS');
    expect(bridge).toMatch(/setInterval\([\s\S]{0,80}?pushYardageToWatch/);
  });

  it('only transmits when the numbers actually changed, so the wrist costs less than before', () => {
    expect(bridge).toMatch(/if \(key === lastYardageKey\) return;/);
    // Hole belongs in the key: a hole change must send even if the triplet repeats.
    expect(bridge).toMatch(/const key = `\$\{y\.hole_number\}/);
  });

  it('unsubscribes and forgets the last reading on teardown', () => {
    expect(bridge).toContain('fixSub?.();');
    expect(bridge).toMatch(/lastYardageKey = '';/);
  });
});
