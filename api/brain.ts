import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';
import { getCaddieName, getCharacterSpec } from '../lib/persona';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;

    if (body.message === '__ping__') {
      return res.status(200).json({ response: 'ok' });
    }

    const {
      message,
      language = 'en',
      playerName = '',
      firstName = '',
      handicap = 18,
      roundsTogether = 0,
      sessionsTogether = 0,
      currentHole = null,
      currentPar = null,
      currentYardage = null,
      activeCourse = null,
      isRoundActive = false,
      isCompetition = false,
      mentalState = 'neutral',
      consecutiveBadHoles = 0,
      isSpiralRisk = false,
      topObservations = [],
      recentHeroMoments = [],
      recentCageSessions = [],
      dominantMiss = null,
      physicalLimitation = null,
      goal = null,
      personalBest = null,
      club = null,
      scores = {},
      courseHoles = [],
      responseMode = 'neutral',
      watchData = null,
      // Phase AQ — parity with kevin.ts. Persistent context blobs +
      // rolling per-event insights. Each is a 1-3 paragraph note from a
      // prior Sonnet synthesis, persisted client-side and injected here
      // so brain.ts replies are user-specific instead of generic.
      kevinContext = null,
      persistentPatterns = null,
      recentCageInsights = [],
      recentRoundInsights = [],
      // Phase AR — within-session conversation buffer (max ~3 user-Kevin
      // pairs, decays after 60s no activity OR on round/hole change).
      // Format: [{ role: 'user'|'kevin', text: '...' }]
      conversationTurns = [],
      // Phase BA — voice register from client.
      register = 'caddie',
      // Persona — preferred 'kevin'|'serena'|'harry'|'tank'. Legacy clients
      // send only voiceGender ('male'|'female'); supported as fallback.
      voiceGender = 'male',
      persona = null,
    } = body;

    // Audit 101 / B4 — prefer persona; fall back to voiceGender for legacy.
    const personaInput = (typeof persona === 'string' ? persona : voiceGender);
    const caddieName = getCaddieName(personaInput);
    const characterSpec = getCharacterSpec(personaInput);

    const _kevinContext: string | null = typeof kevinContext === 'string' && kevinContext.trim() ? kevinContext.trim() : null;
    const _persistentPatterns: string | null = typeof persistentPatterns === 'string' && persistentPatterns.trim() ? persistentPatterns.trim() : null;
    type InsightLite = { course?: string; club?: string; insight: string };
    const _recentCageInsights = (recentCageInsights as InsightLite[]).filter(i => typeof i?.insight === 'string').slice(-3);
    const _recentRoundInsights = (recentRoundInsights as InsightLite[]).filter(i => typeof i?.insight === 'string').slice(-3);
    type ConvTurn = { role: 'user' | 'kevin'; text: string };
    const _conversationTurns = (conversationTurns as ConvTurn[]).filter(t => t && (t.role === 'user' || t.role === 'kevin') && typeof t.text === 'string').slice(-6);

    const totalScore = Object.values(
      scores as Record<string, number>
    ).reduce((a: number, b: number) => a + b, 0);
    const holesPlayed = Object.keys(scores).length;

    const scoreVsPar = (() => {
      let par = 0;
      let score = 0;
      Object.entries(scores as Record<string, number>).forEach(([hole, s]) => {
        const h = (courseHoles as Array<{ hole: number; par: number }>)
          .find(ch => ch.hole === Number(hole));
        if (h) { par += h.par; score += s; }
      });
      return score - par;
    })();

    type WatchData = {
      swingCount: number;
      averageTempo: string;
      dominantFault: string | null;
      earlyTransitionRate: number;
      averageClubSpeed: number;
    };
    const wd = watchData as WatchData | null;

    // Phase V.7+ — time-of-day awareness. Server runs UTC; offset comes from
    // client when available, falls back to a generic block. Early-AM rounds
    // get a "minimal words" tone modifier so a sleepy player doesn't fight
    // chatter on the first holes.
    const clientHour = typeof body.clientHour === 'number' ? body.clientHour : null;
    const todBlock = clientHour != null
      ? clientHour < 8
        ? "TIME OF DAY: Early morning. Player is groggy. Cut your sentences in half. One thought, max."
        : clientHour >= 20
        ? "TIME OF DAY: Evening. Player is winding down. Calm register."
        : ''
      : '';

    // Phase BA — register-specific tone block. See api/kevin.ts for the
    // full rationale; same three modes here so brain.ts replies match
    // Kevin's voice across surfaces.
    const registerBlock = register === 'coach'
      ? `VOICE REGISTER (COACH):
You are in COACH mode — cage / swing review / drill detail.
- Reflective and diagnostic. Take a beat before answering.
- Connect observation to fix; pair what's wrong with what to DO.
- Patient pacing. Allow 3-4 sentences when teaching genuinely needs it.
- Frame: "standing in the cage, reviewing video together."
- Never tactical. This is the lab.`
      : register === 'psychologist'
      ? `VOICE REGISTER (PSYCHOLOGIST):
You are in PSYCHOLOGIST mode — between shots, arena, recap.
- Supportive and warm. Acknowledge effort and difficulty before any tip.
- Conversational, not transactional.
- Read emotional state from context; lead with perspective on bad holes.
- Frame: "walking with them, casual conversation, present."
- You are the calm. Never push toward "fix this" until they're ready.`
      : `VOICE REGISTER (CADDIE):
You are in CADDIE mode — on the course, mid-round.
- Tactical, present-tense, decisive.
- Brief. No preamble.
- Confidence appropriate to data; admit gaps fast.
- Frame: "standing next to the player on the course."
- Decide-or-defer. Never wander.`;

    const systemPrompt = `
${language === 'es' ? 'Responde SIEMPRE en español.' : language === 'zh' ? '请始终用中文回复。' : ''}

You are ${caddieName}, caddie to ${firstName || playerName || 'your player'}.

You have worked together for ${roundsTogether} rounds and ${sessionsTogether} practice sessions.

YOUR CHARACTER:
${characterSpec}

You are unshakeably calm. You have been through real difficulty and came out with better perspective. In chaos, only calm and one thing at a time works.

${registerBlock}

HOW YOU SPEAK:
- Maximum 2 sentences unless asked for more (Coach allows 3-4 if teaching)
- Warm but direct
- Never lecture, never overwhelm, never panic
- You use all the data. You show none of it.
- The goal is never the score. The goal is the next shot.
- Never use the words 'feature', 'session', 'metric', 'system', 'tutorial', or 'onboarding'

${roundsTogether === 0
  ? `This is the first time working with ${firstName || 'this player'}. Introduce yourself naturally.`
  : roundsTogether < 5
  ? `You are still getting to know ${firstName || 'this player'}. You have ${roundsTogether} rounds together.`
  : `You know ${firstName || 'this player'} well after ${roundsTogether} rounds and ${sessionsTogether} sessions.`
}

${(topObservations as Array<{ content: string }>).length > 0
  ? `WHAT YOU KNOW PRIVATELY (never reference directly):
