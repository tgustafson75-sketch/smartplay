/**
 * 2026-09-11 — THE RECAP'S PHOTO COLLAGE COULD NEVER HAVE A PHOTO IN IT.
 *
 * Found by sweeping every store action for a caller, after `distanceControl` turned out to be the
 * fifth profile field with readers and no writer.
 *
 * The whole chain was built. `roundStore.addRoundPhoto` is the only writer of currentRoundPhotos;
 * `endRound` copies it onto the round record as round_photos; `app/recap/[round_id]` renders
 * `<PhotoCollage photos={roundPhotos} />`; components/recap/PhotoCollage lays them out. Four pieces,
 * all correct, and the one hop that puts a photo in was never called by anything. The collage
 * rendered an empty array for every round anyone has ever played.
 *
 * Nothing could have failed: each half worked perfectly, they were simply not connected — the same
 * shape as yardageInsight and experienceContext, which is why the payload-contract guard exists.
 * [[orphans-are-live-bugs-not-dead-code]]
 *
 * This pins the CHAIN, hop by hop, so a future edit cannot quietly cut it again at any one link.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const store = read('store/roundStore.ts');
const finder = read('app/smartfinder.tsx');
const recap = read('app/recap/[round_id].tsx');

describe('a photo taken on the course reaches the recap', () => {
  it('hop 1 — the capture path adds it to the round', () => {
    // The only place in the app that takes a photo on a golf course.
    const at = finder.indexOf('takePictureAsync({ quality: 0.85');
    expect(at).toBeGreaterThan(-1);
    expect(finder.slice(at, at + 1800)).toMatch(/addRoundPhoto\(photo\.uri\)/);
  });

  it('hop 2 — addRoundPhoto is still the writer of currentRoundPhotos', () => {
    const at = store.indexOf('addRoundPhoto: (uri) =>');
    expect(at).toBeGreaterThan(-1);
    expect(store.slice(at, at + 400)).toMatch(/currentRoundPhotos:/);
  });

  it('hop 3 — endRound carries them onto the round record', () => {
    expect(store).toMatch(/round_photos: s\.currentRoundPhotos\.length > 0 \? \[\.\.\.s\.currentRoundPhotos\] : undefined,/);
  });

  it('hop 4 — the recap reads that field and renders the collage', () => {
    expect(recap).toMatch(/roundRecord\?\.round_photos \?\? EMPTY_PHOTOS/);
    expect(recap).toMatch(/<PhotoCollage photos=\{roundPhotos\} \/>/);
  });
});

describe('it does not collect photos it has no business collecting', () => {
  it('an off-round photo is refused by the writer, not by the caller', () => {
    // The guard belongs in the store so every future caller inherits it. A range photo or a shot of
    // the car park must not end up in the last round's recap.
    const at = store.indexOf('addRoundPhoto: (uri) =>');
    expect(store.slice(at, at + 200)).toMatch(/if \(!s\.isRoundActive\) return s;/);
  });

  it('the hole and the time are recorded with it, so the collage can be ordered', () => {
    const at = store.indexOf('addRoundPhoto: (uri) =>');
    const body = store.slice(at, at + 400);
    expect(body).toMatch(/hole: s\.currentHole/);
    expect(body).toMatch(/timestamp: Date\.now\(\)/);
  });
});
