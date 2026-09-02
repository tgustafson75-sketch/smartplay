/**
 * 2026-08-31 (SmartMotion walk) — `detectionOffsetSeconds` IS NOT ALWAYS A MEASUREMENT.
 *
 * When SmartMotion detects no swing it synthesizes a whole-clip segment whose strike is
 * `0.6 x duration` (smartmotion.tsx, "its strikeMs is a 0.6*duration GUESS") so the analysis can
 * still run bounded and fast. That placeholder is then persisted onto the shot in the SAME field a
 * real acoustic strike uses. The writer records the distinction — peakDb 0 becomes
 * detectionMethod 'manual', a heard strike becomes 'audio_transient' — but every reader had to
 * remember to ask, and four of them did not.
 *
 * Three surfaces presented that guess to the player as a measurement:
 *   • the club path re-centred its search window on it (a confident wrong four seconds),
 *   • the tempo trainer seeded the impact line from it and marked it AUTO, then computed the
 *     tempo RATIO — the very number the player is training,
 *   • bilateral fed it to bilateralMerge, whose `alignedAtImpact` is true when BOTH angles carry a
 *     value, so two placeholders would announce a synchronisation nobody measured.
 *
 * This guards the SHAPE, not the three instances: any surface that reads the field must first ask
 * how the strike was found. [[run-the-second-pass-yourself]] [[smartmotion-contact-honesty]]
 */
import fs from 'fs';
import path from 'path';

const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

/** The window between a needle and the next `}` — so an assertion cannot drift into another function. */
function near(src: string, needle: string, span = 900): string {
  const i = src.indexOf(needle);
  expect(i).toBeGreaterThan(-1);
  return src.slice(i, i + span);
}

describe('the producer still records how the strike was found', () => {
  const sm = read('app/swinglab/smartmotion.tsx');

  it('synthesizes 0.6 * duration when nothing was detected', () => {
    expect(sm).toMatch(/strikeMs: Math\.round\(durMs \* 0\.6\)/);
  });

  it('and stamps peakDb 0 -> manual, a real strike -> audio_transient', () => {
    const w = near(sm, 'detectionOffsetSeconds: s.strikeMs / 1000');
    expect(w).toMatch(/detectionMethod: \(s\.peakDb \?\? 0\) !== 0 \? 'audio_transient' as const : 'manual' as const/);
  });
});

describe('every reader asks before trusting it', () => {
  it('CLUB PATH — the rule lives in one module and refuses a manual shot', () => {
    const src = read('services/swing/clubPathWindow.ts');
    expect(near(src, 'export function impactAnchorMs')).toMatch(/detectionMethod === 'audio_transient'/);
  });

  it('TEMPO TRAINER — only a heard strike may seed the impact line', () => {
    const w = near(read('app/swinglab/smart-tempo.tsx'), 'const impactMs =');
    expect(w).toMatch(/shot\?\.detectionMethod === 'audio_transient'/);
    expect(w).toMatch(/detectionOffsetSeconds \* 1000/);
  });

  it('BILATERAL — an unheard strike yields null rather than a fake alignment', () => {
    const w = near(read('app/swinglab/bilateral.tsx'), 'impactSec:');
    expect(w).toMatch(/detectionMethod === 'audio_transient'/);
  });

  it("BILATERAL MERGE still treats a present value as 'aligned at impact'", () => {
    // The reason the guard above matters. If this ever stops being true, re-read the guard.
    expect(read('services/swing/bilateralMerge.ts'))
      .toMatch(/alignedAtImpact = \(dtlIn\?\.impactSec != null\) && \(faceOnIn\?\.impactSec != null\)/);
  });
});

describe('the readers that were already honest stay honest', () => {
  const sm = read('app/swinglab/smartmotion.tsx');

  it('BALL DEPARTURE gates a video-located swing on confidence', () => {
    expect(sm).toMatch(/const videoLocated = \(seg\?\.peakDb \?\? 0\) === 0;/);
    expect(sm).toMatch(/videoLocated\s*\n?\s*\? \(r && r\.departed && r\.confidence !== 'low' && r\.ball_present_before \? r : null\)/);
  });
});

describe('the capture path measures the window before it guesses one (2026-09-01)', () => {
  const sm = read('app/swinglab/smartmotion.tsx');

  it('on-device locate runs BEFORE the 0.6*duration placeholder', () => {
    const onDev = sm.indexOf('locateSwingWindowOnDevice(recorded.uri, durMs)');
    const guess = sm.indexOf('strikeMs: Math.round(durMs * 0.6)');
    expect(onDev).toBeGreaterThan(-1);
    expect(guess).toBeGreaterThan(-1);
    expect(onDev).toBeLessThan(guess);
  });

  it('a measured WINDOW still carries synthesized:true — the impact is a centre, not a measurement', () => {
    // The flag is overloaded: it also means "this impact is not precise", and three consumers read it
    // that way. tempo does downswingMs = impactMs - topMs WITHOUT refining, and a downswing is ~250ms
    // — the same order as this anchor's tolerance — so flipping it would make the RATIO wrong.
    const i = sm.indexOf('strikeMs: Math.round(located.swingTimeSec * 1000)');
    const measured = sm.slice(i, i + 1600);
    expect(measured).toMatch(/synthesized: true/);
    expect(measured).not.toMatch(/synthesized: false/);
  });

  it('so tempo still refuses it, and frame extraction still calls it non-acoustic', () => {
    expect(sm).toMatch(/seg\.strikeMs == null \|\| seg\.synthesized\) \{ setTempo\(null\); return; \}/);
    expect(read('services/swing/poseExtractKey.ts')).toMatch(/!seg\.synthesized \? seg\.strikeMs : null/);
  });

  it('but it still claims NO acoustic strike — peakDb stays 0 on both branches', () => {
    const block = sm.slice(sm.indexOf('let located:'), sm.indexOf('let located:') + 3200);
    expect((block.match(/peakDb: 0/g) ?? []).length).toBe(2);
    expect(block).not.toMatch(/audio_transient/);
  });

  it('the guess survives as the fallback — a bounded window must always exist', () => {
    expect(sm).toMatch(/: \{ index: 1, strikeMs: Math\.round\(durMs \* 0\.6\), startMs: 0, endMs: durMs/);
  });
});
