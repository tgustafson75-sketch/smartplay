import type { ParsedShotRecord } from '../types/parsedShot';
import type { ShotEvent } from './shotDetectionService';
import type { ShotResult } from '../store/roundStore';
import { shotDetectionService, getPromptDelayMs } from './shotDetectionService';
import { useRoundStore } from '../store/roundStore';
import { useSettingsStore } from '../store/settingsStore';
import { speak } from './voiceService';
import { recordParsedShot, getRecentUserPhrases } from './vocabularyProfileService';
import { getFirstShotPrompt, recordVoiceLoggedShot } from './voiceOnboardingService';
import { getCurrentLocation } from './shotLocationService';
import { fetchWeatherAt, getCachedWeather } from './weatherService';
import { getDialog } from './dialogEngine';
import { ownerSentinel } from './ownerSentinel';

// Phase F — shot prompt variations now live in
// constants/dialogTemplates/caddieTemplates.ts under the 'shot_prompt'
// situation. The pickPrompt() function below routes through dialogEngine.

const SKIP_PHRASES = ['skip', 'later', 'not now', 'never mind', 'pass', 'no thanks'];

export type OrchestratorState =
  | { kind: 'idle' }
  | { kind: 'waiting_for_prompt'; shotEvent: ShotEvent; firesAt: number }
  | { kind: 'prompting'; shotEvent: ShotEvent }
  | { kind: 'listening'; shotEvent: ShotEvent }
  | { kind: 'parsing'; raw_utterance: string; shotEvent: ShotEvent }
  | { kind: 'lie_followup'; parsed: ParsedShotRecord; shotEvent: ShotEvent }
  | { kind: 'logged'; finalShot: ShotResult };

export interface CadenceLogEntry {
  shot_event: ShotEvent;
  prompt_played: string;
  user_responded: boolean;
  user_skipped: boolean;
  parsed: ParsedShotRecord | null;
  logged_shot_id: string | null;
  timestamp: number;
}

export interface OrchestratorDeps {
  /** Open mic and capture transcript. Resolves with text or null on timeout / cancellation. */
  captureUtterance: (timeoutMs: number) => Promise<string | null>;
  /** apiUrl for parser endpoint. */
  apiUrl: string;
  /** Optional callback to surface manual fallback (e.g. open shot card) when voice fails. */
  onFallbackToManual?: (event: ShotEvent) => void;
  /** Optional voice gender override. */
  voiceGender?: 'male' | 'female';
  /** Optional language override. */
  language?: 'en' | 'es' | 'zh';
}

class ConversationalLoggingOrchestrator {
  private state: OrchestratorState = { kind: 'idle' };
  private cadenceLog: CadenceLogEntry[] = [];
  private deps: OrchestratorDeps | null = null;
  private subscriptionDispose: (() => void) | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private suspended = false;

  configure(deps: OrchestratorDeps): void {
    this.deps = deps;
  }

  /** Subscribe to shotDetectionService and start orchestrating. */
  start(): void {
    if (this.subscriptionDispose) return;
    this.subscriptionDispose = shotDetectionService.on((event) => this.handleShotEvent(event));
    console.log('[orchestrator] started');
  }

  stop(): void {
    if (this.subscriptionDispose) { this.subscriptionDispose(); this.subscriptionDispose = null; }
    if (this.pendingTimer) { clearTimeout(this.pendingTimer); this.pendingTimer = null; }
    this.state = { kind: 'idle' };
    // 2026-05-17 — reset cadence log at round-end so the debug surface
    // shows only this round's cadence, not a rolling buffer across
    // rounds. The 50-entry slice cap protected against unbounded
    // growth, but conceptually cadence is a per-round concern.
    this.cadenceLog = [];
    this.suspended = false;
    console.log('[orchestrator] stopped');
  }

  /** Pause without unsubscribing — useful when user is in a modal or other voice flow. */
  setSuspended(suspended: boolean): void {
    this.suspended = suspended;
  }

  getState(): OrchestratorState {
    return this.state;
  }

  getCadenceLog(): CadenceLogEntry[] {
    return [...this.cadenceLog];
  }

  /**
   * Manually trigger the conversational flow for a synthetic shot event.
   * Used for testing and as the integration point from manual "I just hit a shot" trigger.
   */
  async triggerManual(): Promise<void> {
    const round = useRoundStore.getState();
    const event: ShotEvent = {
      timestamp: Date.now(),
      start_location: { lat: 0, lng: 0 },
      estimated_distance_yards: 0,
    };
    await this.runFlow(event, round.currentHole);
  }

