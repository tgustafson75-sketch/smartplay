/**
 * 2026-06-14 (Tim — pre-round setup check) — renders a SetupCheckResult.
 * Momentum-first: the ready line + what's dialed in lead; ONE tweak follows.
 * Reusable by the standalone Setup Check screen and (later) the 20-min routine.
 */
import React from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SetupCheckResult } from '../../services/swing/setupCheck';

type Props = {
  result: SetupCheckResult;
  imageUri: string | null;
  speaking?: boolean;
  onReplay?: () => void;
  onTryAgain: () => void;
  onDone: () => void;
};

export default function SetupCheckCard({ result, imageUri, speaking, onReplay, onTryAgain, onDone }: Props) {
  // A "keep" cue (sound setup, nothing to change) reads better as affirmation
  // than as a "tweak". Detect the server's KEEP phrasing to label it honestly.
  const adj = (result.adjustment ?? '').trim();
  const isKeep = /^(nothing|no change|keep|don'?t change)/i.test(adj);

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      {imageUri ? <Image source={{ uri: imageUri }} style={styles.photo} resizeMode="cover" /> : null}

      <Text style={styles.readyNote}>{result.readyNote}</Text>

      {result.strengths.length > 0 ? (
        <View style={styles.block}>
          <Text style={[styles.label, { color: '#3FB950' }]}>WHAT&apos;S DIALED IN</Text>
          {result.strengths.map((s, i) => (
            <View key={i} style={styles.row}>
              <Ionicons name="checkmark-circle" size={16} color="#3FB950" style={styles.rowIcon} />
              <Text style={styles.rowText}>{s}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {adj ? (
        <View style={[styles.block, styles.tweakBlock, isKeep && styles.keepBlock]}>
          <Text style={[styles.label, { color: isKeep ? '#3FB950' : '#F5A623' }]}>
            {isKeep ? 'TAKE IT TO THE TEE' : 'ONE TWEAK'}
          </Text>
          <Text style={styles.tweakText}>{adj}</Text>
        </View>
      ) : null}

      {result.drill && !isKeep ? (
        <View style={styles.block}>
          <Text style={[styles.label, { color: '#7dd3a8' }]}>QUICK REHEARSAL</Text>
          <Text style={styles.rowText}>{result.drill}</Text>
        </View>
      ) : null}

      {result.evidence ? <Text style={styles.evidence}>{result.evidence}</Text> : null}

      <View style={styles.actions}>
        <TouchableOpacity style={styles.btn} onPress={onTryAgain} accessibilityRole="button">
          <Ionicons name="camera-outline" size={16} color="#9ca3af" />
          <Text style={styles.btnText}>Retake</Text>
        </TouchableOpacity>
        {onReplay ? (
          <TouchableOpacity style={styles.btn} onPress={onReplay} accessibilityRole="button">
            <Ionicons name={speaking ? 'stop' : 'volume-high-outline'} size={16} color="#9ca3af" />
            <Text style={styles.btnText}>{speaking ? 'Stop' : 'Replay'}</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={onDone} accessibilityRole="button">
          <Text style={[styles.btnText, styles.btnTextPrimary]}>Let&apos;s go</Text>
          <Ionicons name="arrow-forward" size={16} color="#00C896" />
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, paddingBottom: 40 },
  photo: { width: '100%', aspectRatio: 3 / 4, borderRadius: 14, marginBottom: 14, backgroundColor: '#0a1e12' },
  readyNote: { color: '#ffffff', fontSize: 19, fontWeight: '800', lineHeight: 26, marginBottom: 14 },
  block: { marginBottom: 14 },
  label: { fontSize: 10, fontWeight: '900', letterSpacing: 1.4, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 3 },
  rowIcon: { marginRight: 8, marginTop: 1 },
  rowText: { color: '#e8f5e9', fontSize: 14, lineHeight: 20, flex: 1, fontWeight: '600' },
  tweakBlock: {
    backgroundColor: 'rgba(245,166,35,0.07)', borderLeftWidth: 3, borderLeftColor: '#F5A623',
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: 6,
  },
  keepBlock: { backgroundColor: 'rgba(63,185,80,0.07)', borderLeftColor: '#3FB950' },
  tweakText: { color: '#e8f5e9', fontSize: 14, lineHeight: 20, fontWeight: '600' },
  evidence: { color: '#9ca3af', fontSize: 11, lineHeight: 16, fontStyle: 'italic', marginTop: 2, marginBottom: 8 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 8, flexWrap: 'wrap' },
  btn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 12, paddingHorizontal: 16,
    borderWidth: 1, borderColor: '#1e3a28', borderRadius: 10, backgroundColor: '#0a1e12',
  },
  btnPrimary: { borderColor: '#00C896', backgroundColor: '#003d20' },
  btnText: { color: '#9ca3af', fontSize: 13, fontWeight: '700' },
  btnTextPrimary: { color: '#00C896' },
});
