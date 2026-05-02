import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';
import { KEVIN_CHARACTER_SPEC } from '../constants/kevinCharacter';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODE_DESCRIPTIONS: Record<string, string> = {
  break_100: 'Break 100 — avoid doubles, bogey is success, lay up by default',
  break_90:  'Break 90 — smart misses, lay up when in doubt, par is the win',
  break_80:  'Break 80 — hunt birdies on par 5s and short par 4s, back off only on bad risk',
  free_play: 'Free play — casual round, no specific score target',
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      courseName = 'the course',
      mode = 'free_play',
      playerName = '',
      handicap = 18,
      goal = null,
      dominantMiss = null,
      patternInsights = [],
      ghostLabel = null,
      roundsTogether = 0,
      language = 'en',
      // Phase T — handicap context. courseHandicap pre-computed by caller
      // via services/handicapCalculator so this endpoint stays math-free.
      courseHandicap = null,
      teeName = null,
      // Phase U — meaningful pattern shift across recent rounds (computed
      // client-side via services/patternDetection.detectPatternShift).
      patternShiftAlert = null,
    } = req.body;

    const name = String(playerName || '').trim();
    const modeDesc = MODE_DESCRIPTIONS[String(mode)] ?? String(mode);
    const insightsBlock = (patternInsights as string[]).length > 0
      ? `Recent patterns:\n${(patternInsights as string[]).map(i => '- ' + i).join('\n')}`
      : '';
    const ghostBlock = ghostLabel
      ? `Ghost match active — playing against: ${ghostLabel}. Mention this briefly.`
      : '';
    const handicapBlock = (courseHandicap != null)
      ? `Course Handicap from ${teeName || 'these tees'} today is ${courseHandicap}. Drop this in naturally — one short line.`
      : '';
    const patternShiftBlock = patternShiftAlert
      ? `Pattern shift across recent rounds: ${patternShiftAlert}. Mention this briefly so the user heads onto the course aware of the trend.`
      : '';

    const systemPrompt = `${KEVIN_CHARACTER_SPEC}

You are Kevin, the player's caddie. They are about to start a round. Deliver a 30-60 second spoken pre-round briefing in your voice.

${language === 'es' ? 'Responde SIEMPRE en español.' : language === 'zh' ? '请始终用中文回复。' : ''}

Briefing structure (loose — vary it each time):
1. Opening using their name and the course ('Alright ${name || "let's go"}, ${courseName} today...')
2. Course read tied to mode — what this mode means for strategy on this course
3. Pattern callout if relevant and specific (if no patterns, skip this)
4. Ghost match note if one is active
5. A closing line that settles them — encouraging but not a pep talk

Rules:
- Speak it, don't write it — no bullet points, no headers, just the words Kevin would say
- Under 90 words
- Vary the opening phrase across rounds — don't always start with 'Alright'
- No app-speak. No 'metrics', 'sessions', 'features', 'data'
- If no patterns, skip the pattern step entirely — don't say 'no patterns'
- Output ONLY the briefing text`;

    const userMessage = `Course: ${courseName}
Mode: ${modeDesc}
Player: ${name || 'the player'}, handicap ${handicap}${goal ? ', goal: ' + goal : ''}${dominantMiss ? ', dominant miss: ' + dominantMiss : ''}
Rounds together: ${roundsTogether}
${insightsBlock}
${ghostBlock}
${handicapBlock}
${patternShiftBlock}

Give the pre-round briefing now.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 200,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const block = response.content.find(b => b.type === 'text');
    const brief = (block as { type: 'text'; text: string } | undefined)?.text?.trim() ?? '';

    console.log('[briefing] generated for', courseName, mode, `"${brief.slice(0, 60)}..."`);
    return res.status(200).json({ brief });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[briefing] error:', msg);
    return res.status(500).json({ error: msg });
  }
}