  private handleShotEvent(event: ShotEvent): void {
    if (this.suspended) return;
    if (this.state.kind !== 'idle') return; // already handling a shot
    const round = useRoundStore.getState();
    if (!round.isRoundActive) return;

    // 2026-05-19 — suppress auto-fire in cart mode. Tim's finding from
    // yesterday's Sunnyvale round: "every time the cart moves we record
    // a shot is faulty — you don't just stop the cart when hitting."
    // Cart stops happen for many non-shot reasons (waiting on the group,
    // talking, lost ball, breaks). GPS-displacement-after-stop is too
    // noisy to drive the orchestrator's "what shot did you take?"
    // prompt without spurious fires. Manual triggers (Tools → Log shot,
    // voice "log a shot ...", cockpit Distance/Direction buttons, or
    // triggerManual via voice intent) still work the same way — they
    // route through this.runFlow directly rather than this auto-path.
    //
    // 2026-05-17 — Phase 413: also suppress when the walking detector
    // (Health Connect steps + GPS speed) reports cart with HIGH
    // confidence. Catches the case where the user forgot to flip the
    // manual cartMode toggle but is clearly riding. The detector
    // never overrides a manual "walking" choice — manual setting wins
    // when it says "walking" (cartMode=false) but the detector says
    // "cart"; we only ADD suppression, never remove it.
    const settings = useSettingsStore.getState();
    // Lazy import to avoid pulling Health Connect at module-load
    // time. 2026-05-17 — wrap the require itself in try/catch so a
    // walkingDetector module-load error can't take down the whole
    // shot-event pipeline (it would have crashed silently and
    // dropped every auto-fire). On failure we fall back to the
    // manual cartMode setting only.
    let effectiveCart = settings.cartMode;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { isEffectiveCartMode } = require('./walkingDetector') as typeof import('./walkingDetector');
      effectiveCart = isEffectiveCartMode(settings.cartMode);
    } catch (e) {
      ownerSentinel('orchestrator.walkingDetector', e);
    }
    if (effectiveCart) {
      console.log('[orchestrator] auto-fire suppressed (cart mode effective) — use manual log');
      return;
    }
    // 2026-05-17 — Audit C "B" P1 fix: also suppress when the latest
    // raw GPS speed is sustained-cart territory (>4 m/s ≈ 9 mph),
    // independent of the walkingDetector cache. The detector takes
    // ~30s + several Health Connect samples to warm up at round
    // start; before that, isEffectiveCartMode returns the manual
    // settings value, which is false by default. So a cart round
    // with cartMode=false would fire false-shot prompts on the
    // first 1-2 stops before the detector arms. This gate catches
    // that window using only GPS state.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getLastFix } = require('./gpsManager') as typeof import('./gpsManager');
      const speed = getLastFix()?.speed ?? 0;
      if (speed > 4.0) {
        console.log(`[orchestrator] auto-fire suppressed (gps speed ${speed.toFixed(1)} m/s)`);
        return;
      }
    } catch (e) {
      ownerSentinel('orchestrator.gpsSpeedGate', e);
    }

    const delay = getPromptDelayMs();
    this.state = { kind: 'waiting_for_prompt', shotEvent: event, firesAt: Date.now() + delay };
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      this.runFlow(event, round.currentHole).catch(err => {
        ownerSentinel('orchestrator.flow', err);
        this.state = { kind: 'idle' };
      });
    }, delay);
  }

  private async runFlow(event: ShotEvent, currentHole: number): Promise<void> {
    if (!this.deps) {
      console.log('[orchestrator] no deps configured — aborting flow');
      this.state = { kind: 'idle' };
      return;
    }

    const settings = useSettingsStore.getState();
    if (!settings.voiceEnabled) {
      // Voice disabled — log a silent placeholder and surface manual fallback
      this.recordCadence(event, '', false, false, null, null);
      this.deps.onFallbackToManual?.(event);
      this.state = { kind: 'idle' };
      return;
    }

    // Phase A.4: first-shot hint variant for first-round users.
    const prompt = getFirstShotPrompt(pickPrompt());
    this.state = { kind: 'prompting', shotEvent: event };
    try {
      await speak(prompt, this.deps.voiceGender ?? settings.voiceGender, this.deps.language ?? settings.language, this.deps.apiUrl);
    } catch (err) {
      ownerSentinel('orchestrator.promptSpeak', err);
      this.recordCadence(event, prompt, false, false, null, null);
      this.deps.onFallbackToManual?.(event);
      this.state = { kind: 'idle' };
      return;
    }

    this.state = { kind: 'listening', shotEvent: event };
    let utterance: string | null = null;
    try {
      utterance = await this.deps.captureUtterance(8000);
    } catch (err) {
      ownerSentinel('orchestrator.captureUtterance', err);
      utterance = null;
    }

    if (!utterance || !utterance.trim()) {
      // Silent / no response — log untagged shot
      const untagged = await this.logUntagged(event, currentHole);
      this.recordCadence(event, prompt, false, false, null, untagged.id ?? null);
      this.state = { kind: 'idle' };
      return;
    }

    const lower = utterance.toLowerCase();
    if (SKIP_PHRASES.some(p => lower.includes(p))) {
      this.recordCadence(event, prompt, true, true, null, null);
      this.state = { kind: 'idle' };
      return;
    }

    this.state = { kind: 'parsing', raw_utterance: utterance, shotEvent: event };
    const parsed = await this.parseUtterance(utterance, currentHole, false);

    if (!parsed) {
      const untagged = await this.logUntagged(event, currentHole, utterance);
      this.recordCadence(event, prompt, true, false, null, untagged.id ?? null);
      this.state = { kind: 'idle' };
      return;
    }

    let finalParsed = parsed;
    let lieQuality: string | null = null;

    if (parsed.lie_followup) {
      this.state = { kind: 'lie_followup', parsed, shotEvent: event };
      try {
        await speak("How's the lie?", this.deps.voiceGender ?? settings.voiceGender, this.deps.language ?? settings.language, this.deps.apiUrl);
        const lieUtterance = await this.deps.captureUtterance(6000);
        if (lieUtterance && lieUtterance.trim()) {
          const lieParsed = await this.parseUtterance(lieUtterance, currentHole, true);
          lieQuality = (lieParsed as unknown as { lie_quality?: string })?.lie_quality ?? null;
        }
      } catch (err) {
        ownerSentinel('orchestrator.lieFollowup', err);
      }
    }

    const finalShot = await this.logParsed(event, currentHole, finalParsed, lieQuality);
    recordParsedShot(finalParsed);
    recordVoiceLoggedShot();
    this.recordCadence(event, prompt, true, false, finalParsed, finalShot.id ?? null);
    this.state = { kind: 'idle' };
  }

  private async parseUtterance(utterance: string, currentHole: number, isLieFollowup: boolean): Promise<ParsedShotRecord | null> {
    if (!this.deps) return null;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      const res = await fetch(this.deps.apiUrl + '/api/parse-shot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          utterance,
          context: {
            hole_number: currentHole,
            recent_user_phrases: getRecentUserPhrases(20),
            is_lie_followup: isLieFollowup,
          },
        }),
      }).finally(() => clearTimeout(timeout));

      if (!res.ok) {
        ownerSentinel('orchestrator.parseShot.http', new Error(`HTTP ${res.status}`));
        return null;
      }
      return await res.json() as ParsedShotRecord;
    } catch (err) {
      ownerSentinel('orchestrator.parseShot', err);
      return null;
    }
  }

  private async resolveStartLocation(event: ShotEvent): Promise<{ lat: number; lng: number } | null> {
    if (event.start_location.lat !== 0 || event.start_location.lng !== 0) {
      return event.start_location;
    }
    // Manual trigger path — fetch a fresh GPS fix.
    return await getCurrentLocation();
  }

  private async logParsed(event: ShotEvent, hole: number, parsed: ParsedShotRecord, _lieQuality: string | null): Promise<ShotResult> {
    const round = useRoundStore.getState();
    const idx = round.shots.length;
    const startLoc = await this.resolveStartLocation(event);
    const shot: ShotResult = {
      id: `voice-${event.timestamp}`,
      feel: parsed.outcome === 'good' ? 'flush' : parsed.outcome === 'bad' ? 'fat' : null,
      direction: parsed.direction,
      shape: null,
      club: parsed.club,
      hole,
      timestamp: event.timestamp,
      acousticContact: null,
      distance_yards: parsed.distance,
      raw_utterance: parsed.raw_utterance,
      logged_via: 'voice',
      gps_location: startLoc,
      start_location: startLoc,
      end_location: null,
      hole_number: hole,
      shot_in_round_index: idx,
      weather_snapshot: startLoc ? getCachedWeather(startLoc) : null,
    };
    round.logShot(shot);
    // Phase C — fire-and-forget weather fetch; populates the shot's
    // weather_snapshot once the network call returns. Does not block logging.
    if (startLoc && shot.id) {
      fetchWeatherAt(startLoc)
        .then(snap => {
          if (snap) useRoundStore.getState().updateShotWeather(shot.id!, snap as unknown as Record<string, unknown>);
        })
        .catch(err => console.log('[orchestrator] weather attach failed:', err));
    }
    return shot;
  }

  private async logUntagged(event: ShotEvent, hole: number, raw?: string): Promise<ShotResult> {
    const round = useRoundStore.getState();
    const idx = round.shots.length;
    const startLoc = await this.resolveStartLocation(event);
    const shot: ShotResult = {
      id: `voice-untagged-${event.timestamp}`,
      feel: null,
      direction: null,
      shape: null,
      club: null,
      hole,
      timestamp: event.timestamp,
      acousticContact: null,
      raw_utterance: raw ?? '',
      logged_via: 'voice',
      gps_location: startLoc,
      start_location: startLoc,
      end_location: null,
      hole_number: hole,
      shot_in_round_index: idx,
    };
    round.logShot(shot);
    return shot;
  }

  private recordCadence(
    event: ShotEvent,
    prompt: string,
    responded: boolean,
    skipped: boolean,
    parsed: ParsedShotRecord | null,
    loggedShotId: string | null,
  ): void {
    this.cadenceLog.push({
      shot_event: event,
      prompt_played: prompt,
      user_responded: responded,
      user_skipped: skipped,
      parsed,
      logged_shot_id: loggedShotId,
      timestamp: Date.now(),
    });
    if (this.cadenceLog.length > 50) {
      this.cadenceLog = this.cadenceLog.slice(-50);
    }
  }
}

function pickPrompt(): string {
  return getDialog('caddie', 'shot_prompt');
}

export const conversationalLoggingOrchestrator = new ConversationalLoggingOrchestrator();
