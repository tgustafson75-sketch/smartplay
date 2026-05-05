import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 25_000, maxRetries: 1 });

export async function POST(request: Request) {
  try {
     
    const formData = (await request.formData()) as any;
    const audio = formData.get('audio') as File | null;
    const language = (formData.get('language') as string | null) ?? 'en';

    if (!audio) {
      return Response.json({ error: 'No audio file' }, { status: 400 });
    }

    console.log('[transcribe] received:', audio.size, 'bytes, language:', language);

    const transcription = await openai.audio.transcriptions.create({
      file: audio,
      model: 'whisper-1',
      language: language === 'zh' ? 'zh' : language,
    });

    console.log('[transcribe] result:', transcription.text);

    return Response.json({ text: transcription.text });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log('[transcribe] error:', msg);
    return Response.json(
      { error: 'Transcription failed', text: '' },
      { status: 200 },
    );
  }
}
