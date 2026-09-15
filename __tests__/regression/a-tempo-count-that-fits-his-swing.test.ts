/**
 * 2026-09-14 (Tim) — "tempo would be really helpful with feel … Hank Haney … swears on full swing
 * to say one hundred and one … There is a simple app for that I tried. It was neat but not a useful
 * app as a standalone. Only is this have grounding in known caddy truth"
 *
 * It has grounding: Tour Tempo established 3:1 across tour players and teaches it with tones at
 * fixed frame counts (24/8, 21/7, 27/9 — all with an eight-frame downswing), which the tempo
 * trainer already uses. A spoken count is that device carried by syllables.
 *
 * What made the standalone app neat-but-useless is that it hands you a PRESET: it has never seen
 * you swing. SmartPlay measures the backswing and downswing in milliseconds, so the count is chosen
 * to fit — and, more usefully, a second count is offered for the tempo he is aiming at.
 *
 * The honesty line: this claims nothing about counting making you better. It answers one arithmetic
 * question — at this duration, what can a human actually say at a comfortable speaking rate.
 */
import { countForBackswing, countForTarget } from '../../services/tempoCount';

describe('the count is chosen from the measurement', () => {
  it('a normal backswing gets a sayable count', () => {
    const c = countForBackswing(750, 250)!;
    expect(c.comfortable).toBe(true);
    expect(c.msPerSyllable).toBeGreaterThanOrEqual(170);
    expect(c.msPerSyllable).toBeLessThanOrEqual(260);
    expect(c.note).toContain('750 ms');        // his number, not a preset's
  });

  it('different swings get different counts — it is not one preset wearing a hat', () => {
    const quick = countForBackswing(450, 250)!;
    const full = countForBackswing(1000, 250)!;
    expect(quick.back).not.toBe(full.back);
    expect(quick.comfortable && full.comfortable).toBe(true);
  });

  it("Haney's count lands where a real full backswing lands", () => {
    // "one hundred and one" is five syllables; it fits a genuinely full load, not a quick one.
    expect(countForBackswing(900, 250)!.back).toBe('one hundred and one');
    expect(countForBackswing(450, 250)!.back).not.toBe('one hundred and one');
  });

  it('a backswing too short to count SAYS SO rather than telling him to talk faster', () => {
    const c = countForBackswing(300, 250)!;
    expect(c.comfortable).toBe(false);
    expect(c.note).toMatch(/too quick to count/i);
    expect(c.note).toMatch(/Lengthen the load/);
    // The failure is the finding — it must not be dressed up as a working count.
    expect(c.note).not.toMatch(/just say it faster/i);
  });

  it('a backswing long enough to drag says that too', () => {
    const c = countForBackswing(2200, 250)!;
    expect(c.comfortable).toBe(false);
    expect(c.note).toMatch(/drags/);
  });

  it('the downswing is always one syllable, because it is always about a quarter second', () => {
    for (const b of [450, 750, 1000]) expect(countForBackswing(b, 250)!.down).toBe('hit');
  });

  it('refuses nonsense rather than returning a count for it', () => {
    expect(countForBackswing(0, 250)).toBeNull();
    expect(countForBackswing(Number.NaN, 250)).toBeNull();
    expect(countForTarget(0, 3)).toBeNull();
    expect(countForTarget(250, 0)).toBeNull();
  });
});

describe('the target count is the training half', () => {
  it('holds the real downswing and counts the backswing the target would want', () => {
    // 250 ms downswing at 3:1 wants a 750 ms backswing — the same count as measuring 750 directly.
    expect(countForTarget(250, 3)!.back).toBe(countForBackswing(750, 250)!.back);
  });

  it('a rushed player is given a longer count to aim at than the one he has', () => {
    const his = countForBackswing(450, 250)!;      // 1.8:1 — quick
    const aim = countForTarget(250, 3)!;           // what 3:1 would want
    expect(aim.back).not.toBe(his.back);
    expect(aim.comfortable).toBe(true);
  });
});
