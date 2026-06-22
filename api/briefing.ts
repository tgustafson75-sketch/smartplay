import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getCaddieName, getCharacterSpec } from '../lib/persona';
import { completeText, providerFromHeader } from './_aiProvider';

const MODE_DESCRIPTIONS: Record<string, string> = {
  break_100: 'Break 100 — avoid doubles, bogey is success, lay up by default',
  break_90:  'Break 90 — smart misses, lay up when in doubt, par is the win',
  break_80:  'Break 80 — hunt birdies on par 5s and short par 4s, back off only on bad risk',
  free_play: 'Free play — casual round, no specific score target',
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // 2026-06-15 (Tim — pre-round brief fired ~25s late) — Pre-warm. The client
  // pings this with { mode: 'warmup' } the instant "Start Round Here" is tapped,
  // so the Lambda + provider SDK + TLS are hot by the time the hole-1 handoff
  // actually generates the brief. Single 'ping', max_tokens:1 (~$0.0001 per warmup).
  if (req.body?.mode === 'warmup' || req.query?.mode === 'warmup') {
    const warmProvider = providerFromHeader(req.headers as Record<string, string | string[] | undefined>);
    try {
      await completeText(warmProvider, 'quality', 'ping', [{ role: 'user', content: 'ping' }], { maxTokens: 1 });
      console.log(`[briefing] warmup completed (${warmProvider} SDK hot)`);
    } catch (e) {
      console.log('[briefing] warmup failed (non-fatal):', e instanceof Error ? e.message : String(e));
    }
    return res.status(200).json({ ok: true, mode: 'warmup' });
  }

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
      // Phase V.7+ — last 1-3 cage sessions so the briefing can name what
      // the player was working on at practice ("let's see if Tuesday's
      // driver work holds up"). Quietly omitted when empty.
      recentCageSessions = [],
      // Persona — preferred 'kevin'|'serena'|'harry'|'tank'. Legacy clients
      // send only voiceGender ('male'|'female'); supported as fallback.
      voiceGender = 'male',
      persona = null,
    } = req.body;

    // Audit 101 / B4 — prefer persona; fall back to voiceGender for legacy.
    const personaInput = (typeof persona === 'string' ? persona : voiceGender);
    const caddieName = getCaddieName(personaInput);
    const characterSpec = getCharacterSpec(personaInput);

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
    type CageSessionLite = { club: string; dominantMiss: string | null; rootCause: string | null; date: string };
    const cageBlock = (recentCageSessions as CageSessionLite[]).length > 0
      ? `Recent cage practice (factor in silently — reference at most one of these naturally if it actually fits the round ahead, never list them):\n${(recentCageSessions as CageSessionLite[]).map(s =>
          `- ${s.date}: ${s.club}${s.dominantMiss ? ', tending ' + s.dominantMiss : ''}${s.rootCause ? '. ' + s.rootCause : ''}`
        ).join('\n')}`
      : '';

    const systemPrompt = `${characterSpec}

You are ${caddieName}, the player's caddie. They are about to start a round. Deliver a 30-60 second spoken pre-round briefing in your voice.

${language === 'es' ? 'Responde SIEMPRE en español.' : language === 'zh' ? '请始终用中文回复。' : ''}

Briefing structure (loose — vary it each time):
1. Opening using their name and the course ('Alright ${name || "let's go"}, ${courseName} today...')
2. Course read tied to mode — what this mode means for strategy on this course
3. Pattern callout if relevant and specific (if no patterns, skip this)
4. Ghost match note if one is active
5. A closing line that settles them — encouraging but not a pep talk

Rules:
- Speak it, don't write it — no bullet points, no headers, just the words ${caddieName} would say
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
${cageBlock}

Give the pre-round briefing now.`;

    const provider = providerFromHeader(req.headers as Record<string, string | string[] | undefined>);
    const brief = await completeText(provider, 'quality', systemPrompt, [{ role: 'user', content: userMessage }], { maxTokens: 200 });

    if (!brief) {
      console.error('[briefing] empty response from AI provider for', courseName, mode);
      return res.status(502).json({ error: 'Empty brief from AI provider' });
    }

    console.log('[briefing] generated for', courseName, mode, `"${brief.slice(0, 60)}..."`);
    return res.status(200).json({ brief });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[briefing] error:', msg);
    return res.status(500).json({ error: msg });
  }
}
