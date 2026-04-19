/**
 * ValidationPanel.tsx
 *
 * Per-hole overlay shown when Validation Mode is ON.
 * Designed for 1–2 tap input during play — no typing required.
 *
 * Props:
 *   holeId      — current hole number (1-based)
 *   basePar     — stored par for this hole
 *   baseYardage — stored yardage for this hole
 *   validation  — current HoleValidation state from useValidationStore
 *   onYardageAdjust(delta)  — called when user taps a yardage button
 *   onParOverride(par|undef)— called when user changes par
 *   onToggleTag(tag)        — called when user taps a reality-check tag
 *   onClear()               — resets all inputs for this hole
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
} from 'react-native';
import type { HoleValidation, ValidationTag } from './useValidationStore';
import { VALIDATION_TAGS } from './useValidationStore';

// ── Yardage adjustments ──────────────────────────────────────────────────────

const YARDAGE_DELTAS = [
  { label: 'Exact', delta: 0 },
  { label: '+10',   delta: 10 },
  { label: '+20',   delta: 20 },
  { label: '-10',   delta: -10 },
  { label: '-20',   delta: -20 },
] as const;

// ── Par options ───────────────────────────────────────────────────────────────

const PAR_OPTIONS = [3, 4, 5, 6] as const;

// ── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  holeId: number;
  basePar: number;
  baseYardage: number;
  validation: HoleValidation;
  onYardageAdjust: (delta: number) => void;
  onParOverride: (par: number | undefined) => void;
  onToggleTag: (tag: ValidationTag) => void;
  onClear: () => void;
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function ValidationPanel({
  holeId,
  basePar,
  baseYardage,
  validation,
  onYardageAdjust,
  onParOverride,
  onToggleTag,
  onClear,
}: Props) {
  const [showParPicker, setShowParPicker] = useState(false);

  const activeDelta  = validation.yardageAdjustment;
  const activePar    = validation.parOverride ?? basePar;
  const effectiveYds = baseYardage + activeDelta;

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.title}>
          Hole {holeId}  ·  Par {basePar}  ·  {baseYardage}y
        </Text>
        <Pressable onPress={onClear}>
          <Text style={s.clearBtn}>Reset</Text>
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>

        {/* ── Section 1: Yardage accuracy ─────────────────────────────── */}
        <Text style={s.sectionLabel}>YARDAGE ACCURACY</Text>
        <View style={s.btnRow}>
          {YARDAGE_DELTAS.map(({ label, delta }) => {
            const active = activeDelta === delta;
            return (
              <Pressable
                key={label}
                style={[s.yardBtn, active && s.yardBtnActive]}
                onPress={() => onYardageAdjust(delta)}
              >
                <Text style={[s.yardBtnText, active && s.yardBtnTextActive]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
        {activeDelta !== 0 && (
          <Text style={s.adjustedYds}>
            Adjusted: <Text style={{ color: '#A7F3D0', fontWeight: '700' }}>{effectiveYds}y</Text>
            {'  '}{activeDelta > 0 ? `(+${activeDelta})` : `(${activeDelta})`}
          </Text>
        )}

        {/* ── Section 2: Par accuracy ──────────────────────────────────── */}
        <Text style={s.sectionLabel}>PAR ACCURACY</Text>
        <View style={s.btnRow}>
          <Pressable
            style={[s.parBtn, !showParPicker && validation.parOverride === undefined && s.parBtnActive]}
            onPress={() => { setShowParPicker(false); onParOverride(undefined); }}
          >
            <Text style={[s.parBtnText, !showParPicker && validation.parOverride === undefined && s.parBtnTextActive]}>
              Correct (Par {basePar})
            </Text>
          </Pressable>
          <Pressable
            style={[s.parBtn, showParPicker && s.parBtnWarn]}
            onPress={() => setShowParPicker((v) => !v)}
          >
            <Text style={[s.parBtnText, showParPicker && s.parBtnWarnText]}>
              {validation.parOverride !== undefined ? `Par ${validation.parOverride} ✓` : 'Incorrect →'}
            </Text>
          </Pressable>
        </View>
        {showParPicker && (
          <View style={s.parPickerRow}>
            {PAR_OPTIONS.map((p) => (
              <Pressable
                key={p}
                style={[s.parNum, activePar === p && s.parNumActive]}
                onPress={() => { onParOverride(p); setShowParPicker(false); }}
              >
                <Text style={[s.parNumText, activePar === p && s.parNumTextActive]}>{p}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* ── Section 3: Reality Check tags ───────────────────────────── */}
        <Text style={s.sectionLabel}>REALITY CHECK</Text>
        <View style={s.tagGrid}>
          {VALIDATION_TAGS.map((tag) => {
            const active = validation.tags.includes(tag);
            return (
              <Pressable
                key={tag}
                style={[s.tag, active && s.tagActive]}
                onPress={() => onToggleTag(tag)}
              >
                <Text style={[s.tagText, active && s.tagTextActive]}>{tag}</Text>
              </Pressable>
            );
          })}
        </View>

      </ScrollView>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container:        { backgroundColor: '#0c1f10', borderRadius: 14, borderWidth: 1, borderColor: '#1F3A22', padding: 14, marginHorizontal: 8, marginBottom: 8 },

  header:           { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  title:            { color: '#fff', fontSize: 13, fontWeight: '700', letterSpacing: 0.4 },
  clearBtn:         { color: '#6B7280', fontSize: 12, paddingHorizontal: 8, paddingVertical: 4 },

  sectionLabel:     { color: '#4B5563', fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 6, marginTop: 10 },

  // Yardage
  btnRow:           { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  yardBtn:          { backgroundColor: '#111E14', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9, borderWidth: 1, borderColor: '#1F3A22' },
  yardBtnActive:    { backgroundColor: '#065F46', borderColor: '#059669' },
  yardBtnText:      { color: '#6B7280', fontSize: 14, fontWeight: '600' },
  yardBtnTextActive:{ color: '#A7F3D0' },
  adjustedYds:      { color: '#6B7280', fontSize: 12, marginTop: 6 },

  // Par
  parBtn:           { backgroundColor: '#111E14', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9, borderWidth: 1, borderColor: '#1F3A22', flex: 1 },
  parBtnActive:     { backgroundColor: '#065F46', borderColor: '#059669' },
  parBtnWarn:       { backgroundColor: '#2D1A00', borderColor: '#B45309' },
  parBtnText:       { color: '#6B7280', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  parBtnTextActive: { color: '#A7F3D0' },
  parBtnWarnText:   { color: '#F59E0B' },
  parPickerRow:     { flexDirection: 'row', gap: 8, marginTop: 8 },
  parNum:           { flex: 1, backgroundColor: '#111E14', borderRadius: 8, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: '#1F3A22' },
  parNumActive:     { backgroundColor: '#065F46', borderColor: '#059669' },
  parNumText:       { color: '#6B7280', fontSize: 18, fontWeight: '700' },
  parNumTextActive: { color: '#A7F3D0' },

  // Tags
  tagGrid:          { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag:              { backgroundColor: '#111E14', borderRadius: 16, paddingHorizontal: 11, paddingVertical: 7, borderWidth: 1, borderColor: '#1F3A22' },
  tagActive:        { backgroundColor: '#1E3A5F', borderColor: '#3B82F6' },
  tagText:          { color: '#6B7280', fontSize: 12 },
  tagTextActive:    { color: '#93C5FD' },
});
