/**
 * EVERYTHING THE APP KNOWS MUST REACH THE CADDIE.
 *
 * 2026-08-21. Tim: "I get embarrassed as hell thinking this is out there in over twenty people's
 * hands, and people who played it thirty times have stopped because they found all these bugs
 * before we did."
 *
 * Testers finding bugs first is a DETECTION failure, and this is the class that kept producing them:
 * the app computes something genuinely valuable and never tells the brain. It is invisible to every
 * other kind of test, because both halves work perfectly — they are simply not connected. Four were
 * found in a single day:
 *
 *   • the SmartFinder LOCK   — the number the player just measured; the caddie answered from the
 *                              GPS green-middle instead
 *   • ADVICE CALIBRATION     — whether its own club calls had been right; nothing consumed it
 *   • HAZARDS                — computer vision found the bunkers and measured the carry; it stopped
 *                              at the rangefinder screen
 *   • the GOLFER MODEL       — dominant miss, miss type, contact tendency. golferModel.ts even ships
 *                              describeForPrompt(), a function whose only purpose is to feed a
 *                              prompt, and the primary brain never received it
 *
 * So this test is not about those four. It is the standing check that the NEXT one fails here rather
 * than on a course. Each entry names something the caddie must know; if a future change stops it
 * reaching the CNS, this goes red.
 */
import * as fs from 'fs';
import * as path from 'path';

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, '../../', rel), 'utf-8');
/**
 * 2026-08-23 — was services/pipecatContext.ts. That file was the SECOND client payload builder,
 * feeding the second brain; it has been deleted and every surface now assembles its request in
 * services/caddieRequestBody.ts. Same property, one file: what the app knows must reach the caddie.
 *
 * Two entries below moved rather than vanished, and both moved somewhere better — checked against
 * source before this test was re-aimed, not assumed:
 *   • the SmartFinder lock is sent as `smartFinderContext`, the string form kevin actually reads,
 *     instead of an object kevin had no field for.
 *   • measured hazards are no longer a `hazards:` payload field at all. They are composed by
 *     caddieMemoryRetrieval.liveTroubleLine into the ONE context block every brain path pastes —
 *     which is why the marker for them is asserted against the CNS below.
 */
const ctx = read('services/caddieRequestBody.ts');
const shim = read('api/_brainShim.ts');
const cns = read('services/caddieMemoryRetrieval.ts');

/** What the caddie must know, and the marker proving it is assembled for the brain. */
const MUST_REACH: Array<{ what: string; why: string; inContext: RegExp; inShim?: RegExp }> = [
  {
    what: 'the SmartFinder lock',
    why: 'the number the player measured themselves outranks the GPS green-middle',
    inContext: /smartFinderContext/, inShim: /SMARTFINDER ACTIVE/,
  },
  {
    what: 'measured hazards',
    why: 'computer vision found them and geometry measured the carry — "clears the bunker" beats "158 yards"',
    // Composed into the shared context block, so the CNS is where it must appear.
    inContext: /getCaddieContext/, inShim: /MEASURED TROUBLE ON THIS SHOT/,
  },
  {
    what: 'the golfer model',
    why: 'dominant miss, miss type, contact tendency — the caddie should know who it is advising',
    inContext: /golferModel/, inShim: /golfer_model_snippet/,
  },
  {
    what: 'course intelligence',
    why: 'hazard-aware targeting instructions are useless without the hole knowledge they run on',
    inContext: /courseIntelligence/, inShim: /courseIntelligence/,
  },
  {
    what: 'physical limitation',
    why: 'Tim: "handicap does not play an overall swing with physical limitation — absolutely does". A bad back changes the CLUB, not just the encouragement, and handicap is skill not capability',
    inContext: /physicalLimitation/, inShim: /physicalLimitation/,
  },
  {
    what: 'miss TYPE',
    why: 'slice vs hook vs pull — which way it goes wrong, not merely which side',
    inContext: /missType/, inShim: /missType/,
  },
  {
    what: 'handedness',
    why: 'every directional word is inverted for a lefty; "aim left" is precisely wrong, which is worse than vague. It reached NO brain at all before 2026-08-21',
    inContext: /handedness/, inShim: /LEFT-HANDED/,
  },
  {
    what: 'persistent patterns',
    why: 'the long-run reads earned across rounds',
    inContext: /persistentPatterns/, inShim: /persistentPatterns/,
  },
  {
    what: 'per-club tendencies',
    why: 'what each club DOES for this player, not just how far it goes',
    inContext: /describeBagTendencies/,
  },
];

describe('every sense the app has reaches the brain that answers', () => {
  it.each(MUST_REACH.map(m => [m.what, m] as const))('%s is assembled into the caddie context', (_label, m) => {
    expect(ctx).toMatch(m.inContext);
  });

  it.each(MUST_REACH.filter(m => m.inShim).map(m => [m.what, m] as const))(
    '%s survives the translation to the one brain', (_label, m) => {
      // A field present in the context and dropped by the adapter is the same bug one layer down —
      // exactly how the golfer model reached the on-screen path and not the primary one.
      expect(shim).toMatch(m.inShim!);
    });

  it('the advice calibration the caddie learns about ITSELF still reaches it', () => {
    // The only consumer of advice-vs-outcome used to be a post-round adherence percentage, which
    // measures whether the PLAYER obeyed rather than whether the CALL was right.
    expect(cns).toMatch(/describeAdviceCalibration/);
    expect(cns).toMatch(/YOUR OWN CALLING/);
  });
});
