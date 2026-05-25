/**
 * Tournament — leaderboard computation per format.
 *
 * Pure functions; read from the store snapshot, return derived
 * standings. UI calls these on render so the leaderboard reflects
 * the latest entered scores immediately.
 *
 * 2026-05-24 — Built for Tim's guys-weekend trip.
 */

import type {
  TournamentState,
  TournamentTeam,
  TournamentHole,
  TournamentFormat,
} from '../../store/tournamentStore';

export interface LeaderboardRow {
  teamId: string;
  teamName: string;
  /** Format-specific primary score. Stroke/scramble/best_ball/match_play = strokes;
   *  stableford = points; skins = skins won; match_play = holes-up vs the other team. */
  primary: number;
  /** Human-readable formatted version of `primary` for the row's right cell. */
  primaryDisplay: string;
  /** Secondary metric — usually "through N holes" or "vs par +/-N". */
  secondary: string;
  /** Higher-is-better? Stableford + Skins + Match Play = true; others = false. */
  highIsBetter: boolean;
  /** Per-hole detail for the format. Holes where this team has no entry
   *  yet are omitted. UI uses this for the expand-row drill-down. */
  holes: Array<{ hole: number; value: number | null; note?: string }>;
}

export interface LeaderboardResult {
  format: TournamentFormat;
  rows: LeaderboardRow[];
  /** Highest hole number any team has completed. Surfaces as "through 7"
   *  in the leaderboard header. */
  maxThrough: number;
}

// ─── helpers ────────────────────────────────────────────────────────

function teamScoreAt(state: TournamentState, teamId: string, hole: number): number | null {
  return state.teamScores[`${teamId}.${hole}`] ?? null;
}

function playerScoreAt(state: TournamentState, teamId: string, playerIdx: number, hole: number): number | null {
  return state.playerScores[`${teamId}.${playerIdx}.${hole}`] ?? null;
}

function activePlayerCount(team: TournamentTeam): number {
  return team.players.filter(p => p.trim().length > 0).length || team.players.length;
}

function holePar(state: TournamentState, hole: number): number {
  return state.holes.find(h => h.hole === hole)?.par ?? 4;
}

function stablefordForScore(state: TournamentState, hole: number, score: number): number {
  const par = holePar(state, hole);
  const delta = score - par;
  const sp = state.stablefordPoints;
  if (delta <= -2) return sp.eagle;
  if (delta === -1) return sp.birdie;
  if (delta === 0) return sp.par;
  if (delta === 1) return sp.bogey;
  return sp.doublePlus;
}

/** Best (lowest) score across active players for a team at a given hole.
 *  Returns null if no player has logged for that hole. */
function bestBallForTeam(state: TournamentState, team: TournamentTeam, hole: number): number | null {
  let best: number | null = null;
  const n = activePlayerCount(team);
  for (let p = 0; p < n; p++) {
    const v = playerScoreAt(state, team.id, p, hole);
    if (v == null) continue;
    if (best == null || v < best) best = v;
  }
  return best;
}

// ─── per-format computers ───────────────────────────────────────────

function rowsStrokeOrScramble(state: TournamentState): LeaderboardRow[] {
  return state.teams.map(t => {
    const holes: LeaderboardRow['holes'] = [];
    let total = 0;
    let parTotal = 0;
    for (const h of state.holes) {
      const v = teamScoreAt(state, t.id, h.hole);
      holes.push({ hole: h.hole, value: v });
      if (v != null) { total += v; parTotal += h.par; }
    }
    const through = holes.filter(h => h.value != null).length;
    const vsPar = total - parTotal;
    return {
      teamId: t.id,
      teamName: t.name,
      primary: total,
      primaryDisplay: total === 0 ? '—' : `${total}`,
      secondary: through === 0 ? 'no holes scored' : `thru ${through} · ${vsPar > 0 ? '+' : vsPar < 0 ? '' : 'E'}${vsPar !== 0 ? vsPar : ''}`,
      highIsBetter: false,
      holes,
    };
  });
}

