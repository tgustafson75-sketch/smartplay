/**
 * 2026-10-14 (Tim — "prep JSON data to import export between the two apps"). SmartBay AI ↔ SmartPlay
 * Caddie exchange, v1. The bridge until Caddie 2.0 hosts the bay inside SwingLab as the AI Caddie
 * module and imports @smartbay/bay-core directly.
 *
 * AUTHORITY: smartbay-ai/packages/bay-core/src/exchange.ts and smartbay-ai/docs/EXCHANGE.md. The two
 * format interfaces and both parsers below are a copy of that file (the RN app cannot import the bay
 * monorepo yet). __tests__/logic/bay-exchange.test.ts parses the SAME example files the bay's own
 * tests parse, so a drift between the copies goes red on both sides.
 *
 *   smartplay/bay-lesson  bay → Caddie   a finished bay lesson, saved from the golfer's QR report
 *   smartplay/player      Caddie → bay   this player's profile + fault tendencies
 *
 * Instructor bias stays in the bay (Tim, 2026-10-14): an imported lesson is recorded as what was
 * measured and taught, labelled by the fix, never by the instructor.
 */

import { usePracticeSessionStore } from '../store/practiceSessionStore';
import { useBayLessonStore } from '../store/bayLessonStore';

export const BAY_LESSON_FORMAT = 'smartplay/bay-lesson';
export const PLAYER_FORMAT = 'smartplay/player';

/** The app's primary_fault vocabulary (store/swingSessionStore.ts PrimaryIssue.primary_fault). */
export const BAY_FAULTS = [
  'over_the_top', 'early_extension', 'casting', 'sway', 'reverse_pivot', 'chicken_wing',
  'plane_too_flat', 'plane_too_steep', 'head_movement', 'spine_angle_loss', 'lead_arm_bent', 'poor_finish',
] as const;
export type BayFault = (typeof BAY_FAULTS)[number];
export type BaySeverity = 'minor' | 'moderate' | 'significant';
/** The bay's coach id. Recorded, never used here: Caddie stays instructor-neutral. */
export type BayCoach = string;

export interface BayLessonExport {
  format: typeof BAY_LESSON_FORMAT;
  version: 1;
  exportedAt: number;
  source: { app: 'smartbay-ai'; bay: string; coach: BayCoach };
  player: { installId: string; playerId: string } | null;
  lesson: {
    at: number;
    focus: string | null;
    swings: number;
    targetFault: BayFault | null;
    target: { label: string; cue: string } | null;
    /** Bay drill id — Caddie has no drill with these ids, so name/how/reps are what it shows. */
    drill: { id: string; name: string; how: string; reps: number } | null;
    findings: { label: string; detail: string; status: string }[];
    compare: { label: string; before: number | null; after: number | null; unit: string; improved: boolean | null }[];
  };
  shots?: {
    id: string;
    swingAt: number;
    tempo: number | null;
    faults: { fault: BayFault; severity: BaySeverity }[];
    sim: { carry: number | null; ballSpeed: number | null; launch: number | null; spin: number | null; offline: number | null; club?: string } | null;
  }[];
}

export interface PlayerExport {
  format: typeof PLAYER_FORMAT;
  version: 1;
  exportedAt: number;
  source: { app: 'smartplay-caddie'; appVersion?: string };
  player: {
    installId: string | null;
    playerId: string;
    firstName: string | null;
    handedness: 'right' | 'left';
    handicapIndex: number | null;
    dominantMiss: 'left' | 'right' | 'straight' | null;
    goal: string | null;
  };
  tendencies: { fault: BayFault; count: number }[];
}

// ── Parsers: anything not exactly the format comes back null, never a crash. ──

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const numOrNull = (x: unknown) => x === null || isNum(x);
const strOrNull = (x: unknown) => x === null || isStr(x);
const isFault = (x: unknown): x is BayFault => isStr(x) && (BAY_FAULTS as readonly string[]).includes(x);
const isCoach = (x: unknown): x is BayCoach => isStr(x) && x.length > 0;
const isSeverity = (x: unknown): x is BaySeverity => x === 'minor' || x === 'moderate' || x === 'significant';

