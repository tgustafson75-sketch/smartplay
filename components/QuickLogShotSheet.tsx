/**
 * Phase 109-followup — Quick Log Shot tap UI.
 *
 * Modal sheet for proactive ad-hoc shot logging when:
 *   - The user wants to log a shot without waiting for auto-detection
 *   - Voice intent didn't fire / user prefers tap input
 *   - Catching up after forgetting to log a few
 *
 * Mirrors the log_shot voice intent's data model: club + distance + outcome,
 * GPS captured at modal open, calls roundStore.logShot.
 *
 * Exposed from the Tools menu sheet on Caddie home (round-active only).
 */

import React, { useState, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, Modal, StyleSheet, TextInput, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import { useRoundStore, type ShotResult, type ShotLocation } from '../store/roundStore';
import { getCourseHoleCount } from '../data/courses';
import { getLastFix as getSmartFinderLastFix } from '../services/smartFinderService';
import { getLastFix as getGpsLastFix, getOneShotFix } from '../services/gpsManager';
import { track } from '../services/analytics';
import type { ShotOutcome } from '../types/shot';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const CLUBS = [
  'driver', '3-wood', '5-wood', 'hybrid',
  '3-iron', '4-iron', '5-iron', '6-iron',
  '7-iron', '8-iron', '9-iron',
  'pitching wedge', 'gap wedge', 'sand wedge', 'lob wedge',
  'putter',
] as const;

const OUTCOMES: { label: string; value: ShotOutcome }[] = [
  { label: 'Clean', value: 'clean' },
  { label: 'Water', value: 'water' },
  { label: 'OB', value: 'ob' },
  { label: 'Lost', value: 'lost' },
  { label: 'Hazard', value: 'hazard_drop' },
  { label: 'Unplayable', value: 'unplayable' },
];

const DIRECTIONS: { label: string; value: ShotResult['direction'] }[] = [
  { label: '↶ Left', value: 'left' },
  { label: '↑ Straight', value: 'straight' },
  { label: '↷ Right', value: 'right' },
];

function snapshotLocation(): { loc: ShotLocation | null; ageMs: number | null; accuracy: number | null } {
  const sf = getSmartFinderLastFix();
  if (sf) {
    return {
      loc: sf.location,
      ageMs: typeof sf.timestamp === 'number' ? Date.now() - sf.timestamp : null,
      accuracy: sf.accuracy_m ?? null,
    };
  }
  const gps = getGpsLastFix();
  if (gps) {
    return {
      loc: { lat: gps.lat, lng: gps.lng },
      ageMs: Date.now() - gps.timestamp,
      accuracy: gps.accuracy_m ?? null,
    };
  }
  return { loc: null, ageMs: null, accuracy: null };
}

export default function QuickLogShotSheet({ visible, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const isRoundActive = useRoundStore(s => s.isRoundActive);
  const currentHole = useRoundStore(s => s.currentHole);
  // 2026-06-04 — Bundled-aware hole count for 9-hole executive courses.
  const activeCourseId = useRoundStore(s => s.activeCourseId);
  const liveCourseHolesLen = useRoundStore(s => s.courseHoles.length);
  const courseHolesCount = getCourseHoleCount(activeCourseId, liveCourseHolesLen);
  const setCurrentHole = useRoundStore(s => s.setCurrentHole);
  const logShot = useRoundStore(s => s.logShot);
  const shotsCount = useRoundStore(s => s.shots.filter(x => (x.hole_number ?? x.hole) === s.currentHole).length);

  const [club, setClub] = useState<string | null>(null);
  const [distance, setDistance] = useState('');
  const [outcome, setOutcome] = useState<ShotOutcome>('clean');
  const [direction, setDirection] = useState<ShotResult['direction']>(null);
  const [holeOverride, setHoleOverride] = useState<number | null>(null);
  // Pinned location from a manual "Get fresh fix" tap. When set, overrides
  // the cached gpsManager / smartFinder lastFix at submit time. Useful for
  // ground-truth marking when riding in a cart (cached fix may be from a
  // previous waypoint).
  const [pinnedLoc, setPinnedLoc] = useState<{ loc: ShotLocation; ageMs: 0; accuracy: number | null } | null>(null);
  const [pinning, setPinning] = useState(false);

  const refreshFix = async () => {
    if (pinning) return;
    setPinning(true);
    try {
      const fix = await getOneShotFix({ maxAgeMs: 0 });
      if (fix) {
        setPinnedLoc({
          loc: { lat: fix.lat, lng: fix.lng },
          ageMs: 0,
          accuracy: fix.accuracy_m ?? null,
        });
      }
    } finally {
      setPinning(false);
    }
  };

  const reset = () => {
    setClub(null);
    setPinnedLoc(null);
    setHoleOverride(null);
    setDistance('');
    setOutcome('clean');
    setDirection(null);
  };

  const submit = useMemo(() => () => {
    if (!club) return;
    const distNum = distance.trim() ? parseInt(distance, 10) : NaN;
    // Prefer the manually-pinned fix when present; otherwise fall back to
    // the cached gpsManager / smartFinder lastFix.
    const location = pinnedLoc ? pinnedLoc.loc : snapshotLocation().loc;
    const effectiveHole = holeOverride ?? currentHole;
    if (holeOverride && holeOverride !== currentHole) setCurrentHole(holeOverride);
    const shot: ShotResult = {
      id: `${Date.now()}_tap`,
      hole: effectiveHole,
      hole_number: effectiveHole,
      club,
      timestamp: Date.now(),
      feel: null,
      direction,
      shape: null,
      acousticContact: null,
      distance_yards: Number.isFinite(distNum) ? distNum : null,
      outcome,
      logged_via: 'tap',
      gps_location: location,
      start_location: location,
      end_location: null,
      shot_in_hole_index: shotsCount + 1,
    };
    logShot(shot);
    track('quick_log_shot_submitted', {
      club,
      has_distance: Number.isFinite(distNum),
      outcome,
      direction,
      had_gps: location != null,
      manual_fresh_fix: pinnedLoc != null,
      hole_overridden: holeOverride != null && holeOverride !== currentHole,
    });
    reset();
    onClose();
  }, [club, distance, outcome, direction, currentHole, holeOverride, shotsCount, logShot, onClose, pinnedLoc, setCurrentHole]);

  if (!isRoundActive) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.scrim}>
        <View
          style={[
            styles.sheet,
            { backgroundColor: colors.surface, paddingBottom: insets.bottom + 16, borderColor: colors.border },
          ]}
        >
          <View style={styles.headerRow}>
            <Text style={[styles.title, { color: colors.text_primary }]}>
              Log shot · hole {holeOverride ?? currentHole}
            </Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={[styles.cancel, { color: colors.text_muted }]}>Cancel</Text>
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            {/* GPS fix freshness + manual refresh — for ground-truth marking
                under cart play (cached fix may be from a previous waypoint). */}
            {(() => {
              const snap = pinnedLoc ?? snapshotLocation();
              const ageLabel = pinnedLoc
                ? 'fresh fix'
                : snap.ageMs == null ? 'no fix yet'
                : snap.ageMs < 1000 ? '<1s old'
                : `${Math.round(snap.ageMs / 1000)}s old`;
              const accLabel = snap.accuracy != null ? ` · ±${Math.round(snap.accuracy)}m` : '';
              return (
                <TouchableOpacity
                  onPress={refreshFix}
                  disabled={pinning}
                  style={[
                    styles.input,
                    {
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      borderColor: pinnedLoc ? colors.accent : colors.border,
                      backgroundColor: colors.background,
                      opacity: pinning ? 0.6 : 1,
                      marginTop: 0,
                    },
                  ]}
                >
                  <Text style={{ color: colors.text_primary, fontSize: 13, fontWeight: '700' }}>
                    {pinning ? 'Locking…' : pinnedLoc ? '📍 Pinned' : '↺ Use fresh GPS fix'}
                  </Text>
                  <Text style={{ color: colors.text_muted, fontSize: 12 }}>
                    {ageLabel}{accLabel}
                  </Text>
                </TouchableOpacity>
              );
            })()}

            <Text style={[styles.label, { color: colors.text_muted, marginTop: 12 }]}>Hole</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={[styles.chipRow, { flexWrap: 'nowrap' }]}>
                {Array.from({ length: courseHolesCount }, (_, i) => i + 1).map(h => {
                  const active = (holeOverride ?? currentHole) === h;
                  return (
                    <TouchableOpacity
                      key={h}
                      onPress={() => setHoleOverride(h)}
                      style={[
                        styles.chip,
                        { borderColor: colors.border, minWidth: 38, alignItems: 'center' },
                        active && { backgroundColor: colors.accent, borderColor: colors.accent },
                      ]}
                    >
                      <Text style={[
                        styles.chipText,
                        { color: colors.text_primary, fontWeight: '700' },
                        active && { color: '#000' },
                      ]}>{h}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>

            <Text style={[styles.label, { color: colors.text_muted, marginTop: 12 }]}>Club</Text>
            <View style={styles.chipRow}>
              {CLUBS.map(c => (
                <TouchableOpacity
                  key={c}
                  onPress={() => setClub(c)}
                  style={[
                    styles.chip,
                    { borderColor: colors.border },
                    club === c && { backgroundColor: colors.accent, borderColor: colors.accent },
                  ]}
                >
                  <Text style={[
                    styles.chipText,
                    { color: colors.text_primary },
                    club === c && { color: '#000' },
                  ]}>{c}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.label, { color: colors.text_muted, marginTop: 12 }]}>Distance (yards, optional)</Text>
            <TextInput
              value={distance}
              onChangeText={setDistance}
              keyboardType="numeric"
              placeholder="e.g. 165"
              placeholderTextColor={colors.text_muted}
              style={[
                styles.input,
                { color: colors.text_primary, borderColor: colors.border, backgroundColor: colors.background },
              ]}
            />

            <Text style={[styles.label, { color: colors.text_muted, marginTop: 12 }]}>Outcome</Text>
            <View style={styles.chipRow}>
              {OUTCOMES.map(o => (
                <TouchableOpacity
                  key={o.value}
                  onPress={() => setOutcome(o.value)}
                  style={[
                    styles.chip,
                    { borderColor: colors.border },
                    outcome === o.value && { backgroundColor: colors.accent, borderColor: colors.accent },
                  ]}
                >
                  <Text style={[
                    styles.chipText,
                    { color: colors.text_primary },
                    outcome === o.value && { color: '#000' },
                  ]}>{o.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.label, { color: colors.text_muted, marginTop: 12 }]}>Direction (optional)</Text>
            <View style={styles.chipRow}>
              {DIRECTIONS.map(d => (
                <TouchableOpacity
                  key={d.label}
                  onPress={() => setDirection(direction === d.value ? null : d.value)}
                  style={[
                    styles.chip,
                    { borderColor: colors.border },
                    direction === d.value && { backgroundColor: colors.accent, borderColor: colors.accent },
                  ]}
                >
                  <Text style={[
                    styles.chipText,
                    { color: colors.text_primary },
                    direction === d.value && { color: '#000' },
                  ]}>{d.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          <TouchableOpacity
            disabled={!club}
            onPress={submit}
            style={[
              styles.submit,
              { backgroundColor: club ? colors.accent : colors.border },
            ]}
          >
            <Text style={[styles.submitText, { color: club ? '#000' : colors.text_muted }]}>
              {club ? `Log ${club}` : 'Pick a club'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
    maxHeight: '85%',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: { fontSize: 18, fontWeight: '700' },
  cancel: { fontSize: 14, fontWeight: '600' },
  label: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', marginBottom: 6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 18,
    borderWidth: 1,
  },
  chipText: { fontSize: 12, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  submit: {
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  submitText: { fontSize: 15, fontWeight: '700' },
});
