/**
 * 2026-09-12 (Tim) — "We need to make sure user sets total and carry distances during profile setup,
 * then it will dynamically update over rounds adjusting obviously truthfully by total, then we
 * extrapolate as honestly as possible average carry — that really makes a huge difference in overall
 * strategy."
 *
 * THE MODEL HE DESCRIBES ALREADY EXISTED AND IS GOOD. clubStatsStore keeps TWO ladders with a roll
 * model between them ("Driver runs out a lot; wedges barely"), GPS shot tracking writes the TOTAL
 * ladder because tee→rest is what GPS can actually see, and carry falls back to tracked total minus
 * typical roll. registerBagFromSpeech has accepted `kind: 'carry' | 'total'` the whole time.
 *
 * THE BUG WAS THE ONE PLACE THAT NEVER PASSED IT. setClubDistanceHandler hardcoded `kind: 'carry'`,
 * so "my 3 wood goes 230" — plainly the number he watches the ball stop at — was recorded as 230 of
 * CARRY, overstating it by the roll.
 *
 * THAT ERRS IN THE DIRECTION THAT LOSES A BALL. An overstated carry tells the caddie the player
 * flies a hazard they do not. Understating it costs a few yards of club and costs nothing else, so
 * an unstated kind must resolve to TOTAL, not carry.
 *
 * THE VERB ALREADY MEANS SOMETHING: "carries"/"carry is"/"flies" describe the flight → carry;
 * "goes" describes where it ended up → total.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '../..');
const code = (rel: string) =>
  fs.readFileSync(path.join(ROOT, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const HANDLER = code('services/intents/setClubDistanceHandler.ts');
const PRECHECK = code('services/localIntentPrecheck.ts');
const PROMPT = fs.readFileSync(path.join(ROOT, 'api/voice-intent.ts'), 'utf8');

describe('nothing files a distance as carry by assumption any more', () => {
  it('the hardcoded carry is gone', () => {
    expect(HANDLER).not.toMatch(/kind: 'carry' \}\]/);
    expect(HANDLER).not.toMatch(/distances: \[\{ club, yards, kind: 'carry' \}\]/);
  });

  it('an unstated kind resolves to TOTAL — the direction that does not lose a ball', () => {
    expect(HANDLER).toMatch(/distance_kind === 'carry' \? 'carry' : 'total'/);
  });

  it('both numbers are recorded when both were stated, so nothing is inferred', () => {
    expect(HANDLER).toMatch(/if \(carry != null\) distances\.push\(\{ club, yards: carry, kind: 'carry' \}\)/);
    expect(HANDLER).toMatch(/if \(total != null\) distances\.push\(\{ club, yards: total, kind: 'total' \}\)/);
  });

  it('rejects a non-numeric or non-positive yardage rather than recording it', () => {
    expect(HANDLER).toMatch(/Number\.isFinite\(n\) && n > 0/);
  });
});

describe('the offline precheck keeps the verb', () => {
  it('captures it instead of throwing it away', () => {
    // It used to be a non-capturing group — which is how the information was lost.
    expect(PRECHECK).toMatch(/\(goes\|carries\|carry\\s\+is\|flies\)/);
  });

  it('maps "goes" to total and everything else to carry', () => {
    expect(PRECHECK).toMatch(/\? 'total' : 'carry'/);
  });

  it('picks up a SECOND number of the other kind in the same sentence', () => {
    expect(PRECHECK).toMatch(/carry_yards/);
    expect(PRECHECK).toMatch(/total_yards/);
  });
});

describe('the classifier is told the same rule — a handler cannot fix what never reaches it', () => {
  it('the parameters include the kind', () => {
    expect(PROMPT).toMatch(/distance_kind: "carry" \| "total"/);
  });

  it('the prompt states the verb rule AND why the default is total', () => {
    expect(PROMPT).toMatch(/describe the\s+FLIGHT → carry/);
    expect(PROMPT).toMatch(/"goes" describes where it ENDED UP → total/);
    expect(PROMPT).toMatch(/flies a hazard they do not/);
  });

  it('carries a worked example of both numbers in one sentence', () => {
    expect(PROMPT).toMatch(/my 3 wood goes 230 and carries 215/);
    expect(PROMPT).toMatch(/total_yards: 230, carry_yards: 215/);
  });
});

describe('the two-ladder model underneath is untouched', () => {
  it('the registrar still routes total to the total ladder', () => {
    const reg = code('services/bagVoiceRegistration.ts');
    expect(reg).toMatch(/if \(kind === 'total'\) stats\.recordTotal\(name, yds\)/);
  });

  it('GPS tracking still writes TOTAL — that is what tee-to-rest actually is', () => {
    expect(code('services/shotTracking.ts')).toMatch(/recordTotal/);
  });
});
