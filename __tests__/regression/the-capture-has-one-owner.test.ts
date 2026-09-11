/**
 * 2026-09-11 — field log: three of five voice failures were an EMPTY transcript on audio the VAD had
 * already confirmed contained speech (heardSpeech: true, durationMs: 8331, bail: 'empty').
 *
 * TWO OWNERS COULD STOP THE SAME RECORDING. captureUtteranceDetailed owns the Recording — it reads
 * the duration, calls stopAndUnloadAsync, then getURI. stopCapture reached in and called
 * stopAndUnloadAsync on the SAME object. When a stop landed in that window the two unloads
 * interleaved and the .m4a went to the uploader with its MPEG-4 moov atom never written: a file that
 * exists, passes the >1KB gate, and cannot be demuxed. Deepgram answers 200 with an empty
 * transcript, which downstream is indistinguishable from "the player said nothing".
 *
 * Two more defects in the same path, both provable on their own:
 *  - the hedge leaked a SECOND upload on every healthy turn. doFetch kept its AbortController to
 *    itself, so once Promise.any settled nothing cancelled the loser: two transcriptions billed and
 *    two uploads off cell data for one spoken sentence.
 *  - the server sent `Content-Type: audio/m4a`, which is not a real MIME type. The recorder produces
 *    MPEG-4/AAC, whose registered type is audio/mp4. Deepgram does not reject an unknown type — it
 *    answers 200 with an empty transcript.
 */
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('one owner stops the recording', () => {
  const vs = code(read('services/voiceService.ts'));

  it('stopCapture signals and does not unload the recorder itself', () => {
    const body = vs.slice(vs.indexOf('export const stopCapture'), vs.indexOf('export const isCapturing'));
    expect(body).toContain('captureCancelled = true');
    expect(body).not.toContain('stopAndUnloadAsync');
    // Nulling the handle out from under the owner is the other half of the same race.
    expect(body).not.toMatch(/currentRecording\s*=\s*null/);
  });

  it('the capture loop still exits promptly on a cancel, so the mic does not stay open', () => {
    expect(vs).toMatch(/while \(Date\.now\(\) - start < timeoutMs && !captureCancelled && !captureEarlyStop\)/);
    expect(vs).toMatch(/if \(captureCancelled\) \{[\s\S]{0,200}?stopAndUnloadAsync/);
  });
});

describe('the transcribe hedge cancels its loser, and only its loser', () => {
  const hf = code(read('services/voice/hedgedFetch.ts'));
  const vs = code(read('services/voiceService.ts'));
  const vc = code(read('hooks/useVoiceCaddie.ts'));

  it('both mic owners race through the one shared function', () => {
    // The sim carries a LOCK requiring the tap and earbud paths to fail the same way. They used to
    // satisfy it by looking alike; now they satisfy it by being the same code.
    expect(vs).toContain('raceHedged');
    expect(vc).toContain('raceHedged');
    expect(hf).toContain('export async function raceHedged');
  });

  it('each attempt hands back an abort rather than hiding its controller', () => {
    expect(vs).toMatch(/const doFetch = \(timeoutMs: number\): \{ res: Promise<Response>; abort: \(\) => void \}/);
    expect(vc).toMatch(/const doTranscribeFetch = \(timeoutMs: number\): \{ result: Promise<Response>; abort: \(\) => void \}/);
  });

  it('a primary that already answered stops the hedge from ever opening a connection', () => {
    expect(hf).toContain("if (state.settled) { reject(new Error('hedge_not_needed')); return; }");
  });

  it('NEVER aborts the winner — Promise.any resolves on headers, the body is read after', () => {
    expect(hf).toContain("if (state.winner === 'hedge') primary.abort();");
    expect(hf).toContain('else if (state.hedgeStarted) state.abortHedge?.();');
    // An unconditional primary.abort() in the finally would tear the winner's body stream out.
    const fin = hf.slice(hf.indexOf('} finally {'));
    expect(fin).not.toMatch(/^\s*primary\.abort\(\);/m);
  });
});

describe('the audio is sent as what it actually is', () => {
  const tr = code(read('api/transcribe.ts'));
  const vs = code(read('services/voiceService.ts'));

  it('the server declares the real container type', () => {
    expect(tr).toContain("'Content-Type': 'audio/mp4'");
    expect(tr).not.toContain("'audio/m4a'");
  });

  it('which matches what the recorder actually produces', () => {
    expect(vs).toContain('Audio.AndroidOutputFormat.MPEG_4');
    expect(vs).toContain('Audio.IOSOutputFormat.MPEG4AAC');
  });

  it('an empty transcript is logged with enough to diagnose it', () => {
    expect(tr).toMatch(/if \(!cleanedText\.trim\(\)\)/);
    expect(tr).toContain('EMPTY transcript');
    expect(tr).toContain('bytes=');
  });
});
