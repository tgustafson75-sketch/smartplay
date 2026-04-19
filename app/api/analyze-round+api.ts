// Expo Router API route — POST /api/analyze-round
// Called once after a round ends. Never called during live gameplay.
// Returns a lightweight AI profile delta; gracefully degrades on failure.

import type { Shot } from '../../store/roundStore';

interface RoundPayload {
  shots: Shot[];
}

export interface AiRoundInsight {
  missBias: 'right' | 'left' | 'straight';
  confidence: 'low' | 'medium' | 'high';
  clubAdjustments: Record<string, string>;
  coachNote: string;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return Response.json({ error: 'API key not configured' }, { status: 500 });
    }

    const body = (await request.json()) as RoundPayload;
    const { shots } = body;

    if (!Array.isArray(shots) || shots.length === 0) {
      return Response.json({ error: 'No shots provided' }, { status: 400 });
    }

    // Summarise — never send raw PII; only aggregated stats
    const total = shots.length;
    const rightMisses = shots.filter((s) => s.result === 'right').length;
    const leftMisses  = shots.filter((s) => s.result === 'left').length;
    const straight    = shots.filter((s) => s.result === 'center').length;

    // Club dispersion stats
    const clubStats: Record<string, { total: number; right: number; left: number }> = {};
    for (const shot of shots) {
      if (!clubStats[shot.club]) clubStats[shot.club] = { total: 0, right: 0, left: 0 };
      clubStats[shot.club].total++;
      if (shot.result === 'right') clubStats[shot.club].right++;
      if (shot.result === 'left')  clubStats[shot.club].left++;
    }

    const clubSummary = Object.entries(clubStats)
      .map(([c, v]) => `${c}: ${v.total} shots, ${v.right} right, ${v.left} left`)
      .join('; ');

    const prompt = `A golfer just completed a round. Analyse these shot statistics and return a JSON object.\n\nShots: ${total} total — ${rightMisses} right, ${leftMisses} left, ${straight} straight.\nClub breakdown: ${clubSummary}.\n\nReturn ONLY valid JSON matching this exact schema:\n{"missBias":"right"|"left"|"straight","confidence":"low"|"medium"|"high","clubAdjustments":{"<club>":"<short tip>"},"coachNote":"<one sentence coaching note under 15 words>"}`;

    const openAIRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 200,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You are a golf performance analyst. Respond only with the requested JSON. Be concise.',
          },
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (!openAIRes.ok) {
      return Response.json({ error: 'OpenAI request failed' }, { status: 502 });
    }

    const data = await openAIRes.json();
    const raw  = (data.choices?.[0]?.message?.content as string)?.trim() ?? '{}';

    let insight: AiRoundInsight;
    try {
      insight = JSON.parse(raw) as AiRoundInsight;
    } catch {
      return Response.json({ error: 'Failed to parse AI response' }, { status: 502 });
    }

    return Response.json(insight);
  } catch (err) {
    console.error('[/api/analyze-round] error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
