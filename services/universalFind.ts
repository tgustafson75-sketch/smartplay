/**
 * 2026-07-25 (Tim — the whole point of the app: "ask the Caddie to FIND anything of MINE").
 *
 * A universal retrieval index over the user's OWN data — past rounds/recaps + saved swings — so the
 * caddie can answer "pull up my last scorecard", "find my round at Mines", "show my driver swings".
 * Pure, offline, deterministic: reads the local stores, ranks by relevance (query-word overlap) then
 * recency, and returns each hit with a route the caddie can open. Courses are handled by the existing
 * open_course intent; scorecard-photo ingest is a separate flow — this is the find/open backbone.
 */
import { useRoundStore } from '../store/roundStore';
import { useCageStore } from '../store/cageStore';

export type FindKind = 'round' | 'swing';

export interface FindResult {
  kind: FindKind;
  id: string;
  label: string;   // human line, e.g. "Mines — 82 (+12) · Jul 24"
  route: string;   // where to open it
  ts: number;      // recency (epoch ms)
  score: number;   // relevance rank
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(ts: number): string {
  if (!ts || !Number.isFinite(ts)) return '';
  try { const d = new Date(ts); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; } catch { return ''; }
}
function fmtVsPar(v: number | null | undefined): string {
  if (v == null) return '';
  return v === 0 ? 'E' : v > 0 ? `+${v}` : `${v}`;
}
function safe<T>(fn: () => T): T | null { try { return fn(); } catch { return null; } }

// Relevance = how many meaningful query tokens appear in the item's haystack. Short filler words
// ("my", "the", "pull", "up", "show", "find") are ignored so they don't inflate every item equally.
const STOP = new Set(['my', 'the', 'a', 'an', 'pull', 'up', 'bring', 'find', 'show', 'me', 'open', 'get', 'see', 'round', 'rounds', 'swing', 'swings', 'scorecard', 'recap', 'last', 'latest', 'recent', 'from', 'at', 'of', 'on', 'for']);
function relevance(q: string, hay: string): number {
  const toks = q.split(/\s+/).map((w) => w.replace(/[^a-z0-9]/gi, '')).filter((w) => w.length >= 3 && !STOP.has(w));
  if (toks.length === 0) return 0;
  let n = 0;
  for (const t of toks) if (hay.includes(t)) n++;
  return n;
}

/**
 * Search the user's own rounds + swings. `rawQuery` is the free-text ask ("my last round at Mines").
 * Returns ranked results (best first). Empty query → the most recent items of each kind.
 */
export function universalFind(rawQuery: string, limit = 6): FindResult[] {
  const q = (rawQuery || '').toLowerCase().trim();
  const wantsRecent = /\b(last|latest|recent|most\s+recent)\b/.test(q);
  const kindRound = /\b(round|scorecard|recap|score)\b/.test(q);
  const kindSwing = /\b(swing|swings)\b/.test(q);
  const out: FindResult[] = [];

  const rounds = safe(() => useRoundStore.getState().roundHistory) ?? [];
  for (const r of rounds) {
    const course = (r.courseName ?? 'Round').trim();
    const dateStr = fmtDate(r.startedAt);
    const hay = `${course} round scorecard recap ${dateStr}`.toLowerCase();
    const rel = relevance(q, hay);
    if (q === '' || rel > 0 || kindRound) {
      const label = `${course} — ${r.totalScore}${r.scoreVsPar != null ? ` (${fmtVsPar(r.scoreVsPar)})` : ''}${dateStr ? ` · ${dateStr}` : ''}`;
      out.push({ kind: 'round', id: r.id, label, route: `/recap/${r.id}`, ts: r.startedAt, score: rel * 10 + (kindRound ? 3 : 0) });
    }
  }

  const sessions = safe(() => useCageStore.getState().sessionHistory) ?? [];
  for (const s of sessions) {
    const dateStr = fmtDate(s.date);
    const hay = `${s.club} swing ${s.captureKind ?? ''} ${dateStr}`.toLowerCase();
    const rel = relevance(q, hay);
    if (q === '' || rel > 0 || kindSwing) {
      out.push({ kind: 'swing', id: s.id, label: `${s.club} swing${dateStr ? ` · ${dateStr}` : ''}`, route: `/swinglab/swing/${s.id}`, ts: s.date, score: rel * 10 + (kindSwing ? 3 : 0) });
    }
  }

  // Best relevance first; recency breaks ties (and dominates when the ask is "last/latest/recent").
  out.sort((a, b) => (wantsRecent ? (b.ts - a.ts) || (b.score - a.score) : (b.score - a.score) || (b.ts - a.ts)));
  return out.slice(0, Math.max(1, limit));
}
