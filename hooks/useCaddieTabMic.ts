/**
 * THE CADDIE-TAB MIC — one voice turn, end to end.
 *
 * 2026-09-01 — renamed off "pipecat". The route that word named is deleted, and the header below
 * described a pipeline this hook has not used since the unification: it posts the ONE payload to
 * /api/kevin through askCaddie, like every other surface.
 *
 *   Audio: expo-av → Whisper STT (/api/transcribe) → transcript
 *   Brain: askCaddie → /api/kevin (tools + reply, persona TTS already rendered server-side)
 *   TTS:   the existing speak() path
 *
 * Phase 3 (future): real-time audio streaming via WebSocket.
 *   openSession() / connect() / pushGpsUpdate() / closeSession() are scaffold for Phase 3.
 */

import { useRef, useCallback } from 'react';
import { useSettingsStore } from '../store/settingsStore';
import { askCaddie } from '../services/caddieBrain';
import { recordKevinTurn } from '../services/conversationState';
import { endsAsQuestion, isCloseIntent } from './useVoiceCaddie';
import { speak } from '../services/voiceService';
import { getApiBaseUrl, markEndpointWarmed, isEndpointWarmed } from '../services/apiBase';
import { devLog } from '../services/devLog';
// 2026-07-01 (audit — MIC CONVERGENCE) — the ONE shared pipecat history, so this
// mic and the earbud/badge path keep the same conversation + reset together.
import { clearConversationHistory } from '../services/voice/conversationHistory';
import { useConversationLog } from '../store/conversationLogStore';
import type { ToolAction } from '../types/toolAction';

// Simplified history entry — persisted in a ref, sent to /turn each call
/**
 * 2026-08-23 — ConversationMessage / PipecatToolAction / PipecatUIEvent / PipecatSessionState are
 * gone. Every one described the Phase-3 WebSocket session that was deleted above, every one had
 * ZERO importers anywhere in the app, and `state` was returned from this hook permanently reading
 * 'idle' because the only function that ever advanced it was unreachable. A type nobody imports and
 * a field that cannot change are not API surface — they are the residue that makes a dead path look
 * live to the next audit.
 */

// 2026-06-23 (audit) — was 20s but the server turn budget is 30s, so a
// healthy-but-slow turn got aborted client-side on good signal. Match 30s.
// 2026-07-20 (pre-ship audit) — 30s → 35s. The server's provider cascade worst case is
// ~27s (3×9s); at exactly 30s a cold Lambda + network could tip a HEALTHY turn past the
// client abort before the server's graceful reply lands. 35s keeps the client budget
// strictly above the server cascade so we never cancel a turn that's about to answer.
const TURN_TIMEOUT_MS = 35_000;
// History cap now lives in services/voice/conversationHistory.ts (the shared history).

interface UsePipecatVoiceOpts {
  // 2026-08-23 — onUIEvent / onStateChange are gone with the Phase-3 WebSocket scaffold. Both were
  // fired ONLY from the WS message handler, so a caddie.tsx that passed onUIEvent was wiring a
  // callback to a socket that never opened. Removing the props is what makes that visible; leaving
  // them accepted-and-ignored is how a dead wire survives an audit.
  onKevinSpoke?: (text: string) => void;
  onToolAction?: (action: ToolAction) => void;
  onVoiceStateChange?: (state: 'idle' | 'listening' | 'thinking' | 'speaking') => void;
  onReadyToListen?: () => void;
}

