/**
 * 2026-10-20 (Tim, SmartMotion in a practice bay: "the sound is too sensitive"). Three owners:
 * the live HUD meter, PRACTICE strike segmentation, and the Auto-Listen (VAD) onset gate.
 */
import fs from 'fs';
import path from 'path';
import { createLiveStrikeMeter } from '../../services/swing/liveStrikeMeter';
import { detectStrikes, levelStrikes, createSessionLeveller, type MeterSample } from '../../services/swing/strikeDetector';
import { createSpeechOnsetGate } from '../../services/voice/speechOnset';

/** A loud bay: ~-28 dBFS with ±3 dB of chatter/fan, 50ms readings. */
const bay = (ms: number, from = 0): MeterSample[] =>
  Array.from({ length: ms / 50 }, (_, i) => ({ timeMs: from + i * 50, dB: -28 + ((i * 5) % 7) - 3 }));

describe('live meter: levelled against the room', () => {
  it('a loud bay with nobody swinging never lights the strike badge', () => {
    const m = createLiveStrikeMeter(30);
    const reads = bay(4000).map((s) => m.push(s.timeMs, s.dB));
    expect(reads.some((r) => r.hit)).toBe(false);
    // The old rule (raw level > -30) was lit for most of this.
    expect(bay(4000).filter((s) => s.dB > -30).length).toBeGreaterThan(20);
    expect(Math.max(...reads.slice(5).map((r) => r.level))).toBeLessThan(0.25);
  });

  it('a strike over that room fills the meter and lights it', () => {
    const m = createLiveStrikeMeter(30);
    for (const s of bay(2000)) m.push(s.timeMs, s.dB);
    const r = m.push(2050, 4);
    expect(r.hit).toBe(true);
    expect(r.level).toBe(1);
  });
});

describe('practice segmentation: the next bay is levelled out', () => {
  it('drops a strike far below the session loudest, keeps yours', () => {
    const strikes = [
      { timeMs: 1000, peakDb: -2 },
      { timeMs: 3000, peakDb: -19 },   // next bay
      { timeMs: 5000, peakDb: -4 },
      { timeMs: 7000, peakDb: -11 },   // your thin one, within 12
    ];
    const { kept, dropped } = levelStrikes(strikes);
    expect(kept.map((s) => s.timeMs)).toEqual([1000, 5000, 7000]);
    expect(dropped.map((s) => s.timeMs)).toEqual([3000]);
  });

  it('a lone strike is never levelled away', () => {
    expect(levelStrikes([{ peakDb: -25 }]).kept).toHaveLength(1);
  });

  it('end to end: detectStrikes admits the neighbour, levelling removes it', () => {
    const samples = bay(8000);
    const spike = (t: number, peak: number) => {
      const i = samples.findIndex((s) => s.timeMs === t);
      samples[i] = { timeMs: t, dB: peak };
      samples[i + 1] = { timeMs: t + 50, dB: peak - 20 };
    };
    spike(2000, 6);   // you
    spike(4000, -8);  // next bay: sharp and 20 dB over the room, so the detector admits it
    spike(6000, 5);   // you
    const res = detectStrikes(samples, { thresholdDb: 18, noisyFloorDb: Number.POSITIVE_INFINITY });
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;
    expect(res.strikes).toHaveLength(3);
    expect(levelStrikes(res.strikes).kept.map((s) => s.timeMs)).toEqual([2000, 6000]);
  });
});

describe('Auto-Listen onset: a bay is not a voice', () => {
  it('a loud room from mic-open never reads as speech', () => {
    const g = createSpeechOnsetGate();
    const out = Array.from({ length: 80 }, (_, i) => g.push(-32 + (i % 3))); // 8s of bay at 100ms
    expect(out.some((o) => o.onset)).toBe(false);
  });

  it('a strike from the next bay (spike, net hit, decay) does not open the mic', () => {
    const g = createSpeechOnsetGate();
    for (let i = 0; i < 20; i++) g.push(-50);
    const out = [-12, -24, -33, -45, -50, -50].map((d) => g.push(d));
    expect(out.some((o) => o.onset)).toBe(false);
  });

  it('a voice still opens it, on the third reading', () => {
    const g = createSpeechOnsetGate();
    for (let i = 0; i < 20; i++) g.push(-50);
    const out = [-26, -24, -27, -25].map((d) => g.push(d));
    expect(out.map((o) => o.onset)).toEqual([false, false, true, true]);
  });

  it('a voice over a loud bay still opens it', () => {
    const g = createSpeechOnsetGate();
    for (let i = 0; i < 20; i++) g.push(-32);
    const out = [-14, -12, -15].map((d) => g.push(d));
    expect(out[2]!.onset).toBe(true);
  });
});

