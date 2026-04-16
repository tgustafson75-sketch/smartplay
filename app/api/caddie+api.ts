// Expo Router API route — POST /api/caddie

export async function POST(request: Request): Promise<Response> {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return Response.json({ error: 'API key not configured' }, { status: 500 });
    }

    const body = await request.json();
    const { prompt } = body as { prompt: string };

    if (!prompt || typeof prompt !== 'string') {
      return Response.json({ error: 'Invalid request' }, { status: 400 });
    }

    const openAIRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 40,
        messages: [
          { role: 'system', content: 'You are a concise professional golf caddie. Keep every response under 12 words.' },
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (!openAIRes.ok) {
      return Response.json({ error: 'OpenAI request failed' }, { status: 502 });
    }

    const data = await openAIRes.json();
    const message = (data.choices?.[0]?.message?.content as string)?.trim() ?? null;

    return Response.json({ message });
  } catch (err) {
    console.error('[/api/caddie] error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
