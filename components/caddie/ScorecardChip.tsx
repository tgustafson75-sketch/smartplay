/**
 * Phase R — Caddie home scorecard glance.
 *
 * Small chip showing "+3 thru 7" during active rounds. Tap to open a
 * quick scorecard modal with hole-by-hole strokes.
 */

import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, Modal, ScrollView, StyleSheet, Pressable,
} from 'react-native';
import { useRoundStore } from '../../store/roundStore';
import { Ionicons } from '@expo/vector-icons';

export default function ScorecardChip() {
  const isRoundActive = useRoundStore(s => s.isRoundActive);
  const scores = useRoundStore(s => s.scores);
  const courseHoles = useRoundStore(s => s.courseHoles);
  const logScore = useRoundStore(s => s.logScore);
  const [open, setOpen] = useState(false);

  if (!isRoundActive) return null;

  const playedHoles = Object.keys(scores).map(Number).sort((a, b) => a - b);
  if (playedHoles.length === 0) return null;

  let scoreVsPar = 0;
  let totalStrokes = 0;
  for (const h of playedHoles) {
    const par = courseHoles.find(c => c.hole === h)?.par ?? 0;
    scoreVsPar += scores[h] - par;
    totalStrokes += scores[h];
  }

  // Phase AT — single-circle compact display. "E" / "+3" / "-1" only.
  // The "thru N" detail is one tap away in the modal.
  const compactLabel = scoreVsPar === 0
    ? 'E'
    : scoreVsPar > 0 ? '+' + scoreVsPar : String(scoreVsPar);

  return (
    <>
      <TouchableOpacity onPress={() => setOpen(true)} style={styles.circle} activeOpacity={0.8}>
        <Text style={styles.circleText}>{compactLabel}</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Scorecard</Text>
              <Text style={styles.sheetTotal}>{totalStrokes} ({compactLabel} thru {playedHoles.length})</Text>
            </View>
            <ScrollView>
              {playedHoles.map(h => {
                const par = courseHoles.find(c => c.hole === h)?.par ?? 0;
                const s = scores[h];
                const v = s - par;
                return (
                  <View key={h} style={styles.row}>
                    <Text style={styles.rowHole}>Hole {h}</Text>
                    <Text style={styles.rowPar}>Par {par}</Text>
                    {/* Phase AY — inline +/- edit on prior holes. Same
                        logScore wiring as the Score tab so edits propagate. */}
                    <View style={styles.rowEdit}>
                      <TouchableOpacity
                        onPress={() => { if (s > 1) logScore(h, s - 1); }}
                        disabled={s <= 1}
                        style={styles.rowStep}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 4 }}
                      >
                        <Ionicons name="remove" size={14} color={s <= 1 ? '#374151' : '#ffffff'} />
                      </TouchableOpacity>
                      <Text style={[
                        styles.rowScore,
                        v > 0 && { color: '#fbbf24' },
                        v < 0 && { color: '#34d399' },
                      ]}>{s}</Text>
                      <TouchableOpacity
                        onPress={() => logScore(h, s + 1)}
                        style={styles.rowStep}
                        hitSlop={{ top: 6, bottom: 6, left: 4, right: 6 }}
                      >
                        <Ionicons name="add" size={14} color="#ffffff" />
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
            <TouchableOpacity onPress={() => setOpen(false)} style={styles.closeBtn}>
              <Text style={styles.closeText}>Close</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  // Phase AT — compact single-circle (replaces wider "E thru N" pill).
  circle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,200,150,0.15)',
    borderColor: '#00C896',
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  circleText: {
    color: '#00C896',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  // Legacy (kept temporarily; no consumer):
  chip: { marginTop: 4 },
  chipText: { color: '#00C896' },
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center', alignItems: 'center',
  },
  sheet: {
    width: '88%', maxWidth: 400, maxHeight: '70%',
    backgroundColor: '#0d1a0d', borderRadius: 16, borderWidth: 1, borderColor: '#1e3a28',
    padding: 16,
  },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 },
  sheetTitle: { color: '#fff', fontSize: 18, fontWeight: '900' },
  sheetTotal: { color: '#00C896', fontSize: 14, fontWeight: '700' },
  row: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1e3a28',
  },
  rowHole: { color: '#fff', fontSize: 14, fontWeight: '600', flex: 1 },
  rowPar: { color: '#6b7280', fontSize: 13, width: 60, textAlign: 'center' },
  rowScore: { color: '#fff', fontSize: 16, fontWeight: '800', width: 30, textAlign: 'center' },
  rowEdit: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowStep: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  closeBtn: { marginTop: 12, paddingVertical: 10, alignItems: 'center', backgroundColor: '#1e3a28', borderRadius: 10 },
  closeText: { color: '#fff', fontWeight: '700' },
});
