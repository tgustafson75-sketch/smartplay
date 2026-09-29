/**
 * 2026-09-29 — "DID IT SEE MY WHOLE SWING?" IS A QUESTION THE CADDIE CAN ANSWER.
 *
 * The nine-frame read records where its frames came from (sample_coverage), which phases the model
 * actually saw (phases_visible) and caps confidence when it saw neither the top nor impact. The review
 * SHOWS all of that; none of it reached the brain, so the caddie could only guess at why a read was
 * low confidence. This builds the real request body after an analysis and reads what it carries.
 */
import fs from 'fs';
import path from 'path';
import { useCaptureEngineStore } from '../../store/captureEngineStore';
import { buildCaddieRequestBody, CADDIE_REQUEST_KEYS } from '../../services/caddieRequestBody';

const body = () => buildCaddieRequestBody({ message: 'did it see my whole swing?', language: 'en' });
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

afterEach(() => useCaptureEngineStore.getState().setReviewingClip(null));

describe('the request body built after an analysis carries what the read was built on', () => {
  it('coverage, phases seen and missed, the capped confidence and why, and the captured fps', () => {
    useCaptureEngineStore.getState().setReviewingClip({
      fps: 60,
      read: {
        coverage: { start_sec: 1.2, end_sec: 2.8, frames: 9, whole_clip: false },
        phases_visible: { address: true, top: false, impact: false, finish: true },
        confidence: 'low',
      },
    });
    const line = body().swing_read as string;
    expect(typeof line).toBe('string');
    expect(line).toContain('9 frames from 1.2-2.8 s, where the swing was found');
    expect(line).toContain('phases seen: address, finish; NOT seen: top, impact');
    expect(line).toContain('confidence LOW because neither the top nor impact was in the frames');
    expect(line).toContain('captured at 60 fps');
  });

  it('a whole-clip spread says the swing was not pinned; an unknown rate says so', () => {
    useCaptureEngineStore.getState().setReviewingClip({
      fps: null,
      read: {
        coverage: { start_sec: 0.3, end_sec: 5.2, frames: 9, whole_clip: true },
        phases_visible: { address: true, top: true, impact: true, finish: true },
        confidence: 'high',
      },
    });
    const line = body().swing_read as string;
    expect(line).toContain('the swing was NOT pinned');
    expect(line).toContain('all four phases seen');
    expect(line).toContain('confidence high');
    expect(line).toContain('capture frame rate unknown');
  });

  it('nothing under review sends nothing', () => {
    expect(body().swing_read).toBeNull();
    expect(CADDIE_REQUEST_KEYS).toContain('swing_read');
  });
});

describe('both ends are wired', () => {
  const root = path.join(__dirname, '../..');
  it('SmartMotion publishes the analysis it is showing with the clip', () => {
    const sm = strip(fs.readFileSync(path.join(root, 'app/swinglab/smartmotion.tsx'), 'utf8'));
    expect(sm).toMatch(/coverage: analysis\.sample_coverage \?\? null, phases_visible: analysis\.phases_visible \?\? null, confidence: analysis\.confidence \?\? null/);
    expect(sm).toMatch(/setReviewingClip\(reviewing \? \{ fps: clipFps, read \} : null\)/);
    expect(sm).toMatch(/\}, \[clipUri, phase, clipFps, analysis\]\);/);
  });

  it('the brain renders it on the message side', () => {
    const k = strip(fs.readFileSync(path.join(root, 'api/kevin.ts'), 'utf8'));
    expect(k).toMatch(/swing_read = null,/);
    expect(k).toMatch(/if \(typeof swing_read === 'string' && swing_read\.trim\(\)\) \{\s*lines\.push\(`- The swing read on their screen was built from: \$\{swing_read\.trim\(\)/);
  });
});
