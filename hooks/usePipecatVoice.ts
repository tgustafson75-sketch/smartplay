/**
 * Pipecat voice orchestrator hook.
 *
 * Phase 2 (active): text-in / text+tools-out via POST /turn.
 *   Audio: expo-av → Whisper STT (unchanged) → transcript
 *   Brain: Pipecat /turn → Claude claude-sonnet-4-6 tool_use → response + tool_actions
 *   TTS: existing speak() path
 *
 * Phase 3 (future): real-time audio streaming via WebSocket.
 *   openSession() / connect() / pushGpsUpdate() / closeSession() are scaffold for Phase 3.
 */

import { useRef, useCallback } from 'react';
import { useRoundStore } from '../store/roundStore';
import { useSettingsStore } from '../store/settingsStore';
import { answerOffline } from '../services/offlineCaddie';
import { buildPipecatContext } from '../services/pipecatContext';
import { recordKevinTurn } from '../services/conversationState';
import { endsAsQuestion, isCloseIntent } from './useVoiceCaddie';
import { speak } from '../services/voiceService';
import { getApiBaseUrl } from '../services/apiBase';
import { screenContextForPrompt } from '../services/screenContext';
import { devLog } from '../services/devLog';
// 2026-07-01 (audit — MIC CONVERGENCE) — the ONE shared pipecat history, so this
// mic and the earbud/badge path keep the same conversation + reset together.
import { getPipecatHistory, setPipecatHistory, clearPipecatHistory } from '../services/voice/pipecatHistory';
import { useConversationLog } from '../store/conversationLogStore';
import type { ToolAction } from '../app/api/kevin+api';

// Simplified history entry — persisted in a ref, sent to /turn each call
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

// Tool actions from the Pipecat server — same shape as Kevin's ToolAction
export type PipecatToolAction = ToolAction;

export type PipecatUIEvent =
  | 'open_smartvision'
  | 'open_smartfinder'
  | 'open_swinglab'
  | 'record_swing';

export type PipecatSessionState = 'idle' | 'connecting' | 'connected' | 'error' | 'closed';

// 2026-06-23 (audit) — was 20s but the server turn budget is 30s, so a
// healthy-but-slow turn got aborted client-side on good signal. Match 30s.
const TURN_TIMEOUT_MS = 30_000;
// History cap now lives in services/voice/pipecatHistory.ts (the shared history).

interface UsePipecatVoiceOpts {
  onUIEvent?: (event: PipecatUIEvent, data: Record<string, unknown>) => void;
  onStateChange?: (state: PipecatSessionState) => void;
  onKevinSpoke?: (text: string) => void;
  onToolAction?: (action: ToolAction) => void;
  onVoiceStateChange?: (state: 'idle' | 'listening' | 'thinking' | 'speaking') => void;
  onReadyToListen?: () => void;
}

