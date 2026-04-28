import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useRoundStore, type RoundRecord } from '../store/roundStore';
import { useGhostStore } from '../store/ghostStore';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { generateRecap } from '../services/recapGenerator';
import { saveRecap } from '../services/planStorage';

const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8081';

// ─── Synthetic ghost for when roundHistory is empty ───────────────────────────

const SYNTHETIC_GHOST: RoundRecord = {
  id: 'synthetic_ghost_001',
  roundNumber: 1,
  courseName: 'Palms Golf Course',
  courseId: null,
  startedAt: Date.now() - 86400000 * 7,
  endedAt: Date.now() - 86400000 * 7 + 14400000,
  holesPlayed: 9,
  totalScore: 43,
  scoreVsPar: 7,
  isCompetition: false,
  nineHoleMode: true,
  mode: 'free_play',
  scores: { 1: 5, 2: 4, 3: 5, 4: 4, 5: 4, 6: 6, 7: 3, 8: 5, 9: 7 },
  putts: {},
  plans: [],
  shots: [],
};

// Mock current scores — total 41 vs ghost 43 (ahead by 2)
const MOCK_CURRENT_SCORES: Record<number, number> = {
  1: 4, 2: 5, 3: 4, 4: 4, 5: 5, 6: 5, 7: 3, 8: 6, 9: 5,
};

const MOCK_PARS: Record<number, number> = {
  1: 4, 2: 3, 3: 4, 4: 4, 5: 5, 6: 4, 7: 3, 8: 4, 9: 5,
};