function rowsBestBall(state: TournamentState): LeaderboardRow[] {
  return state.teams.map(t => {
    const holes: LeaderboardRow['holes'] = [];
    let total = 0;
    let parTotal = 0;
    for (const h of state.holes) {
      const best = bestBallForTeam(state, t, h.hole);
      holes.push({ hole: h.hole, value: best });
      if (best != null) { total += best; parTotal += h.par; }
    }
    const through = holes.filter(h => h.value != null).length;
    const vsPar = total - parTotal;
    return {
      teamId: t.id,
      teamName: t.name,
      primary: total,
      primaryDisplay: total === 0 ? '—' : `${total}`,
      secondary: through === 0 ? 'no holes scored' : `thru ${through} · best-ball ${vsPar > 0 ? '+' : vsPar < 0 ? '' : 'E'}${vsPar !== 0 ? vsPar : ''}`,
      highIsBetter: false,
      holes,
    };
  });
}

function rowsStableford(state: TournamentState): LeaderboardRow[] {
  return state.teams.map(t => {
    const n = activePlayerCount(t);
    const holes: LeaderboardRow['holes'] = [];
    let totalPts = 0;
    let scoredHoles = 0;
    for (const h of state.holes) {
      let holePts = 0;
      let anyScored = false;
      for (let p = 0; p < n; p++) {
        const v = playerScoreAt(state, t.id, p, h.hole);
        if (v == null) continue;
        holePts += stablefordForScore(state, h.hole, v);
        anyScored = true;
      }
      holes.push({ hole: h.hole, value: anyScored ? holePts : null });
      if (anyScored) { totalPts += holePts; scoredHoles++; }
    }
    return {
      teamId: t.id,
      teamName: t.name,
      primary: totalPts,
      primaryDisplay: `${totalPts} pts`,
      secondary: scoredHoles === 0 ? 'no holes scored' : `thru ${scoredHoles}`,
      highIsBetter: true,
      holes,
    };
  });
}

function rowsSkins(state: TournamentState): LeaderboardRow[] {
  // Skins: lowest individual gross per hole wins the skin. Ties carry the
  // skin to the next hole. We accumulate skins per team here; the row's
  // primary metric is "skins won".
  const skinsByTeam: Record<string, number> = {};
  const holeAttribByTeam: Record<string, Array<{ hole: number; value: number | null; note?: string }>> = {};
  for (const t of state.teams) {
    skinsByTeam[t.id] = 0;
    holeAttribByTeam[t.id] = state.holes.map(h => ({ hole: h.hole, value: null }));
  }

  let carry = 0;
  for (const h of state.holes) {
    let bestScore: number | null = null;
    let winners: Array<{ teamId: string; playerIdx: number; score: number }> = [];
    for (const t of state.teams) {
      const n = activePlayerCount(t);
      for (let p = 0; p < n; p++) {
        const v = playerScoreAt(state, t.id, p, h.hole);
        if (v == null) continue;
        if (bestScore == null || v < bestScore) {
          bestScore = v;
          winners = [{ teamId: t.id, playerIdx: p, score: v }];
        } else if (v === bestScore) {
          winners.push({ teamId: t.id, playerIdx: p, score: v });
        }
      }
    }
    if (bestScore == null) continue; // hole not scored
    // Resolve: if exactly one winner, they take 1 + carry. Otherwise carry++.
    const uniqueTeams = new Set(winners.map(w => w.teamId));
    if (winners.length === 1 || uniqueTeams.size === 1) {
      const teamId = winners[0].teamId;
      const skins = 1 + carry;
      skinsByTeam[teamId] += skins;
      holeAttribByTeam[teamId] = holeAttribByTeam[teamId].map(r =>
        r.hole === h.hole ? { ...r, value: skins, note: carry > 0 ? `+${carry} carryover` : undefined } : r,
      );
      carry = 0;
    } else {
      carry += 1;
      // Mark every winning team's hole as a tied carry
      for (const t of state.teams) {
        holeAttribByTeam[t.id] = holeAttribByTeam[t.id].map(r =>
          r.hole === h.hole ? { ...r, value: 0, note: 'tied → carry' } : r,
        );
      }
    }
  }
  return state.teams.map(t => {
    const skinsWon = skinsByTeam[t.id];
    return {
      teamId: t.id,
      teamName: t.name,
      primary: skinsWon,
      primaryDisplay: `${skinsWon} skin${skinsWon === 1 ? '' : 's'}`,
      secondary: carry > 0 ? `${carry} carrying` : '',
      highIsBetter: true,
      holes: holeAttribByTeam[t.id],
    };
  });
}

