import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 25_000, maxRetries: 1 });
// 2026-05-26 — Fix BU: Gemini fallback transcriber. Whisper has been
// the only path; an OpenAI outage previously meant total voice-input
// blackout. Gemini 2.5 Flash handles audio natively (Anthropic does
// not), so it's the right secondary. Lazy-construct only if the key
// is configured so deployments without GOOGLE_API_KEY still work
// (just without the fallback).
const gemini = process.env.GOOGLE_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY })
  : null;

const AUDIO_MIME_BY_EXT: Record<string, string> = {
  '.m4a':  'audio/mp4',
  '.mp4':  'audio/mp4',
  '.mp3':  'audio/mpeg',
  '.wav':  'audio/wav',
  '.webm': 'audio/webm',
  '.ogg':  'audio/ogg',
  '.aac':  'audio/aac',
  '.flac': 'audio/flac',
};

const GEMINI_TRANSCRIBE_PROMPT: Record<string, string> = {
  en: 'Transcribe this audio verbatim in English. Output only the spoken words, no commentary, no punctuation beyond what reflects natural pauses. Context: a golfer talking to their voice caddie about SmartPlay, SmartMotion, SmartVision, SmartFinder, TightLie, SwingLab, caddie names (Kevin, Tank, Serena, Harry), and standard golf vocabulary.',
  es: 'Transcribe este audio textualmente en español. Solo las palabras habladas. Contexto: golfista hablando con su caddie.',
  zh: '请逐字转录这段中文音频。仅输出说话内容。背景:高尔夫球员在与语音球童交谈。',
};

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

  // 2026-06-04 — Pre-warm. Client hits this with ?mode=warmup after
  // splash completes so the OpenAI SDK + TLS to api.openai.com are
  // hot when the first real transcribe lands. Note: query param (not
  // body) because this handler disables bodyParser (formidable parses
  // multipart later). openai.audio.speech.create warms the SAME SDK
  // HTTP layer that openai.audio.transcriptions.create uses, so this
  // primes Whisper's connection too. Mirrors api/voice.ts shape.
  if (req.query?.mode === 'warmup') {
    try {
      const mp3 = await openai.audio.speech.create({
        model: 'gpt-4o-mini-tts',
        voice: 'onyx',
        input: ' ',
      });
      await mp3.arrayBuffer();
      console.log('[transcribe] warmup completed (OpenAI SDK hot)');
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
    // 2026-05-26 — Fix BU: Whisper-then-Gemini chain. If OpenAI fails
    // (outage, rate limit, regional drop), fall back to Gemini 2.5
    // Flash with the audio inlined as base64. Either path produces
    // `rawText` + a `providerUsed` tag for _debug observability.
    let rawText = '';
    let providerUsed: 'whisper' | 'gemini-fallback' = 'whisper';
    let whisperError: string | null = null;
    try {
      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(filePath),
        model: 'whisper-1',
        language: language,
        prompt: PRIMING_PROMPT[language] ?? undefined,
      });
      rawText = transcription.text;
    } catch (e) {
      whisperError = e instanceof Error ? e.message : String(e);
      console.warn('[transcribe] whisper failed:', whisperError, '— attempting Gemini fallback');
      if (!gemini) {
        try { fs.unlinkSync(filePath); } catch { /* ignore */ }
        throw new Error(`Whisper failed and Gemini fallback unavailable: ${whisperError}`);
      }
      const audioBytes = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const mimeType = AUDIO_MIME_BY_EXT[ext] ?? 'audio/mp4';
      const gem = await gemini.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{
          role: 'user',
          parts: [
            { text: GEMINI_TRANSCRIBE_PROMPT[language] ?? GEMINI_TRANSCRIBE_PROMPT.en },
            { inlineData: { mimeType, data: audioBytes.toString('base64') } },
          ],
        }],
      });
      rawText = (gem.text ?? '').trim();
      providerUsed = 'gemini-fallback';
      if (!rawText) {
        try { fs.unlinkSync(filePath); } catch { /* ignore */ }
        throw new Error(`Both Whisper and Gemini failed (whisper: ${whisperError}; gemini: empty response)`);
      }
      console.log('[transcribe] Gemini fallback success');
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
      cleanedText !== rawText ? '(post-substitution)' : '',
      `(provider=${providerUsed})`);

    return res.status(200).json({
      text: cleanedText,
      _debug: { provider: providerUsed, whisper_error: whisperError },
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
