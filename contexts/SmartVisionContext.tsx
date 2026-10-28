import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import { useSmartVisionSignalStore } from '../store/smartVisionSignalStore';

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

  // 2026-10-27 (Brain review F5) — mirrored for the payload builder, which every mic and the typed box
  // go through and none of which can read this context.
  useEffect(() => {
    useSmartVisionSignalStore.getState().setLiveView(state.isOpen ? state : null);
  }, [state]);
  useEffect(() => () => useSmartVisionSignalStore.getState().setLiveView(null), []);

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
