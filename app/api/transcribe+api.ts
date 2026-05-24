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

    // 2026-05-24 — ES/ZH voice diagnosis fix (Option A hybrid). The
    // prior `language: language === 'zh' ? 'zh' : language` pinned
    // Whisper to en/es/zh — but settings.language defaults to 'en',
    // so a user who hadn't switched the picker first got their Spanish
    // audio mangled into English-looking text before the classifier
    // ever saw it. Now: pin ONLY when the user explicitly chose es/zh
    // (accuracy on short utterances); otherwise omit the field and let
    // Whisper auto-detect. Spanish "just works" without setup. See
    // ES-ZH-VOICE-DIAGNOSIS.md for the full Stage-1 trace.
    const transcription = await openai.audio.transcriptions.create({
      file: audio,
      model: 'whisper-1',
      language: language === 'es' || language === 'zh' ? language : undefined,
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
