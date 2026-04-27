import React, { createContext, useContext, useState, useCallback } from 'react';

export interface SmartVisionState {
  isOpen: boolean;
  holeNumber: number | null;
  par: number | null;
  centerYards: number | null;
  measureYards: number | null;
  analysisText: string | null;
}

interface SmartVisionContextValue extends SmartVisionState {
  setSmartVisionState: (patch: Partial<SmartVisionState>) => void;
}

const DEFAULT_STATE: SmartVisionState = {
  isOpen: false,
  holeNumber: null,
  par: null,
  centerYards: null,
  measureYards: null,
  analysisText: null,
};

const SmartVisionContext = createContext<SmartVisionContextValue>({
  ...DEFAULT_STATE,
  setSmartVisionState: () => {},
});

export function SmartVisionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SmartVisionState>(DEFAULT_STATE);

  const setSmartVisionState = useCallback((patch: Partial<SmartVisionState>) => {
    setState(prev => ({ ...prev, ...patch }));
  }, []);

  return (
    <SmartVisionContext.Provider value={{ ...state, setSmartVisionState }}>
      {children}
    </SmartVisionContext.Provider>
  );
}

export function useSmartVision() {
  return useContext(SmartVisionContext);
}