function rowsMatchPlay(state: TournamentState): LeaderboardRow[] {
  // Match Play in v1 is strictly head-to-head between team[0] and team[1].
  // For each hole both teams entered, lower wins (1 hole up); equal halves.
  // Row primary = "holes up" net (positive = up, negative = down).
  if (state.teams.length < 2) return rowsStrokeOrScramble(state); // safety
  const a = state.teams[0];
  const b = state.teams[1];
  let netAB = 0; // positive = a up
  const holesA: LeaderboardRow['holes'] = [];
  const holesB: LeaderboardRow['holes'] = [];
  let through = 0;
  for (const h of state.holes) {
    const av = teamScoreAt(state, a.id, h.hole);
    const bv = teamScoreAt(state, b.id, h.hole);
    if (av == null || bv == null) {
      holesA.push({ hole: h.hole, value: null });
      holesB.push({ hole: h.hole, value: null });
      continue;
    }
    through++;
    if (av < bv) { netAB += 1; holesA.push({ hole: h.hole, value: 1, note: 'won' }); holesB.push({ hole: h.hole, value: -1, note: 'lost' }); }
    else if (av > bv) { netAB -= 1; holesA.push({ hole: h.hole, value: -1, note: 'lost' }); holesB.push({ hole: h.hole, value: 1, note: 'won' }); }
    else { holesA.push({ hole: h.hole, value: 0, note: 'halved' }); holesB.push({ hole: h.hole, value: 0, note: 'halved' }); }
  }
  const fmt = (n: number) => n === 0 ? 'AS' : (n > 0 ? `${n} UP` : `${Math.abs(n)} DN`);
  return [
    {
      teamId: a.id,
      teamName: a.name,
      primary: netAB,
      primaryDisplay: fmt(netAB),
      secondary: through === 0 ? 'no holes' : `thru ${through}`,
      highIsBetter: true,
      holes: holesA,
    },
    {
      teamId: b.id,
      teamName: b.name,
      primary: -netAB,
      primaryDisplay: fmt(-netAB),
      secondary: through === 0 ? 'no holes' : `thru ${through}`,
      highIsBetter: true,
      holes: holesB,
    },
  ];
}

// ─── dispatcher ─────────────────────────────────────────────────────

export function computeLeaderboard(state: TournamentState): LeaderboardResult {
  let rows: LeaderboardRow[];
  switch (state.format) {
    case 'stroke':
    case 'scramble':
      rows = rowsStrokeOrScramble(state);
      break;
    case 'best_ball':
      rows = rowsBestBall(state);
      break;
    case 'stableford':
      rows = rowsStableford(state);
      break;
    case 'skins':
      rows = rowsSkins(state);
      break;
    case 'match_play':
      rows = rowsMatchPlay(state);
      break;
  }
  const sorted = [...rows].sort((x, y) => {
    if (x.highIsBetter) return y.primary - x.primary;
    // Stroke-based: teams with NO scores (primary === 0) sort to the bottom
    // so a team that hasn't started doesn't fake-lead at 0.
    if (x.primary === 0 && y.primary !== 0) return 1;
    if (y.primary === 0 && x.primary !== 0) return -1;
    return x.primary - y.primary;
  });
  let maxThrough = 0;
  for (const r of rows) {
    const through = r.holes.filter(h => h.value != null).length;
    if (through > maxThrough) maxThrough = through;
  }
  return { format: state.format, rows: sorted, maxThrough };
}

/** Render the leaderboard as a shareable plain-text card. */
export function leaderboardAsText(state: TournamentState, result: LeaderboardResult): string {
  const lines: string[] = [];
  const formatName: Record<TournamentFormat, string> = {
    stroke: 'Stroke Play',
    scramble: 'Scramble',
    best_ball: 'Best Ball',
    stableford: 'Stableford',
    skins: 'Skins',
    match_play: 'Match Play',
  };
  lines.push(`🏌️ ${state.label || 'Tournament'} — ${formatName[state.format]}`);
  if (state.courseName) lines.push(state.courseName);
  lines.push(`Through ${result.maxThrough} of 18`);
  lines.push('');
  result.rows.forEach((r, i) => {
    const place = `${i + 1}.`;
    lines.push(`${place} ${r.teamName}  ·  ${r.primaryDisplay}  ${r.secondary ? '(' + r.secondary + ')' : ''}`.trim());
  });
  lines.push('');
  lines.push('via SmartPlay Caddie');
  return lines.join('\n');
}
