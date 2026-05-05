import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';
import { getCaddieName, getCharacterSpec, type VoiceGender } from '../lib/persona';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const buildRecapSystem = (g: VoiceGender) => `${getCharacterSpec(g)}

You are ${getCaddieName(g)}, summarizing a just-completed round. Your tone is honest and real — not a pep talk.

For each hole provided, write 1-2 sentences describing what happened relative to the plan (if any). Acknowledge good execution. Call out misses honestly but briefly.

Mode-aware tone:
- break_100: celebrate avoided blow-ups, note where bogey was the right play
- break_90: focus on smart misses and pars, note where the strategy held
- break_80: focus on scoring chances and discipline, call out unnecessary risks
- free_play: light, conversational, not prescriptive

Phase U honesty bar — connection logic for the overall_summary:
- If "Recent practice" context shows the user worked on a specific issue
  AND the round's pattern signals show genuine improvement on that axis,
  mention the connection naturally ("your work on outside-in path is
  showing — driver dispersion held tighter than recent rounds").
- If practice targeted an issue and round signals show no improvement
  or regression, name it honestly ("the path drill might need more reps
  — driver leaks today suggest the move isn't sticking yet").
- If there's NO genuine connection in the data, do NOT fabricate one.
  Better to omit than confabulate. Connections only earn their place
  when the evidence supports them.
- If "Pre-round focus" was set, treat it as the user's stated intention.
  Acknowledge effort if the round shows they worked on it; call out
  drift honestly if the focus slipped during the round.

After the per-hole summaries, write one overall_summary: one strong observation about the round and one concrete takeaway for next time. Max 3 sentences for overall_summary.

Never use the words 'metric', 'session', 'feature', 'system', or 'data' in responses.

Respond ONLY with valid JSON in this exact format, no other text:
{
  "hole_summaries": [
    { "hole_number": 1, "summary": "..." },
    ...
  ],
  "overall_summary": "..."
}`;

interface HoleSummaryRequest {
  hole_number: number;
  par: number;
  score: number | null;
  plan_summary: string | null;
  shots_summary: string | null;
  variance: number | null;
}

interface CageContext {
  recent_sessions_count: number;
  primary_issues: Array<{ issue_name: string; severity: string; occurrence_count: number; session_date: string }>;
  drill_recommendations?: Array<{ drill_name: string; target_issue: string }>;
  most_recent_session_date?: string | null;
}

// Phase V Component 2 — Arena practice (Skills Challenge / CTP / Sim Round)
// is logged in pointsStore separately from cageStore. Surface it here so
// the recap can connect Arena work to on-course outcomes.
interface ArenaContext {
  recent_sessions_count: number;
  recent_sessions: Array<{ reason: string; points: number; date: string }>;
  most_recent_date?: string | null;
}

interface RecapRequest {
  player_name: string;
  course_name: string;
  mode: string;
  total_score: number;
  score_vs_par: number;
  holes_played: number;
  holes: HoleSummaryRequest[];
  pattern_insights: string[];
  // Phase U Component 1: recent cage practice context
  cage_context?: CageContext | null;
  // Phase U Component 2: user's pre-round focus notes
  pre_round_notes?: string | null;
  // Phase V Component 2: Arena practice context
  arena_context?: ArenaContext | null;
  // Phase BR Component 9 — active tutorial / practice context. Pre-formatted
  // by services/tutorialContext.buildFullPracticeContext on the client side.
  // Multi-line string when ≥1 tutorials are active, null otherwise.
  practice_context?: string | null;
  // Persona — 'male' (Kevin) or 'female' (Serena). Defaults to Kevin.
  voiceGender?: VoiceGender;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const raw = (req.body ?? {}) as Partial<RecapRequest>;

    if (!Array.isArray(raw.holes) || raw.holes.length === 0) {
      return res.status(400).json({ error: 'holes[] (non-empty array of hole summaries) required' });
    }
    if (typeof raw.course_name !== 'string' || !raw.course_name.trim()) {
      return res.status(400).json({ error: 'course_name (string) required' });
    }

    const body = raw as RecapRequest;
    if (!Array.isArray(body.pattern_insights)) body.pattern_insights = [];

    const modeLabel: Record<string, string> = {
      break_100: 'Break 100',
      break_90:  'Break 90',
      break_80:  'Break 80',
      free_play: 'Free Play',
    };

    const holesBlock = body.holes
      .map(h => {
        const scoreLine = h.score != null
          ? `Score: ${h.score} (${h.variance != null ? (h.variance > 0 ? '+' + h.variance : String(h.variance)) : '?'} vs plan)`
          : 'Score: not recorded';
        const planLine = h.plan_summary ? `Plan: ${h.plan_summary}` : 'Plan: none';
        const shotsLine = h.shots_summary ? `Shots: ${h.shots_summary}` : 'Shots: not tracked';
        return `Hole ${h.hole_number} (par ${h.par}):\n  ${scoreLine}\n  ${planLine}\n  ${shotsLine}`;
      })
      .join('\n\n');

