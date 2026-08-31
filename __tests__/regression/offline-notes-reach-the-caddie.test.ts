/**
 * 2026-08-30 — WHAT THE PLAYER SAID WITH NO SIGNAL HAS TO REACH THE CADDIE.
 *
 * The capture half shipped 2026-07-04: usePipecatVoice calls captureOfflineStatement whenever a turn
 * cannot reach the brain, and roundStore calls markRoundNotesIngested at round end. The READ half
 * never connected. peekOfflineNotesBlock — the function whose entire job is handing those notes to
 * the live caddie once signal returns — had zero callers anywhere in the app.
 *
 * So a player says "I'm pulling everything left" on a dead cell, gets nothing, signal returns, and
 * the caddie has no idea it was ever said. Then the round ends and the notes are marked "ingested"
 * by a function whose name describes something that never happened.
 *
 * Capture without a read is not a loop. [[close-the-loop-strategy]]
 */

import { peekOfflineNotesBlock, captureOfflineStatement } from '../../services/voiceLogService';
import { useVoiceLogStore } from '../../store/voiceLogStore';
import { useRoundStore } from '../../store/roundStore';
import { buildCaddieRequestBody } from '../../services/caddieRequestBody';

beforeEach(() => {
  useVoiceLogStore.setState({ entries: [] } as never);
});

/** Put the app in a round, the state a note is captured against. */
function inRound(roundId = 'r-offline-test') {
  useRoundStore.setState({ isRoundActive: true, currentRoundId: roundId, currentHole: 7 } as never);
  return roundId;
}

describe('the note survives capture', () => {
  it('captures what was said while offline, against the current hole', () => {
    inRound();
    expect(captureOfflineStatement('I am pulling everything left today')).toBe(true);
    expect(peekOfflineNotesBlock()).toContain('pulling everything left');
  });

  it('ignores an empty transcript rather than storing a blank note', () => {
    inRound();
    expect(captureOfflineStatement('  ')).toBe(false);
  });
});

describe('the note reaches the brain', () => {
  it('rides the context block every caddie path already merges', () => {
    // THE REGRESSION. Before this, the note existed in the store and appeared in NO request.
    inRound();
    captureOfflineStatement('I am pulling everything left today');
    const body = buildCaddieRequestBody({ message: 'what should I hit', language: 'en' }) as
      Record<string, unknown>;
    expect(String(body.unified_context_block ?? '')).toContain('pulling everything left');
  });

  it('says nothing at all when there are no notes', () => {
    // The block self-gates, so a player who was never offline pays no tokens for the feature and
    // the caddie is not handed an empty heading to explain.
    inRound();
    const body = buildCaddieRequestBody({ message: 'what should I hit', language: 'en' }) as
      Record<string, unknown>;
    expect(String(body.unified_context_block ?? '')).not.toMatch(/WHILE OFFLINE/);
  });

  it('adds no new request key, which is what makes it OTA-safe', () => {
    // Folded into an existing block rather than sent as its own field: reaching a server already in
    // production means no schema change and no deploy. If this ever becomes a new key, the parity
    // suite should be the thing that notices, not a tester on a dead cell.
    inRound();
    captureOfflineStatement('felt like I came over the top');
    const withNote = Object.keys(buildCaddieRequestBody({ message: 'x', language: 'en' })).sort();
    useVoiceLogStore.setState({ entries: [] } as never);
    const without = Object.keys(buildCaddieRequestBody({ message: 'x', language: 'en' })).sort();
    expect(withNote).toEqual(without);
  });
});

describe('peek does not consume', () => {
  it('leaves the note pending so a failed turn does not lose it', () => {
    inRound();
    captureOfflineStatement('driver is going right');
    expect(peekOfflineNotesBlock()).toContain('driver is going right');
    // Read twice: a turn that fails after the request was built must not have eaten the note.
    expect(peekOfflineNotesBlock()).toContain('driver is going right');
  });
});
