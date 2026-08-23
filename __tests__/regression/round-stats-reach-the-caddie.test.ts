import * as fs from 'fs';
import * as path from 'path';
import { buildCaddieRequestBody } from '../../services/caddieRequestBody';
import { useRoundStore } from '../../store/roundStore';
const read = (r: string) => fs.readFileSync(path.resolve(__dirname, '../../', r), 'utf-8');

/**
 * 2026-08-22 (Tim) — "your information is still generic related to the user" and "caddy has no
 * context when you're doing a putt read."
 *
 * The round store computes putts, penalties, fairways and GIR per hole and keeps them. NEITHER old
 * payload referenced any of it, so the caddie could see the score and nothing about how it happened.
 */
describe('the caddie knows how the round is actually going', () => {
  it('sends putts, three-putts, greens, fairways and the last three holes', () => {
    useRoundStore.setState({
      getHoleStats: () => ([
        { hole: 1, score: 5, putts: 2, penalties: 0, fairwayHit: true,  girHit: false },
        { hole: 2, score: 6, putts: 3, penalties: 1, fairwayHit: false, girHit: false },
        { hole: 3, score: 4, putts: 3, penalties: 0, fairwayHit: true,  girHit: true  },
      ]),
    } as never);
    const rs = buildCaddieRequestBody({ message: 'x', language: 'en' }).roundStats as Record<string, unknown>;
    expect(rs.holesPlayed).toBe(3);
    expect(rs.putts).toBe(8);
    expect(rs.threePutts).toBe(2);
    expect(rs.gir).toBe('1/3');
    expect(rs.fairways).toBe('2/3');
    expect(rs.penalties).toBe(1);
    expect((rs.lastThreeHoles as unknown[]).length).toBe(3);
  });

  it('never reports a green as MISSED when we simply do not know', () => {
    // girHit null means unknown. Counting it as a miss would invent a stat.
    useRoundStore.setState({
      getHoleStats: () => ([
        { hole: 1, score: 4, putts: 2, penalties: 0, fairwayHit: null, girHit: null },
        { hole: 2, score: 4, putts: 2, penalties: 0, fairwayHit: null, girHit: true },
      ]),
    } as never);
    const rs = buildCaddieRequestBody({ message: 'x', language: 'en' }).roundStats as Record<string, unknown>;
    expect(rs.gir).toBe('1/1');     // one KNOWN green, hit — not 1/2
    expect(rs.fairways).toBeNull(); // nothing known at all
  });

  it('stays null before a round has any holes', () => {
    useRoundStore.setState({ getHoleStats: () => [] } as never);
    expect(buildCaddieRequestBody({ message: 'x', language: 'en' }).roundStats).toBeNull();
  });

  it('the server destructures AND renders it — not sent-and-ignored', () => {
    const kevin = read('api/kevin.ts');
    expect(kevin).toMatch(/roundStats = null,/);
    expect(kevin).toMatch(/HOW THIS ROUND IS GOING/);
    expect(kevin).toMatch(/three-putt/);
    expect(kevin).toMatch(/Last three:/);
  });
});

describe('walking versus riding reaches the caddie', () => {
  const kevin = read('api/kevin.ts');

  /**
   * 2026-08-22 — transportMode has been set on the Play tab and persisted on the round since
   * 2026-06-13, and reached the caddie ZERO times. The store's own comment says it exists for
   * "walking fatigue/pace awareness" — the exact thing that was never wired.
   */
  it('is sent, and defaults to walking rather than nothing', () => {
    useRoundStore.setState({ transportMode: 'cart' } as never);
    expect(buildCaddieRequestBody({ message: 'x', language: 'en' }).transportMode).toBe('cart');
    useRoundStore.setState({ transportMode: undefined } as never);
    expect(buildCaddieRequestBody({ message: 'x', language: 'en' }).transportMode).toBe('walking');
  });

  it('the server reads it and says which one', () => {
    expect(kevin).toMatch(/transportMode = null,/);
    expect(kevin).toMatch(/Getting around:/);
    expect(kevin).toMatch(/riding a cart/);
  });

  it('only mentions fatigue for a WALKED round, and only late in it', () => {
    // Riding 15 holes is not tiring in the way walking 15 is; saying so would be noise.
    expect(kevin).toMatch(/transportMode !== 'cart' && holesPlayed >= 13/);
  });
});

describe('the caddie knows where on the hole you are standing', () => {
  const kevin = read('api/kevin.ts');

  /**
   * 2026-08-22 (Tim — "caddy has no context when you're doing a putt read"). currentLocationType has
   * been derived from every GPS fix since 2026-05-24 and was never sent. On the green it is the
   * difference between a club recommendation and a putt read.
   */
  it('sends it, defaulting to unknown rather than guessing', () => {
    useRoundStore.setState({ currentLocationType: 'green' } as never);
    expect(buildCaddieRequestBody({ message: 'x', language: 'en' }).currentLocationType).toBe('green');
    useRoundStore.setState({ currentLocationType: undefined } as never);
    expect(buildCaddieRequestBody({ message: 'x', language: 'en' }).currentLocationType).toBe('unknown');
  });

  it('on the green it says PUTT, not club', () => {
    expect(kevin).toMatch(/currentLocationType = null,/);
    expect(kevin).toMatch(/ON THE GREEN — this is a PUTT/);
    expect(kevin).toMatch(/do not recommend a club or a full swing/);
  });

  it('says nothing at all when the position is unknown', () => {
    // Inventing "you're in the fairway" would be worse than silence.
    expect(kevin).toMatch(/currentLocationType !== 'unknown'/);
  });
});

describe('risk posture, tee box and nine-hole mode reach the cloud caddie too', () => {
  const kevin = read('api/kevin.ts');

  /**
   * 2026-08-22 — riskMode was wired on 08-12 but only into the ON-DEVICE shot read (cnsShotRead,
   * used by SmartFinder, SmartVision and the local responder). The cloud brain — the thing the
   * player actually talks to — never received it, so safe/aggressive changed the phone's answer and
   * not the caddie's.
   */
  it('sends all three, with honest defaults', () => {
    useRoundStore.setState({ riskMode: 'aggressive', currentTeeBox: 'Blue', nineHoleMode: true } as never);
    const b = buildCaddieRequestBody({ message: 'x', language: 'en' });
    expect(b.riskMode).toBe('aggressive');
    expect(b.currentTeeBox).toBe('Blue');
    expect(b.nineHoleMode).toBe(true);

    useRoundStore.setState({ riskMode: undefined, currentTeeBox: undefined, nineHoleMode: undefined } as never);
    const d = buildCaddieRequestBody({ message: 'x', language: 'en' });
    expect(d.riskMode).toBe('normal');
    expect(d.currentTeeBox).toBeNull();
    expect(d.nineHoleMode).toBe(false);
  });

  it('the server reads all three and acts on them', () => {
    expect(kevin).toMatch(/riskMode = null,/);
    expect(kevin).toMatch(/currentTeeBox = null,/);
    expect(kevin).toMatch(/nineHoleMode = false,/);
    expect(kevin).toMatch(/Risk posture:/);
    expect(kevin).toMatch(/take the conservative line/);
    expect(kevin).toMatch(/NINE-HOLE round — pace the round to 9, never 18/);
  });

  it('mentions the tee box only when one is known', () => {
    expect(kevin).toMatch(/currentTeeBox \? ` \| Tee: \$\{currentTeeBox\}` : ''/);
  });
});
