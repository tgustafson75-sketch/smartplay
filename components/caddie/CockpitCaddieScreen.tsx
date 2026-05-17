/*
 * Cockpit Mode — full screen composer
 *
 * Layout (top to bottom):
 *   1. BrandHeader  — logo (tap = mic) + SMARTPLAY CADDIE + tagline
 *   2. SubHeader    — "Hole N/18 · Course" (minimal, in-row)
 *   3. StepperPair  — HOLE / SHOTS / PUTTS with +/- steppers
 *   4. DistanceCard — big yards-to-pin + F/C/B, tap → full SmartFinder
 *   5. SmartToolsRow — Vision · Motion · Play · Settings pills
 *   6. CaddieAdviceBox — most recent caddie reply
 *
 * Hard guarantees (after tonight's incident):
 *   - Voice plumbing is NOT re-instantiated here. The parent caddie.tsx
 *     owns useVoiceCaddie / useKevin and passes voiceState +
 *     caddieResponse + onMicPress as props. Single recording session,
 *     single source of voice truth.
 *   - Full Mode behavior is byte-identical when cockpitMode is off.
 *     This component is only mounted when the user opted in via Settings.
 *   - No avatar gates, no freemium logic, no Trust Level rewiring.
 *
 * Non-developer note: this is purely a screen-layout alternative.
 * Toggling it on/off changes ONLY what the Caddie tab looks like.
 * Kevin still hears, responds, and works exactly the same way.
 */

import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useShallow } from 'zustand/react/shallow';
import * as Haptics from 'expo-haptics';

import { useRoundStore, type ShotResult } from '../../store/roundStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useTheme } from '../../contexts/ThemeContext';
import { getCaddieName } from '../../lib/persona';
import {
  getGreenYardagesSync,
  subscribeFixChange,
  type GreenYardages,
} from '../../services/smartFinderService';
import { forceMarkPosition } from '../../services/positionMarkBus';

import { BrandHeader } from './cockpit/BrandHeader';
import { StepperPair } from './cockpit/StepperPair';
import { DistanceCard, type FrontMiddleBack } from './cockpit/DistanceCard';
import { SmartToolsRow } from './cockpit/SmartToolsRow';
import { AskCaddieButton } from './cockpit/AskCaddieButton';
import {
  ShotResultRow,
  type ShotDistanceResult,
  type ShotDirectionResult,
} from './cockpit/ShotResultRow';

import type { VoiceState } from '../CaddieAvatar';

export interface CockpitCaddieScreenProps {
  /** Current voice pipeline state from useVoiceCaddie (parent owns). */
  voiceState: VoiceState;
  /** Most recent caddie reply text (or empty). */
  caddieResponse: string;
  /** Mic tap handler — wired to handleMicPress in caddie.tsx. */
  onMicPress: () => void;
}

