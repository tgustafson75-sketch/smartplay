/**
 * 2026-09-20 (Tim's Sentry, SM-F926U, and eight months of "we cannot seem to reliably track a
 * clubhead and draw a line where it travels"):
 *
 *     clubpath_arc_too_sparse { screen: "swing-detail", detected: 2, framesSampled: 14,
 *                               framesPlanned: 14, rejected: "too_few", points: 0 }
 *
 * The sampler did its whole job — fourteen of fourteen PLANNED frames. The model found a clubhead in
 * TWO of them. That is not a strict gate; that is a ~6px clubhead.
 *
 * The 2026-08-10 ROI crop fixes exactly that (crop to the player's pose bounds, spend the 640px
 * budget there, ~6px → ~40px). It was passed at ONE of FOUR detectClubPath call sites. The other
 * three ran full-frame, including the PERSIST pass whose own comment says it exists "so the
 * swing-detail screen draws the stored points" — so the arc the player keeps was computed without
 * the fix while the one that flashes past during review had it.
 *
 * analysisPipeline's header had already named the cause on 2026-09-06: "`bodyBoundsFromPose` lived
 * in a SCREEN, so the pose pipeline could not reach the crop engine and ran full-frame forever.
 * Nobody owned 'who gets the roi'." It was written down and left in the screen.
 *
 * So: one owner (services/swing/bodyBounds), and every caller crops.
 * [[no-half-fixes-enforce-every-surface]] [[sweep-the-missing-half-not-the-unused-export]]
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { bodyBoundsFromPose } from '../../services/swing/bodyBounds';
import { roiFromBodyBounds } from '../../services/swing/clubPath';

const ROOT = path.join(__dirname, '../..');

/** Every detectClubPath invocation in app code, comments excluded. */
function callSites(): { file: string; line: number; text: string }[] {
  const out = execFileSync('grep', [
    '-rn', 'detectClubPath({', '--include=*.ts', '--include=*.tsx', 'app', 'services',
  ], { cwd: ROOT, encoding: 'utf8' });
  return out.split('\n').filter(Boolean)
    .map((l) => {
      const m = l.match(/^([^:]+):(\d+):(.*)$/);
      return m ? { file: m[1], line: Number(m[2]), text: m[3] } : null;
    })
    .filter((x): x is { file: string; line: number; text: string } => x != null)
    .filter((x) => !x.file.includes('__tests__'))
    .filter((x) => !/^\s*(\*|\/\/)/.test(x.text));
}

describe('every club-path call crops to the player', () => {
  it('there are call sites to check — never pass vacuously', () => {
    expect(callSites().length).toBeGreaterThanOrEqual(3);
  });

  it('no call site asks the model to find a clubhead in a full frame', () => {
    // Read the whole call expression, not the matched line: the upload path spells its arguments
    // across seven lines, and a one-line check called it naked while it was cropping correctly.
    const naked = callSites().filter((c) => {
      const src = fs.readFileSync(path.join(ROOT, c.file), 'utf8');
      const from = src.split('\n').slice(c.line - 1).join('\n');
      const start = from.indexOf('detectClubPath({');
      let depth = 0;
      let end = start;
      for (let i = start + 'detectClubPath('.length; i < from.length; i++) {
        if (from[i] === '{' || from[i] === '(') depth++;
        else if (from[i] === '}' || from[i] === ')') {
          depth--;
          if (depth === 0) { end = i; break; }
        }
      }
      return !from.slice(start, end + 1).includes('bodyBounds');
    });
    expect(naked.map((c) => `${c.file}:${c.line}`)).toEqual([]);
  });

  it('the crop helper is a service, not a screen — or three callers cannot reach it', () => {
    expect(fs.existsSync(path.join(ROOT, 'services/swing/bodyBounds.ts'))).toBe(true);
    const sm = fs.readFileSync(path.join(ROOT, 'app/swinglab/smartmotion.tsx'), 'utf8');
    // The screen must IMPORT it rather than keep a second copy that can drift.
    expect(sm).toMatch(/import \{ bodyBoundsFromPose \} from '\.\.\/\.\.\/services\/swing\/bodyBounds'/);
    expect(sm).not.toMatch(/^function bodyBoundsFromPose/m);
  });

  it('the diagnostic says whether the crop actually engaged', () => {
    // Without this, "detected: 2" cannot be told apart from "the zoom never ran".
    for (const f of ['app/swinglab/swing/[swing_id].tsx', 'app/swinglab/smartmotion.tsx']) {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      expect(src).toMatch(/zoomed: bodyBoundsFromPose\(poseFrames\) != null/);
    }
  });

  it('bounds → a crop that actually zooms a small player', () => {
    // A player filling ~15% of frame height: the case in Tim's screenshot.
    const frames = [{
      timestampMs: 0,
      keypoints: Array.from({ length: 12 }, (_, i) => ({
        x: 0.48 + (i % 3) * 0.02, y: 0.40 + (i % 4) * 0.035, score: 0.9,
      })),
    }] as unknown as Parameters<typeof bodyBoundsFromPose>[0];
    const b = bodyBoundsFromPose(frames);
    expect(b).not.toBeNull();
    const roi = roiFromBodyBounds(b);
    expect(roi).not.toBeNull();
    // The crop must be materially smaller than the frame, or the zoom buys nothing.
    expect(roi!.w).toBeLessThan(0.8);
    expect(roi!.h).toBeLessThan(0.8);
  });

  it('weak or missing pose leaves the old full-frame behaviour, not a guessed crop', () => {
    expect(bodyBoundsFromPose(null)).toBeNull();
    expect(bodyBoundsFromPose([])).toBeNull();
    const lowScore = [{
      timestampMs: 0,
      keypoints: Array.from({ length: 12 }, () => ({ x: 0.5, y: 0.5, score: 0.1 })),
    }] as unknown as Parameters<typeof bodyBoundsFromPose>[0];
    expect(bodyBoundsFromPose(lowScore)).toBeNull();
  });
});
