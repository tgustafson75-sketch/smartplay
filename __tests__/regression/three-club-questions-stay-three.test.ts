/**
 * 2026-09-11 — THREE CLUB QUESTIONS, AND THEY MUST STAY THREE.
 *
 * While orchestrating the in-play decision behind services/caddieDecision, two other club functions
 * were deliberately left alone, and Tim agreed they are different: "those do seem like different
 * club related functions."
 *
 *   WHICH CLUB SHOULD HE HIT?        caddieDecision.decideShot → cnsShotRead.pickClub
 *                                    Weighs plays-like, risk posture, room behind the pin, and how
 *                                    this player covers an in-between number.
 *
 *   WHICH CLUB WAS THIS SHOT HIT WITH?  clubStatsStore.inferClub
 *                                    Nearest carry, nothing else — and that is correct, because it
 *                                    is a GUESS about the past, not a choice about the future.
 *
 *   WHICH CLUBS SHOULD HE CARRY?     services/bagRecommendation
 *                                    About the bag over a season, not about this shot.
 *
 * Collapsing any pair would be the same two-owners bug pointing a different way. But a boundary that
 * is only agreed in conversation drifts the first time somebody wires the convenient one in. So it
 * is pinned here, in BOTH directions.
 *
 * The direction that actually bit before: queryStatusHandler stamps inferClub(yards) through the
 * SAME pendingKevinRec slot the caddie's spoken recommendation uses. Adherence measured against an
 * app guess is meaningless, and it fed the recap's "you took my club X% of the time". The fix was
 * the `kind: 'inferred'` tag and shotClubResolver.isAdvice — and today's standing-call and override
 * paths both had to inherit it.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const code = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('a guess about the past never becomes advice about the future', () => {
  it('the app tags its own inference rather than passing it off as a call', () => {
    const h = code('services/intents/queryStatusHandler.ts');
    expect(h).toMatch(/inferClub\(/);
    expect(h).toMatch(/kind: 'inferred'/);
  });

  it('and the resolver refuses to treat an inference as advice', () => {
    const r = code('services/shotClubResolver.ts');
    expect(r).toMatch(/function isAdvice\(kind[^)]*\)[^{]*\{\s*return kind !== 'inferred';/);
  });

  it('EVERY reader of the pending slot goes through that check', () => {
    /**
     * The real risk is a NEW reader of pendingKevinRec that forgets. Both readers that exist —
     * adherence and the standing call the caddie speaks from — apply it, and this counts them so a
     * third cannot appear unguarded.
     */
    const r = code('services/shotClubResolver.ts');
    const reads = (r.match(/pendingKevinRec/g) || []).length;
    const checks = (r.match(/isAdvice\(/g) || []).length;
    expect(reads).toBeGreaterThanOrEqual(2);
    expect(checks).toBeGreaterThanOrEqual(2);
  });

  it('the brain reads the standing call through the guarded accessor, not the raw slot', () => {
    const brain = code('services/caddieDecision.ts');
    expect(brain).toMatch(/pendingAdviceIfFresh\(\)/);
    expect(brain).not.toMatch(/pendingKevinRec/);
  });
});

describe('the decision never doubles as attribution', () => {
  it('nothing attributes a logged shot from the caddie decision', () => {
    // "What we told him to hit" is not "what he hit". The shot's club comes from the resolver,
    // which weighs what he DECLARED against what was advised, by recency.
    for (const f of ['services/shotTracking.ts', 'app/(tabs)/scorecard.tsx']) {
      expect(code(f)).not.toMatch(/decideShot\(/);
    }
  });

  it('attribution still has its own answer', () => {
    expect(code('services/shotTracking.ts')).toMatch(/inferClub\(/);
    expect(code('app/(tabs)/scorecard.tsx')).toMatch(/inferClub\(/);
  });
});

describe('attribution never doubles as the decision', () => {
  it('no surface picks a club from the nearest-carry lookup', () => {
    // This is what SmartFinder did until today: "Aggressive: 7I to 158y" from inferClub, beside an
    // "8 iron" from the real chooser.
    const surfaces: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
        const p = `${d}/${e.name}`;
        if (e.isDirectory()) walk(p);
        else if (/\.tsx$/.test(e.name)) surfaces.push(p.slice(2));
      }
    };
    walk('./app'); walk('./components');
    // the scorecard is the one legitimate caller — it is attributing a LOGGED shot
    const offenders = surfaces
      .filter((f) => f !== 'app/(tabs)/scorecard.tsx')
      .filter((f) => /\binferClub\s*\(/.test(code(f)));
    expect(offenders).toEqual([]);
  });

  it('and the bag recommendation stays about the bag, not about this shot', () => {
    expect(code('services/bagRecommendation.ts')).not.toMatch(/decideShot\(|composeShotRead\(/);
  });
});
