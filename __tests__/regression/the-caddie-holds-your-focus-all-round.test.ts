/**
 * 2026-08-31 (Tim: "check if note input on play tab does the same thing") — IT DID, IN THE MIDDLE.
 *
 * The pre-round note written on the Play tab was wired at both ENDS and absent from the entire round
 * between them:
 *
 *   api/briefing  (round START)  → "Player's focus for today: ..."                    ✓
 *   the live caddie (18 holes)   → nothing. Not in the payload at all.                ✗
 *   api/recap     (round END)    → "Pre-round focus (user wrote) — coaching contract" ✓
 *
 * So a player writes "working on tempo today", hears nothing about it for eighteen holes, and is
 * then graded against it at the end. The one place a coaching contract can actually change a
 * decision is while the round is being played, and that was the one place it never arrived.
 *
 * Same shape as the swing feel/coach notes swept the same night, and as the offline notes that were
 * collected all round and never read. Capture is easy to ship and easy to believe finished.
 * [[orphans-are-live-bugs-not-dead-code]]
 */
import * as fs from 'fs';
import * as path from 'path';
const read = (r: string) => fs.readFileSync(path.join(__dirname, '..', '..', r), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

describe('the pre-round note survives the whole round', () => {
  it('the Play tab still hands it to the round', () => {
    const play = strip(read('app/(tabs)/play.tsx'));
    expect(play).toMatch(/notes: setupNotes/);
  });

  it('the round stores it', () => {
    expect(strip(read('store/roundStore.ts'))).toMatch(/roundNotes: options\.notes/);
  });

  it('THE GAP THAT WAS: the LIVE caddie payload now carries it', () => {
    const body = strip(read('services/caddieRequestBody.ts'));
    expect(body).toMatch(/roundNotes: safe\(/);
    // Bounded — a note is a sentence, not an essay, and it rides every turn.
    expect(body).toMatch(/slice\(0, 400\)/);
    // Empty means ABSENT, never an empty string pretending to be a focus.
    expect(body).toMatch(/\|\| null, null\)/);
  });

  it('the brain renders it as a standing intention, not a thing to keep announcing', () => {
    const k = strip(read('api/kevin.ts'));
    expect(k).toMatch(/roundNotes = null/);
    expect(k).toMatch(/Before the round the player wrote what they want to work on/);
    // A caddie who mentions your stated focus on every shot is worse than one who never does.
    expect(k).toMatch(/standing intention/);
    expect(k).toMatch(/say nothing about it when it is not/);
  });

  it('it rides the MESSAGE, not the cached system prompt', () => {
    // roundNotes is round-stable so either would be safe, but the message keeps the cache untouched
    // and the ratchet honest. The block it lives in is composed into the user turn.
    const k = read('api/kevin.ts');
    const mine = k.indexOf('Before the round the player wrote');
    const sys = k.indexOf('const systemPrompt = `');
    expect(mine).toBeGreaterThan(-1);
    expect(sys).toBeGreaterThan(-1);
    expect(mine).toBeLessThan(sys);
    expect(strip(k)).toMatch(/turnStatePrefix/);
  });

  it('the two ends that already worked still work', () => {
    expect(strip(read('api/briefing.ts'))).toMatch(/Player's focus for today/);
    expect(strip(read('api/recap.ts'))).toMatch(/Pre-round focus \(user wrote\)/);
  });
});
