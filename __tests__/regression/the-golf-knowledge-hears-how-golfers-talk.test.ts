/**
 * 2026-10-15 (offline audit gap #7) — the bundled golf knowledge is what the caddie answers from with no
 * signal (services/offlineCaddie, minScore 8), and it is the brain's RAG grounding online.
 *
 * Two defects, measured on 33 everyday questions: 19 found nothing, and 2 found the WRONG thing.
 *   - Aliases matched as plain substrings, so "stance" matched inside "distance" ("cold weather
 *     distance" → a posture tip) and "thin" inside "thinking" ("stop thinking over the ball" → the
 *     thin-shot fault). A phrase must now START a word; a suffix is fine ("putt" → "putting").
 *   - The entries existed but only under textbook phrasing ("how to hit out of a bunker"), not the
 *     way a golfer says it ("how do I hit out of a bunker").
 */
import { retrieveKB } from '../../services/knowledgeBase/retrieve';

const top = (q: string) => retrieveKB(q, { max: 1, minScore: 8 })[0]?.id ?? null;

describe('offline golf knowledge, asked the way golfers talk', () => {
  it.each([
    ['how do I hit out of a bunker', 'sg.bunker.energy-transfer'],
    ['my ball is in the water what are my options', 'rules.penalty-area'],
    ['how should I play into the wind', 'cond.into-wind'],
    ['how do I read this putt', 'putt.read.slope'],
    ["I'm nervous on the first tee", 'mind.first-tee-nerves'],
    ['unplayable lie', 'rules.unplayable'],
    ["what's a provisional", 'rules.provisional'],
    ['cart path relief', 'rules.free-relief'],
    ['how do I play in the rain', 'cond.firm-vs-wet'],
    ['how far should I stand from the ball', 'setup.distance-from-ball'],
    ['out of bounds', 'rules.out-of-bounds'],
    ['plugged lie in the bunker', 'sg.bunker.buried'],
    ['how do I hit a punch shot under trees', 'cm.smart-escape'],
  ])('THE BUG: "%s" finds %s', (q, id) => {
    expect(top(q)).toBe(id);
  });

  it('THE BUG: a phrase never matches from the middle of a word', () => {
    expect(top('cold weather distance')).toBe('cond.temp-altitude'); // was video.posture.balance ("di-stance")
    expect(top('stop thinking over the ball')).not.toBe('fault.thin'); // was fault.thin ("thin-king")
  });

  it('a suffix still matches — "putt" finds putting questions', () => {
    expect(top('how do I putt better')).toBe('focus.putting');
    expect(top('fairway bunker')).toBe('sg.bunker.fairway');
  });

  it('a question nothing covers stays a miss rather than a guess', () => {
    expect(top('how do I hit my driver straighter')).toBeNull();
  });
});