export default function CockpitCaddieScreen({
  voiceState,
  caddieResponse,
  onMicPress,
}: CockpitCaddieScreenProps) {
  const router = useRouter();
  const { colors } = useTheme();

  // Round data — useShallow keeps re-renders scoped to keys we actually read.
  const {
    isRoundActive,
    currentHole,
    activeCourse,
    courseHoles,
    scores,
    putts,
    currentYardage,
  } = useRoundStore(
    useShallow((s) => ({
      isRoundActive: s.isRoundActive,
      currentHole: s.currentHole,
      activeCourse: s.activeCourse,
      courseHoles: s.courseHoles,
      scores: s.scores,
      putts: s.putts,
      currentYardage: s.currentYardage,
    })),
  );
  // Action refs — stable; pulled separately.
  const setCurrentHole = useRoundStore((s) => s.setCurrentHole);
  const setScore = useRoundStore((s) => (s as unknown as {
    setScore?: (hole: number, n: number) => void;
  }).setScore);
  const setPutts = useRoundStore((s) => (s as unknown as {
    setPutts?: (hole: number, n: number) => void;
  }).setPutts);
  // Manual shot logging — Pro's roundStore exposes logShot(ShotResult).
  // We map v3's Distance / Direction taps onto Pro's existing schema:
  //   - Direction (left/straight/right) → ShotResult.direction
  //   - Distance (good/short/long)      → ShotResult.outcome_text (free-text
  //     field — Pro has no closed enum for distance result; outcome_text
  //     is exactly what Phase BJ added for free-form descriptors).
  const logShot = useRoundStore((s) => s.logShot);

  const caddiePersonality = useSettingsStore((s) => s.caddiePersonality);
  const distance_unit = useSettingsStore((s) => s.distance_unit);
  const caddieName = getCaddieName(caddiePersonality);

  // Live FRONT/CENTER/BACK from Pro's existing SmartFinder. Re-reads
  // on every GPS fix change so yardages update as the player walks.
  const [fmb, setFmb] = useState<FrontMiddleBack | null>(() => {
    const initial = getGreenYardagesSync(currentHole);
    return greenYardsToFmb(initial);
  });
  useEffect(() => {
    // Seed immediately for the current hole (covers hole change).
    setFmb(greenYardsToFmb(getGreenYardagesSync(currentHole)));
    // Subscribe to live fix updates — auto-cleanup on unmount / hole change.
    const unsub = subscribeFixChange(() => {
      setFmb(greenYardsToFmb(getGreenYardagesSync(currentHole)));
    });
    return () => { unsub(); };
  }, [currentHole]);

  // Hole metadata from the active course's hole list.
  const holeData = courseHoles.find((h) => h.hole === currentHole);
  const par = holeData?.par ?? 4;
  const baseYardage = holeData?.distance ?? null;
  const holeShots = scores[currentHole];
  const holePutts = putts[currentHole];

  const handleStepperHole = (next: number) => {
    void Haptics.selectionAsync().catch(() => undefined);
    setCurrentHole(next);
  };
  const handleStepperShots = (next: number) => {
    void Haptics.selectionAsync().catch(() => undefined);
    setScore?.(currentHole, next);
  };
  const handleStepperPutts = (next: number) => {
    void Haptics.selectionAsync().catch(() => undefined);
    setPutts?.(currentHole, next);
  };

  // ── Manual shot logging (v3 ShotResultRow parity) ──────────────────
  // Quick taps that write a partial ShotResult row to roundStore.
  // The user can tap distance + direction independently for the same
  // shot — each writes its own row (Pro doesn't aggregate
  // direction+outcome into one shot at the moment; consistent with
  // the conversational logging path).
  const handleLogDistance = (result: ShotDistanceResult) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    const outcomeText =
      result === 'good'  ? 'good distance'
      : result === 'short' ? 'short of target'
      : 'long of target';
    const shot: ShotResult = {
      hole: currentHole,
      timestamp: Date.now(),
      feel: null,
      direction: null,
      shape: null,
      club: null,
      acousticContact: null,
      outcome_text: outcomeText,
    };
    logShot(shot);
  };

  const handleLogDirection = (result: ShotDirectionResult) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    const shot: ShotResult = {
      hole: currentHole,
      timestamp: Date.now(),
      feel: null,
      direction: result,
      shape: null,
      club: null,
      acousticContact: null,
    };
    logShot(shot);
  };

  // Mark = "I'm standing where my shot landed." Pro's canonical Mark
  // path is forceMarkPosition() in positionMarkBus — it pulls a fresh
  // GPS fix, fires the bus event, and SmartFinder + hole-detection
  // re-anchor to the marked spot. Same code path the existing
  // post-shot Mark button uses; we're just adding this surface as a
  // redundant entry point.
  const handleMarkShot = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    void forceMarkPosition().catch((e) => console.log('[cockpit] mark failed', e));
  };

  // GPS accuracy hint for the SmartFinder card's status dot.
  // Pulled from the most-recent fmb refresh; not perfect but cheap.
  const gpsAccuracy: 'good' | 'weak' | 'off' =
    fmb && fmb.middle != null ? 'good' : currentYardage != null ? 'weak' : 'off';

  return (
    <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <BrandHeader
          voiceState={voiceState}
          onMicPress={onMicPress}
        />

        {/* Minimal sub-row: hole / course. Mirrors v3's SubHeaderBar
            left-side content. Right-side thumbnail intentionally omitted
            (the DistanceCard below shows the same yardage with more room).
            2026-05-16 — sub-row only renders DURING an active round.
            After endRound, the Caddie tab should show no stale hole
            data ("Hole 10 / Mariners Point" persisted after a round
            end at a 9-hole course). Hole count comes from courseHoles
            length instead of hardcoded /18 so 9-hole courses read
            correctly. */}
        {isRoundActive && (
          <View style={[styles.subRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.holeLabel, { color: colors.accent }]}>
              Hole {currentHole}/{courseHoles.length || 18}
            </Text>
            <Text style={[styles.courseName, { color: colors.text_muted }]} numberOfLines={1}>
              {activeCourse ?? ''}
            </Text>
          </View>
        )}

        <StepperPair
          holeNumber={currentHole}
          par={par}
          shots={holeShots}
          putts={holePutts}
          onChangeHole={handleStepperHole}
          onChangeShots={handleStepperShots}
          onChangePutts={handleStepperPutts}
        />

        <DistanceCard
          fmb={fmb}
          baseYardage={baseYardage}
          gpsAccuracy={gpsAccuracy}
          unit={distance_unit}
          // Tap the card → opens Pro's full SmartFinder screen which
          // already has zoom + lock + rangefinder gestures. We're NOT
          // re-implementing rangefinder here; we're surfacing the data
          // and offering a one-tap entry to the existing screen.
          onPressOpenRangefinder={() => {
            void Haptics.selectionAsync().catch(() => undefined);
            router.push('/smartfinder' as never);
          }}
        />

        <SmartToolsRow
          onVision={() => router.push('/smartvision' as never)}
          onMotion={() => {
            // Course mode: skip the camera-setup checklist (which is
            // tuned for range-mode multi-shot framing) and jump straight
            // to single-swing capture. Mid-round users want to fire the
            // camera fast, not configure tripod alignment.
            router.push('/swinglab/cage-drill' as never);
          }}
          onPlay={() => router.push('/lie-analysis' as never)}
          onSettings={() => router.push('/settings' as never)}
        />

        {/* Primary voice affordance — full-width pill with badge + state
            label. Same handleMicPress wire as caddie.tsx Full Mode. */}
        <AskCaddieButton voiceState={voiceState} onTap={onMicPress} />

        {/* Manual shot entry — the v3 backup-entry parity. Distance and
            direction are independent quick-taps. Mark captures current
            GPS via Pro's positionMarkBus (same path the in-app post-shot
            Mark button uses). */}
        <ShotResultRow
          onLogDistance={handleLogDistance}
          onLogDirection={handleLogDirection}
          onMarkShot={handleMarkShot}
        />

        {/* Caddie advice — the most recent caddie reply. Persistent
            card; falls back to a tap-to-ask hint when empty. */}
        <View style={[styles.advice, { backgroundColor: colors.surface_elevated, borderLeftColor: colors.accent, borderColor: colors.border }]}>
          <Text style={[styles.adviceHeading, { color: colors.text_muted }]}>{caddieName.toUpperCase()}</Text>
          <Text
            style={[
              styles.adviceBody,
              { color: caddieResponse ? colors.text_primary : colors.text_muted },
              !caddieResponse && styles.adviceBodyPlaceholder,
            ]}
          >
            {caddieResponse || `Tap the badge to ask ${caddieName} about distance, club, or strategy.`}
          </Text>
        </View>

        {/* Round-active hint at the bottom when no round running. */}
        {!isRoundActive && (
          <Text style={[styles.inactiveHint, { color: colors.text_muted }]}>
            Start a round from the Play tab to enable live yardages.
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * Adapter: convert smartFinderService's GreenYardages to the FmB
 * shape the DistanceCard expects. They're structurally similar; this
 * just drops the hole_number field that the card doesn't use.
 */
function greenYardsToFmb(g: GreenYardages | null): FrontMiddleBack | null {
  if (!g) return null;
  if (g.front == null && g.middle == null && g.back == null) return null;
  return { front: g.front, middle: g.middle, back: g.back };
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: {
    paddingBottom: 24,
  },
  subRow: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    gap: 2,
  },
  holeLabel: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  courseName: {
    fontSize: 13,
  },
  advice: {
    marginHorizontal: 12,
    marginTop: 14,
    borderLeftWidth: 3,
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 4,
  },
  adviceHeading: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  adviceBody: {
    fontSize: 15,
    lineHeight: 22,
  },
  adviceBodyPlaceholder: {
    fontStyle: 'italic',
  },
  inactiveHint: {
    marginTop: 16,
    textAlign: 'center',
    fontSize: 12,
    fontStyle: 'italic',
    paddingHorizontal: 24,
  },
});
