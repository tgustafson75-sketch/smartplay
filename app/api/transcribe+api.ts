/**
 * 2026-05-26 — Fix CC: ported Batch 57 (Whisper→Gemini fallback) +
 * Fix S/S.2 (SmartPlay priming + post-Whisper substitution table)
 * from api/transcribe.ts into this Expo Router dev-server twin so
 * they don't drift. Prior twin was bare Whisper-only — when OpenAI
 * was down during dev, the whole voice input chain broke silently.
 * Now: Whisper still primary; Gemini 2.5 Flash fires on Whisper
 * failure; same priming prompts + post-substitutions apply to both
 * paths.
 *
 * Note: in PROD the mobile app hits the Vercel /api/transcribe
 * directly (this twin only runs in dev under Expo Router), so the
 * twin drift wasn't breaking prod users. But dev parity matters for
 * catching regressions before they ship.
 */

import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 25_000, maxRetries: 1 });
const gemini = process.env.GOOGLE_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY })
  : null;

const EN_PRIMING = 'SmartPlay Caddie. SmartMotion, SmartVision, SmartFinder, TightLie, SwingLab, Cage Mode, Coach Mode, Quick Record. Caddies: Kevin, Tank, Serena, Harry. Hole views, hole view, mark the tee, mark the pin, mark the green. Golf: fairway, green, tee, pin, flag, par, bogey, birdie, eagle, slice, hook, draw, fade, yardage, approach, layup, wedge, driver, putter, iron, sand, bunker, rough.';

const PRIMING_PROMPT: Record<string, string> = {
  en: EN_PRIMING,
  es: 'Transcripción en español. Términos de golf: hierro, madera, putter, green, tee, bunker, fairway, swing.',
  zh: '中文转录。高尔夫术语:铁杆,木杆,推杆,果岭,发球台,沙坑,球道,挥杆。',
};

const GEMINI_TRANSCRIBE_PROMPT: Record<string, string> = {
  en: 'Transcribe this audio verbatim in English. Output only the spoken words, no commentary, no punctuation beyond what reflects natural pauses. Context: a golfer talking to their voice caddie about SmartPlay, SmartMotion, SmartVision, SmartFinder, TightLie, SwingLab, caddie names (Kevin, Tank, Serena, Harry), and standard golf vocabulary.',
  es: 'Transcribe este audio textualmente en español. Solo las palabras habladas. Contexto: golfista hablando con su caddie.',
  zh: '请逐字转录这段中文音频。仅输出说话内容。背景:高尔夫球员在与语音球童交谈。',
};

const AUDIO_MIME_BY_TYPE: Record<string, string> = {
  'audio/mp4':  'audio/mp4',
  'audio/mpeg': 'audio/mpeg',
  'audio/wav':  'audio/wav',
  'audio/webm': 'audio/webm',
  'audio/ogg':  'audio/ogg',
  'audio/aac':  'audio/aac',
  'audio/flac': 'audio/flac',
  'audio/x-m4a':'audio/mp4',
};

const SUBSTITUTIONS: readonly [RegExp, string][] = [
  [/\bspark motion\b/gi, 'SmartMotion'],
  [/\bsmart bishop\b/gi, 'SmartVision'],
  [/\bsmart fission\b/gi, 'SmartVision'],
  [/\bsmart finger\b/gi, 'SmartFinder'],
  [/\bspark finder\b/gi, 'SmartFinder'],
  [/\bhull views?\b/gi, 'hole view'],
  [/\bwhole views?\b/gi, 'hole view'],
  [/\btight light\b/gi, 'TightLie'],
];

export async function POST(request: Request) {
  try {

    const formData = (await request.formData()) as any;
    const audio = formData.get('audio') as File | null;
    const language = (formData.get('language') as string | null) ?? 'en';

    if (!audio) {
      return Response.json({ error: 'No audio file' }, { status: 400 });
    }

    console.log('[transcribe] received:', audio.size, 'bytes, language:', language);

    let rawText = '';
    let providerUsed: 'whisper' | 'gemini-fallback' = 'whisper';
    let whisperError: string | null = null;

    try {
      // 2026-05-24 — ES/ZH voice diagnosis fix + Fix S priming. Pin
      // Whisper to es/zh only when the user explicitly chose it; let
      // it auto-detect otherwise. Priming prompt biases toward the
      // SmartPlay domain vocab (Fix S — wind/cart noise was producing
      // "spark motion" / "smart bishop" mis-hears).
      const transcription = await openai.audio.transcriptions.create({
        file: audio,
        model: 'whisper-1',
        language: language === 'es' || language === 'zh' ? language : undefined,
        prompt: PRIMING_PROMPT[language] ?? undefined,
      });
      rawText = transcription.text;
    } catch (e) {
      whisperError = e instanceof Error ? e.message : String(e);
      console.warn('[transcribe] whisper failed:', whisperError, '— attempting Gemini fallback');
      if (!gemini) {
        throw new Error(`Whisper failed and Gemini fallback unavailable: ${whisperError}`);
      }
      const audioBytes = new Uint8Array(await audio.arrayBuffer());
      const mimeType = AUDIO_MIME_BY_TYPE[audio.type] ?? 'audio/mp4';
      // Base64-encode the audio for Gemini's inlineData parts.
      let binary = '';
      for (let i = 0; i < audioBytes.length; i++) binary += String.fromCharCode(audioBytes[i]);
      const base64 = typeof btoa === 'function' ? btoa(binary) : Buffer.from(audioBytes).toString('base64');
      const gem = await gemini.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{
          role: 'user',
          parts: [
            { text: GEMINI_TRANSCRIBE_PROMPT[language] ?? GEMINI_TRANSCRIBE_PROMPT.en },
            { inlineData: { mimeType, data: base64 } },
          ],
        }],
      });
      rawText = (gem.text ?? '').trim();
      providerUsed = 'gemini-fallback';
      if (!rawText) {
        throw new Error(`Both Whisper and Gemini failed (whisper: ${whisperError}; gemini: empty response)`);
      }
      console.log('[transcribe] Gemini fallback success');
    }

    // Post-Whisper substitution safety net for known cart-noise mis-hears.
    let cleanedText = rawText;
    for (const [re, sub] of SUBSTITUTIONS) cleanedText = cleanedText.replace(re, sub);

    console.log('[transcribe] result:', cleanedText,
      cleanedText !== rawText ? '(post-substitution)' : '',
      `(provider=${providerUsed})`);

    return Response.json({
      text: cleanedText,
      _debug: { provider: providerUsed, whisper_error: whisperError },
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log('[transcribe] error:', msg);
    return Response.json(
      { error: 'Transcription failed', text: '' },
      { status: 200 },
    );
  }
}