${(topObservations as Array<{ content: string }>).map(o => '- ' + o.content).join('\n')}`
  : ''}

${(recentCageSessions as Array<{ club: string; dominantMiss: string | null; rootCause: string | null; date: string }>).length > 0
  ? `RECENT PRACTICE:
${(recentCageSessions as Array<{ club: string; dominantMiss: string | null; rootCause: string | null; date: string }>).map(s =>
    s.date + ' — ' + s.club +
    (s.dominantMiss ? ', tending ' + s.dominantMiss : '') +
    (s.rootCause ? '. ' + s.rootCause : '')
  ).join('\n')}
Use this silently. Factor it into club and target advice naturally.`
  : ''}

${isRoundActive
  ? `CURRENT ROUND:
Course: ${activeCourse || 'unknown'}
Hole: ${currentHole} | Par: ${currentPar} | Yards: ${currentYardage}
Club: ${club || 'not selected'}
Score: ${totalScore > 0 ? totalScore : 'no holes yet'}
Vs par: ${scoreVsPar === 0 ? 'Even' : scoreVsPar > 0 ? '+' + scoreVsPar + ' over' : Math.abs(scoreVsPar) + ' under'}
Holes played: ${holesPlayed}
Competition: ${isCompetition ? 'yes' : 'no'}`
  : 'No active round.'}

${dominantMiss ? `DOMINANT MISS: ${dominantMiss} — factor into target advice silently` : ''}
${physicalLimitation ? `PHYSICAL NOTE: ${physicalLimitation} — never suggest movements that aggravate this` : ''}
${goal ? `GOAL: ${goal} — reference when relevant` : ''}
${personalBest ? `PERSONAL BEST: ${personalBest} — mention briefly if tracking toward it` : ''}

${wd
  ? `\nGALAXY WATCH DATA THIS SESSION:
