import * as FileSystem from 'expo-file-system/legacy';
import type { RoundRecap } from '../types/plan';
// 2026-06-04 — archivePlans / loadArchivedPlans removed with HolePlan.

// ─── Paths ────────────────────────────────────────────────────────────────────

const ARCHIVES_DIR = (FileSystem.documentDirectory ?? '') + 'round_archives/';

function roundDir(roundId: string): string {
  return ARCHIVES_DIR + roundId + '/';
}

async function ensureRoundDir(roundId: string): Promise<void> {
  const dir = roundDir(roundId);
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
}

// ─── Recap archive ────────────────────────────────────────────────────────────

export async function saveRecap(roundId: string, recap: RoundRecap): Promise<void> {
  try {
    await ensureRoundDir(roundId);
    await FileSystem.writeAsStringAsync(
      roundDir(roundId) + 'recap.json',
      JSON.stringify(recap),
    );
  } catch (e) {
    console.warn('[planStorage] saveRecap failed:', e);
  }
}

export async function loadRecap(roundId: string): Promise<RoundRecap | null> {
  try {
    const path = roundDir(roundId) + 'recap.json';
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    const raw = await FileSystem.readAsStringAsync(path);
    const recap = JSON.parse(raw) as RoundRecap;
    // Patch pre-v1 archived shots that lack outcome/penalty_strokes fields
    recap.hole_comparisons = (recap.hole_comparisons ?? []).map(hc => ({
      ...hc,
      actual_shots: (hc.actual_shots ?? []).map(s => ({
        ...s,
        outcome: s.outcome ?? 'clean',
        penalty_strokes: s.penalty_strokes ?? 0,
      })),
    }));
    return recap;
  } catch {
    return null;
  }
}

export async function listArchivedRecaps(): Promise<RoundRecap[]> {
  try {
    const info = await FileSystem.getInfoAsync(ARCHIVES_DIR);
    if (!info.exists) return [];
    const entries = await FileSystem.readDirectoryAsync(ARCHIVES_DIR);
    const recaps: RoundRecap[] = [];
    for (const entry of entries) {
      const r = await loadRecap(entry);
      if (r) recaps.push(r);
    }
    return recaps.sort((a, b) => b.ended_at - a.ended_at);
  } catch {
    return [];
  }
}
