/**
 * RoundContext — Single source of truth for round data + AI brain state.
 *
 * Holds the active round's course/hole/strategy configuration alongside the
 * AI brain's running pattern analysis and caddie output so every screen can
 * read from one place without prop-drilling.
 *
 * Usage:
 *   // Wrap at app root (or round root layout):
 *   <RoundProvider><App /></RoundProvider>
 *
 *   // Consume anywhere:
 *   const { hole, addShot, caddieMessage } = useRoundContext();
 */

import React, { createContext, useCallback, useContext, useEffect, useReducer } from 'react';
import { generateCaddieMessage } from '../services/caddieMessageEngine';
import { VoiceTimingController } from '../services/voiceTimingController';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RoundShot {
  result: string;
  timestamp: number;
  hole: number;
}

export interface RoundState {
  // ── Round configuration ─────────────────────────────────────────────────
  course: string | null;
  hole: number;
  strategy: 'aggressive' | 'balanced' | 'conservative';
  mode: 'safe' | 'neutral' | 'attack';
  mentalState: 'confident' | 'neutral' | 'frustrated' | 'nervous';
  notes: string;
  clubDistances: Record<string, number>;
  roundStarted: boolean;

  // ── Shot history ────────────────────────────────────────────────────────
  shots: RoundShot[];
  lastShot: RoundShot | null;

  // ── AI Brain ────────────────────────────────────────────────────────────
  currentPattern: string | null;
  patternConfidence: number;       // 0–1
  patternInsight: string;

  caddieMessage: string;
  lastAdvice: string;

