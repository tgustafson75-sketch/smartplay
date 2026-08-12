/**
 * 2026-08-12 (full audit — divergent constants) — two answers to one question.
 *
 * The same concept, "how far above ambient must a voice be to count as speech", was defined twice
 * with different values:
 *
 *   hooks/useVoiceActivityDetection  SPEECH_MARGIN_DB = 14   ← decides to OPEN the mic
 *   services/voiceService            SPEECH_MARGIN_DB = 18   ← decides someone SPOKE
 *
 * That asymmetry has a precise symptom, and it's one Tim has reported repeatedly: VAD hears you at
 * 14dB over ambient and opens a capture; the capture then refuses to count the same voice as
 * speech, so `hasSpoken` never flips — it stands down or returns silence, and the caddie says it
 * didn't catch you. The mic opened FOR speech it then declined to recognise.
 *
 * THE INVARIANT: whatever threshold decides to OPEN the mic must be at least as strict as the one
 * that decides someone SPOKE. Otherwise the app can promise a listen it cannot honour.
 *
 * Neither number is wrong in isolation, which is exactly why this survived — it's only wrong as a
 * pair, and nothing was comparing them.
 */
import fs from 'fs';
import path from 'path';

const read = (p: string) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const num = (src: string, name: string): number => {
  const m = new RegExp(`const ${name} = (-?\\d+)`).exec(src);
  if (!m) throw new Error(`${name} not found`);
  return Number(m[1]);
};

const vad = read('hooks/useVoiceActivityDetection.ts');
const voice = read('services/voiceService.ts');

describe('the mic never opens for speech the capture will not recognise', () => {
  it('the confirm threshold is no stricter than the open threshold', () => {
    const open = num(vad, 'SPEECH_MARGIN_DB');
    const confirm = num(voice, 'SPEECH_MARGIN_DB');
    expect(confirm).toBeLessThanOrEqual(open);
  });

  it('ending a sentence stays easier than starting one', () => {
    // A trailing-off final word must not clip the capture, so the silence margin sits below the
    // speech margin. If these ever cross, captures end mid-word.
    expect(num(voice, 'SILENCE_MARGIN_DB')).toBeLessThanOrEqual(num(voice, 'SPEECH_MARGIN_DB'));
  });

  it('both are still adaptive against a measured noise floor, not absolute', () => {
    // The margins only mean anything relative to ambient — a fixed dB gate fails in a cart or wind.
    expect(vad).toContain('noiseFloorRef.current + SPEECH_MARGIN_DB');
    expect(voice).toContain('noiseFloorDb + SPEECH_MARGIN_DB');
  });
});

describe('one yards-per-metre constant', () => {
  it('nothing uses a truncated conversion', () => {
    // api/acoustic-detect used 1.0936 while thirteen other sites used 1.09361. Small error, but a
    // hand-typed constant that disagrees with its siblings is how a number drifts.
    // Code lines only — a comment explaining what the value USED to be must not fail this.
    const codeLines = (src: string) =>
      src.split('\n').filter(l => {
        const t = l.trim();
        return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
      });
    for (const f of ['api/acoustic-detect.ts', 'services/rangefinder.ts', 'services/courseGeometryService.ts']) {
      for (const line of codeLines(read(f))) expect(line).not.toMatch(/1\.0936(?!1)/);
    }
  });
});
