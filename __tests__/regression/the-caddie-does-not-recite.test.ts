/**
 * 2026-09-01 (Tim: "a canned speech in Serena at startup and delayed" — the THIRD time he has
 * flagged canned speech, after 08-20's "there's still canned speech clashing" and the
 * stop-recording line).
 *
 * WHAT IT ACTUALLY WAS. Not the persona handoff intro and not the app-open opener (that one is
 * already a real brain turn and stays SILENT on failure). It was the get-to-know interview opener:
 * a hardcoded TWO-SENTENCE SPEECH, spoken in the active persona's real voice on a 1400ms timer at
 * cold launch — identical every single time.
 *
 * A fixed sentence delivered in a convincing voice is the uncanny half of this product: it sounds
 * like a person right up until you hear it twice. Tim's call was "make it a real brain line".
 *
 * Both moments now compose their own words. The fixed strings survive ONLY as offline fallbacks,
 * because neither surface may go silent — the interview opens the mic straight after, so a mute
 * caddie leaves the player staring at a card with nothing asked.
 */
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');
const read = (r: string) => fs.readFileSync(path.join(root, r), 'utf8');

describe('there is one way to ask the caddie to speak unprompted', () => {
  const brain = read('services/conversationalBrain.ts');

  it('generateProactiveLine exists and is proactive, not a player utterance', () => {
    expect(brain).toMatch(/export async function generateProactiveLine/);
    expect(brain).toMatch(/is_proactive: true/);
  });

  it('it returns nothing rather than inventing a line', () => {
    expect(brain).toMatch(/if \(!turn\?\.text\) return NO_ANSWER;/);
  });

  it('history is seeded only when asked — an aside must not pollute the thread', () => {
    expect(brain).toMatch(/if \(opts\?\.seedHistory\) setPipecatHistory/);
  });
});

describe('the interview opener composes itself', () => {
  const caddie = read('app/(tabs)/caddie.tsx');

  it('THE REPORT: the hardcoded speech is no longer what gets spoken', () => {
    // The words survive as OPENER_FALLBACK only.
    expect(caddie).toMatch(/const OPENER_FALLBACK =/);
    expect(caddie).not.toMatch(/const opener =\s*\n?\s*"Alright — let's actually get to know your game/);
  });

  it('it asks the brain first, and seeds the history it will be answered against', () => {
    expect(caddie).toMatch(/generateProactiveLine\(/);
    expect(caddie).toMatch(/seedHistory: true/);
  });

  it('but it never goes silent — the mic opens straight after', () => {
    expect(caddie).toMatch(/let opener = OPENER_FALLBACK;/);
    expect(caddie).toMatch(/if \(brain\.text\) opener = brain\.text;/);
  });
});

describe('the persona switch introduces itself in its own words', () => {
  const settings = read('store/settingsStore.ts');

  it('asks the brain, short-fused so a switch still feels immediate', () => {
    expect(settings).toMatch(/generateProactiveLine\(/);
    expect(settings).toMatch(/timeoutMs: 3_500/);
  });

  it('falls back to the pre-rendered clip rather than stalling on the network', () => {
    expect(settings).toMatch(/keep the fixed line — a switch must never stall on the network/);
    expect(settings).toMatch(/resolveCachedOfflineClipUri/);
  });

  it('the fixed intros still exist as the fallback text', () => {
    expect(read('services/offlineVoiceCache.ts')).toMatch(/PERSONA_HANDOFF_INTROS/);
  });
});