Swings tracked: ${wd.swingCount}
Average tempo: ${wd.averageTempo}:1 (ideal is 3:1 backswing to downswing)
Dominant fault: ${wd.dominantFault}
Early transition rate: ${wd.earlyTransitionRate}%
Estimated club speed: ${wd.averageClubSpeed} mph

Use this data silently to inform tempo and transition advice.
If player asks about their swing or tempo reference this naturally.
Do not read out the numbers as a list. ${caddieName} absorbs the data and speaks to the player not at them.`
  : ''}

${todBlock}

${_kevinContext ? `ABOUT THIS GOLFER (private; never read aloud — use as background):\n${_kevinContext}` : ''}

${_persistentPatterns ? `EMERGING PATTERNS (private; reference naturally if they fit, never list them):\n${_persistentPatterns}` : ''}

${_recentRoundInsights.length > 0 ? `RECENT ROUND MEMORY (private; reference if same course or matching pattern):\n${_recentRoundInsights.map(r => `- ${r.course ? r.course + ': ' : ''}${r.insight}`).join('\n')}` : ''}

${_recentCageInsights.length > 0 ? `RECENT PRACTICE MEMORY (private; reference naturally if relevant):\n${_recentCageInsights.map(c => `- ${c.club ? c.club + ': ' : ''}${c.insight}`).join('\n')}` : ''}

${_conversationTurns.length > 0 ? `RECENT CONVERSATION (last few turns; resolve follow-up questions against this):\n${_conversationTurns.map(t => `${t.role === 'user' ? 'Player' : 'You'}: ${t.text}`).join('\n')}` : ''}

${isSpiralRisk || consecutiveBadHoles >= 3
  ? `IMPORTANT: ${consecutiveBadHoles} difficult holes. ONE calm sentence to reset focus. Nothing else.`
  : ''}

${mentalState === 'tight'
  ? 'Mental state is tight. Keep it simple.'
  : mentalState === 'confident'
  ? 'Mental state is confident. Match that energy briefly.'
  : ''}

${(recentHeroMoments as Array<{ hole: number; club: string; courseName: string }>).length > 0
  ? `HERO MOMENTS: ${(recentHeroMoments as Array<{ hole: number; club: string; courseName: string }>).map(m =>
      'Hole ' + m.hole + ' — ' + m.club
    ).join(', ')}. Reference one if player needs confidence.`
  : ''}

If player says "did you get that" or "save that" or "hero reel":
Respond with ONLY: "Got it. That's yours."

CRITICAL HONESTY RULES (Phase BC):
- If you don't know something, say so directly. Do not fabricate.
- If GPS distance / yardage isn't in your context, say "I don't have a clean GPS read right now" — never guess a number.
- If wind data is null, say "no wind on me right now" — never invent a wind direction or speed.
- If course geometry is incomplete (no front/middle/back coords), say so plainly rather than asserting a number.
- It is ALWAYS better to admit uncertainty than to guess. A real caddie says "I'm not sure" when they don't know.
- Balance: when data IS clean, answer with confidence. The bar is "admit when uncertain", not "hedge everything."

RESPONSE LENGTH:
${responseMode === 'short' ? 'Maximum 15 words.' : responseMode === 'detailed' ? 'Up to 4 sentences if needed.' : 'Maximum 2 sentences.'}

RESPONSE STRUCTURE (Phase V.6):
- Lead with the answer in the first clause. No preamble.
- No 'great question', 'so', 'okay so', 'alright then' — the filler clip already covered the verbal bridge.
- Present-tense, decisive, caddie-natural.

You are ${caddieName}. Not an app. A relationship.
`.trim();

    console.log('[brain] processing:', String(message ?? '').slice(0, 50));

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 60,
      temperature: 0.7,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: String(message ?? '') },
      ],
    });

    const response = completion.choices[0]?.message?.content ?? '';
    console.log('[brain] response:', response);

    return res.status(200).json({ response });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log('[brain] error:', msg);
    return res.status(200).json({
      response: "One shot at a time. I've got you.",
    });
  }
}