export default function GhostDebugScreen() {
  const router = useRouter();
  const { roundHistory } = useRoundStore();
  const ghost = useGhostStore();
  const [commentary, setCommentary] = useState<string | null>(null);
  const [commentaryLoading, setCommentaryLoading] = useState(false);
  const [recapLoading, setRecapLoading] = useState(false);
  const [scoredHoles, setScoredHoles] = useState<number[]>([]);

  const isActive = ghost.ghostRecord !== null;

  // ── Activate helpers ──────────────────────────────────────────────────────

  const handleActivateSynthetic = () => {
    ghost.activateGhost(SYNTHETIC_GHOST);
    setScoredHoles([]);
    setCommentary(null);
  };

  const handleActivateFromHistory = (record: RoundRecord) => {
    ghost.activateGhost(record);
    setScoredHoles([]);
    setCommentary(null);
  };

  const handleDeactivate = () => {
    ghost.deactivateGhost();
    setScoredHoles([]);
    setCommentary(null);
  };

  // ── Score a hole ──────────────────────────────────────────────────────────

  const handleScoreHole = (holeNum: number) => {
    const score = MOCK_CURRENT_SCORES[holeNum] ?? 4;
    useRoundStore.getState().logScore(holeNum, score);
    ghost.updateHole(holeNum, score);
    setScoredHoles(prev => prev.includes(holeNum) ? prev : [...prev, holeNum].sort((a, b) => a - b));
  };

  // ── Commentary ────────────────────────────────────────────────────────────

  const handleAskKevin = async () => {
    setCommentaryLoading(true);
    setCommentary(null);
    try {
      const playerName = usePlayerProfileStore.getState().firstName || usePlayerProfileStore.getState().name || 'Tim';
      const res = await fetch(apiUrl + '/api/kevin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'How am I doing against past me?',
          language: 'en',
          playerName,
          firstName: playerName,
          ghostContext: ghost.getSummaryText(),
          isRoundActive: true,
          roundMode: 'free_play',
          responseMode: 'neutral',
        }),
      });
      const data = await res.json() as { text?: string };
      setCommentary(data.text ?? 'No text in response.');
    } catch (err) {
      setCommentary('API error: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setCommentaryLoading(false);
    }
  };

  // ── Recap ─────────────────────────────────────────────────────────────────

  const handleGenerateRecap = async () => {
    const snapshot = ghost.getSnapshot();
    if (!snapshot) return;
    setRecapLoading(true);
    try {
      const roundId = 'ghost_debug_' + Date.now();
      const scored = scoredHoles.length > 0 ? scoredHoles : [1, 2, 3];
      const scores: Record<number, number> = {};
      scored.forEach(h => { scores[h] = MOCK_CURRENT_SCORES[h] ?? 4; });
      const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);
      const scoreVsPar = Object.entries(scores).reduce((acc, [h, s]) => acc + s - (MOCK_PARS[Number(h)] ?? 4), 0);
      const courseHoles = Object.entries(MOCK_PARS).map(([h, par]) => ({
        hole: Number(h), par, distance: 380, front: 355, back: 405,
        teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0,
        frontLat: 0, frontLng: 0, backLat: 0, backLng: 0,
        note: '', estimated: true,
      }));

      const recap = await generateRecap(roundId, {
        courseName: ghost.ghostRecord?.courseName ?? 'Debug Course',
        courseId: null,
        mode: 'free_play',
        startedAt: Date.now() - 7200000,
        endedAt: Date.now(),
        totalScore,
        scoreVsPar,
        scores,
        plans: [],
        shots: [],
        courseHoles,
        patternInsights: ['DEBUG: synthetic ghost match data'],
        playerName: usePlayerProfileStore.getState().firstName || 'Tim',
        apiUrl,
        ghostSnapshot: snapshot,
      });

      router.push(('/recap/' + recap.round_id) as never);
    } catch (err) {
      console.error('[ghost-debug] recap failed:', err);
    } finally {
      setRecapLoading(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Ghost Debug</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>

        {/* GHOST STATE */}
        <Text style={styles.section}>GHOST STATE</Text>
        <View style={styles.card}>
          {isActive ? (
            <>
              <Text style={styles.row}>Ghost: <Text style={styles.val}>{ghost.getLabel()}</Text></Text>
              <Text style={styles.row}>Status: <Text style={styles.val}>{ghost.getSummaryText()}</Text></Text>
              <Text style={styles.row}>Delta: <Text style={[styles.val, { color: ghost.overall_delta <= 0 ? '#00C896' : '#ef4444' }]}>
                {ghost.overall_delta > 0 ? '+' : ''}{ghost.overall_delta}
              </Text></Text>
              <Text style={styles.row}>Compared: <Text style={styles.val}>{ghost.holes_compared} holes</Text></Text>
            </>
          ) : (
            <Text style={styles.empty}>No ghost active</Text>
          )}
        </View>

        {/* Hole-by-hole results */}
        {isActive && Object.keys(ghost.holeResults).length > 0 && (
          <>
            <Text style={styles.section}>HOLE RESULTS</Text>
            <View style={styles.card}>
              <View style={styles.tableHeader}>
                <Text style={[styles.tableCell, styles.tableCellLabel]}>HOLE</Text>
                <Text style={[styles.tableCell, styles.tableCellLabel]}>GHOST</Text>
                <Text style={[styles.tableCell, styles.tableCellLabel]}>YOURS</Text>
                <Text style={[styles.tableCell, styles.tableCellLabel]}>DELTA</Text>
              </View>
              {Object.entries(ghost.holeResults)
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([hole, r]) => (
                  <View key={hole} style={styles.tableRow}>
                    <Text style={styles.tableCell}>{hole}</Text>
                    <Text style={styles.tableCell}>{r.ghost_score ?? '—'}</Text>
                    <Text style={styles.tableCell}>{r.current_score}</Text>
                    <Text style={[styles.tableCell, { color: r.delta != null && r.delta < 0 ? '#00C896' : r.delta === 0 ? '#9ca3af' : '#ef4444' }]}>
                      {r.delta != null ? (r.delta > 0 ? '+' : '') + r.delta : '—'}
                    </Text>
                  </View>
                ))}
            </View>
          </>
        )}

        {/* ACTIVATE */}
        <Text style={styles.section}>ACTIVATE GHOST</Text>

        <TouchableOpacity style={styles.btn} onPress={handleActivateSynthetic}>
          <Text style={styles.btnText}>Activate Synthetic Ghost (Palms 43)</Text>
        </TouchableOpacity>

        {roundHistory.slice(-5).reverse().map(record => (
          <TouchableOpacity
            key={record.id}
            style={[styles.btn, ghost.ghostRecord?.id === record.id && styles.btnActive]}
            onPress={() => handleActivateFromHistory(record)}
          >
            <Text style={styles.btnText}>
              {record.courseName ?? 'Unknown'} — {record.totalScore} ({record.holesPlayed}H)
            </Text>
          </TouchableOpacity>
        ))}

        {isActive && (
          <TouchableOpacity style={[styles.btn, styles.btnDestructive]} onPress={handleDeactivate}>
            <Text style={styles.btnText}>Deactivate Ghost</Text>
          </TouchableOpacity>
        )}

        {/* MOCK HOLE SCORING */}
        {isActive && (
          <>
            <Text style={styles.section}>MOCK HOLE SCORING</Text>
            <Text style={styles.hint}>
              Ghost scores: H1:5 H2:4 H3:5 H4:4 H5:4 H6:6 H7:3 H8:5 H9:7{'\n'}
              Mock current: H1:4 H2:5 H3:4 H4:4 H5:5 H6:5 H7:3 H8:6 H9:5
            </Text>
            <View style={styles.holeGrid}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(h => (
                <TouchableOpacity
                  key={h}
                  style={[styles.holeBtn, scoredHoles.includes(h) && styles.holeBtnScored]}
                  onPress={() => handleScoreHole(h)}
                >
                  <Text style={styles.holeBtnLabel}>H{h}</Text>
                  <Text style={styles.holeBtnScore}>{MOCK_CURRENT_SCORES[h]}</Text>
                  {scoredHoles.includes(h) && <Text style={styles.holeBtnCheck}>✓</Text>}
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {/* LIVE COMMENTARY */}
        {isActive && (
          <>
            <Text style={styles.section}>LIVE COMMENTARY</Text>
            <TouchableOpacity
              style={[styles.btn, styles.btnGreen]}
              onPress={handleAskKevin}
              disabled={commentaryLoading}
            >
              {commentaryLoading
                ? <ActivityIndicator color="#060f09" />
                : <Text style={[styles.btnText, styles.btnTextDark]}>"How am I doing against past me?"</Text>
              }
            </TouchableOpacity>
            {commentary && (
              <View style={styles.commentaryCard}>
                <Text style={styles.commentaryLabel}>KEVIN SAYS</Text>
                <Text style={styles.commentaryText}>{commentary}</Text>
              </View>
            )}
          </>
        )}

        {/* GENERATE RECAP */}
        {isActive && (
          <>
            <Text style={styles.section}>GHOST-AWARE RECAP</Text>
            <TouchableOpacity
              style={[styles.btn, styles.btnGreen]}
              onPress={handleGenerateRecap}
              disabled={recapLoading}
            >
              {recapLoading
                ? <ActivityIndicator color="#060f09" />
                : <Text style={[styles.btnText, styles.btnTextDark]}>Generate & View Recap</Text>
              }
            </TouchableOpacity>
          </>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060f09' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
  },
  backBtn: { width: 60 },
  backText: { color: '#00C896', fontSize: 16, fontWeight: '600' },
  title: { color: '#ffffff', fontSize: 16, fontWeight: '800' },
  content: { padding: 16, paddingBottom: 60 },
  section: { color: '#6b7280', fontSize: 10, fontWeight: '800', letterSpacing: 2, marginTop: 16, marginBottom: 6 },
  card: {
    backgroundColor: '#0d2418', borderRadius: 10,
    borderWidth: 1, borderColor: '#1e3a28', padding: 12, gap: 4,
  },
  row: { color: '#9ca3af', fontSize: 13 },
  val: { color: '#ffffff', fontWeight: '700' },
  empty: { color: '#374151', fontSize: 13 },
  hint: { color: '#4b5563', fontSize: 11, marginBottom: 8, lineHeight: 17 },
  btn: {
    marginBottom: 8, paddingVertical: 12, borderRadius: 10,
    borderWidth: 1, borderColor: '#1e3a28', backgroundColor: '#0d2418',
    alignItems: 'center',
  },
  btnActive: { borderColor: '#00C896' },
  btnDestructive: { borderColor: '#ef4444' },
  btnGreen: { backgroundColor: '#00C896', borderColor: '#00C896' },
  btnText: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
  btnTextDark: { color: '#060f09' },
  holeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  holeBtn: {
    width: 64, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1, borderColor: '#1e3a28', backgroundColor: '#0d2418',
    alignItems: 'center',
  },
  holeBtnScored: { borderColor: '#00C896', backgroundColor: '#003d20' },
  holeBtnLabel: { color: '#6b7280', fontSize: 10, fontWeight: '700' },
  holeBtnScore: { color: '#ffffff', fontSize: 18, fontWeight: '900' },
  holeBtnCheck: { color: '#00C896', fontSize: 10, fontWeight: '800' },
  tableHeader: { flexDirection: 'row', marginBottom: 6 },
  tableRow: { flexDirection: 'row', paddingVertical: 3 },
  tableCell: { flex: 1, color: '#ffffff', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  tableCellLabel: { color: '#6b7280', fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  commentaryCard: {
    backgroundColor: '#0d2418', borderLeftWidth: 3, borderLeftColor: '#00C896',
    borderRadius: 8, padding: 12, marginBottom: 8,
  },
  commentaryLabel: { color: '#00C896', fontSize: 9, fontWeight: '800', letterSpacing: 2, marginBottom: 6 },
  commentaryText: { color: '#ffffff', fontSize: 14, lineHeight: 21 },
});
