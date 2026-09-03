/**
 * 2026-09-03 (Tim) — his actual pre-round: open the app, "Kevin, play Sail by Awolnation on
 * YouTube", let it play while he gets his tempo right. What he got was the caddie reading him a
 * link he had to tap.
 *
 * The cause was PLACEMENT. tryPlaySong lived only inside sendToBrain, and sendToBrain "survives
 * only for the follow-up listen loop" — a FIRST utterance goes to processTranscriptOverride and
 * straight to the brain, which answers conversationally with a URL. So the song portal worked as a
 * follow-up and never as the opening request, which is why it read as intermittent rather than
 * broken.
 *
 * These pin the detector (which has to stay narrow about golf "play" phrases) and the routine
 * ingest he asked for on top.
 */
import { detectPlaySongRequest } from '../../services/musicIntent';
import { takeSongRoutineCandidate, _setSongRoutineCandidate } from '../../services/playSongFlow';

describe('detectPlaySongRequest', () => {
  it('catches the way Tim actually says it', () => {
    expect(detectPlaySongRequest('play Sail by Awolnation on YouTube')?.query).toContain('Sail by Awolnation');
    expect(detectPlaySongRequest('Kevin, put on Sweet Caroline')?.query).toBe('Sweet Caroline');
    expect(detectPlaySongRequest('can you play some Johnny Cash please')?.query).toBe('some Johnny Cash');
  });

  it('never hijacks golf', () => {
    for (const phrase of [
      'play a round', 'play golf', 'play it safe', 'play through',
      'play my last swing', 'play that back', 'play the clip', 'how do I play this lie',
      "let's play", 'play nine', 'play 18',
    ]) {
      expect(detectPlaySongRequest(phrase)).toBeNull();
    }
  });

  it('needs something to search for', () => {
    expect(detectPlaySongRequest('play')).toBeNull();
    expect(detectPlaySongRequest('play a')).toBeNull();
    expect(detectPlaySongRequest('')).toBeNull();
  });
});

describe('the routine candidate', () => {
  afterEach(() => _setSongRoutineCandidate(null));

  it('is offered for a short window, then forgotten', () => {
    const now = Date.now();
    _setSongRoutineCandidate({ text: 'Put on Sail', title: 'Sail', at: now });
    expect(takeSongRoutineCandidate(now + 60_000)?.title).toBe('Sail');
    // Ten minutes later it is stale — a curious search must not land in his routine an hour on.
    expect(takeSongRoutineCandidate(now + 11 * 60_000)).toBeNull();
  });

  it('is absent when no song was played', () => {
    expect(takeSongRoutineCandidate()).toBeNull();
  });
});
