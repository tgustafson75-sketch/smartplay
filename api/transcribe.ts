import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';
import * as fs from 'fs';
import * as os from 'os';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: 'whisper-1',
      language: language === 'zh' ? 'zh' : language,
    });

    try { fs.unlinkSync(filePath); } catch { /* ignore cleanup errors */ }

    console.log('[transcribe] result:', transcription.text);

    return res.status(200).json({ text: transcription.text });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log('[transcribe] error:', msg);
    return res.status(200).json({ error: 'Transcription failed', text: '' });
  }
}
