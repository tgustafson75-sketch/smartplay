import { useState, useCallback } from 'react';
import { speakFromBase64, stopSpeaking } from '../services/voiceService';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { useRelationshipStore } from '../store/relationshipStore';
import { useRoundStore } from '../store/roundStore';
import { useSettingsStore } from '../store/settingsStore';
import type { ToolAction } from '../app/api/kevin+api';

export type { ToolAction };

interface KevinCallbacks {
  onToolAction?: (action: ToolAction) => void;
}

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8081';

export function useKevin(callbacks: KevinCallbacks = {}) {
  const [isThinking, setIsThinking] = useState(false);

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
    await stopSpeaking();

    try {
      const currentPar = getCurrentPar();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25_000);

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
        }),
      }).finally(() => clearTimeout(timeout));

      if (!res.ok) {
        setIsThinking(false);
        return "One shot at a time.";
      }

      const data = await res.json() as { text: string; audioBase64: string | null; toolAction: ToolAction | null };

      if (data.toolAction && callbacks.onToolAction) {
        callbacks.onToolAction(data.toolAction);
      }

      setIsThinking(false);

      if (data.audioBase64) {
        await speakFromBase64(data.audioBase64);
      }

      return data.text ?? "One shot at a time.";

    } catch (err) {
      console.log('[kevin] hook error:', err);
      setIsThinking(false);
      return "One shot at a time.";
    }
  }, [
    name, firstName, handicap, language, roundsTogether, sessionsTogether,
    currentHole, currentYardage, activeCourse,
    isRoundActive, isCompetition, club, scores, courseHoles,
    getCurrentPar, callbacks,
  ]);

  return { ask, isThinking };
}
