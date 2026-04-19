import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createMemoryProfile,
  updateMemoryWithShot,
  updateClubDistance,
  setResponseLength,
  type MemoryProfile,
  type ShotRecord,
} from "../engine/memoryEngine";
import {
  createRoundState,
  updateRoundState,
  markInsightShown,
  type RoundState,
  type RoundShot,
} from "../engine/roundEngine";
import {
  createPersonalityProfile,
  updatePersonality,
  setPlayerPersonality,
  type PersonalityProfile,
  type PersonalityMode,
} from "../engine/personalityEngine";
import {
  createIdentityProfile,
  updateIdentity,
  type IdentityProfile,
} from "../engine/identityEngine";
import {
  updateClubPerformance,
  type ShotResult,
} from "../engine/learningEngine";

export type CaddiePersonality = 'safe' | 'aggressive' | 'pro';

export interface PlayerModel {
  totalShots: number;
  misses: { left: number; right: number; straight: number };
}

const MEMORY_STORAGE_KEY      = '@smartplay_caddie_memory';
const PERSONALITY_STORAGE_KEY  = '@smartplay_caddie_personality';
const IDENTITY_STORAGE_KEY     = '@smartplay_caddie_identity';

interface CaddieContextValue {
  state: string;
  setState: (s: string) => void;
  mode: string;
  setMode: (m: string) => void;
  playerModel: PlayerModel;
  setPlayerModel: (m: PlayerModel) => void;
  personality: CaddiePersonality;
  setPersonality: (p: CaddiePersonality) => void;
  /** Persistent memory profile (tendencies, club distances, preferences) */
  memory: MemoryProfile;
  /** Record a shot and persist memory */
  addShotToMemory: (shot: ShotRecord) => void;
  /** Record a club distance sample and persist memory */
  recordClubDistance: (club: string, distance: number) => void;
  /** Toggle response length preference */
  setMemoryResponseLength: (length: 'short' | 'long') => void;
  /** Focus Mode personality profile */
  focusPersonality: PersonalityProfile;
  /** Let player manually override personality mode */
  setFocusPersonalityMode: (mode: PersonalityMode) => void;
  /** Long-term player identity */
  identity: IdentityProfile;
  /** Merge this round's memory into the long-term identity (call at round end) */
  finalizeRoundIdentity: () => void;
  /** Record a shot result for a club (learning loop) */
  recordShotResult: (club: string, result: ShotResult) => void;
  /** Live round intelligence state */
  roundState: RoundState;
  /** Record a shot into round intelligence (pass hole + distance for pressure detection) */
  addShotToRound: (shot: RoundShot, context?: { hole?: number; distance?: number | null }) => void;
  /** Mark that the latest round insight has been shown to the user */
  markRoundInsightShown: () => void;
  /** Reset round state at the start of a new round */
  resetRound: () => void;
}

const CaddieContext = createContext<CaddieContextValue | null>(null);

export const useCaddie = () => useContext(CaddieContext);

export const CaddieProvider = ({ children }: { children: React.ReactNode }) => {
  const [state, setState] = useState("idle"); // idle | listening | speaking
  const [mode, setMode] = useState("female");
  const [playerModel, setPlayerModel] = useState<PlayerModel>({
    totalShots: 0,
    misses: { left: 0, right: 0, straight: 0 },
  });
  const [personality, setPersonality] = useState<CaddiePersonality>('safe');
  const [memory, setMemory] = useState<MemoryProfile>(createMemoryProfile());
  const [roundState, setRoundState] = useState<RoundState>(createRoundState());
  const [focusPersonality, setFocusPersonality] = useState<PersonalityProfile>(
    createPersonalityProfile(),
  );
  const [identity, setIdentity] = useState<IdentityProfile>(createIdentityProfile());

  // ── Sync focusPersonality with round momentum ────────────────────────────
  useEffect(() => {
    setFocusPersonality((prev) => updatePersonality(prev, roundState));
  }, [roundState.momentum]);

  // ── Load persisted memory on mount ────────────────────────────────────────
  useEffect(() => {
    AsyncStorage.getItem(MEMORY_STORAGE_KEY).then((raw) => {
      if (raw) {
        try {
          const parsed: MemoryProfile = JSON.parse(raw);
          setMemory(parsed);
        } catch {
          // Corrupted storage — start fresh
        }
      }
    });

    AsyncStorage.getItem(PERSONALITY_STORAGE_KEY).then((raw) => {
      if (raw) {
        try {
          const parsed: PersonalityProfile = JSON.parse(raw);
          setFocusPersonality(parsed);
        } catch {}
      }
    });

    AsyncStorage.getItem(IDENTITY_STORAGE_KEY).then((raw) => {
      if (raw) {
        try {
          const parsed: IdentityProfile = JSON.parse(raw);
          setIdentity(parsed);
        } catch {}
      }
    });
  }, []);

  // ── Persist memory whenever it changes ────────────────────────────────────
  const persistMemory = useCallback((updated: MemoryProfile) => {
    setMemory(updated);
    AsyncStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(updated)).catch(() => {
      // Storage write failure is non-fatal
    });
  }, []);

  const addShotToMemory = useCallback((shot: ShotRecord) => {
    setMemory((prev) => {
      const updated = updateMemoryWithShot(prev, shot);
      AsyncStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(updated)).catch(() => {});
      return updated;
    });
  }, []);

  const recordClubDistance = useCallback((club: string, distance: number) => {
    setMemory((prev) => {
      const updated = updateClubDistance(prev, club, distance);
      AsyncStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(updated)).catch(() => {});
      return updated;
    });
  }, []);

  const setMemoryResponseLength = useCallback((length: 'short' | 'long') => {
    setMemory((prev) => {
      const updated = setResponseLength(prev, length);
      AsyncStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(updated)).catch(() => {});
      return updated;
    });
  }, []);

  const setFocusPersonalityMode = useCallback((mode: PersonalityMode) => {
    setFocusPersonality((prev) => {
      const updated = setPlayerPersonality(prev, mode);
      AsyncStorage.setItem(PERSONALITY_STORAGE_KEY, JSON.stringify(updated)).catch(() => {});
      return updated;
    });
  }, []);

  const finalizeRoundIdentity = useCallback(() => {
    setIdentity((prev) => {
      const updated = updateIdentity(prev, memory);
      AsyncStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(updated)).catch(() => {});
      return updated;
    });
  }, [memory]);

  const recordShotResult = useCallback((club: string, result: ShotResult) => {
    setMemory((prev) => {
      const updated = updateClubPerformance(prev, club, result);
      AsyncStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(updated)).catch(() => {});
      return updated;
    });
  }, []);

  const addShotToRound = useCallback(
    (shot: RoundShot, context: { hole?: number; distance?: number | null } = {}) => {
      setRoundState((prev) => updateRoundState(prev, shot, context));
    },
    [],
  );

  const markRoundInsightShown = useCallback(() => {
    setRoundState((prev) => markInsightShown(prev));
  }, []);

  const resetRound = useCallback(() => {
    setRoundState(createRoundState());
  }, []);

  return (
    <CaddieContext.Provider value={{
      state, setState,
      mode, setMode,
      playerModel, setPlayerModel,
      personality, setPersonality,
      memory,
      addShotToMemory,
      recordClubDistance,
      setMemoryResponseLength,
      roundState,
      addShotToRound,
      markRoundInsightShown,
      resetRound,
      focusPersonality,
      setFocusPersonalityMode,
      identity,
      finalizeRoundIdentity,
      recordShotResult,
    }}>
      {children}
    </CaddieContext.Provider>
  );
};
