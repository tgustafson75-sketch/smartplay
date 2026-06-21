import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';
import * as fs from 'fs';
import * as os from 'os';

// timeout 15s: Vercel cap is 30s; client aborts at 20s. No retry —
// a second Whisper attempt would push total to 30s+ and lose to client abort.
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 15_000, maxRetries: 0 });
// 2026-06-04 — Gemini fallback removed. Tim's Google AI Studio
// account hit prepayment-credit depletion (429 on every call) and
// the fallback was poisoning the transcribe chain whenever Whisper
// had a transient hiccup. Whisper-only is the honest degradation:
// if OpenAI is down, transcribe fails fast; client surfaces it
// instead of waiting on a dead fallback. To re-enable, restore
// the GoogleGenAI import + lazy-init + the catch-block fallback.

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 2026-06-04 / 2026-06-07 — Pre-warm. Client hits this with
  // ?mode=warmup after splash completes. Now ALSO hits Whisper
  // directly with a 1-byte WAV so the FIRST real transcribe doesn't
  // pay a 5-10s Whisper cold-start (Tim's "took too long" report on
  // first interaction — TTS warm doesn't transitively warm Whisper).
  // Total cost: ~$0.0002 (TTS single space + ~0.001s Whisper on
  // empty audio). Fire-and-forget if Whisper warmup rejects; the
  // SDK + TLS warm already provided most of the win.
  if (req.query?.mode === 'warmup') {
    try {
      const ttsP = openai.audio.speech.create({
        model: 'gpt-4o-mini-tts',
        voice: 'onyx',
        input: ' ',
      }).then(mp3 => mp3.arrayBuffer());
      // Tiny silent WAV (44-byte header + 0 samples). Whisper accepts
      // it and returns an empty transcription — model gets paged in,
      // first real transcribe lands on hot Whisper. PCM 16-bit mono
      // 8kHz so the file is genuinely 44 bytes. File uploaded via
      // the SDK's File polyfill.
      const silentWav = Buffer.from([
        0x52,0x49,0x46,0x46, 0x24,0x00,0x00,0x00, 0x57,0x41,0x56,0x45,
        0x66,0x6d,0x74,0x20, 0x10,0x00,0x00,0x00, 0x01,0x00,0x01,0x00,
        0x40,0x1f,0x00,0x00, 0x80,0x3e,0x00,0x00, 0x02,0x00,0x10,0x00,
        0x64,0x61,0x74,0x61, 0x00,0x00,0x00,0x00,
      ]);
      const warmupFile = new File([new Uint8Array(silentWav)], 'warmup.wav', { type: 'audio/wav' });
      const whisperP = openai.audio.transcriptions.create({
        model: 'gpt-4o-mini-transcribe',
        file: warmupFile,
      }).then(() => undefined).catch((e) => {
        console.log('[transcribe] whisper warmup failed (non-fatal):', e instanceof Error ? e.message : String(e));
      });
      await Promise.allSettled([ttsP, whisperP]);
      console.log('[transcribe] warmup completed (TTS + Whisper hot)');
    } catch (e) {
      console.log('[transcribe] warmup failed (non-fatal):', e instanceof Error ? e.message : String(e));
    }
    return res.status(200).json({ ok: true, mode: 'warmup' });
  }

  try {
    const formidable = await import('formidable');
    const FormClass = (formidable as unknown as { default?: { IncomingForm: new (opts: object) => unknown }; IncomingForm?: new (opts: object) => unknown }).default?.IncomingForm
      ?? (formidable as unknown as { IncomingForm: new (opts: object) => unknown }).IncomingForm;

    const form = new FormClass({
      uploadDir: os.tmpdir(),
      keepExtensions: true,
      maxFileSize: 25 * 1024 * 1024,
    }) as { parse: (req: unknown, cb: (err: unknown, fields: unknown, files: unknown) => void) => void };

    const [fields, files] = await new Promise<[Record<string, unknown>, Record<string, unknown>]>(
      (resolve, reject) => {
        form.parse(req, (err: unknown, f: unknown, fi: unknown) => {
          if (err) reject(err);
          else resolve([f as Record<string, unknown>, fi as Record<string, unknown>]);
        });
      }
    );

    const language = Array.isArray(fields.language)
      ? (fields.language as string[])[0]
      : (fields.language as string | undefined) ?? 'en';

    const audioFile = Array.isArray(files.audio)
      ? (files.audio as Array<{ filepath?: string; path?: string; size?: number }>)[0]
      : files.audio as { filepath?: string; path?: string; size?: number } | undefined;

    if (!audioFile) {
      return res.status(400).json({ error: 'No audio file', text: '' });
    }

    const filePath = audioFile.filepath ?? audioFile.path ?? '';

    console.log('[transcribe] received:', audioFile.size ?? 'unknown', 'bytes, language:', language);

    // Tim 2026-05-15: Spanish tester said Whisper returned English on
    // the first phrase, then Spanish only after Kevin's reply gave
    // context. The `language` parameter is a HINT — Whisper can still
    // auto-detect from accent. The `prompt` parameter is much stronger:
    // priming text in the target language biases the model decisively
    // toward that language. Per-language priming below; English path
    // omits the prompt so accent-thick English speakers still transcribe
    // cleanly.
    // 2026-05-25 — Fix S: bias Whisper toward the SmartPlay domain
    // vocabulary so wind/cart-noise mistranscriptions stop ("smartmotion"
    // → "spark motion", "hole views" → "hull views", caddie names
    // misheard, golf vocab mangled). The English path used to omit the
    // prompt; now it primes with our product names + golf vocab so the
    // recurring mis-hears flagged in tonight's round stop polluting the
    // issue log + voice-intent classifier.
    const EN_PRIMING = 'SmartPlay Caddie. SmartMotion, SmartVision, SmartFinder, TightLie, SwingLab, Cage Mode, Coach Mode, Quick Record. Caddies: Kevin, Tank, Serena, Harry. Hole views, hole view, mark the tee, mark the pin, mark the green. Golf: fairway, green, tee, pin, flag, par, bogey, birdie, eagle, slice, hook, draw, fade, yardage, approach, layup, wedge, driver, putter, iron, sand, bunker, rough.';
    const PRIMING_PROMPT: Record<string, string> = {
      en: EN_PRIMING,
      es: 'Transcripción en español. Términos de golf: hierro, madera, putter, green, tee, bunker, fairway, swing.',
      zh: '中文转录。高尔夫术语:铁杆,木杆,推杆,果岭,发球台,沙坑,球道,挥杆。',
    };
    // 2026-06-04 — Whisper-only. Gemini fallback removed (see header
    // comment). If Whisper fails, clean up tmp file and rethrow so
    // the outer 502 path fires with the real error message.
    let rawText = '';
    try {
      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(filePath),
        model: 'gpt-4o-mini-transcribe',
        language: language,
        prompt: PRIMING_PROMPT[language] ?? undefined,
      });
      rawText = transcription.text;
    } catch (e) {
      try { fs.unlinkSync(filePath); } catch { /* ignore */ }
      throw new Error(`Whisper failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    try { fs.unlinkSync(filePath); } catch { /* ignore cleanup errors */ }

    // 2026-05-25 — Fix S.2: post-Whisper substitution safety net. Even
    // with the priming prompt, the recurring long-tail mis-hears slip
    // through occasionally (especially with wind / cart noise). Keep
    // this table SMALL and additive — only known recurring patterns
    // from real on-course logs. Case-insensitive, word-boundary.
    const SUBSTITUTIONS: ReadonlyArray<[RegExp, string]> = [
      [/\bspark motion\b/gi, 'SmartMotion'],
      [/\bsmart bishop\b/gi, 'SmartVision'],
      [/\bsmart fission\b/gi, 'SmartVision'],
      [/\bsmart finger\b/gi, 'SmartFinder'],
      [/\bspark finder\b/gi, 'SmartFinder'],
      [/\bhull views?\b/gi, 'hole view'],
      [/\bwhole views?\b/gi, 'hole view'],
      [/\btight light\b/gi, 'TightLie'],
    ];
    let cleanedText = rawText;
    for (const [re, sub] of SUBSTITUTIONS) cleanedText = cleanedText.replace(re, sub);

    console.log('[transcribe] result:', cleanedText,
      cleanedText !== rawText ? '(post-substitution)' : '');

    return res.status(200).json({
      text: cleanedText,
      _debug: { provider: 'whisper' },
    });

  } catch (err: unknown) {
    // Audit fix: was returning HTTP 200 with `{error,text:''}` which made
    // failures look like silent successes — client-side code that read
    // `text` got an empty string and assumed the user said nothing. Now
    // we return a proper 5xx so monitoring (Sentry once enabled) sees
    // these as real errors and the voice UI can re-prompt the user.
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[transcribe] error:', msg);
    return res.status(502).json({ error: 'Transcription failed', detail: msg, text: '' });
  }
}
