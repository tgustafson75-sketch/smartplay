/**
 * 2026-06-04 — Kevin's Read (AI prevailing-tendency assessment).
 *
 * Called from the dashboard via services/kevinReadService AFTER endRound
 * fires or when the user explicitly taps the Kevin's Read card to
 * regenerate. Never called on cold launch or mid-round.
 *
 * Input shape:
 *   { recentShots: ShotResultLite[], recentRounds: RoundLite[] }
 *
 * Both arrays are caller-trimmed (~last 5 rounds + their shots) so
 * the request body stays small (Haiku doesn't need much context to
 * surface dominant tendencies).
 *
 * Output: 2-3 sentence Kevin-voice assessment. On any failure path
 * (missing API key, network error, model returns empty) we fall back
 * to one of five default fallback lines picked randomly so the user
 * always sees a real string.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { completeText, providerFromHeader } from './_aiProvider';

const SYSTEM_PROMPT = `You are Kevin, an elite AI golf caddie. Based on this player's recent round data, give a 2-3 sentence honest prevailing tendency assessment. Speak directly to the player in Kevin's voice — confident, direct, encouraging. Focus on patterns: what's working, what's costing strokes, one actionable tendency. No bullet points. Natural speech. Never quote the data verbatim; talk about it like a caddie noticing patterns walking next to the player.`;

const DEFAULT_FALLBACKS = [
  'Swing easy, hit it far. Play one shot at a time.',
  'The game rewards patience. Build your round hole by hole.',
  'Trust your preparation. One shot at a time.',
  'Stay in the present. The scorecard takes care of itself.',
  'Good things happen when you commit to the shot.',
] as const;

function pickFallback(): string {
  return DEFAULT_FALLBACKS[Math.floor(Math.random() * DEFAULT_FALLBACKS.length)];
}

interface ShotLite {
  hole?: number;
  club?: string | null;
  direction?: string | null;
  feel?: string | null;
  outcome?: string | null;
  distance_yards?: number | null;
  carry_distance?: number | null;
  shot_in_hole_index?: number | null;
}

interface RoundLite {
  totalScore: number;
  scoreVsPar?: number;
  holesPlayed?: number;
  mode?: string;
  courseName?: string | null;
  endedAt?: number;
}

interface KevinReadRequest {
  shots?: ShotLite[];
  rounds?: RoundLite[];
}

function summarizeShots(shots: ShotLite[]): string {
  if (shots.length === 0) return 'No shots tracked yet.';
  const total = shots.length;
  const dirCount: Record<string, number> = {};
  const feelCount: Record<string, number> = {};
  const clubYards: Record<string, number[]> = {};
  let teeShots = 0;
  let teeStraight = 0;
  for (const s of shots) {
    if (s.direction) dirCount[s.direction] = (dirCount[s.direction] ?? 0) + 1;
    if (s.feel) feelCount[s.feel] = (feelCount[s.feel] ?? 0) + 1;
    const club = s.club ?? null;
    const dist = s.carry_distance ?? s.distance_yards ?? null;
    if (club && typeof dist === 'number' && dist > 0) {
      (clubYards[club] = clubYards[club] ?? []).push(dist);
    }
    if (s.shot_in_hole_index === 1) {
      teeShots += 1;
      if (s.direction === 'straight') teeStraight += 1;
    }
  }
  const dirSummary = Object.entries(dirCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([d, c]) => `${d} ${c}`)
    .join(', ');
  const feelSummary = Object.entries(feelCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([f, c]) => `${f} ${c}`)
    .join(', ');
  const clubAvgs = Object.entries(clubYards)
    .map(([c, ys]) => `${c} avg ${Math.round(ys.reduce((a, b) => a + b, 0) / ys.length)}y (${ys.length} shots)`)
    .slice(0, 5)
    .join('; ');
  const fairwayRate = teeShots > 0 ? Math.round((teeStraight / teeShots) * 100) : null;
  return [
    `Total shots tracked: ${total}.`,
    dirSummary ? `Directional mix: ${dirSummary}.` : '',
    feelSummary ? `Contact mix: ${feelSummary}.` : '',
    clubAvgs ? `Club distances: ${clubAvgs}.` : '',
    fairwayRate != null ? `Tee-shot straight rate: ${fairwayRate}%.` : '',
  ].filter(Boolean).join(' ');
}

function summarizeRounds(rounds: RoundLite[]): string {
  if (rounds.length === 0) return 'No completed rounds yet.';
  const lines = rounds.map((r, i) => {
    const vsPar = r.scoreVsPar != null
      ? (r.scoreVsPar === 0 ? 'E' : r.scoreVsPar > 0 ? `+${r.scoreVsPar}` : String(r.scoreVsPar))
      : '?';
    const holes = r.holesPlayed != null ? `${r.holesPlayed}h` : '';
    const mode = r.mode ? ` (${r.mode})` : '';
    return `Round ${i + 1}: ${r.totalScore} (${vsPar} vs par)${holes ? ', ' + holes : ''}${mode}`;
  });
  return lines.join('. ');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Mirrors api/kevin warmup pattern so services/voiceWarmup could
  // optionally also warm this endpoint later. ~$0.00005 per warmup.
  if (req.body?.mode === 'warmup' || req.query?.mode === 'warmup') {
    const warmProvider = providerFromHeader(req.headers as Record<string, string | string[] | undefined>);
    await completeText(warmProvider, 'fast', 'ping', [{ role: 'user', content: 'ping' }], { maxTokens: 1 }).catch(() => {});
    return res.status(200).json({ ok: true, mode: 'warmup' });
  }

  try {
    const body = (req.body ?? {}) as KevinReadRequest;
    const shots = Array.isArray(body.shots) ? body.shots : [];
    const rounds = Array.isArray(body.rounds) ? body.rounds : [];

    // No data → return a random Kevin-voice fallback line.
    if (shots.length === 0 && rounds.length === 0) {
      return res.status(200).json({ text: pickFallback(), source: 'fallback_empty' });
    }

    const userPrompt = [
      'Recent rounds:',
      summarizeRounds(rounds),
      '',
      'Recent shots across those rounds:',
      summarizeShots(shots),
    ].join('\n');

    const provider = providerFromHeader(req.headers as Record<string, string | string[] | undefined>);
    const text = await completeText(provider, 'fast', SYSTEM_PROMPT, [{ role: 'user', content: userPrompt }], { maxTokens: 200 });

    if (!text) {
      return res.status(200).json({ text: pickFallback(), source: 'fallback_empty_response' });
    }

    return res.status(200).json({ text, source: provider });
  } catch (e) {
    console.log('[kevin-read] handler error (returning fallback):', e instanceof Error ? e.message : e);
    return res.status(200).json({ text: pickFallback(), source: 'fallback_error' });
  }
}
