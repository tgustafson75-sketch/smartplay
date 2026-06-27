import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as formidable from 'formidable';
import * as fs from 'fs';
import * as os from 'os';

// Root-cause fix 2026-06-22: Replaced OpenAI Whisper (5-15s, cold Lambda) with Deepgram
// Nova-2 (1-3s, external API — no cold-start sensitivity). DEEPGRAM_API_KEY is already
// in Vercel env (Preview + Production). This eliminates the "transcribe_http — Aborted"
// errors Tim was seeing: every call was hitting the 20s client timeout because Whisper
// on a cold Lambda + formidable parsing reliably exceeded 20s.

export const config = { api: { bodyParser: false } };

const DG_BASE = 'https://api.deepgram.com/v1/listen';
const DG_TIMEOUT_MS = 12_000;

// Language map for Deepgram BCP-47 codes
const DG_LANG: Record<string, string> = { en: 'en', es: 'es', zh: 'zh-CN' };

// Golf + product vocabulary for Deepgram keyword boosting (replaces Whisper prompt)
const DG_KEYWORDS = [
  'SmartPlay:5', 'SmartMotion:5', 'SmartVision:5', 'SmartFinder:5',
  'SwingLab:4', 'TightLie:4', 'SmartCaddie:4',
  'Kevin:3', 'Serena:3', 'Harry:3', 'Tank:3',
  'fairway:2', 'bunker:2', 'yardage:2', 'birdie:2', 'bogey:2',
].map(k => `keywords=${encodeURIComponent(k)}`).join('&');

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

interface DgResponse {
  results?: {
    channels?: Array<{
      alternatives?: Array<{ transcript?: string }>;
    }>;
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Warmup — Deepgram is always available, no Lambda warming needed
  if (req.query?.mode === 'warmup') {
    return res.status(200).json({ ok: true, mode: 'warmup' });
  }

  const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
  if (!DEEPGRAM_API_KEY) {
    console.error('[transcribe] DEEPGRAM_API_KEY not set');
    return res.status(500).json({ error: 'STT not configured', text: '' });
  }

  try {
    const form = new formidable.IncomingForm({
      uploadDir: os.tmpdir(),
      keepExtensions: true,
      maxFileSize: 25 * 1024 * 1024,
    });

    const [fields, files] = await new Promise<[Record<string, unknown>, Record<string, unknown>]>(
      (resolve, reject) => {
        form.parse(req, (err: unknown, f: unknown, fi: unknown) => {
          if (err) reject(err);
          else resolve([f as Record<string, unknown>, fi as Record<string, unknown>]);
        });
      }
    );

    const language = (Array.isArray(fields.language)
      ? (fields.language as string[])[0]
      : (fields.language as string | undefined)) ?? 'en';

    const audioFile = Array.isArray(files.audio)
      ? (files.audio as Array<{ filepath?: string; path?: string; size?: number }>)[0]
      : files.audio as { filepath?: string; path?: string; size?: number } | undefined;

    if (!audioFile) return res.status(400).json({ error: 'No audio file', text: '' });

    const filePath = audioFile.filepath ?? audioFile.path ?? '';
    const fileSize = audioFile.size ?? 0;

    if (fileSize > 3.5 * 1024 * 1024) {
      try { fs.unlinkSync(filePath); } catch { /* ignore */ }
      console.log('[transcribe] audio too large:', fileSize, 'bytes');
      return res.status(413).json({ error: 'audio_too_large', text: '' });
    }

    console.log('[transcribe] sending to Deepgram:', fileSize, 'bytes, language:', language);

    const audioBuffer = fs.readFileSync(filePath);
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }

    const dgLang = DG_LANG[language] ?? 'en';
    const url = `${DG_BASE}?model=nova-2&language=${dgLang}&smart_format=true&${DG_KEYWORDS}`;

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), DG_TIMEOUT_MS);

    let dgRes: Response;
    try {
      dgRes = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Token ${DEEPGRAM_API_KEY}`,
          'Content-Type': 'audio/m4a',
        },
        body: audioBuffer,
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(t);
    }

    if (!dgRes.ok) {
      const errText = await dgRes.text().catch(() => '');
      throw new Error(`Deepgram ${dgRes.status}: ${errText.slice(0, 200)}`);
    }

    const dgData = await dgRes.json() as DgResponse;
    const rawText = dgData.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '';

    let cleanedText = rawText;
    for (const [re, sub] of SUBSTITUTIONS) cleanedText = cleanedText.replace(re, sub);

    console.log('[transcribe] result:', cleanedText.slice(0, 80),
      cleanedText !== rawText ? '(substituted)' : '');

    return res.status(200).json({ text: cleanedText, _debug: { provider: 'deepgram-nova2' } });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[transcribe] error:', msg);
    // 2026-06-27 — return 200 (not 502) with an error field + empty text. The client
    // already treats an `error` field as a failure (speaks "didn't catch that"), so
    // UX is unchanged — but a 502 reads as a hard backend failure and can trip the
    // client's voice circuit breaker. Graceful, same as the brain endpoints.
    return res.status(200).json({ error: 'Transcription failed', detail: msg, text: '' });
  }
}
