import { useState, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { speakFromBase64, stopSpeaking } from '../services/voiceService';
import { checkContent } from '../services/contentGuardrail';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { useRelationshipStore } from '../store/relationshipStore';
import { useRoundStore } from '../store/roundStore';
import { useSettingsStore } from '../store/settingsStore';
import { useKevinPresence } from '../contexts/KevinPresenceContext';
import type { ToolAction } from '../app/api/kevin+api';
import { buildFullPracticeContext } from '../services/tutorialContext';
import { getGreenYardagesSync } from '../services/smartFinderService';
import { useSmartFinderStore } from '../store/smartFinderStore';
import { tryLocalReply } from '../services/localStatusResponder';
import { getCaddieContext, mergeMemoryIntoContext } from '../services/caddieMemoryRetrieval';
import { getApiBaseUrl } from '../services/apiBase';

export type { ToolAction };

// 2026-06-10 — Fail-safe brain fallback. If the brain call genuinely fails,
// answer LOCALLY when we can (on-course status questions resolve from device
// state with zero network), otherwise return a brief, non-alarming line — NOT
// a "no network / lost connection / hit a snag" wall. The caddie always says
// something useful.
function brainFallbackReply(message: string, language: string): string {
  const lang = (language === 'es' || language === 'zh') ? language : 'en';
  try {
    const local = tryLocalReply(message, lang);
    if (local?.text) return local.text;
  } catch { /* fall through to the brief line */ }
  if (lang === 'es') return 'Dame un segundo e inténtalo otra vez.';
  if (lang === 'zh') return '稍等一下，再问我一次。';
  return 'Give me one sec and ask me again.';
}

interface KevinCallbacks {
  onToolAction?: (action: ToolAction) => void;
}

export function useKevin(callbacks: KevinCallbacks = {}) {
  const [isThinking, setIsThinking] = useState(false);
  const { setIsThinking: setPresenceThinking } = useKevinPresence();

  // Audit follow-up (2026-05-13) — wrapped each multi-key destructure
  // in useShallow so unrelated store writes (e.g. a settings flip on a
  // theme toggle) don't force this hook + every component using it to
  // re-render. Functions are pulled separately via single-key selectors
  // since they're stable references.
  const { name, firstName, handicap } = usePlayerProfileStore(
    useShallow((s) => ({ name: s.name, firstName: s.firstName, handicap: s.handicap }))
  );
  const language = useSettingsStore((s) => s.language);
  const { roundsTogether, sessionsTogether } = useRelationshipStore(
    useShallow((s) => ({ roundsTogether: s.roundsTogether, sessionsTogether: s.sessionsTogether }))
  );
  const {
    currentHole, currentYardage, activeCourse,
    isRoundActive, isCompetition, club, scores, courseHoles, holeNotes,
  } = useRoundStore(
    useShallow((s) => ({
      currentHole: s.currentHole,
      currentYardage: s.currentYardage,
      activeCourse: s.activeCourse,
      isRoundActive: s.isRoundActive,
      isCompetition: s.isCompetition,
      club: s.club,
      scores: s.scores,
      courseHoles: s.courseHoles,
      holeNotes: s.holeNotes,
    }))
  );
  const getCurrentPar = useRoundStore((s) => s.getCurrentPar);

  const ask = useCallback(async (message: string): Promise<string> => {
    setIsThinking(true);
    setPresenceThinking(true);
    await stopSpeaking();

    try {
      const currentPar = getCurrentPar();
      const controller = new AbortController();
      // 2026-06-10 — 35s, not 25s. The server's Anthropic SDK timeout is 25s
      // and it can retry on a 529 overload; a 25s client abort could cut a
      // still-valid response right as it lands. 35s gives the server its full
      // window + network round-trip. (Voice path already uses 60s.)
      const timeout = setTimeout(() => controller.abort(), 35_000);

      // 2026-05-22 — Vision context. When a recent frame is in the
      // glassesVisionInput queue (lie capture, glasses POV, putting
      // setup), read it as base64 + pipe to the kevin endpoint as
      // image_base64. Server then switches to a multimodal Sonnet
      // call. Best-effort: failure paths (no frame queued, file gone,
      // expo-file-system not available) return null and Kevin
      // continues with text-only — no regression.
      let visionImage: { base64: string; media_type: 'image/jpeg' | 'image/png'; caption: string } | null = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const vis = require('../services/glassesVisionInput') as typeof import('../services/glassesVisionInput');
        visionImage = await vis.getActiveVisionFrameBase64();
      } catch (e) {
        console.log('[kevin] vision frame fetch failed (non-fatal):', e);
      }

      // 2026-05-23 — Unified vision context. Composes GPS + hole +
      // geometry + active vision + recent shots into a single
      // promptBlock the brain can quote. Best-effort; null on
      // failure / no active round.
      let unifiedPromptBlock: string | null = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const uv = require('../services/unifiedVisionContext') as typeof import('../services/unifiedVisionContext');
        const ctx = await uv.getUnifiedVisionContext();
        unifiedPromptBlock = ctx.promptBlock;
      } catch (e) {
        console.log('[kevin] unified context fetch failed (non-fatal):', e);
      }

      // Phase BA — register selection from active surface. Maps the
      // tracked surface to one of three role registers so the API can
      // build a tone-distinct system prompt:
      //   caddie      → on-course tactical voice
      //   coach       → cage / swing review reflective voice
      //   psychologist→ between-shots / arena / recap supportive voice
      // Falls back to caddie when no surface is registered.
      let register: 'caddie' | 'coach' | 'psychologist' = 'caddie';
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { getActiveSurface } = require('../services/activeSurfaceRegistry');
        const surface = getActiveSurface();
        if (surface === 'cage' || surface === 'swing_library' || surface === 'swing_detail') {
          register = 'coach';
        } else if (surface === 'arena' || surface === 'recap') {
          register = 'psychologist';
        } else {
          register = 'caddie';
        }
      } catch { /* default caddie */ }

      // Phase BS audit (2026-05-14) — give the brain the same yardages the
      // user sees on the Caddie tab so "how far to the pin?" returns a
      // crisp answer instead of "I don't have a clean GPS read." The
      // server side (api/kevin.ts:610) already consumes smartFinderContext
      // and pins the working number into the system prompt.
      const smartFinderContext = (() => {
        if (!isRoundActive) return null;
        const fmb = getGreenYardagesSync(currentHole);
        const lock = useSmartFinderStore.getState().currentLock;
        const parts: string[] = [];
        if (fmb && (fmb.front != null || fmb.middle != null || fmb.back != null)) {
          parts.push(`Live GPS to green — front ${fmb.front ?? '?'}, middle ${fmb.middle ?? '?'}, back ${fmb.back ?? '?'} yards.`);
        }
        if (lock && typeof lock.distance_yards === 'number') {
          parts.push(`Locked target: ${lock.distance_yards} yards.`);
        }
        return parts.length > 0 ? parts.join(' ') : null;
      })();

      // 2026-07-07 (audit) — read the LIVE host at call time. This was frozen to the
      // module-load host, so after a mid-session dual-host failover the typed/tapped
      // chat kept hitting the dead host forever (the voice path was already fixed for
      // exactly this; useKevin wasn't).
      const res = await fetch(getApiBaseUrl() + '/api/kevin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          message,
          language,
          playerName: name,
          firstName,
          handicap,
          smartFinderContext,
          roundsTogether,
          sessionsTogether,
          currentHole,
          currentPar,
          currentYardage,
          activeCourse,
          holeNotes,
          isRoundActive,
          isCompetition,
          club,
          scores,
          courseHoles,
          register, // Phase BA
          // Phase BR — active practice context from tutorialStore.
          practice_context: buildFullPracticeContext(),
          // PGA HOPE follow-up — persona, intensity dial, Tank soft-intro.
          persona: useSettingsStore.getState().caddiePersonality,
          personaIntensity: useSettingsStore.getState().personaIntensity?.[useSettingsStore.getState().caddiePersonality] ?? 100,
          tankSoftIntro: useSettingsStore.getState().tankSoftIntro,
          // Phase 409 — TightLie pending lie analysis. Read straight
          // from roundStore (NOT a destructured prop) so the latest
          // value is sent on each request without forcing a re-render
          // of every consumer of useKevin when the lie changes.
          pendingLieAnalysis: (() => {
            try {
              return useRoundStore.getState().pendingLieAnalysis;
            } catch { return null; }
          })(),
          // 2026-05-22 — Brain prompt builder integration. Three layers
          // of golfer-specific context fold into Kevin's system prompt:
          //   - kevinContext: prior Sonnet onboarding profile (existing
          //     field, just was never being sent — now plumbed through)
          //   - golfer_model_snippet: derived tendency snapshot from
          //     services/golferModel.buildGolferModel()
          //   - recent_analyses_snippet: condensed string of the last 8
          //     smartAnalysisEngine envelopes for continuity
          // Every fetch is best-effort; failures fall through to null
          // and Kevin just doesn't get that layer of context (no regression).
          kevinContext: (() => {
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const p = require('../store/playerProfileStore') as typeof import('../store/playerProfileStore');
              return p.usePlayerProfileStore.getState().kevinContext;
            } catch { return null; }
          })(),
          golfer_model_snippet: (() => {
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const gm = require('../services/golferModel') as typeof import('../services/golferModel');
              return gm.buildGolferModel().prompt_snippet;
            } catch { return null; }
          })(),
          recent_analyses_snippet: (() => {
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const eng = require('../services/smartAnalysisEngine') as typeof import('../services/smartAnalysisEngine');
              const recent = eng.getRecentAnalyses(8);
              if (recent.length === 0) return null;
              return recent
                .map((r) => `[${r.kind}] ${r.voice_summary}`)
                .join('\n');
            } catch { return null; }
          })(),
          // 2026-05-22 — Vision frame. When present, api/kevin upgrades
          // the call to a multimodal Sonnet pass so the caddie can
          // "see" what the player just captured (lie photo, glasses
          // POV, putting setup). Server treats absent / null as the
          // existing text-only path.
          image_base64: visionImage?.base64 ?? null,
          image_media_type: visionImage?.media_type ?? null,
          image_caption: visionImage?.caption ?? null,
          // 2026-05-23 — Unified context prompt block — GPS + hole +
          // geometry + recent shots + vision in one composed
          // newline-separated block, server pastes verbatim into the
          // system prompt. Null when no round / no data.
          // 2026-06-10 — CNS Phase 2: fold in the learned-memory slice (bag,
          // course/hole history, tendencies). Additive — merges into the same
          // block the server already pastes; empty memory → unchanged.
          unified_context_block: mergeMemoryIntoContext(
            unifiedPromptBlock,
            getCaddieContext({
              courseId: useRoundStore.getState().activeCourseId,
              hole: currentHole,
              club,
            }).promptBlock,
          ),
        }),
      }).finally(() => clearTimeout(timeout));

      if (!res.ok) {
        setIsThinking(false);
        setPresenceThinking(false);
        return brainFallbackReply(message, language);
      }

      const raw = await res.json() as { text: string; audioBase64: string | null; toolAction: ToolAction | null };
      const { text, audioBase64 } = checkContent(raw.text, raw.audioBase64);

      if (raw.toolAction && callbacks.onToolAction) {
        callbacks.onToolAction(raw.toolAction);
      }

      setIsThinking(false);
      setPresenceThinking(false);

      // 2026-05-23 — Surface API overload as a clear toast so the
      // player understands the "servers are busy" message isn't a
      // bug. The brain endpoint returns the overload-specific
      // string starting with "Servers are busy" (see api/kevin.ts
      // OVERLOAD_FALLBACK_KEVIN). When we detect that prefix, emit
      // a one-time toast in addition to the normal spoken reply.
      if (text && /^Servers are busy|servidores están saturados|服务器目前繁忙/i.test(text)) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const toast = require('../store/toastStore') as typeof import('../store/toastStore');
          toast.useToastStore.getState().show('Servers busy — try in a few seconds');
        } catch { /* non-fatal */ }
      }

      if (audioBase64) {
        await speakFromBase64(audioBase64);
      }

      return text ?? "Got nothing back from the brain. Try again.";

    } catch (err) {
      console.log('[kevin] hook error:', err);
      setIsThinking(false);
      setPresenceThinking(false);
      return brainFallbackReply(message, language);
    }
  }, [
    name, firstName, handicap, language, roundsTogether, sessionsTogether,
    currentHole, currentYardage, activeCourse,
    isRoundActive, isCompetition, club, scores, courseHoles, holeNotes,
    getCurrentPar, callbacks,
  ]);

  return { ask, isThinking };
}
