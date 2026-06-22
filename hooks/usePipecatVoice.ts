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
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { useTrustLevelStore } from '../store/trustLevelStore';
import { getLastFix } from '../services/gpsManager';
import { speak } from '../services/voiceService';
import { getApiBaseUrl } from '../services/apiBase';
import { devLog } from '../services/devLog';
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

const TURN_TIMEOUT_MS = 20_000;
const MAX_HISTORY_TURNS = 6; // keep last 6 exchanges (~12 messages) for context

interface UsePipecatVoiceOpts {
  onUIEvent?: (event: PipecatUIEvent, data: Record<string, unknown>) => void;
  onStateChange?: (state: PipecatSessionState) => void;
  onKevinSpoke?: (text: string) => void;
  onToolAction?: (action: ToolAction) => void;
  onVoiceStateChange?: (state: 'idle' | 'listening' | 'thinking' | 'speaking') => void;
}

export function usePipecatVoice({
  onUIEvent,
  onStateChange,
  onKevinSpoke,
  onToolAction,
  onVoiceStateChange,
}: UsePipecatVoiceOpts = {}) {
  const wsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const stateRef = useRef<PipecatSessionState>('idle');
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const historyRef = useRef<ConversationMessage[]>([]);

  const setSessionState = useCallback((s: PipecatSessionState) => {
    stateRef.current = s;
    onStateChange?.(s);
  }, [onStateChange]);

  /** Build the full context snapshot to push on connect. */
  const buildContext = useCallback(() => {
    const round = useRoundStore.getState();
    const settings = useSettingsStore.getState();
    const profile = usePlayerProfileStore.getState();
    const trustLevel = useTrustLevelStore.getState().level;

    return {
      player: {
        name: profile.name ?? 'golfer',
        handicap: profile.handicap ?? undefined,
        dominantMiss: profile.dominantMiss ?? undefined,
        caddiePersonality: settings.caddiePersonality,
        trustLevel,
      },
      round: {
        active: round.isRoundActive,
        currentHole: round.currentHole ?? undefined,
        courseId: round.activeCourseId ?? undefined,
        courseName: round.activeCourse ?? undefined,
        mentalState: round.mentalState ?? undefined,
        goal: round.goal ?? undefined,
      },
      bag: {
        club_distances: {} as Record<string, number>,
      },
      settings: {
        trustLevel,
        language: settings.language ?? 'en',
        aiProvider: 'anthropic',
      },
      gps: {
        lat: getLastFix()?.lat ?? undefined,
        lng: getLastFix()?.lng ?? undefined,
      },
    };
  }, []);

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
    historyRef.current = [];
  }, []);

  /**
   * Phase 2 brain — send a text transcript to Pipecat /turn, get Claude's
   * response + tool actions back, speak the response, dispatch tool actions.
   */
  const processTurn = useCallback(async (transcript: string): Promise<void> => {
    const serverUrl = useSettingsStore.getState().pipecatServerUrl;
    if (!serverUrl) {
      devLog('[pipecat] pipecatServerUrl not set');
      return;
    }

    const httpBase = serverUrl.replace(/^wss?:\/\//, 'https://').replace(/\/+$/, '');
    const secret = process.env.EXPO_PUBLIC_PIPECAT_SECRET ?? '';

    onVoiceStateChange?.('thinking');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TURN_TIMEOUT_MS);

    try {
      const resp = await fetch(`${httpBase}/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          secret,
          text: transcript,
          history: historyRef.current,
          context: buildContext(),
          sessionId: sessionIdRef.current,
        }),
      });

      clearTimeout(timeout);

      if (!resp.ok) {
        devLog('[pipecat] /turn error:', resp.status);
        return;
      }

      const data = await resp.json() as {
        response_text: string;
        tool_actions: Array<Record<string, unknown>>;
        updated_history: ConversationMessage[];
      };

      // Update history, capped to avoid unbounded growth
      historyRef.current = (data.updated_history ?? []).slice(-MAX_HISTORY_TURNS * 2);

      // Dispatch tool actions to the RN UI (same handler as Kevin's tools)
      if (data.tool_actions?.length) {
        for (const raw of data.tool_actions) {
          onToolAction?.(raw as ToolAction);
        }
      }

      const text = data.response_text ?? '';

      // TTS via existing speak() path
      if (text) {
        onVoiceStateChange?.('speaking');
        onKevinSpoke?.(text);
        try {
          const settings = useSettingsStore.getState();
          await speak(text, settings.voiceGender, settings.language, getApiBaseUrl());
        } catch (e) {
          devLog('[pipecat] tts error:', e);
        }
      }

      onVoiceStateChange?.('idle');
    } catch (e) {
      clearTimeout(timeout);
      devLog('[pipecat] /turn fetch error:', e);
      onVoiceStateChange?.('idle');
    }
  }, [buildContext, onKevinSpoke, onToolAction, onVoiceStateChange]);

  /**
   * Phase 2 full pipeline: audio URI → Whisper STT → processTurn → speak.
   * Drop-in for useVoiceCaddie's processAudioUri when voiceOrchestrator === 'pipecat'.
   */
  const processAudioUri = useCallback(async (
    uri: string,
    opts?: { apiUrl?: string; language?: string },
  ): Promise<void> => {
    const apiUrl = opts?.apiUrl ?? useSettingsStore.getState().pipecatServerUrl
      ? useSettingsStore.getState().pipecatServerUrl.replace(/^wss?:\/\//, 'https://').replace(/\/+$/, '')
      : '';
    // STT: use existing Whisper transcribe endpoint (same as legacy path)
    const whisperUrl = (() => {
      // apiUrl here is the Vercel deployment URL, not the Pipecat server
      // The Pipecat server URL is for /turn; Vercel handles /api/transcribe
      const vercelBase = process.env.EXPO_PUBLIC_API_URL ?? '';
      return vercelBase ? `${vercelBase}/api/transcribe` : '/api/transcribe';
    })();

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
