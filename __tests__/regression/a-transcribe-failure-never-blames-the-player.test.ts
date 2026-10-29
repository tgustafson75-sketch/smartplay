/**
 * 2026-10-28 (Brain recheck R9) — THE SERVER FAILED, NOT THE PLAYER'S VOICE.
 *
 * The avatar mic (useVoiceCaddie.processAudioUri — both the tap and the VAD path on the Caddie tab)
 * uploads the recording; when /api/transcribe answers 502 {error:'Transcription failed'} (provider 5xx,
 * 429, quota) or Vercel 5xxs, it spoke a hard-coded English "Didn't catch that — say it again?". The mic
 * worked; the outage is ours. The player repeats into the same outage, and a Spanish or Chinese player
 * hears English. Its non-abort catch did the same with "Something went wrong on my end". The abort
 * branch beside it has used the one failure owner since 10-15.
 *
 * The hook is too large to mount here, so the branch is pinned by its structure, and the owner it now
 * calls is pinned behaviourally: a 502 over good internet is OWNED, in the player's language.
 */
import * as fs from 'fs';
import * as path from 'path';
import { caddieFailureReply } from '../../services/caddieFailureReply';
import { _resetReachabilityForTests } from '../../services/reachability';
import { CADDIE_NOTICE_ON_US } from '../../services/caddieAckLines';

const code = fs.readFileSync(path.resolve(__dirname, '../../hooks/useVoiceCaddie.ts'), 'utf-8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

/** The body of the transcribe-failed branch: from its condition to its return. */
function failedBranch(): string {
  const at = code.indexOf('if (!transcribeRes.ok || transcribeData.error) {');
  expect(at).toBeGreaterThan(0);
  return code.slice(at, code.indexOf('return;', at));
}
/** The catch's non-abort arm. */
function genericCatch(): string {
  const at = code.indexOf("logVoiceError('process_audio', err);");
  expect(at).toBeGreaterThan(0);
  return code.slice(at, code.indexOf("wrappedOnVoiceStateChange('idle');", at));
}

const ENGLISH_LITERAL = /["'`](Didn't catch that|Something went wrong on my end)/;
const OWNER = /caddieFailureReply\(\{ heard: null, language \}\)\)\.text;\s*onResponseReceived\(line\);\s*if \(voiceEnabled\) void speakDeviceNotice\(line, language, voiceGender\)/;

describe('a failed transcription says what is true, in his language', () => {
  it('the 502 branch speaks the failure owner, not "Didn\'t catch that"', () => {
    const b = failedBranch();
    expect(b).not.toMatch(ENGLISH_LITERAL);                     // pre-fix: the English literal
    expect(b).toMatch(OWNER);
    expect(b).toMatch(/recordVoiceEndpointFailure\('transcribe'\)/); // still feeds the breaker
  });

  it('the generic catch speaks the failure owner, not an English literal', () => {
    const c = genericCatch();
    expect(c).not.toMatch(ENGLISH_LITERAL);                     // pre-fix: "Something went wrong on my end"
    expect(c).toMatch(/caddieFailureReply\(\{ heard: null, language \}\)\)\.text;\s*onResponseReceived\(line\);/);
  });

  it('what that owner says for a 502 over good internet: OWNED, localized, never "didn\'t catch"', async () => {
    _resetReachabilityForTests();
    global.fetch = jest.fn(async (input: unknown) => {
      const url = String(input);
      if (url.startsWith('https://captive.apple.com/')) return new Response('<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>', { status: 200 });
      if (url.startsWith('https://www.gstatic.com/generate_204')) return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ error: 'Transcription failed' }), { status: 502 });
    }) as unknown as typeof fetch;
    const es = await caddieFailureReply({ heard: null, language: 'es' });
    expect(es).toMatchObject({ source: 'on_us', text: CADDIE_NOTICE_ON_US.es });
    expect(es.text).not.toMatch(/catch/i);
  });
});
