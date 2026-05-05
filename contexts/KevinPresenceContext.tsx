import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { subscribeToSpeaking } from '../services/voiceService';

type KevinMode = 'full' | 'badge' | 'hidden';

interface KevinPresenceState {
  mode: KevinMode;
  isThinking: boolean;
  isSpeaking: boolean;
}

interface KevinPresenceContextValue extends KevinPresenceState {
  setMode: (mode: KevinMode) => void;
  setIsThinking: (thinking: boolean) => void;
  setIsSpeaking: (speaking: boolean) => void;
}

const KevinPresenceContext = createContext<KevinPresenceContextValue | null>(null);

export function KevinPresenceProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<KevinMode>('full');
  const [isThinking, setIsThinking] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  useEffect(() => {
    return subscribeToSpeaking(setIsSpeaking);
  }, []);

  // Audit 101 / W6 — memoize the context value so consumers re-render
  // only when one of the listed state fields changes. Setters from
  // useState are stable references; React's `dispatch` from useState
  // never changes identity across renders, so they don't need their own
  // dep tracking.
  const value = useMemo(
    () => ({ mode, isThinking, isSpeaking, setMode, setIsThinking, setIsSpeaking }),
    [mode, isThinking, isSpeaking],
  );

  return (
    <KevinPresenceContext.Provider value={value}>
      {children}
    </KevinPresenceContext.Provider>
  );
}

export function useKevinPresence() {
  const ctx = useContext(KevinPresenceContext);
  if (!ctx) throw new Error('useKevinPresence must be used within KevinPresenceProvider');
  return ctx;
}
