/**
 * screens/PlayScreen.tsx
 *
 * Focus Mode UI — thin layer only.
 * All intelligence lives in /engine/.
 *
 * Layout zones:
 *   1. PlayView   (flex 8) — yardage + hole
 *   2. Control Bar (flex 1) — mic + 4 quick actions
 *   3. Caddie strip (flex 2) — message + shot input
 */

import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';

import { handleFocusInput }      from '../engine/focusEngine';
import { buildFocusContext }      from '../engine/contextBuilder';
import { createMemoryProfile, updateMemoryWithShot } from '../engine/memoryEngine';
import { createRoundState, updateRoundState }        from '../engine/roundEngine';
import { checkProactiveTriggers } from '../engine/proactiveEngine';
import { useCaddie }              from '../context/CaddieContext';
import { COLORS, SPACING, RADIUS } from '../theme/tokens';

// ─── Types ────────────────────────────────────────────────────────────────────

type ShotResult = 'left' | 'straight' | 'right';

interface LocalShot {
  result: ShotResult;
  timestamp: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PlayScreen() {
  const caddie = useCaddie();

  const [caddieMsg, setCaddieMsg]   = useState('Ready when you are.');
  const [isThinking, setIsThinking] = useState(false);
  const [shots, setShots]           = useState<LocalShot[]>([]);

  // Use CaddieContext memory/round when available; fall back to local state
  const [localMemory, setLocalMemory]     = useState(createMemoryProfile());
  const [localRoundState, setLocalRound]  = useState(createRoundState());
  const proactiveShownIds = useRef<Set<string>>(new Set());

  const memory     = caddie?.memory     ?? localMemory;
  const roundState = caddie?.roundState ?? localRoundState;

  // Hard-coded stubs — replace with live GPS / store values as needed
  const hole     = 1;
  const distance = 150;

  // ── Context builder ────────────────────────────────────────────────────────
  const buildCtx = useCallback(() =>
    buildFocusContext({
      hole,
      distance,
      shots,
      memory,
      roundState,
      weather: null,
      wind:    null,
      sunset:  null,
    }),
    [shots, memory, roundState],
  );

  // ── Input handler ──────────────────────────────────────────────────────────
  const handleInput = useCallback(async (input: string) => {
    setIsThinking(true);
    try {
      const ctx = buildCtx();
      // aiCaller stub — wire up your real OpenAI caller here
      const aiCaller = async (_q: string) => null;
      const res = await handleFocusInput(input, ctx, aiCaller);
      if (res) setCaddieMsg(res);
    } finally {
      setIsThinking(false);
    }
  }, [buildCtx]);

  // ── Shot handler ───────────────────────────────────────────────────────────
  const handleShot = useCallback((result: ShotResult) => {
    const shot: LocalShot = { result, timestamp: Date.now() };
    const updatedShots = [...shots, shot];
    setShots(updatedShots);

    // Update memory + round (prefer CaddieContext actions when available)
    const newMemory = caddie?.addShotToMemory
      ? (caddie.addShotToMemory({ result }), memory)
      : updateMemoryWithShot(localMemory, { result });
    if (!caddie?.addShotToMemory) setLocalMemory(newMemory);

    const newRound = caddie?.addShotToRound
      ? (caddie.addShotToRound({ result }, { hole, distance }), roundState)
      : updateRoundState(localRoundState, { result }, { hole, distance });
    if (!caddie?.addShotToRound) setLocalRound(newRound);

    // Proactive triggers
    const ctx = buildFocusContext({
      hole, distance, shots: updatedShots,
      memory: newMemory, roundState: newRound,
    });
    const triggers = checkProactiveTriggers(ctx, proactiveShownIds.current);
    if (triggers.length > 0) {
      setCaddieMsg(triggers[0].message);
      proactiveShownIds.current = new Set([...proactiveShownIds.current, triggers[0].id]);
      caddie?.markRoundInsightShown?.();
    }
  }, [shots, memory, roundState, localMemory, localRoundState, caddie, hole, distance]);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <View style={styles.root}>

      {/* ── Zone 1: PlayView ─────────────────────────────────────────────── */}
      <View style={styles.playView}>
        <Text style={styles.holeLabel}>HOLE {hole}</Text>
        <Text style={styles.yardage}>{distance}</Text>
        <Text style={styles.yardsLabel}>yds</Text>
      </View>

      {/* ── Zone 2: Control Bar ──────────────────────────────────────────── */}
      <View style={styles.controlBar}>
        <TouchableOpacity style={styles.micBtn} onPress={() => handleInput('advice')}>
          <Text style={styles.micIcon}>🎤</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quickBtn} onPress={() => handleInput('food')}>
          <Text style={styles.quickLabel}>Food</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quickBtn} onPress={() => handleInput('weather')}>
          <Text style={styles.quickLabel}>Weather</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quickBtn} onPress={() => handleInput('sunset')}>
          <Text style={styles.quickLabel}>Sunset</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quickBtn} onPress={() => handleInput('restroom')}>
          <Text style={styles.quickLabel}>Facilities</Text>
        </TouchableOpacity>
      </View>

      {/* ── Zone 3: Caddie strip + shot input ────────────────────────────── */}
      <View style={styles.caddieStrip}>
        {isThinking
          ? <ActivityIndicator color={COLORS.action} style={styles.spinner} />
          : <Text style={styles.caddieMsg} numberOfLines={3}>{caddieMsg}</Text>
        }

        <View style={styles.shotRow}>
          <TouchableOpacity style={styles.shotBtn} onPress={() => handleShot('left')}>
            <Text style={styles.shotIcon}>←</Text>
            <Text style={styles.shotBtnLabel}>Left</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.shotBtn, styles.shotBtnCenter]} onPress={() => handleShot('straight')}>
            <Text style={styles.shotIcon}>↑</Text>
            <Text style={styles.shotBtnLabel}>Straight</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.shotBtn} onPress={() => handleShot('right')}>
            <Text style={styles.shotIcon}>→</Text>
            <Text style={styles.shotBtnLabel}>Right</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.shotCount}>
          {shots.length} shot{shots.length !== 1 ? 's' : ''} logged
        </Text>
      </View>

    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },

  // Zone 1
  playView: {
    flex: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  holeLabel: {
    color: COLORS.textSecondary,
    fontSize: 13,
    letterSpacing: 2,
    marginBottom: SPACING.sm,
  },
  yardage: {
    color: COLORS.textPrimary,
    fontSize: 88,
    fontWeight: '700',
    lineHeight: 88,
  },
  yardsLabel: {
    color: COLORS.action,
    fontSize: 18,
    marginTop: SPACING.xs,
    letterSpacing: 1,
  },

  // Zone 2
  controlBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: SPACING.lg,
    backgroundColor: COLORS.card,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  micBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.action,
    justifyContent: 'center',
    alignItems: 'center',
  },
  micIcon: {
    fontSize: 22,
  },
  quickBtn: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.sm,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  quickLabel: {
    color: COLORS.textSecondary,
    fontSize: 12,
  },

  // Zone 3
  caddieStrip: {
    flex: 2,
    padding: SPACING.lg,
    justifyContent: 'space-between',
    backgroundColor: COLORS.primary,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  caddieMsg: {
    color: COLORS.textPrimary,
    fontSize: 15,
    lineHeight: 22,
    minHeight: 44,
  },
  spinner: {
    alignSelf: 'flex-start',
    marginVertical: SPACING.sm,
  },
  shotRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: SPACING.sm,
  },
  shotBtn: {
    flex: 1,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.md,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
  },
  shotBtnCenter: {
    backgroundColor: COLORS.action + '22',
    borderWidth: 1,
    borderColor: COLORS.action + '55',
  },
  shotIcon: {
    color: COLORS.textPrimary,
    fontSize: 18,
    marginBottom: 2,
  },
  shotBtnLabel: {
    color: COLORS.textSecondary,
    fontSize: 11,
  },
  shotCount: {
    color: COLORS.textSecondary,
    fontSize: 11,
    textAlign: 'center',
    opacity: 0.6,
  },
});
