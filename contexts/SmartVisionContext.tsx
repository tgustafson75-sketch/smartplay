import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';

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

  // Audit 101 / W6 — memoize the context value so consumers re-render
  // only when state or the (stable) setter actually change. Prior code
  // built a new value object on every Provider render, defeating React's
  // memoization for downstream consumers.
  const value = useMemo(
    () => ({ ...state, setSmartVisionState }),
    [state, setSmartVisionState],
  );

  return (
    <SmartVisionContext.Provider value={value}>
      {children}
    </SmartVisionContext.Provider>
  );
}

export function useSmartVision() {
  return useContext(SmartVisionContext);
}
