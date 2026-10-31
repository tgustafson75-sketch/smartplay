/**
 * 2026-10-31 (Brain recheck r18, BRAIN-1) — "HOW FAR TO THE WATER" IS A QUESTION, NOT THE GREEN YARDAGE.
 *
 * The generic yardage rule in services/localIntentPrecheck matched "how far to" with no hazard word in it,
 * so every hazard distance came back as distance_to_green at confidence 'high' and the caddie never heard
 * the question. The tab-mic bypass test pins only tabBypassKind, so it stayed green through the defect.
 *
 * BEHAVIOURAL: the real precheckLocalIntent. A hazard question must be 'conversational' (the brain's
 * route), and the plain green distances keep their instant answer.
 */
import { precheckLocalIntent } from '../../services/localIntentPrecheck';

describe('a hazard distance reaches the caddie', () => {
  it.each([
    'how far to the water',
    'how far is it to the trees',
    'distance to the water',
    'how far to clear the creek',
    'how far to the hazard on the left',
    'yards to the pond',
  ])('"%s" → conversational', (said) => {
    expect(precheckLocalIntent(said)?.intent_type).toBe('conversational');
  });
});

describe('a carry-style hazard question is never answered as the green yardage', () => {
  it('"how far to carry the bunker" is not distance_to_green', () => {
    expect(precheckLocalIntent('how far to carry the bunker')?.parameters?.query_topic).not.toBe('distance_to_green');
  });
});

describe('the plain green distances keep their instant answer', () => {
  it.each([
    ['how far to the pin', 'green_middle'],
    ['how far to the front', 'green_front'],
    ['yards to the back', 'green_back'],
    ['distance to the green', 'distance_to_green'],
  ])('"%s" → query_status %s', (said, topic) => {
    const r = precheckLocalIntent(said);
    expect([r?.intent_type, r?.parameters?.query_topic]).toEqual(['query_status', topic]);
  });
});