export function useCaddieTabMic({
  onKevinSpoke,
  onToolAction,
  onVoiceStateChange,
  onReadyToListen,
}: UsePipecatVoiceOpts = {}) {
  // 2026-07-06 (voice-parity F2) — one brain turn at a time. A mic tap while the
  // caddie is still 'thinking' releases isProcessingRef in the consumer BEFORE
  // this await resolves, so a second processTurn could start and race the ONE
  // shared pipecat history (last-writer-wins), double-award points, and log two
  // turns. This ref makes processTurn re-entrancy-safe at the true chokepoint.
  const turnInFlightRef = useRef(false);

  /**
   * 2026-08-23 — the Phase-3 WebSocket scaffold is GONE (openSession / closeSession / pushMessage /
   * pushGpsUpdate / pushHoleTransition / buildContext).
   *
   * It streamed audio to a Railway-hosted Python pipecat server. That server was never deployed:
   * `pipecatServerUrl` defaults to '' and no screen in the app can set it, so openSession's very
   * first act was to log "orchestrator inactive" and set state 'error'. Nothing called it either —
   * the caddie tab only ever used processTurn. Six exported functions, a WebSocket lifecycle and a
   * keep-alive ping, none of it reachable.
   *
   * It was also the last consumer of buildPipecatContext in this hook: dead code holding a second
   * payload builder alive. [[unconnected-halves-not-broken-code]]
   */


  /** Clear conversation history (call on round end or new session). */
  const clearHistory = useCallback(() => {
    clearConversationHistory();
  }, []);

  /**
   * One turn with the caddie: transcript in → the caddie's answer spoken, his tools dispatched.
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

    onVoiceStateChange?.('thinking');

    // Once we've spoken a real response, a later throw (e.g. from auto-listen) must NOT be treated
    // as a failed turn — that would double-answer the player.
    let spokeResponse = false;

    /**
     * 2026-08-23 (Tim, sprint finish) — ONE BRAIN, ONE PAYLOAD, ONE VOICE.
     *
     * This hook is the caddie-tab mic — one of the two hands-free surfaces Tim actually plays with.
     * It used to POST a second, differently-shaped payload (buildPipecatContext) to a second brain
     * (/api/pipecat-turn), while the text box and the follow-up mic posted the unified payload to
     * /api/kevin. Same question, two caddies, and which one you got depended on how you asked. That
     * is the "going back and forth" he kept describing, and it was live on the surface he uses most.
     *
     * askCaddie is now the only way any surface reaches the caddie. The reply also arrives with the
     * persona's REAL voice already rendered (kevin TTS's server-side), so the turn no longer waits
     * on a second round-trip to start speaking.
     */
    try {
      const turn = await askCaddie({
        message: transcript,
        language: useSettingsStore.getState().language ?? 'en',
        timeoutMs: TURN_TIMEOUT_MS,
      });

      /**
       * No answer. NOT a cue to hand the player a lesser caddie — that ladder (offline responder →
       * canned line → device robot voice) is what made the app sound generic when the network
       * hiccuped, and it fired far more often than a real outage. Keep what he said so nothing is
       * lost, tell him the truth in one line, and stop.
       */
      if (!turn) {
        const settings = useSettingsStore.getState();
        const lang = (['en', 'es', 'zh'] as const).includes(settings.language as never) ? (settings.language as 'en' | 'es' | 'zh') : 'en';
        onVoiceStateChange?.('speaking');
        let captured = false;
        try {
          const { captureOfflineStatement } = await import('../services/voiceLogService');
          captured = captureOfflineStatement(transcript);
        } catch { /* capture is best-effort */ }
        const line = captured
          ? "I didn't get that through just now, but I saved what you said. I'll pick it back up in a second."
          : "I lost you for a second there — say that again.";
        onKevinSpoke?.(line);
        const { speakDeviceNotice } = await import('../services/voiceService');
        await speakDeviceNotice(line, lang, settings.voiceGender).catch(() => {});
        onVoiceStateChange?.('idle');
        return;
      }

      const text = turn.text;

      // Dispatch tool actions to the RN UI (the same dispatcher every surface uses).
      for (const a of turn.toolActions) onToolAction?.(a as ToolAction);

      // 2026-06-30 (Tim — "a log for the WHOLE voice") — his words → the caddie's reply → which
      // tool(s) fired, in the owner issue log. Lets him SEE when the brain jumped to a tool instead
      // of answering conversationally: the "too predictive" signal. Owner-gated, best-effort.
      try {
        const tool = turn.toolActions.length
          ? turn.toolActions.map((a) => (a as { type?: string })?.type).filter(Boolean).join(',')
          : null;
        require('../store/issueLogStore').useIssueLogStore.getState().addVoiceTurn(transcript, text, { path: 'brain', tool });
      } catch { /* best-effort */ }

      try { require('../store/pointsStore').usePointsStore.getState().addPoints(3, 'caddie_interaction'); } catch { /* best-effort */ }

      spokeResponse = true;
      onVoiceStateChange?.('speaking');
      onKevinSpoke?.(text);
      recordKevinTurn(text);
      try {
        const settings = useSettingsStore.getState();
        /**
         * The persona voice the server already rendered. Playing it directly is what closes the gap
         * between the caption appearing and the caddie speaking — the second TTS round-trip this
         * path used to make was most of that wait.
         */
        if (turn.audioBase64) {
          const { speakFromBase64 } = await import('../services/voiceService');
          await speakFromBase64(turn.audioBase64, { userInitiated: true, caption: text });
        } else {
          await speak(text, settings.voiceGender, settings.language, getApiBaseUrl(), { userInitiated: true });
        }
      } catch (e) {
        devLog('[caddie] tts error:', e);
      }

      onVoiceStateChange?.('idle');

      // Auto-listen: always in continuous mode; on any question otherwise.
      if (text.trim() && onReadyToListen) {
        const { continuousConversationMode } = useSettingsStore.getState();
        const isQuestion = endsAsQuestion(text);
        // 2026-06-30 (Tim) — a sign-off ("I'm good, thanks" / "that's all") must END the
        // conversation, not re-open the mic. The caddie still speaks its sign-off; we simply
        // don't listen again.
        const userSignedOff = isCloseIntent(transcript);
        if (!userSignedOff && (continuousConversationMode || isQuestion)) {
          await new Promise<void>((r) => setTimeout(r, 500));
          onReadyToListen();
        }
      }
    } catch (e) {
      devLog('[caddie] turn error:', e);
      if (!spokeResponse) onVoiceStateChange?.('idle');
    } finally {
      // 2026-07-06 (voice-parity F2) — always release so the NEXT tap/turn works.
      turnInFlightRef.current = false;
    }
  }, [onKevinSpoke, onReadyToListen, onToolAction, onVoiceStateChange]);

  /**
   * Phase 2 full pipeline: audio URI → Whisper STT → processTurn → speak.
   * Drop-in for useVoiceCaddie's processAudioUri — the only processor there is.
   */
  /**
   * 2026-08-19 — the same cold-vs-warm budget the tap path uses (useVoiceCaddie's 12s/22s), so the two
   * audio entries can no longer disagree about how long a first turn is allowed to take. The cold
   * number is the one that matters: it is what lets a first turn wait out a cold Lambda instead of
   * aborting into a failure the player reads as "the app is broken".
   */
  const PIPECAT_WARM_TRANSCRIBE_MS = 12_000;
  const PIPECAT_COLD_TRANSCRIBE_MS = 22_000;

  /**
   * 2026-08-19 — never go mute. Every failure on this path used to end in `onVoiceStateChange('idle')`
   * with nothing said and nothing shown, which is exactly what Tim hit: "going straight to failure
   * state… not seeing any text when he talks."
   *
   * The tap path already had the right answer — localStatusResponder.deadEndLine() speaks to what the
   * app ALWAYS knows locally (the shot in front of you, or the practice nudge off-course) rather than
   * announcing a network problem. Routed through the same responder so both paths degrade identically
   * and the caddie stays a person about it. The line goes through onKevinSpoke too, so the TEXT
   * appears alongside the speech instead of only audio.
   */
  const speakDeadEnd = useCallback((reason: string) => {
    devLog('[pipecat] degrading to local line:', reason);
    /**
     * 2026-08-19 (Tim — "make sure we have some special logic in the issue catching and issue log.
     * They can catch the first turn logic").
     *
     * This degrade was devLog-only, which means it was INVISIBLE in the issue log — the app could
     * fall back to the canned local line on every single turn and the log would read as healthy.
     * That is the same shape as the 08-17 busy-bail: an unlogged failure path is indistinguishable
     * from no failure at all, and it is exactly why this took a live test to find.
     *
     * logVoiceSilentFail is a REPORTABLE kind, so it reaches the owner inbox, and voiceErrorLog now
     * stamps first_turn / warmed / turn on every entry — so "the first turn always fails" is legible
     * from the log itself instead of needing someone to reproduce it.
     */
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('../services/voiceErrorLog') as typeof import('../services/voiceErrorLog'))
        .logVoiceSilentFail('pipecat_degrade', { reason, path: 'pipecat_audio' });
    } catch { /* never throw from a failure path */ }
    let line = "Let's stay on this one — what are you working with?";
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const responder = require('../services/localStatusResponder') as typeof import('../services/localStatusResponder');
      const lang = useSettingsStore.getState().language;
      const langSafe = (['en', 'es', 'zh'] as const).includes(lang as 'en' | 'es' | 'zh')
        ? (lang as 'en' | 'es' | 'zh') : 'en';
      line = responder.deadEndLine(langSafe);
    } catch { /* keep the neutral fallback */ }
    try { onKevinSpoke?.(line); } catch { /* non-fatal */ }
    try {
      const s = useSettingsStore.getState();
      if (s.voiceEnabled) void speak(line, s.voiceGender, s.language, getApiBaseUrl(), { userInitiated: true });
    } catch { /* speech is best-effort; the text is already out */ }
    onVoiceStateChange?.('idle');
  }, [onKevinSpoke, onVoiceStateChange]);

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
    // 2026-08-19 — number this turn so a failure below says WHICH turn it was. "Always the 1st" and
    // "the 1st and the 9th" are different bugs and used to look identical in the log.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('../services/voiceErrorLog') as typeof import('../services/voiceErrorLog')).noteVoiceTurnStarted();
    } catch { /* advisory */ }

    try {
      const formData = new FormData();
      formData.append('audio', { uri, type: 'audio/m4a', name: 'audio.m4a' } as unknown as Blob);
      formData.append('language', opts?.language ?? useSettingsStore.getState().language ?? 'en');

      /**
       * 2026-08-19 (Tim, testing live: "Kevin's not answering correctly, it's going straight to
       * failure state… I'm also not seeing any text when he talks" — then, once it warmed up,
       * "eventually it did work… you know what a stable thing this needs to be and to make sure it
       * works the FIRST time").
       *
       * THIS PATH HAD THREE GAPS THE TAP PATH DOES NOT, and they compound on exactly the turn that
       * matters most — the first one after opening the app.
       *
       * 1. THE BUDGET WAS BLIND TO COLD START. A flat 20s, while useVoiceCaddie runs 12s warm and 22s
       *    COLD, gated on isConnectionWarmed(). The first turn is the one that has to wait out a cold
       *    Lambda, and it was the one given the least patience relative to its need. Now both paths
       *    read the same gate, so there is one answer in the app to "how long do we wait".
       *
       * 2. IT NEVER MARKED THE CONNECTION WARM. Even after a transcribe SUCCEEDED — proof the host is
       *    up and warm — this path never called markConnectionWarmed(). So every turn through it kept
       *    paying cold-path costs, and the tap path could not benefit from a warm connection this one
       *    had already established. The two paths were not sharing what they had each learned.
       *
       * 3. IT FAILED SILENTLY — the one Tim actually saw. A failed transcribe, an empty transcript or
       *    any thrown error all did `onVoiceStateChange('idle')` and returned: no speech, no text, no
       *    explanation. That IS the "failure state with no text". The tap path degrades gracefully
       *    into localStatusResponder.deadEndLine() — the caddie says something true about the shot in
       *    front of you instead of going mute. Silence is the most robotic possible failure, and this
       *    path chose it three times over. [[caddie-failsafe-no-walls]] [[feels-like-a-real-caddie]]
       */
      // Same correction as the tap path: transcribe's own warmth, not the backend's in general.
      const coldFirstTurn = !isEndpointWarmed('/api/transcribe');
      /**
       * 2026-08-20 (adversarial audit of the 08-19/08-20 voice work) — THIS PATH HAD NO RETRY.
       *
       * The other two uploaders both get a second attempt: useVoiceCaddie retries the real upload
       * after a failure, and captureUtterance does 25s then 15s. This one fired a single fetch and,
       * on the first AbortError, went straight to speakDeadEnd('transcribe_timeout') — which is
       * exactly the "goes straight to failure state" Tim reported, on exactly the turn (the first,
       * cold one) where a single attempt is least likely to land.
       *
       * A retry is the correct shape here for the same reason it is elsewhere: a request that would
       * have succeeded is completely unaffected, and only a genuinely failed first attempt pays for
       * it. Bounded at cold + 12s so the worst case stays inside what a person will wait through
       * before the caddie says something honest instead.
       */
      const doPipecatFetch = (timeoutMs: number) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        return fetch(whisperUrl, {
          method: 'POST',
          // Rebuild per attempt — a consumed multipart stream cannot be safely re-sent.
          body: (() => {
            const fd = new FormData();
            fd.append('audio', { uri, type: 'audio/m4a', name: 'audio.m4a' } as unknown as Blob);
            fd.append('language', opts?.language ?? useSettingsStore.getState().language ?? 'en');
            return fd;
          })(),
          signal: controller.signal,
        }).finally(() => clearTimeout(timeout));
      };

      let transcribeRes: Response;
      try {
        transcribeRes = await doPipecatFetch(coldFirstTurn ? PIPECAT_COLD_TRANSCRIBE_MS : PIPECAT_WARM_TRANSCRIBE_MS);
      } catch {
        devLog('[pipecat] first transcribe attempt failed — retrying once before degrading');
        await new Promise(r => setTimeout(r, 600));
        transcribeRes = await doPipecatFetch(12_000);
      }

      if (!transcribeRes.ok) {
        devLog('[pipecat] transcribe failed:', transcribeRes.status);
        speakDeadEnd(`transcribe_${transcribeRes.status}`);
        return;
      }

      const { text: transcript = '' } = await transcribeRes.json() as { text?: string };

      // A transcribe that came back at all proves the host is up and warm — tell the shared gate, so
      // the NEXT turn (on either path) takes the fast budget instead of re-paying cold patience.
      markEndpointWarmed('/api/transcribe');

      if (!transcript.trim()) {
        // Heard nothing intelligible. Not an error — answer like a person and invite another go,
        // rather than going silent and leaving the player wondering if the app is broken.
        devLog('[pipecat] empty transcript');
        speakDeadEnd('empty_transcript');
        return;
      }

      devLog('[pipecat] transcript:', transcript);
      await processTurn(transcript);
    } catch (e) {
      devLog('[pipecat] processAudioUri error:', e);
      speakDeadEnd(e instanceof Error && e.name === 'AbortError' ? 'transcribe_timeout' : 'transcribe_error');
    }
  }, [processTurn, onVoiceStateChange, speakDeadEnd]);

  return { processTurn, processAudioUri, clearHistory };
}
