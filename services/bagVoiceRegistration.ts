/**
 * 2026-08-08 (Tim — "in onboarding and in general I should be able to TELL the caddie what's in my bag
 * and current yardages and it gets registered correctly").
 *
 * ONE seam that turns spoken bag facts into the canonical stores, used by BOTH voice paths:
 *   - the brain's `register_bag` tool (rich sentences: "driver, three wood, five through pitching
 *     wedge, fifty-six and sixty" — the model expands ranges into individual club phrases first)
 *   - the offline precheck handler ("my 7-iron goes 165")
 *
 * Writes:
 *   - clubBagStore.registerClub(id, { source: 'voice' })  → bag membership (the brain then ONLY
 *     recommends clubs he actually carries — pipecat prompt reads registered_clubs)
 *   - clubStatsStore.setManual(name, yds)                 → stated CARRY (the honest-carry chain the
 *     brain's club_distances reads); kind 'total' → recordTotal (tee→rest ladder)
 *
 * HONEST: unparseable phrases are returned in `missed` (the caddie asks, never guesses); yardages are
 * plausibility-clamped (30–400) so "my driver goes 12" can't corrupt the bag the caddie quotes.
 */

import { parseSpokenClub, clubLabel } from './clubRecognition';
import { normalizeClub } from './clubNormalize';
import { useClubBagStore } from '../store/clubBagStore';
import { useClubStatsStore, type ClubName } from '../store/clubStatsStore';

export interface SpokenBagInput {
  /** Verbatim club phrases the player says they CARRY ("driver", "3 wood", "56 degree"). */
  clubs?: string[] | null;
  /** Stated distances ("7 iron" → 165). kind defaults to carry (what a golfer states as "goes"). */
  distances?: { club: string; yards: number; kind?: 'carry' | 'total' | null }[] | null;
}

export interface BagRegistrationResult {
  registered: string[];          // club labels added to the bag
  distancesSet: { label: string; yards: number; kind: 'carry' | 'total' }[];
  missed: string[];              // phrases we could not resolve — the caddie should ask
  confirmLine: string;           // natural one-line confirmation ('' when nothing landed)
}

export function registerBagFromSpeech(input: SpokenBagInput): BagRegistrationResult {
  const registered: string[] = [];
  const distancesSet: { label: string; yards: number; kind: 'carry' | 'total' }[] = [];
  const missed: string[] = [];

  const bag = useClubBagStore.getState();
  const stats = useClubStatsStore.getState();

  for (const phrase of input.clubs ?? []) {
    const p = String(phrase ?? '').trim();
    if (!p) continue;
    const parsed = parseSpokenClub(p);
    if (parsed) {
      bag.registerClub(parsed.club_id, { source: 'voice' });
      registered.push(clubLabel(parsed.club_id));
    } else {
      missed.push(p);
    }
  }

  for (const d of input.distances ?? []) {
    const p = String(d?.club ?? '').trim();
    const yds = Math.round(Number(d?.yards));
    if (!p || !Number.isFinite(yds)) continue;
    if (yds < 30 || yds > 400) { missed.push(`${p} ${d?.yards}`); continue; }
    const parsed = parseSpokenClub(p);
    if (!parsed) { missed.push(p); continue; }
    // Stating a yardage implies the club is in the bag — register it too (idempotent).
    bag.registerClub(parsed.club_id, { source: 'voice' });
    const name = (normalizeClub(parsed.club_id) ?? clubLabel(parsed.club_id)) as ClubName;
    const kind: 'carry' | 'total' = d?.kind === 'total' ? 'total' : 'carry';
    if (kind === 'total') stats.recordTotal(name, yds);
    else stats.setManual(name, yds);
    distancesSet.push({ label: clubLabel(parsed.club_id), yards: yds, kind });
  }

  const bits: string[] = [];
  if (registered.length > 0 && distancesSet.length === 0) {
    bits.push(`${registered.length} club${registered.length > 1 ? 's' : ''} in the bag: ${registered.join(', ')}`);
  } else if (registered.length > 0) {
    bits.push(`${registered.length} club${registered.length > 1 ? 's' : ''} registered`);
  }
  for (const d of distancesSet) bits.push(`${d.label} at ${d.yards}${d.kind === 'total' ? ' total' : ''}`);
  const confirmLine = bits.length > 0 ? `Got it — ${bits.join(', ')}.` : '';
  return { registered, distancesSet, missed, confirmLine };
}
