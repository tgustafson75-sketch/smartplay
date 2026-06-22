/**
 * Pipecat voice orchestrator hook.
 *
 * Replaces the batch STT → intent classify → Kevin API chain in useVoiceCaddie
 * when settingsStore.voiceOrchestrator === 'pipecat'.
 *
 * Flow:
 *   1. openSession()   — POST /session to Pipecat server → get sessionId + wsUrl
 *   2. connect()       — open WebSocket, send `context` message with full state
 *   3. startStreaming() — stream mic audio via expo-av PCM chunks
 *   4. Audio frames arrive back → played via speakFromBase64
 *   5. UI-event frames (open_smartvision, etc.) dispatched to RN navigation
 *   6. GPS / hole delta messages pushed as state changes
 *   7. closeSession()  — close WebSocket, clean up
 *
 * Phase 1: session lifecycle + context injection + UI event dispatch.
 * Phase 3 wires the full microphone streaming path.
 */

import { useRef, useCallback } from 'react';
import { useRoundStore } from '../store/roundStore';
import { useSettingsStore } from '../store/settingsStore';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { useTrustLevelStore } from '../store/trustLevelStore';
import { getLastFix } from '../services/gpsManager';
import { devLog } from '../services/devLog';

export type PipecatUIEvent =
  | 'open_smartvision'
  | 'open_smartfinder'
  | 'open_swinglab'
  | 'record_swing';

export type PipecatSessionState = 'idle' | 'connecting' | 'connected' | 'error' | 'closed';

interface UsePipecatVoiceOpts {
  onUIEvent?: (event: PipecatUIEvent, data: Record<string, unknown>) => void;
  onStateChange?: (state: PipecatSessionState) => void;
  onKevinSpoke?: (text: string) => void;
}

export function usePipecatVoice({
  onUIEvent,
  onStateChange,
  onKevinSpoke,
}: UsePipecatVoiceOpts = {}) {
  const wsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const stateRef = useRef<PipecatSessionState>('idle');
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  return {
    openSession,
    closeSession,
    pushGpsUpdate,
    pushHoleTransition,
    pushMessage,
    sessionId: sessionIdRef.current,
    state: stateRef.current,
  };
}
