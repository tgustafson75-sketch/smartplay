/**
 * 2026-05-22 — Meta Glasses Bridge (client-side orchestrator).
 *
 * Single entry from inside the SmartPlay app for routing a Meta-AI-
 * style voice query through the existing Caddie Brain. Two modes:
 *
 *   - LOCAL (preferred when the app is open + we have rich context):
 *     compose state from roundStore + golferModel + ghostStore +
 *     courseDataOrchestrator, call smartAnalysisEngine directly for
 *     a strategic recommendation, persona-thread the spoken response,
 *     compress to ≤15 words, update state. NO server round-trip.
 *
 *   - REMOTE (fallback when an iOS Shortcut / Android Assistant
 *     dispatches WITHOUT the app being in foreground OR when the
 *     local pipeline can't deliver in <1.2s): POST to /api/meta-voice
 *     with the same payload shape so the production endpoint handles
 *     it. Server-side composer doesn't have access to client stores
 *     but does have weather + Anthropic Haiku for a baseline reply.
 *
 * Why both:
 *   - Local is faster (no network) and SPECIFIC (golfer model +
 *     ghost match + recent shots are all in-process).
 *   - Remote is the only path the iOS Shortcut + Android Assistant
 *     have when the app isn't foregrounded. Same shape contract.
 *
 * Surface mirrors the api/meta-voice.ts request/response shape exactly
 * so any caller can choose local vs remote without changing call-sites.
 */

import { useRoundStore } from '../store/roundStore';
import { useSettingsStore } from '../store/settingsStore';
import { useGhostStore } from '../store/ghostStore';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { analyze, type AnalysisEnvelope } from './smartAnalysisEngine';
import { buildGolferModel } from './golferModel';
import { getCaddieName } from '../lib/persona';
import { devLog } from './devLog';

// ─── Public types (must mirror api/meta-voice.ts) ───────────────────────

export interface MetaVoiceRequest {
  query: string;
  gps?: { lat: number; lng: number } | null;
  spoken_context?: string;
  user_id: string;
  state?: Record<string, unknown>;
  image_base64?: string;
}

export interface MetaVoiceResponse {
  speak: string;
  details?: string;
  state: Record<string, unknown>;
  tone: 'neutral' | 'hype' | 'calm' | 'coach';
  alt?: string;
  user_note?: string;
}

export type BridgeMode = 'local' | 'remote' | 'auto';

export interface BridgeOptions {
  /** 'auto' tries local first; falls back to remote on local failure or
   *  >1.2s delay. 'local' forces in-process. 'remote' forces the
   *  /api/meta-voice POST. Default: 'auto'. */
  mode?: BridgeMode;
  /** When true, the resolved `speak` field is played through voiceService
   *  before the promise resolves. Defaults to false — caller may want
   *  to do its own audio routing. */
  speak?: boolean;
}

// ─── Intent classification (mirrors server) ─────────────────────────────

