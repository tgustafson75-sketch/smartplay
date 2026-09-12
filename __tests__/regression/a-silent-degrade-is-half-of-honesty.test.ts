/**
 * 2026-09-12 (Tim) — TELL THEM WHAT THE CAPTURE COULDN'T DO, AND WHAT WOULD FIX IT.
 *
 * "Not letting things break and default and go around. If the user doesn't have their setting on the
 *  ideal, then part of our honesty is that we say: hey listen, we can analyze here, but you may not
 *  have these factors — if you switch your phone to sixty, you get more accuracy."
 *
 * And: "if navigate to SmartMotion with 30 set, provide one text box reminder."
 *
 * MIN_TRACE_FPS has always decided whether a departure trace can be drawn honestly, and when the
 * answer was no, smartmotion returned null. No wrong claim was made — which is the important half —
 * but the player was left to conclude the feature was broken rather than that their capture was too
 * slow for it. Nobody changes a camera setting they were never told mattered.
 */
import fs from 'fs';
import path from 'path';
import { captureQualityNote, captureQualityLine } from '../../services/captureQuality';
import { MIN_TRACE_FPS, PREFERRED_CAPTURE_FPS } from '../../services/capture/captureFlags';

const ROOT = path.join(__dirname, '../..');
const code = (rel: string) =>
  fs.readFileSync(path.join(ROOT, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('an UNKNOWN frame rate is never treated as a bad one', () => {
  it('says nothing when we did not measure it', () => {
    // expo-camera reports no frame rate at all. A warning here would be a guess dressed as a finding.
    for (const v of [null, undefined, 0, -1, NaN]) {
      expect(captureQualityNote(v as number | null).ok).toBe(true);
      expect(captureQualityLine(v as number | null)).toBeNull();
    }
  });

  it('says nothing when the capture was good enough', () => {
    expect(captureQualityNote(MIN_TRACE_FPS).ok).toBe(true);
    expect(captureQualityNote(PREFERRED_CAPTURE_FPS).ok).toBe(true);
    expect(captureQualityLine(240)).toBeNull();
  });
});

describe('below the floor it says all three things', () => {
  const note = captureQualityNote(30);

  it('what it CAN still do — a working analysis must not sound like a failure', () => {
    expect(note.ok).toBe(false);
    expect(note.can).toMatch(/tempo/i);
    expect(note.can).toMatch(/contact/i);
  });

  it('what is missing, with the real measured number', () => {
    expect(note.missing).toMatch(/30 frames a second/);
    expect(note.missing).toMatch(/can't honestly draw/i);
  });

  it('and the concrete fix, naming the rates that would work', () => {
    expect(note.fix).toContain(String(MIN_TRACE_FPS));
    expect(note.fix).toContain(String(PREFERRED_CAPTURE_FPS));
  });

  it('the spoken line leads with what works, not with the limitation', () => {
    const line = captureQualityLine(30)!;
    expect(line.indexOf('I can still read')).toBeLessThan(line.indexOf("can't honestly draw"));
  });
});

describe('the reminder is shown ONCE, and only on a measured shortfall', () => {
  const SM = code('app/swinglab/smartmotion.tsx');

  it('bails on an unknown or adequate frame rate', () => {
    expect(SM).toMatch(/if \(capturedFpsLive == null \|\| capturedFpsLive >= MIN_TRACE_FPS\) return;/);
  });

  it('bails when it has already been shown', () => {
    expect(SM).toMatch(/if \(lowFpsNoticeShown\) return;/);
  });

  it('marks it shown BEFORE opening the alert, so a re-render cannot double it', () => {
    const at = SM.indexOf('markLowFpsNoticeShown()');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(SM.indexOf('Alert.alert('));
  });

  it('the flag is PERSISTED — a reminder that returns every launch is a nag', () => {
    const STORE = code('store/captureEngineStore.ts');
    expect(STORE).toMatch(/partialize: \(s\) => \(\{[\s\S]{0,260}?lowFpsNoticeShown: s\.lowFpsNoticeShown/);
  });

  it('reuses the one owner of the wording rather than restating it', () => {
    expect(SM).toMatch(/captureQualityNote\(capturedFpsLive\)/);
    expect(SM).not.toMatch(/frames a second/);
  });
});

describe('the caddie can say it too', () => {
  it('it rides the payload', () => {
    expect(code('services/caddieRequestBody.ts')).toMatch(/capture_quality: safe/);
  });

  it('and he is told not to lead with it or repeat it', () => {
    const K = code('api/kevin.ts');
    expect(K).toMatch(/capture_quality/);
    expect(K).toMatch(/Do not lead with it and do not bring it up twice/);
  });
});