    const patternBlock = body.pattern_insights.length > 0
      ? `\nPlayer patterns this round:\n${body.pattern_insights.map(i => '- ' + i).join('\n')}`
      : '';

    // Phase U Component 1 — recent cage practice context
    let cageBlock = '';
    if (body.cage_context && body.cage_context.recent_sessions_count > 0) {
      const c = body.cage_context;
      const issuesLine = c.primary_issues.length > 0
        ? c.primary_issues.map(i => `${i.issue_name} (severity ${i.severity}, ${i.occurrence_count} occurrences, ${i.session_date})`).join('; ')
        : 'no specific primary issue';
      const drillsLine = (c.drill_recommendations ?? []).length > 0
        ? (c.drill_recommendations ?? []).map(d => `${d.drill_name} → ${d.target_issue}`).join('; ')
        : 'no specific drill';
      cageBlock = `\nRecent practice (last 14 days, ${c.recent_sessions_count} cage session${c.recent_sessions_count > 1 ? 's' : ''}):\n  Issues worked on: ${issuesLine}\n  Drills targeted: ${drillsLine}\n  Connection logic: only mention practice if today's pattern signals genuinely correlate.`;
    }

    // Phase U Component 2 — pre-round focus notes
    const notesBlock = body.pre_round_notes && body.pre_round_notes.trim()
      ? `\nPre-round focus (user wrote): "${body.pre_round_notes.trim()}"\n  Treat as a coaching contract — acknowledge if the round showed evidence the user worked on this; call out honestly if focus drifted.`
      : '';

    // Phase V Component 2 — Arena practice context (Skills, CTP, Sim Round)
    let arenaBlock = '';
    if (body.arena_context && body.arena_context.recent_sessions_count > 0) {
      const a = body.arena_context;
      const sessionsLine = a.recent_sessions
        .slice(-5)
        .map(s => `${s.date}: ${s.reason} (+${s.points} pts)`)
        .join('; ');
      arenaBlock = `\nRecent Arena practice (last 14 days, ${a.recent_sessions_count} session${a.recent_sessions_count > 1 ? 's' : ''}):\n  ${sessionsLine}\n  Connection logic: only mention Arena work if today's pattern signals genuinely correlate (e.g. distance-control Skills work + tighter approach dispersion).`;
    }

    // Phase BR Component 9 — active tutorial practice context. Inject the
    // pre-formatted block so the recap can reinforce when shots applied
    // the practiced techniques (or honestly call out drift). Same honesty
    // bar as cage context: only cite when round signals support it.
    const practiceBlock = body.practice_context && body.practice_context.trim()
      ? `\n${body.practice_context.trim()}\n\nReinforcement logic for the recap: where round shots clearly applied a practiced technique, name the connection ("on those wedge approaches, you stayed low through impact like Marc's been teaching"). Where the round shows the player reverted to old patterns on the practiced clubs/situations, call it out honestly ("wedge approaches went back to the steeper attack — worth refocusing next round"). Don't fabricate connections; only cite when the shot data supports it.`
      : '';

    const userMessage = `Recap for ${body.player_name || 'the player'} at ${body.course_name}.
Mode: ${modeLabel[body.mode] ?? body.mode}
Total: ${body.total_score} (${body.score_vs_par >= 0 ? '+' : ''}${body.score_vs_par}) over ${body.holes_played} holes
${patternBlock}${cageBlock}${arenaBlock}${notesBlock}${practiceBlock}

${holesBlock}

Write per-hole summaries and an overall summary. Respond only with valid JSON as specified.`;

    console.log('[recap] generating for', body.course_name, body.mode, body.holes_played, 'holes');

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      system: buildRecapSystem(body.voiceGender ?? 'male'),
      messages: [{ role: 'user', content: userMessage }],
    });

    const block = response.content.find(b => b.type === 'text');
    const rawText = (block as { type: 'text'; text: string } | undefined)?.text ?? '';

    // Extract JSON — Claude sometimes wraps in ```json...```
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');

    const parsed = JSON.parse(jsonMatch[0]) as {
      hole_summaries: Array<{ hole_number: number; summary: string }>;
      overall_summary: string;
    };

    console.log('[recap] generated', parsed.hole_summaries.length, 'hole summaries');
    return res.status(200).json(parsed);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[recap] error:', msg);
    return res.status(500).json({ error: msg });
  }
}