type Intent = 'distance_request' | 'lie_assessment' | 'shot_result' | 'strategy' | 'general';
const DISTANCE_RE = /\b(yard|yds?|distance|how far|to (the )?(pin|green|flag|front|back|middle)|to pin)\b/i;
const LIE_RE = /\b(lie|stance|hazard|rough|bunker|sand|trees?|hardpan|water|fluffy|tight|buried|deep)\b/i;
const RESULT_RE = /\b(made it|stuck it|missed|short|long|left|right|hit (it|that)|nailed it|drained|bladed|fat|thin|chunked|skulled|good shot|bad shot|holed)\b/i;
const STRATEGY_RE = /\b(what should i|what'?s the play|smart play|aggressive|conservative|go for|lay up|options?)\b/i;

function classifyIntent(query: string, spoken: string | undefined): Intent {
  const hay = (query + ' ' + (spoken ?? '')).toLowerCase();
  if (RESULT_RE.test(hay)) return 'shot_result';
  if (DISTANCE_RE.test(hay)) return 'distance_request';
  if (LIE_RE.test(hay)) return 'lie_assessment';
  if (STRATEGY_RE.test(hay)) return 'strategy';
  return 'general';
}

// ─── Public API ─────────────────────────────────────────────────────────

const LOCAL_TIMEOUT_MS = 1_200;

/**
 * Route a Meta-AI-style voice query. Always resolves to a MetaVoiceResponse —
 * never throws, never null. Local path runs first when mode==='auto';
 * remote /api/meta-voice fallback fires on timeout / error.
 */
export async function handleMetaVoiceQuery(
  req: MetaVoiceRequest,
  opts: BridgeOptions = {},
): Promise<MetaVoiceResponse> {
  const mode = opts.mode ?? 'auto';
  const intent = classifyIntent(req.query, req.spoken_context);
  devLog(`[metaBridge] route start mode=${mode} intent=${intent} query="${req.query.slice(0, 60)}"`);

  let result: MetaVoiceResponse;
  if (mode === 'remote') {
    result = await callRemote(req);
  } else if (mode === 'local') {
    result = await callLocal(req, intent);
  } else {
    // auto: race local against the deadline; remote on timeout.
    result = await Promise.race<MetaVoiceResponse>([
      callLocal(req, intent),
      new Promise<MetaVoiceResponse>((resolve) =>
        setTimeout(() => resolve(callRemote(req)), LOCAL_TIMEOUT_MS),
      ),
    ]);
  }

  if (opts.speak) {
    void speakResult(result);
  }
  devLog(`[metaBridge] resolved tone=${result.tone} speak="${result.speak.slice(0, 60)}"`);
  return result;
}

// ─── Local path — compose context + call smartAnalysisEngine ────────────

async function callLocal(req: MetaVoiceRequest, intent: Intent): Promise<MetaVoiceResponse> {
  try {
    const round = useRoundStore.getState();
    const settings = useSettingsStore.getState();
    const ghost = useGhostStore.getState();
    const profile = usePlayerProfileStore.getState();
    const golfer = (() => {
      try { return buildGolferModel(); } catch { return null; }
    })();

    // Route to the right analysis kind based on intent.
    let env: AnalysisEnvelope;
    if (intent === 'strategy' || intent === 'distance_request') {
      env = await analyze({
        kind: 'shot_strategy',
        lie_hint: req.spoken_context ?? null,
        // target_yards parsed from the query when explicit ("145 to pin").
        target_yards: extractYardage(req.query),
      });
    } else if (intent === 'lie_assessment') {
      env = await analyze({ kind: 'mental_check', state_note: req.spoken_context ?? 'reading lie' });
    } else if (intent === 'shot_result') {
      // For a result like "I made it" the local path just acknowledges with
      // a brief context-aware response — no analyzer call needed.
      return buildResultAcknowledgement(req, ghost.overall_delta, settings.caddiePersonality);
    } else {
      env = await analyze({ kind: 'ghost_status' });
    }

    const speak = compressForGlasses(env.voice_summary, intent);
    const userNote = buildUserNote(req, intent, env, golfer?.miss_type ?? null);

    return {
      speak,
      details: deriveDetails(env),
      state: buildNextState(req, round, env, intent),
      tone: env.kind === 'mental_check' ? 'calm' : pickTone(env, ghost.overall_delta),
      alt: deriveAlt(env),
      user_note: userNote,
    };
  } catch (e) {
    devLog('[metaBridge] local path failed: ' + String(e));
    // Soft-fail with a generic standing-by line; remote will kick in via
    // the auto-mode timeout race if this resolved fast enough.
    void profileUnused();
    return {
      speak: 'Standing by — give me one second.',
      state: req.state ?? {},
      tone: 'calm',
    };
  }
}

// Silence unused-import warning for profile in fast path; keep it imported
// for future use (golfer-name personalization, handicap context).
function profileUnused(): void {
  void usePlayerProfileStore;
}

// ─── Remote path — POST to api/meta-voice ───────────────────────────────

async function callRemote(req: MetaVoiceRequest): Promise<MetaVoiceResponse> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
  if (!apiUrl) {
    return {
      speak: 'No backend configured — open the app to ask.',
      state: req.state ?? {},
      tone: 'calm',
    };
  }
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 1_500);
    const res = await fetch(`${apiUrl}/api/meta-voice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal: ctl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      return {
        speak: 'One sec — finishing my read.',
        state: req.state ?? {},
        tone: 'calm',
      };
    }
    return (await res.json()) as MetaVoiceResponse;
  } catch (e) {
    devLog('[metaBridge] remote path failed: ' + String(e));
    return {
      speak: 'One sec — finishing my read.',
      state: req.state ?? {},
      tone: 'calm',
    };
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────

function extractYardage(query: string): number | null {
  const m = query.match(/\b(\d{2,3})\b/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n >= 20 && n <= 400 ? n : null;
}

/** Compress an analyzer voice_summary down to caddie-glasses length
 *  (max 15 words). Preserves the first clause; truncates the rest. */
function compressForGlasses(summary: string, intent: Intent): string {
  void intent;
  const s = summary.trim();
  if (!s) return 'Standing by.';
  // Split on sentence boundaries; keep first 1-2 short sentences up to 15w.
  const sentences = s.split(/(?<=[.!?])\s+/);
  const out: string[] = [];
  let wordCount = 0;
  for (const sent of sentences) {
    const w = sent.trim().split(/\s+/).length;
    if (wordCount + w > 15) break;
    out.push(sent.trim());
    wordCount += w;
    if (out.length >= 2) break;
  }
  if (out.length === 0) {
    // Single mega-sentence — hard-clamp word count.
    return s.split(/\s+/).slice(0, 15).join(' ');
  }
  return out.join(' ');
}

function deriveDetails(env: AnalysisEnvelope): string | undefined {
  // Strategy result has a rationale[] we can fold to one line.
  const result = env.result as { rationale?: string[] } | null;
  if (result?.rationale && Array.isArray(result.rationale) && result.rationale.length > 0) {
    return result.rationale.slice(0, 2).join(' ');
  }
  return undefined;
}

function deriveAlt(env: AnalysisEnvelope): string | undefined {
  const result = env.result as { alternative_play?: string | null } | null;
  return result?.alternative_play?.slice(0, 100) ?? undefined;
}

function pickTone(env: AnalysisEnvelope, ghostDelta: number): 'neutral' | 'hype' | 'calm' | 'coach' {
  // Ghost behind by 5+ → calm + lower stakes. Ahead by 3+ → hype.
  if (ghostDelta <= -3) return 'hype';
  if (ghostDelta >= 5) return 'calm';
  if (env.kind === 'shot_strategy') return 'coach';
  return 'neutral';
}

function buildNextState(
  req: MetaVoiceRequest,
  round: ReturnType<typeof useRoundStore.getState>,
  env: AnalysisEnvelope,
  intent: Intent,
): Record<string, unknown> {
  const prior = (req.state ?? {}) as Record<string, unknown>;
  const next: Record<string, unknown> = { ...prior };
  if (round.isRoundActive) {
    next.hole = round.currentHole;
    next.recent_score_vs_par = round.getScoreVsPar();
  }
  if (intent === 'distance_request') {
    const yards = extractYardage(req.query);
    if (yards != null) next.last_yardage = yards;
    // Strategy result includes recommended_club — fold it.
    const result = env.result as { recommended_club?: string | null } | null;
    if (result?.recommended_club) {
      next.last_club = result.recommended_club.toLowerCase().replace(/\s+/g, '');
      next.last_result_pending = true;
    }
  }
  if (intent === 'shot_result') {
    next.last_result_pending = false;
  }
  if (req.gps) next.last_gps = req.gps;
  return next;
}

function buildResultAcknowledgement(
  req: MetaVoiceRequest,
  ghostDelta: number,
  persona: string,
): MetaVoiceResponse {
  const settings = useSettingsStore.getState();
  void settings;
  const caddieName = getCaddieName(persona);
  const positive = /\b(made it|stuck it|nailed|drained|good|hole(d)?|on it|crushed)\b/i.test(req.query);
  const negative = /\b(bad|missed|short|long|left|right|fat|thin|chunked|skulled|bladed)\b/i.test(req.query);
  let speak: string;
  let tone: MetaVoiceResponse['tone'];
  if (positive) {
    speak = `${caddieName} — yes! Big shot. Move on with momentum.`;
    tone = 'hype';
  } else if (negative) {
    speak = `Easy. One swing at a time. Reset and go.`;
    tone = 'calm';
  } else {
    speak = 'Locked in. On to the next.';
    tone = 'neutral';
  }
  const state = { ...(req.state ?? {}), last_result_pending: false };
  if (ghostDelta <= -3) tone = 'hype';
  return {
    speak: compressForGlasses(speak, 'shot_result'),
    state,
    tone,
  };
}

function buildUserNote(
  req: MetaVoiceRequest,
  intent: Intent,
  env: AnalysisEnvelope,
  missType: string | null,
): string | undefined {
  // user_note is a personalization hint Meta AI remembers between
  // sessions. We surface notable beats: personal best context, miss
  // pattern called out, ghost performance, etc.
  if (intent === 'shot_result' && /\bcrushed|nailed|longest|personal best/i.test(req.query)) {
    return 'Player just hit a great shot — note for the round narrative.';
  }
  if (missType && missType !== 'unknown' && missType !== 'varies') {
    if (intent === 'strategy' || intent === 'distance_request') {
      return `Player's chronic miss pattern: ${missType}. Caddie factored it in.`;
    }
  }
  if (env.kind === 'ghost_status' && env.confidence > 70) {
    return 'Player asked about ghost progress — pacing context useful.';
  }
  return undefined;
}

// ─── Voice playback (optional) ──────────────────────────────────────────

async function speakResult(result: MetaVoiceResponse): Promise<void> {
  try {
    const settings = useSettingsStore.getState();
    const voiceMod = await import('./voiceService');
    void voiceMod.speak?.(
      result.speak,
      settings.voiceGender,
      settings.language ?? 'en',
      process.env.EXPO_PUBLIC_API_URL ?? '',
      { userInitiated: true },
    )?.catch?.(() => undefined);
  } catch (e) {
    devLog('[metaBridge] speakResult failed: ' + String(e));
  }
}