describe('wiring (comments stripped)', () => {
  const code = (p: string) =>
    fs.readFileSync(path.join(__dirname, '../..', p), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const sm = code('app/swinglab/smartmotion.tsx');

  it('the HUD badge is the levelled hit, not a raw -30 dBFS bar', () => {
    expect(sm).toMatch(/detected=\{phase === 'recording' && meteringActive \? !!liveRead\?\.hit/);
    expect(sm).not.toMatch(/liveDb\s*>\s*-30/);
    expect(sm).toMatch(/createLiveStrikeMeter\(\s*strikeThresholdDb\(/);
  });

  it('practice levels strikes before anything counts or segments them', () => {
    const lv = sm.indexOf('levelStrikes(res.strikes)');
    expect(lv).toBeGreaterThan(-1);
    expect(sm.slice(lv - 200, lv)).toMatch(/meterMode === 'sim' && !chipOn/);
    expect(lv).toBeLessThan(sm.indexOf('acousticStrikes = res.strikes'));
  });

  it('detection and the live meter share one threshold owner', () => {
    expect(sm).toMatch(/const thresholdDb = strikeThresholdDb\(chipOn, appliedCalibration, meterMode\)/);
    expect(sm.match(/transientThresholdDb/g)?.length).toBe(2); // the helper's type + its read
  });

  it('the VAD hook opens on the onset gate', () => {
    const vad = code('hooks/useVoiceActivityDetection.ts');
    expect(vad).toMatch(/onsetGateRef\.current\.push\(db\)/);
    expect(vad).toMatch(/if \(onset\)/);
    expect(vad).not.toMatch(/aboveCountRef/);
  });
});

describe('Tank, 10-20: calibration setup and rest mode in a practice session', () => {
  const code = (p: string) =>
    fs.readFileSync(path.join(__dirname, '../..', p), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  it('calibration offers Indoor, and opens on it unless SmartMotion is set to Range or a round is on', () => {
    const cal = code('app/swinglab/calibrate.tsx');
    expect(cal).toMatch(/\{ key: 'indoor', label: 'Indoor'/);
    expect(cal).toMatch(/environmentMode === 'range' \? 'range' : 'indoor'/);
    expect(cal).not.toMatch(/useState<Env>\('range'\)/);
  });

  it('the instructions say where the phone goes: where it films you, not by the ball', () => {
    const en = JSON.parse(fs.readFileSync(path.join(__dirname, '../../i18n/locales/en.json'), 'utf8'));
    const line = JSON.stringify(en);
    expect(line).not.toMatch(/phone near where you hit/);
    expect(line).toMatch(/where it films you, not next to the ball/);
  });

  it('rest mode never blacks out a screen you hit balls on without touching', () => {
    const ov = code('components/round/RestModeOverlay.tsx');
    const routes = /SUPPRESS_ROUTES = \[([^\]]*)\]/.exec(ov)?.[1] ?? '';
    for (const r of ['/swinglab/smartmotion', '/swinglab/coach-mode', '/swinglab/calibrate', '/practice-session/session']) {
      expect(routes).toContain(`'${r}'`);
    }
  });
});

describe('practice-session counter: live levelling (Tank: 10 shots counted as 48)', () => {
  it('club taps after the first real strike are never counted', () => {
    const lv = createSessionLeveller();
    expect(lv.push(1000, -3).accepted).toBe(true);    // strike
    expect(lv.push(3000, -22).accepted).toBe(false);  // club grounding
    expect(lv.push(4500, -25).accepted).toBe(false);  // raking the next ball over
    expect(lv.push(7000, -5).accepted).toBe(true);    // strike
  });

  it('taps counted before the first strike are handed back when it lands', () => {
    const lv = createSessionLeveller();
    expect(lv.push(500, -24)).toEqual({ accepted: true, retracted: [] });
    expect(lv.push(2500, -20)).toEqual({ accepted: true, retracted: [] });
    expect(lv.push(5000, -2)).toEqual({ accepted: true, retracted: [500, 2500] });
    expect(lv.push(8000, -9)).toEqual({ accepted: true, retracted: [] }); // a thinner real strike stays
  });

  it('retractClipEvents removes only the named acoustic events, never a manual mark', () => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ps = require('../../services/practiceStorage') as typeof import('../../services/practiceStorage');
      ps.addClipEvent('s1', 0.5, 'audio_transient');
      ps.addClipEvent('s1', 0.5, 'manual');
      ps.addClipEvent('s1', 5, 'audio_transient');
      expect(ps.retractClipEvents('s1', [0.5])).toBe(1);
      expect(ps.retractClipEvents('s1', [0.5])).toBe(0);
    });
  });

  it('the detector levels every multi-shot strike, and the overlay un-counts retractions', () => {
    const code = (p: string) =>
      fs.readFileSync(path.join(__dirname, '../..', p), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    const det = code('services/acousticImpactDetector.ts');
    expect(det).toMatch(/state\.leveller\.push\(pending\.offset_ms, pending\.db\)/);
    expect(det).toMatch(/if \(lv\?\.accepted\) \{\s*\n\s*state\.lastDetectionTs = ts;/);
    const ov = code('components/PracticeSessionOverlay.tsx');
    expect(ov).toMatch(/onShotsRetracted: handleShotsRetracted/);
    expect(ov).toMatch(/retractClipEvents\(sessionRef\.current\.id/);
    expect(ov).toMatch(/setSwingCount\(\(c\) => Math\.max\(0, c - n\)\)/);
  });
});