function asJson(input: unknown): unknown {
  if (!isStr(input)) return input;
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function okShot(x: unknown): boolean {
  if (!isObj(x) || !isStr(x.id) || !isNum(x.swingAt) || !numOrNull(x.tempo) || !Array.isArray(x.faults)) return false;
  if (!x.faults.every((f) => isObj(f) && isFault(f.fault) && isSeverity(f.severity))) return false;
  if (x.sim === null) return true;
  const s = x.sim;
  return isObj(s) && ['carry', 'ballSpeed', 'launch', 'spin', 'offline'].every((k) => numOrNull(s[k])) && (s.club === undefined || isStr(s.club));
}

export function parseBayLesson(input: unknown): BayLessonExport | null {
  const j = asJson(input);
  if (!isObj(j) || j.format !== BAY_LESSON_FORMAT || j.version !== 1 || !isNum(j.exportedAt)) return null;
  const src = j.source;
  if (!isObj(src) || src.app !== 'smartbay-ai' || !isStr(src.bay) || !isCoach(src.coach)) return null;
  const p = j.player;
  if (!(p === null || (isObj(p) && isStr(p.installId) && isStr(p.playerId)))) return null;
  const l = j.lesson;
  if (!isObj(l) || !isNum(l.at) || !strOrNull(l.focus) || !isNum(l.swings)) return null;
  if (!(l.targetFault === null || isFault(l.targetFault))) return null;
  if (!(l.target === null || (isObj(l.target) && isStr(l.target.label) && isStr(l.target.cue)))) return null;
  const d = l.drill;
  if (!(d === null || (isObj(d) && isStr(d.id) && isStr(d.name) && isStr(d.how) && isNum(d.reps)))) return null;
  if (!Array.isArray(l.findings) || !l.findings.every((f) => isObj(f) && isStr(f.label) && isStr(f.detail) && isStr(f.status))) return null;
  if (!Array.isArray(l.compare) || !l.compare.every((c) => isObj(c) && isStr(c.label) && numOrNull(c.before) && numOrNull(c.after) && isStr(c.unit))) return null;
  if (j.shots !== undefined && !(Array.isArray(j.shots) && j.shots.every(okShot))) return null;
  return j as unknown as BayLessonExport;
}

export function parsePlayer(input: unknown): PlayerExport | null {
  const j = asJson(input);
  if (!isObj(j) || j.format !== PLAYER_FORMAT || j.version !== 1 || !isNum(j.exportedAt)) return null;
  if (!isObj(j.source) || j.source.app !== 'smartplay-caddie') return null;
  const p = j.player;
  if (!isObj(p) || !strOrNull(p.installId) || !isStr(p.playerId) || !p.playerId) return null;
  if (!strOrNull(p.firstName) || !(p.handedness === 'right' || p.handedness === 'left') || !numOrNull(p.handicapIndex)) return null;
  if (!(p.dominantMiss === null || p.dominantMiss === 'left' || p.dominantMiss === 'right' || p.dominantMiss === 'straight') || !strOrNull(p.goal)) return null;
  if (!Array.isArray(j.tendencies) || !j.tendencies.every((t) => isObj(t) && isFault(t.fault) && isNum(t.count))) return null;
  return j as unknown as PlayerExport;
}

// ── Import: bay lesson → this app ──

/** The practice-history label. Named by the fix, never by the instructor. */
export function bayLessonLabel(x: BayLessonExport): string {
  return x.lesson.target ? `SmartBay lesson · ${x.lesson.target.label}` : 'SmartBay lesson';
}

export type BayImportResult =
  | { ok: true; label: string; duplicate: false }
  | { ok: true; label: string; duplicate: true }
  | { ok: false; reason: 'not_a_bay_lesson' | 'other_player' };

/**
 * Write one parsed lesson. Exactly one practice-history record (environment 'bay', focus null so
 * it can never tick a SmartPlan day — the bay's focus is a label, not a plan focus id), dated at the
 * lesson, plus the export itself in bayLessonStore for SwingLab. The label reaches the caddie brain
 * through practiceFocusBlock, which reads a session's label when it has no focus.
 */
export function importBayLesson(x: BayLessonExport, activePlayerId: string): BayImportResult {
  if (x.player && x.player.playerId !== activePlayerId) return { ok: false, reason: 'other_player' };
  const label = bayLessonLabel(x);
  if (!useBayLessonStore.getState().add(x)) return { ok: true, label, duplicate: true };
  usePracticeSessionStore.getState().recordCompletedSession({
    kind: 'focus',
    focus: null,
    drillId: null,
    label,
    swingCount: x.lesson.swings,
    environment: 'bay',
    at: x.lesson.at,
    swingSamples: (x.shots ?? [])
      .filter((s) => s.tempo != null)
      .map((s) => ({ club: s.sim?.club ?? null, tier: 'none' as const, tempoRatio: s.tempo, divergenceDeg: null })),
  });
  return { ok: true, label, duplicate: false };
}

/** The whole import interaction, including what the player is told. Never throws. */
export async function importBayLessonWithFeedback(): Promise<void> {
  const toast = (m: string) => (require('../store/toastStore') as typeof import('../store/toastStore')).useToastStore.getState().show(m);
  try {
    const DocumentPicker = await import('expo-document-picker');
    const picked = await DocumentPicker.getDocumentAsync({ type: ['application/json', '*/*'], copyToCacheDirectory: true });
    if (picked.canceled || !picked.assets?.[0]?.uri) return;
    const FS = await import('expo-file-system/legacy');
    const raw = await FS.readAsStringAsync(picked.assets[0].uri, { encoding: FS.EncodingType.UTF8 });
    const lesson = parseBayLesson(raw);
    if (!lesson) {
      toast('That isn’t a SmartBay lesson file. Save it from your SmartBay report and try again.');
      return;
    }
    const { derivePlayerId } = require('../store/swingSessionStore') as typeof import('../store/swingSessionStore');
    const r = importBayLesson(lesson, derivePlayerId());
    if (!r.ok) {
      toast('That lesson was saved for a different player on this phone. Switch to that player and import it again.');
      return;
    }
    toast(r.duplicate ? 'That SmartBay lesson is already in your practice history.' : `Added “${r.label}” to your practice history.`);
  } catch (e) {
    console.log('[bayExchange] import failed:', e);
    toast('That file couldn’t be read.');
  }
}

// ── Export: this player → the bay ──

/** Fault counts across this player's analysed swing sessions, worst first. */
export function tendenciesFrom(sessions: readonly { player_id?: string; primary_issue?: { primary_fault?: string | null } | null }[], playerId: string): PlayerExport['tendencies'] {
  const counts = new Map<BayFault, number>();
  for (const s of sessions) {
    if ((s.player_id ?? playerId) !== playerId) continue;
    const f = s.primary_issue?.primary_fault;
    if (isFault(f)) counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  return [...counts.entries()].map(([fault, count]) => ({ fault, count })).sort((a, b) => b.count - a.count);
}

export async function buildPlayerExport(nowMs: number): Promise<PlayerExport> {
  const { usePlayerProfileStore } = require('../store/playerProfileStore') as typeof import('../store/playerProfileStore');
  const { useSwingSessionStore, derivePlayerId } = require('../store/swingSessionStore') as typeof import('../store/swingSessionStore');
  const { getInstallId } = require('./installId') as typeof import('./installId');
  const Constants = (require('expo-constants') as typeof import('expo-constants')).default;
  const p = usePlayerProfileStore.getState();
  const playerId = derivePlayerId();
  return {
    format: PLAYER_FORMAT,
    version: 1,
    exportedAt: nowMs,
    source: { app: 'smartplay-caddie', appVersion: Constants.expoConfig?.version ?? undefined },
    player: {
      installId: await getInstallId(),
      playerId,
      firstName: p.firstName?.trim() || null,
      handedness: p.handedness === 'left' ? 'left' : 'right',
      handicapIndex: p.handicap_index ?? null,
      dominantMiss: p.dominantMiss ?? null,
      goal: p.goal ?? null,
    },
    tendencies: tendenciesFrom(useSwingSessionStore.getState().sessionHistory ?? [], playerId),
  };
}

/** Write the player file and open the share sheet. Never throws. */
export async function exportPlayerForBayWithFeedback(): Promise<void> {
  const toast = (m: string) => (require('../store/toastStore') as typeof import('../store/toastStore')).useToastStore.getState().show(m);
  try {
    const FS = await import('expo-file-system/legacy');
    const Sharing = await import('expo-sharing');
    const uri = `${FS.cacheDirectory}smartplay-player.json`;
    await FS.writeAsStringAsync(uri, JSON.stringify(await buildPlayerExport(Date.now()), null, 2), { encoding: FS.EncodingType.UTF8 });
    await Sharing.shareAsync(uri, { mimeType: 'application/json', dialogTitle: 'SmartPlay player file' });
  } catch (e) {
    console.log('[bayExchange] export failed:', e);
    toast('Couldn’t create the player file.');
  }
}
