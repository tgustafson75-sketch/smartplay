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

export default function ScorecardChip() {
  const isRoundActive = useRoundStore(s => s.isRoundActive);
  const scores = useRoundStore(s => s.scores);
  const courseHoles = useRoundStore(s => s.courseHoles);
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

  const sign = scoreVsPar > 0 ? '+' : scoreVsPar < 0 ? '' : 'E';
  const label = `${sign}${scoreVsPar !== 0 ? scoreVsPar : ''} thru ${playedHoles.length}`;

  return (
    <>
      <TouchableOpacity onPress={() => setOpen(true)} style={styles.chip} activeOpacity={0.8}>
        <Text style={styles.chipText}>{label}</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Scorecard</Text>
              <Text style={styles.sheetTotal}>{totalStrokes} ({label})</Text>
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
                    <Text style={[
                      styles.rowScore,
                      v > 0 && { color: '#fbbf24' },
                      v < 0 && { color: '#34d399' },
                    ]}>{s}</Text>
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
  chip: {
    backgroundColor: 'rgba(0,200,150,0.15)',
    borderColor: '#00C896',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginTop: 4,
  },
  chipText: {
    color: '#00C896',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
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
  rowScore: { color: '#fff', fontSize: 16, fontWeight: '800', width: 50, textAlign: 'right' },
  closeBtn: { marginTop: 12, paddingVertical: 10, alignItems: 'center', backgroundColor: '#1e3a28', borderRadius: 10 },
  closeText: { color: '#fff', fontWeight: '700' },
});
