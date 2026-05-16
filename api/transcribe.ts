import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';
import * as fs from 'fs';
import * as os from 'os';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 25_000, maxRetries: 1 });

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
    const PRIMING_PROMPT: Record<string, string> = {
      es: 'Transcripción en español. Términos de golf: hierro, madera, putter, green, tee, bunker, fairway, swing.',
      zh: '中文转录。高尔夫术语:铁杆,木杆,推杆,果岭,发球台,沙坑,球道,挥杆。',
    };
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: 'whisper-1',
      language: language,
      prompt: PRIMING_PROMPT[language] ?? undefined,
    });

    try { fs.unlinkSync(filePath); } catch { /* ignore cleanup errors */ }

    console.log('[transcribe] result:', transcription.text);

    return res.status(200).json({ text: transcription.text });

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
