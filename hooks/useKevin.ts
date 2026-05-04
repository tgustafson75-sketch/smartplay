import { useState, useCallback } from 'react';
import { speakFromBase64, stopSpeaking } from '../services/voiceService';
import { checkContent } from '../services/contentGuardrail';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { useRelationshipStore } from '../store/relationshipStore';
import { useRoundStore } from '../store/roundStore';
import { useSettingsStore } from '../store/settingsStore';
import { useKevinPresence } from '../contexts/KevinPresenceContext';
import type { ToolAction } from '../app/api/kevin+api';

export type { ToolAction };

interface KevinCallbacks {
  onToolAction?: (action: ToolAction) => void;
}

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8081';

export function useKevin(callbacks: KevinCallbacks = {}) {
  const [isThinking, setIsThinking] = useState(false);
  const { setIsThinking: setPresenceThinking } = useKevinPresence();

  const { name, firstName, handicap } = usePlayerProfileStore();
  const { language } = useSettingsStore();
  const { roundsTogether, sessionsTogether } = useRelationshipStore();
  const {
    currentHole, currentYardage, activeCourse,
    isRoundActive, isCompetition, club, scores, courseHoles,
    getCurrentPar,
  } = useRoundStore();

  const ask = useCallback(async (message: string): Promise<string> => {
    setIsThinking(true);
    setPresenceThinking(true);
    await stopSpeaking();

    try {
      const currentPar = getCurrentPar();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25_000);

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

      const res = await fetch(API_URL + '/api/kevin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          message,
          language,
          playerName: name,
          firstName,
          handicap,
          roundsTogether,
          sessionsTogether,
          currentHole,
          currentPar,
          currentYardage,
          activeCourse,
          isRoundActive,
          isCompetition,
          club,
          scores,
          courseHoles,
          register, // Phase BA
        }),
      }).finally(() => clearTimeout(timeout));

      if (!res.ok) {
        setIsThinking(false);
        setPresenceThinking(false);
        return "Sorry, lost you for a moment. Try again.";
      }

      const raw = await res.json() as { text: string; audioBase64: string | null; toolAction: ToolAction | null };
      const { text, audioBase64 } = checkContent(raw.text, raw.audioBase64);

      if (raw.toolAction && callbacks.onToolAction) {
        callbacks.onToolAction(raw.toolAction);
      }

      setIsThinking(false);
      setPresenceThinking(false);

      if (audioBase64) {
        await speakFromBase64(audioBase64);
      }

      return text ?? "Got nothing back from the brain. Try again.";

    } catch (err) {
      console.log('[kevin] hook error:', err);
      setIsThinking(false);
      setPresenceThinking(false);
      return "Hit a snag on my end. Try again.";
    }
  }, [
    name, firstName, handicap, language, roundsTogether, sessionsTogether,
    currentHole, currentYardage, activeCourse,
    isRoundActive, isCompetition, club, scores, courseHoles,
    getCurrentPar, callbacks,
  ]);

  return { ask, isThinking };
}