  // ── Voice state ─────────────────────────────────────────────────────────
  lastSpokenAt: number;
  voiceEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

type Action =
  | { type: 'SET_COURSE';         payload: string | null }
  | { type: 'SET_HOLE';           payload: number }
  | { type: 'SET_STRATEGY';       payload: RoundState['strategy'] }
  | { type: 'SET_MODE';           payload: RoundState['mode'] }
  | { type: 'SET_MENTAL_STATE';   payload: RoundState['mentalState'] }
  | { type: 'SET_NOTES';          payload: string }
  | { type: 'SET_CLUB_DISTANCES'; payload: Record<string, number> }
  | { type: 'SET_ROUND_STARTED';  payload: boolean }
  | { type: 'ADD_SHOT';           payload: { result: string } }
  // AI brain updates — call these from any intelligence service
  | { type: 'SET_PATTERN';        payload: { pattern: string | null; confidence: number; insight: string } }
  | { type: 'SET_CADDIE_MESSAGE'; payload: string }
  | { type: 'SET_LAST_ADVICE';    payload: string }
  // Voice
  | { type: 'SET_LAST_SPOKEN_AT'; payload: number }
  | { type: 'SET_VOICE_ENABLED';  payload: boolean }
  | { type: 'RESET_ROUND' };

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const INITIAL_STATE: RoundState = {
  course: 'Menifee Lakes – Palms',
  hole: 1,
  strategy: 'balanced',
  mode: 'safe',
  mentalState: 'neutral',
  notes: '',
  clubDistances: {},
  roundStarted: false,

  shots: [],
  lastShot: null,

  currentPattern: null,
  patternConfidence: 0,
  patternInsight: '',

  caddieMessage: '',
  lastAdvice: '',

  lastSpokenAt: 0,
  voiceEnabled: true,
};

// ---------------------------------------------------------------------------
// Pattern Engine — runs after every shot (pure, no side effects)
// ---------------------------------------------------------------------------

export type PatternResult = {
  pattern: 'miss_right' | 'miss_left' | 'neutral';
  confidence: number;
  insight: string;
};

const INSIGHT: Record<PatternResult['pattern'], string> = {
  miss_right: "You're missing right. Aim slightly left.",
  miss_left:  "You're pulling shots. Ease alignment.",
  neutral:    'Ball flight is balanced.',
};

export function analyzeShots(shots: RoundShot[]): PatternResult {
  const window = shots.slice(-10); // last 5–10 shots
  const total  = window.length;

  if (total < 3) {
    return { pattern: 'neutral', confidence: 0, insight: INSIGHT.neutral };
  }

  const rightCount    = window.filter((s) => s.result === 'right').length;
  const leftCount     = window.filter((s) => s.result === 'left').length;
  const rightPct      = rightCount / total;
  const leftPct       = leftCount  / total;

  if (rightPct > 0.6) {
    return { pattern: 'miss_right', confidence: rightPct, insight: INSIGHT.miss_right };
  }
  if (leftPct > 0.6) {
    return { pattern: 'miss_left',  confidence: leftPct,  insight: INSIGHT.miss_left  };
  }

  const dominantPct = Math.max(rightPct, leftPct);
  return { pattern: 'neutral', confidence: dominantPct || 0, insight: INSIGHT.neutral };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function roundReducer(state: RoundState, action: Action): RoundState {
  switch (action.type) {
    case 'SET_COURSE':
      return { ...state, course: action.payload };
    case 'SET_HOLE':
      return { ...state, hole: action.payload };
    case 'SET_STRATEGY': {
      const next = { ...state, strategy: action.payload };
      return { ...next, caddieMessage: generateCaddieMessage({ strategy: next.strategy, mode: next.mode, mentalState: next.mentalState, currentPattern: next.currentPattern }) };
    }
    case 'SET_MODE': {
      const next = { ...state, mode: action.payload };
      return { ...next, caddieMessage: generateCaddieMessage({ strategy: next.strategy, mode: next.mode, mentalState: next.mentalState, currentPattern: next.currentPattern }) };
    }
    case 'SET_MENTAL_STATE': {
      const next = { ...state, mentalState: action.payload };
      return { ...next, caddieMessage: generateCaddieMessage({ strategy: next.strategy, mode: next.mode, mentalState: next.mentalState, currentPattern: next.currentPattern }) };
    }
    case 'SET_NOTES':
      return { ...state, notes: action.payload };
    case 'SET_CLUB_DISTANCES':
      return { ...state, clubDistances: action.payload };
    case 'SET_ROUND_STARTED':
      return { ...state, roundStarted: action.payload };
    case 'ADD_SHOT': {
      const shot: RoundShot = {
        result: action.payload.result,
        timestamp: Date.now(),
        hole: state.hole,
      };
      const updatedShots = [...state.shots, shot];
      const { pattern, confidence, insight } = analyzeShots(updatedShots);
      const caddieMessage = generateCaddieMessage({
        strategy:       state.strategy,
        mode:           state.mode,
        mentalState:    state.mentalState,
        currentPattern: pattern,
      });
      return {
        ...state,
        shots: updatedShots,
        lastShot: shot,
        currentPattern:    pattern,
        patternConfidence: confidence,
        patternInsight:    insight,
        caddieMessage,
      };
    }
    case 'SET_PATTERN':
      return {
        ...state,
        currentPattern: action.payload.pattern,
        patternConfidence: action.payload.confidence,
        patternInsight: action.payload.insight,
      };
    case 'SET_CADDIE_MESSAGE':
      return { ...state, caddieMessage: action.payload };
    case 'SET_LAST_ADVICE':
      return { ...state, lastAdvice: action.payload };
    case 'SET_LAST_SPOKEN_AT':
      return { ...state, lastSpokenAt: action.payload };
    case 'SET_VOICE_ENABLED':
      return { ...state, voiceEnabled: action.payload };
    case 'RESET_ROUND':
      return { ...INITIAL_STATE };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Context value shape
// ---------------------------------------------------------------------------

interface RoundContextValue extends RoundState {
  // Config setters
  setCourse:        (course: string | null) => void;
  setHole:          (hole: number) => void;
  setStrategy:      (strategy: RoundState['strategy']) => void;
  setMode:          (mode: RoundState['mode']) => void;
  setMentalState:   (state: RoundState['mentalState']) => void;
  setNotes:         (notes: string) => void;
  setClubDistances: (distances: Record<string, number>) => void;
  setRoundStarted:  (started: boolean) => void;

  // Shot
  addShot: (result: string) => void;

  // AI brain writes (for intelligence services)
  setPattern:             (pattern: string | null, confidence: number, insight: string) => void;
  setCaddieMessage:       (msg: string) => void;
  setLastAdvice:          (advice: string) => void;
  refreshCaddieMessage:   (distance?: number | null) => void;

  // Voice
  setLastSpokenAt:  (ts: number) => void;
  setVoiceEnabled:  (enabled: boolean) => void;

  // Reset
  resetRound: () => void;
}

// ---------------------------------------------------------------------------
// Context + Provider
// ---------------------------------------------------------------------------

const RoundContext = createContext<RoundContextValue | null>(null);

export function RoundProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(roundReducer, INITIAL_STATE);

  const setCourse        = useCallback((c: string | null)               => dispatch({ type: 'SET_COURSE',         payload: c }), []);
  const setHole          = useCallback((h: number)                      => dispatch({ type: 'SET_HOLE',           payload: h }), []);
  const setStrategy      = useCallback((s: RoundState['strategy'])      => dispatch({ type: 'SET_STRATEGY',       payload: s }), []);
  const setMode          = useCallback((m: RoundState['mode'])          => dispatch({ type: 'SET_MODE',           payload: m }), []);
  const setMentalState   = useCallback((ms: RoundState['mentalState'])  => dispatch({ type: 'SET_MENTAL_STATE',   payload: ms }), []);
  const setNotes         = useCallback((n: string)                      => dispatch({ type: 'SET_NOTES',          payload: n }), []);
  const setClubDistances = useCallback((d: Record<string, number>)      => dispatch({ type: 'SET_CLUB_DISTANCES', payload: d }), []);
  const setRoundStarted  = useCallback((started: boolean)               => dispatch({ type: 'SET_ROUND_STARTED',  payload: started }), []);

  const addShot          = useCallback((result: string)                 => dispatch({ type: 'ADD_SHOT',           payload: { result } }), []);

  const setPattern       = useCallback((pattern: string | null, confidence: number, insight: string) =>
    dispatch({ type: 'SET_PATTERN', payload: { pattern, confidence, insight } }), []);
  const setCaddieMessage = useCallback((msg: string)                    => dispatch({ type: 'SET_CADDIE_MESSAGE', payload: msg }), []);

  const refreshCaddieMessage = useCallback((distance?: number | null) => {
    const msg = generateCaddieMessage({
      strategy:       state.strategy,
      mode:           state.mode,
      mentalState:    state.mentalState,
      currentPattern: state.currentPattern,
      distance,
    });
    dispatch({ type: 'SET_CADDIE_MESSAGE', payload: msg });
  }, [state.strategy, state.mode, state.mentalState, state.currentPattern]);
  const setLastAdvice    = useCallback((advice: string)                 => dispatch({ type: 'SET_LAST_ADVICE',    payload: advice }), []);

  const setLastSpokenAt  = useCallback((ts: number) => {
    dispatch({ type: 'SET_LAST_SPOKEN_AT', payload: ts });
  }, []);
  const setVoiceEnabled  = useCallback((enabled: boolean)               => dispatch({ type: 'SET_VOICE_ENABLED',  payload: enabled }), []);

  // Sync controller → context when controller records a speak internally
  useEffect(() => {
    const id = setInterval(() => {
      const ts = VoiceTimingController.getLastSpokenAt();
      if (ts !== state.lastSpokenAt) {
        dispatch({ type: 'SET_LAST_SPOKEN_AT', payload: ts });
      }
    }, 500);
    return () => clearInterval(id);
  }, [state.lastSpokenAt]);

  const resetRound       = useCallback(()                               => dispatch({ type: 'RESET_ROUND' }), []);

  return (
    <RoundContext.Provider value={{
      ...state,
      setCourse, setHole, setStrategy, setMode, setMentalState,
      setNotes, setClubDistances, setRoundStarted,
      addShot,
      setPattern, setCaddieMessage, setLastAdvice, refreshCaddieMessage,
      setLastSpokenAt, setVoiceEnabled,
      resetRound,
    }}>
      {children}
    </RoundContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useRoundContext(): RoundContextValue {
  const ctx = useContext(RoundContext);
  if (!ctx) throw new Error('useRoundContext must be used inside <RoundProvider>');
  return ctx;
}
