import React, { createContext, useContext, useState, useEffect } from 'react';
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

  return (
    <KevinPresenceContext.Provider
      value={{ mode, isThinking, isSpeaking, setMode, setIsThinking, setIsSpeaking }}
    >
      {children}
    </KevinPresenceContext.Provider>
  );
}

export function useKevinPresence() {
  const ctx = useContext(KevinPresenceContext);
  if (!ctx) throw new Error('useKevinPresence must be used within KevinPresenceProvider');
  return ctx;
}