export function usePipecatVoice({
  onUIEvent,
  onStateChange,
  onKevinSpoke,
  onToolAction,
  onVoiceStateChange,
  onReadyToListen,
}: UsePipecatVoiceOpts = {}) {
  const wsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const stateRef = useRef<PipecatSessionState>('idle');
  // 2026-07-06 (voice-parity F2) — one brain turn at a time. A mic tap while the
  // caddie is still 'thinking' releases isProcessingRef in the consumer BEFORE
  // this await resolves, so a second processTurn could start and race the ONE
  // shared pipecat history (last-writer-wins), double-award points, and log two
  // turns. This ref makes processTurn re-entrancy-safe at the true chokepoint.
  const turnInFlightRef = useRef(false);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const setSessionState = useCallback((s: PipecatSessionState) => {
    stateRef.current = s;
    onStateChange?.(s);
  }, [onStateChange]);

  /** Build the full context snapshot to push on connect. */
  // 2026-07-01 (audit — MIC CONVERGENCE) — was a full duplicate of
  // services/pipecatContext.buildPipecatContext(). Both were getState()-based and
  // identical, so they silently drifted risk. Now this delegates to the ONE shared
  // builder, so the caddie-tab mic and the earbud/badge/watch path send IDENTICAL
  // context and any future field is added in exactly one place.
  const buildContext = useCallback(() => buildPipecatContext(), []);

  /** Push a delta message to an open session. */
  const pushMessage = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch (e) {
      devLog('[pipecat] push failed:', e);
    }
  }, []);

  /** Push updated GPS coordinates to the open session. */
  const pushGpsUpdate = useCallback((lat: number, lng: number) => {
    pushMessage({ type: 'gps_update', gps: { lat, lng } });
  }, [pushMessage]);

  /** Push a hole transition (fired by roundStore.setCurrentHole). */
  const pushHoleTransition = useCallback((hole: number, par?: number, yardage?: number) => {
    pushMessage({ type: 'hole_transition', hole, par, yardage });
  }, [pushMessage]);

  /** Open a Pipecat session and WebSocket connection. */
  const openSession = useCallback(async () => {
    const serverUrl = useSettingsStore.getState().pipecatServerUrl;
    if (!serverUrl) {
      devLog('[pipecat] pipecatServerUrl not set — voice orchestrator inactive');
      setSessionState('error');
      return;
    }

    setSessionState('connecting');

    // Swap ws:// for http:// to create the session
    const httpBase = serverUrl.replace(/^wss?:\/\//, 'https://').replace(/\/+$/, '');
    const secret = process.env.EXPO_PUBLIC_PIPECAT_SECRET ?? '';

    let sessionId: string;
    let wsUrl: string;

    try {
      const resp = await fetch(`${httpBase}/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret, ...buildContext() }),
      });
      if (!resp.ok) throw new Error(`session create failed: ${resp.status}`);
      const data = await resp.json() as { sessionId: string; wsUrl: string };
      sessionId = data.sessionId;
      wsUrl = data.wsUrl;
    } catch (e) {
      devLog('[pipecat] session create error:', e);
      setSessionState('error');
      return;
    }

    sessionIdRef.current = sessionId;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      devLog('[pipecat] WS connected:', sessionId);
      // Push full context — server already has it from /session, this covers
      // any state that changed in the gap.
      ws.send(JSON.stringify({ type: 'context', ...buildContext() }));
      setSessionState('connected');
      // Keep-alive ping every 25s (Railway drops idle WebSockets after 30s)
      pingIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
      }, 25_000);
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data as string) as {
          type: string;
          tool?: string;
          data?: Record<string, unknown>;
          text?: string;
        };

        if (msg.type === 'ui_event' && msg.tool) {
          devLog('[pipecat] ui_event:', msg.tool);
          onUIEvent?.(msg.tool as PipecatUIEvent, msg.data ?? {});
        }

        if (msg.type === 'transcript' && msg.text) {
          onKevinSpoke?.(msg.text);
        }
      } catch {
        // binary audio frame — handled by the audio pipeline, not JSON
      }
    };

    ws.onerror = (e) => {
      devLog('[pipecat] WS error:', e);
      setSessionState('error');
    };

    ws.onclose = () => {
      devLog('[pipecat] WS closed');
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      wsRef.current = null;
      sessionIdRef.current = null;
      setSessionState('closed');
    };
  }, [buildContext, onUIEvent, onKevinSpoke, setSessionState]);

  /** Close the active session. */
  const closeSession = useCallback(() => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
    const ws = wsRef.current;
    if (ws) {
      try { ws.send(JSON.stringify({ type: 'end_session' })); } catch {}
      ws.close();
      wsRef.current = null;
    }
    sessionIdRef.current = null;
    setSessionState('closed');
  }, [setSessionState]);

  /** Clear conversation history (call on round end or new session). */
  const clearHistory = useCallback(() => {
    clearPipecatHistory();
  }, []);

  /**
   * Phase 2 brain — POST to Vercel /api/pipecat-turn, get Claude's
   * response + tool actions back, speak the response, dispatch tool actions.
   * No Railway or Python server needed for Phase 2.
   */
  const processTurn = useCallback(async (transcript: string): Promise<void> => {
    // 2026-07-06 (voice-parity F2) — block a re-entrant turn. If one is already in
    // flight, drop this call rather than start a second that races history/points.
    if (turnInFlightRef.current) {
      devLog('[pipecat] turn already in flight — ignoring re-entrant call');
      return;
    }
    turnInFlightRef.current = true;

    // 2026-07-06 (Tim — "less predictive, more narrative to build a database") —
    // capture the user's spoken turn to the conversation log NOW, before any tool
    // or reply. Previously only the follow-up-listen loop wrote logUser, so a
    // primary narrated turn (mental state, sleep, "my game's off") never reached
    // the round-end CNS distill. This is what builds the database from narrative
    // even when NO tool fires. Best-effort; never blocks the turn.
    try { if (transcript.trim()) useConversationLog.getState().logUser(transcript.trim(), Date.now()); } catch { /* CNS capture is best-effort */ }

    const apiBase = getApiBaseUrl().replace(/\/+$/, '');
    const secret = process.env.EXPO_PUBLIC_PIPECAT_SECRET ?? '';

    onVoiceStateChange?.('thinking');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TURN_TIMEOUT_MS);
    // Once we've spoken a real response, a later throw (e.g. auto-listen) must
    // NOT trigger the consumer's sendToBrain fallback — that would double-answer.
    let spokeResponse = false;

    try {
      const resp = await fetch(`${apiBase}/api/pipecat-turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          secret,
          text: transcript,
          history: getPipecatHistory(),
          context: buildContext(),
          // 2026-06-26 — parity with the kevin path: send the ephemeral current
          // screen/drill so the live brain answers drill-aware too.
          screen_context: screenContextForPrompt(),
          sessionId: sessionIdRef.current,
        }),
      });

      clearTimeout(timeout);

      if (!resp.ok) {
        // Pipecat OWNS the turn. The local-first precheck already ran in
        // useVoiceCaddie BEFORE this override, so offline/status queries are
        // covered. On a non-ok, speak a graceful retry prompt and STOP — do NOT
        // throw to a legacy fallback. (2026-06-23 regression: throwing here made
        // the consumer double-process every flaky turn — pipecat attempt THEN a
        // second full legacy brain call — doubling latency and letting both paths
        // display/speak. Single path, single voice, graceful degrade.)
        // 2026-06-29 (Tim — audit) — before the canned dead-end, try the OFFLINE caddie
        // (round state + golf KB, device-TTS-capable). It was wired into the legacy path
        // but NOT this default pipecat failure branch, so a dead-network turn got a
        // useless "ask me again" even though a real offline answer existed.
        devLog('[pipecat] /turn error:', resp.status);
        const settings = useSettingsStore.getState();
        const lang = (['en', 'es', 'zh'] as const).includes(settings.language as never) ? (settings.language as 'en' | 'es' | 'zh') : 'en';
        onVoiceStateChange?.('speaking');
        let spokeOffline = false;
        try {
          const off = answerOffline(transcript, lang);
          if (off?.text) {
            onKevinSpoke?.(off.text);
            await speak(off.text, settings.voiceGender, settings.language, getApiBaseUrl(), { userInitiated: true }).catch(() => {});
            spokeOffline = true;
          }
        } catch { /* offline best-effort */ }
        if (!spokeOffline) {
          // 2026-07-04 (Tim — "when all else fails, log statements stored for the round,
          // ingested later if no signal") — the brain is unreachable AND the local
          // caddie had no answer, so this is a STATEMENT to save, not a status query.
          // Capture it against the round so nothing is lost, and confirm via the DEVICE
          // voice (expo-speech, works with zero signal). When we reconnect the note is
          // handed back to the caddie + shown in recap.
          let captured = false;
          try {
            const { captureOfflineStatement } = await import('../services/voiceLogService');
            captured = captureOfflineStatement(transcript);
          } catch { /* best-effort */ }
          const { speakDeviceNotice } = await import('../services/voiceService');
          if (captured) {
            await speakDeviceNotice("No signal right now, but I saved that. I'll bring it back up when we reconnect.", lang, settings.voiceGender).catch(() => {});
          } else {
            await speakDeviceNotice('Give me one sec and ask me again.', lang, settings.voiceGender).catch(() => {});
          }
        }
        onVoiceStateChange?.('idle');
        return;
      }

      const data = await resp.json() as {
        response_text: string;
        tool_actions: Array<Record<string, unknown>>;
        updated_history: ConversationMessage[];
      };

      // Update the shared history, capped to avoid unbounded growth
      setPipecatHistory(data.updated_history ?? []);

      // Dispatch tool actions to the RN UI (same handler as Kevin's tools)
      if (data.tool_actions?.length) {
        for (const raw of data.tool_actions) {
          onToolAction?.(raw as ToolAction);
        }
      }

      const text = data.response_text ?? '';

      // 2026-06-30 (Tim — "a log for the WHOLE voice") — record this turn (his words → the
      // caddie's reply, or null) + which tool(s) fired, in the owner issue log. Lets him SEE
      // when the brain jumped to a tool vs answered conversationally — the exact "too
      // predictive" signal. Owner-gated + best-effort inside addVoiceTurn.
      try {
        const ta = (data as { tool_actions?: Array<{ type?: string }> }).tool_actions;
        const tool = Array.isArray(ta) && ta.length ? ta.map(a => a?.type).filter(Boolean).join(',') : null;
        require('../store/issueLogStore').useIssueLogStore.getState().addVoiceTurn(transcript, text || null, { path: 'brain', tool });
      } catch { /* best-effort */ }

      if (text.trim()) { try { require('../store/pointsStore').usePointsStore.getState().addPoints(3, 'caddie_interaction'); } catch {} }

      // TTS via existing speak() path
      if (text) {
        spokeResponse = true;
        onVoiceStateChange?.('speaking');
        onKevinSpoke?.(text);
        recordKevinTurn(text);
        try {
          const settings = useSettingsStore.getState();
          await speak(text, settings.voiceGender, settings.language, getApiBaseUrl(), { userInitiated: true });
        } catch (e) {
          devLog('[pipecat] tts error:', e);
        }
      }

      onVoiceStateChange?.('idle');

      // Auto-listen: always in continuous mode; on any question otherwise.
      // Mirrors the legacy continuousConversationMode behavior for the pipecat path.
      if (text.trim() && onReadyToListen) {
        const { continuousConversationMode } = useSettingsStore.getState();
        const isQuestion = endsAsQuestion(text);
        // 2026-06-30 (Tim) — a sign-off ("I'm good, thanks" / "that's all" / "I'm done")
        // must END the conversation, not re-open the mic. The legacy loop already had
        // isCloseIntent for exactly this ("trapped in continuous mode"), but the DEFAULT
        // pipecat path never checked it — so continuous mode kept re-arming after a
        // farewell. Honor the same proven matcher here. The brain still spoke its sign-off
        // (e.g. "I'm here if you need me"); we simply don't listen again.
        const userSignedOff = isCloseIntent(transcript);
        if (!userSignedOff && (continuousConversationMode || isQuestion)) {
          await new Promise<void>((r) => setTimeout(r, 500));
          onReadyToListen();
        }
      }
    } catch (e) {
      clearTimeout(timeout);
      devLog('[pipecat] /turn fetch error:', e);
      // Single-path graceful degrade (NO legacy double-processing). If we already
      // spoke a real response, a late auto-listen throw is swallowed silently.
      if (!spokeResponse) {
        onVoiceStateChange?.('speaking');
        const settings = useSettingsStore.getState();
        const lang = (['en', 'es', 'zh'] as const).includes(settings.language as never) ? (settings.language as 'en' | 'es' | 'zh') : 'en';
        let spokeOffline = false;
        try {
          const off = answerOffline(transcript, lang);
          if (off?.text) {
            onKevinSpoke?.(off.text);
            await speak(off.text, settings.voiceGender, settings.language, getApiBaseUrl(), { userInitiated: true }).catch(() => {});
            spokeOffline = true;
          }
        } catch { /* offline best-effort */ }
        if (!spokeOffline) {
          // 2026-07-06 (voice-lifecycle audit #1) — a DEAD network THROWS the fetch,
          // so it lands HERE — but the offline-statement capture only lived in the
          // !resp.ok branch (server reachable-but-erroring). That inverted the whole
          // feature: the exact scenario it was built for (no signal on-course) never
          // captured. Mirror the capture + DEVICE-voice confirm here; cloud TTS can't
          // work on a dead network anyway.
          let captured = false;
          try {
            const { captureOfflineStatement } = await import('../services/voiceLogService');
            captured = captureOfflineStatement(transcript);
          } catch { /* best-effort */ }
          const { speakDeviceNotice } = await import('../services/voiceService');
          if (captured) {
            await speakDeviceNotice("No signal right now, but I saved that. I'll bring it back up when we reconnect.", lang, settings.voiceGender).catch(() => {});
          } else {
            await speakDeviceNotice('Give me one sec and ask me again.', lang, settings.voiceGender).catch(() => {});
          }
        }
      }
      onVoiceStateChange?.('idle');
    } finally {
      // 2026-07-06 (voice-parity F2) — always release so the NEXT tap/turn works.
      turnInFlightRef.current = false;
    }
  }, [buildContext, onKevinSpoke, onReadyToListen, onToolAction, onVoiceStateChange]);

  /**
   * Phase 2 full pipeline: audio URI → Whisper STT → processTurn → speak.
   * Drop-in for useVoiceCaddie's processAudioUri when voiceOrchestrator === 'pipecat'.
   */
  const processAudioUri = useCallback(async (
    uri: string,
    opts?: { apiUrl?: string; language?: string },
  ): Promise<void> => {
    // STT: use existing transcribe endpoint (same as legacy path).
    // 2026-06-23 (smoke-test) — EXPO_PUBLIC_API_URL is EMPTY in eas-update bundles,
    // so the old fallback produced a relative '/api/transcribe' → "Invalid URL" (the
    // api-base-url spine bug). Always resolve through getApiBaseUrl() (prod fallback).
    const whisperUrl = `${getApiBaseUrl().replace(/\/+$/, '')}/api/transcribe`;

    onVoiceStateChange?.('thinking');

    try {
      const formData = new FormData();
      formData.append('audio', { uri, type: 'audio/m4a', name: 'audio.m4a' } as unknown as Blob);
      formData.append('language', opts?.language ?? useSettingsStore.getState().language ?? 'en');

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20_000);

      const transcribeRes = await fetch(whisperUrl, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));

      if (!transcribeRes.ok) {
        devLog('[pipecat] transcribe failed:', transcribeRes.status);
        onVoiceStateChange?.('idle');
        return;
      }

      const { text: transcript = '' } = await transcribeRes.json() as { text?: string };
      if (!transcript.trim()) {
        devLog('[pipecat] empty transcript');
        onVoiceStateChange?.('idle');
        return;
      }

      devLog('[pipecat] transcript:', transcript);
      await processTurn(transcript);
    } catch (e) {
      devLog('[pipecat] processAudioUri error:', e);
      onVoiceStateChange?.('idle');
    }
  }, [processTurn, onVoiceStateChange]);

  return {
    // Phase 2 — text brain
    processTurn,
    processAudioUri,
    clearHistory,
    // Phase 3 — audio streaming (scaffold)
    openSession,
    closeSession,
    pushGpsUpdate,
    pushHoleTransition,
    pushMessage,
    sessionId: sessionIdRef.current,
    state: stateRef.current,
  };
}
