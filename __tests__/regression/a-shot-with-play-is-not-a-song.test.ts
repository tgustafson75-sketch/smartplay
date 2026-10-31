/**
 * 2026-10-31 (Brain recheck r18, BRAIN-3) — "PLAY A LITTLE FADE HERE" IS A SHOT, NOT THE JUKEBOX.
 *
 * detectPlaySongRequest read any imperative "play …" as a song unless the object began with a golf word,
 * so "play a little fade", "play away from the water", "put on a little draw" and "play it smart" opened
 * YouTube mid-round and the shot advice never reached the brain. A shot word in the object (with no music
 * word and no song shape) now answers "not a song". A bare title still reaches the search.
 *
 * BEHAVIOURAL: the real detectPlaySongRequest.
 */
import { detectPlaySongRequest } from '../../services/musicIntent';

describe('a shot instruction that starts with "play" is not a song', () => {
  it.each([
    'play a little fade here',
    'play away from the water',
    'put on a little draw',
    'play it smart',
    'play a little cut into the wind',
    'play it straight at the flag',
    'play it short of the bunker',
    'play it left side',
    'play the safe line',
    'play a lay up',
  ])('"%s" → null', (said) => {
    expect(detectPlaySongRequest(said)).toBeNull();
  });
});

describe('a song request still is', () => {
  it.each([
    ['play Sail by Awolnation', 'Sail by Awolnation'],
    ['Kevin play Hotel California', 'Hotel California'],
    ['play Green Day', 'Green Day'],
    ['play Wrecking Ball', 'Wrecking Ball'],
    ['put on some music', 'some music'],
    ['play the song Low', 'Low'],
  ])('"%s" → query %s', (said, query) => {
    expect(detectPlaySongRequest(said)?.query).toBe(query);
  });
});
