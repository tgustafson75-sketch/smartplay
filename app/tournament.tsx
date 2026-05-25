/**
 * Tournament — standalone group-play scoring tool.
 *
 * Three phases: SETUP → SCORING → LEADERBOARD. State persists via
 * tournamentStore so progress survives app close mid-round.
 *
 * Public surface (NOT owner-gated) so any tester / friend can use it.
 *
 * 2026-05-24 — Built for Tim's guys-weekend trip. Single-scorekeeper
 * model: one person enters scores on their phone, leaderboard shares
 * via the Share sheet (screenshot + text).
 */

import React, { useMemo, useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, TextInput, Share, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  useTournamentStore, isIndividualFormat, type TournamentFormat,
} from '../store/tournamentStore';
import { computeLeaderboard, leaderboardAsText } from '../services/tournament/computation';
// 2026-05-24 — Voice roster: tap the mic on a team card, speak up to 5
// names ("Bob, Mike, and Sarah"), and the players[] populates.
import { captureUtterance } from '../services/voiceService';
import { useSettingsStore } from '../store/settingsStore';

/**
 * Parse a spoken name list into up to 5 trimmed, title-cased first names.
 * Handles common phrasings: "Bob, Mike, and Sarah" / "Bob and Mike" /
 * "Bob Mike Sarah" / "Bob, Mike, Sarah, John, Lisa". Strips common
 * filler ("um", "and", "the", "with") and caps at 5.
 */
function parseRosterNames(transcript: string): string[] {
  const FILLER = new Set(['and', 'with', 'um', 'uh', 'the', 'plus', 'also']);
  const raw = transcript
    .toLowerCase()
    .replace(/[,\.&]+/g, ' ')
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length > 1 && !FILLER.has(w));
  return raw
    .slice(0, 5)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1));
}

const FORMAT_LABEL: Record<TournamentFormat, string> = {
  stroke: 'Stroke Play',
  scramble: 'Scramble',
  best_ball: 'Best Ball',
  stableford: 'Stableford',
  skins: 'Skins',
  match_play: 'Match Play',
};

const FORMAT_HINT: Record<TournamentFormat, string> = {
  stroke: 'Total team strokes. Lowest wins.',
  scramble: 'Best shot every time. One team score per hole.',
  best_ball: 'Each player plays own ball. Best individual = team score per hole.',
  stableford: 'Points-based per player (par=2, birdie=3, eagle=4). Highest wins.',
  skins: 'Lowest individual wins the hole. Ties carry over.',
  match_play: 'Head-to-head between exactly 2 teams. Holes won / lost / halved.',
};

const ALL_FORMATS: TournamentFormat[] = ['scramble', 'best_ball', 'stableford', 'skins', 'match_play', 'stroke'];

export default function TournamentScreen() {
  const router = useRouter();
  const phase = useTournamentStore(s => s.phase);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={styles.back}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Tournament</Text>
        <View style={{ width: 60 }} />
      </View>
      <View style={styles.tabRow}>
        <PhaseBtn label="Setup" active={phase === 'setup'} onPress={() => useTournamentStore.getState().setPhase('setup')} />
        <PhaseBtn label="Scoring" active={phase === 'scoring'} onPress={() => useTournamentStore.getState().setPhase('scoring')} />
        <PhaseBtn label="Leaderboard" active={phase === 'leaderboard'} onPress={() => useTournamentStore.getState().setPhase('leaderboard')} />
      </View>
      {phase === 'setup' && <SetupPanel />}
      {phase === 'scoring' && <ScoringPanel />}
      {phase === 'leaderboard' && <LeaderboardPanel />}
    </SafeAreaView>
  );
}

function PhaseBtn({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.tabBtn, active && styles.tabBtnActive]}>
      <Text style={[styles.tabBtnText, active && styles.tabBtnTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── SETUP ────────────────────────────────────────────────────────

function SetupPanel() {
  const state = useTournamentStore();
  // 2026-05-24 — Per-team voice-roster mic. State tracks which team is
  // currently capturing so other team mics gray out and the user can
  // see the indeterminate state. apiUrl + language threaded into
  // captureUtterance so transcription respects the user's settings.
  const [recordingTeamId, setRecordingTeamId] = useState<string | null>(null);
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
  const language = useSettingsStore(s => s.language) ?? 'en';
  const handleRosterMic = useCallback(async (teamId: string) => {
    if (recordingTeamId) return;
    setRecordingTeamId(teamId);
    try {
      const transcript = await captureUtterance(8_000, apiUrl, language as 'en' | 'es' | 'zh');
      if (!transcript) return;
      const names = parseRosterNames(transcript);
      if (names.length === 0) {
        Alert.alert('No names heard', 'Try again — say up to five first names.');
        return;
      }
      // Populate left-to-right. addPlayer when we run out of slots; cap
      // at 5 (matches store's hard cap). Read fresh state after each
      // mutation so addPlayer's new slot is visible to the next iteration.
      for (let i = 0; i < names.length; i++) {
        const fresh = useTournamentStore.getState().teams.find(x => x.id === teamId);
        if (!fresh) break;
        if (i >= fresh.players.length) {
          if (fresh.players.length >= 5) break;
          useTournamentStore.getState().addPlayer(teamId);
        }
        useTournamentStore.getState().setPlayerName(teamId, i, names[i]);
      }
    } catch (e) {
      console.log('[tournament] roster mic failed (non-fatal):', e);
      Alert.alert('Voice not available', 'Try again, or type names manually.');
    } finally {
      setRecordingTeamId(null);
    }
  }, [recordingTeamId, apiUrl, language]);
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 80 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.sectionLabel}>NAME + COURSE</Text>
        <TextInput style={styles.textInput} value={state.label} onChangeText={state.setLabel} placeholder="Tournament name (e.g. Bandon Trip)" placeholderTextColor="#4b5563" />
        <TextInput style={styles.textInput} value={state.courseName} onChangeText={state.setCourseName} placeholder="Course (free text)" placeholderTextColor="#4b5563" />

        <Text style={styles.sectionLabel}>FORMAT</Text>
        {ALL_FORMATS.map(f => (
          <TouchableOpacity
            key={f}
            style={[styles.formatRow, state.format === f && styles.formatRowActive]}
            onPress={() => state.setFormat(f)}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.formatTitle, state.format === f && { color: '#00C896' }]}>{FORMAT_LABEL[f]}</Text>
              <Text style={styles.formatHint}>{FORMAT_HINT[f]}</Text>
            </View>
            {state.format === f && <Ionicons name="checkmark-circle" size={22} color="#00C896" />}
          </TouchableOpacity>
        ))}

        <Text style={styles.sectionLabel}>TEAMS</Text>
        {state.teams.map((t, ti) => (
          <View key={t.id} style={styles.teamCard}>
            <View style={styles.teamHeaderRow}>
              <TextInput style={styles.teamNameInput} value={t.name} onChangeText={n => state.setTeamName(t.id, n)} placeholder={`Team ${ti + 1}`} placeholderTextColor="#4b5563" />
              {/* 2026-05-24 — Voice-roster mic. Tap → speak up to 5
                  first names → parseRosterNames populates players[].
                  Active state pulses the icon green so the user knows
                  it's listening; disabled state when another team is
                  recording so two mics can't race. */}
              <TouchableOpacity
                onPress={() => { void handleRosterMic(t.id); }}
                disabled={recordingTeamId !== null && recordingTeamId !== t.id}
                style={styles.rosterMicBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={`Voice-add players to ${t.name}`}
              >
                <Ionicons
                  name={recordingTeamId === t.id ? 'mic' : 'mic-outline'}
                  size={18}
                  color={recordingTeamId === t.id ? '#00C896' : (recordingTeamId ? '#374151' : '#9ca3af')}
                />
              </TouchableOpacity>
              {state.teams.length > 2 && (
                <TouchableOpacity onPress={() => state.removeTeam(t.id)} style={styles.removeBtn}>
                  <Ionicons name="trash-outline" size={16} color="#ef4444" />
                </TouchableOpacity>
              )}
            </View>
            {t.players.map((p, pi) => (
              <View key={pi} style={styles.playerRow}>
                <Text style={styles.playerIdx}>{pi + 1}.</Text>
                <TextInput style={styles.playerNameInput} value={p} onChangeText={n => state.setPlayerName(t.id, pi, n)} placeholder={`Player ${pi + 1}`} placeholderTextColor="#4b5563" />
                {t.players.length > 2 && (
                  <TouchableOpacity onPress={() => state.removePlayer(t.id, pi)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="close" size={16} color="#6b7280" />
                  </TouchableOpacity>
                )}
              </View>
            ))}
            {t.players.length < 5 && (
              <TouchableOpacity onPress={() => state.addPlayer(t.id)} style={styles.addRow}>
                <Ionicons name="add-circle-outline" size={16} color="#00C896" />
                <Text style={styles.addRowText}>Add player</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
        {state.teams.length < 5 && !(state.format === 'match_play' && state.teams.length >= 2) && (
          <TouchableOpacity onPress={state.addTeam} style={styles.addTeamBtn}>
            <Ionicons name="add-circle" size={20} color="#00C896" />
            <Text style={styles.addTeamText}>Add team</Text>
          </TouchableOpacity>
        )}
        {state.format === 'match_play' && (
          <Text style={styles.matchPlayHint}>Match Play is head-to-head — exactly 2 teams.</Text>
        )}

        <Text style={styles.sectionLabel}>HOLE PARS</Text>
        <Text style={styles.subHint}>Defaults to par 4. Tap a hole to cycle through 3 / 4 / 5.</Text>
        <View style={styles.parGrid}>
          {state.holes.map(h => (
            <TouchableOpacity
              key={h.hole}
              style={styles.parCell}
              onPress={() => state.setHolePar(h.hole, h.par === 5 ? 3 : h.par + 1)}
            >
              <Text style={styles.parCellHole}>#{h.hole}</Text>
              <Text style={styles.parCellPar}>par {h.par}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={styles.startBtn} onPress={() => useTournamentStore.getState().setPhase('scoring')}>
          <Text style={styles.startBtnText}>Start Scoring →</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => Alert.alert('Reset tournament?', 'Clear all teams, players, scores. Cannot be undone.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Reset', style: 'destructive', onPress: () => useTournamentStore.getState().resetTournament() },
          ])}
          style={styles.resetLink}
        >
          <Text style={styles.resetLinkText}>Reset tournament</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── SCORING ────────────────────────────────────────────────────────

function ScoringPanel() {
  const state = useTournamentStore();
  const hole = state.currentHole;
  const par = state.holes.find(h => h.hole === hole)?.par ?? 4;
  const indiv = isIndividualFormat(state.format);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.scoringHeader}>
        <TouchableOpacity onPress={() => state.setCurrentHole(hole - 1)} disabled={hole <= 1} style={styles.holeNavBtn}>
          <Ionicons name="chevron-back" size={22} color={hole <= 1 ? '#3a5a40' : '#00C896'} />
        </TouchableOpacity>
        <View style={{ alignItems: 'center' }}>
          <Text style={styles.holeBig}>Hole {hole}</Text>
          <Text style={styles.parSmall}>par {par}</Text>
        </View>
        <TouchableOpacity onPress={() => state.setCurrentHole(hole + 1)} disabled={hole >= 18} style={styles.holeNavBtn}>
          <Ionicons name="chevron-forward" size={22} color={hole >= 18 ? '#3a5a40' : '#00C896'} />
        </TouchableOpacity>
      </View>
      <Text style={styles.scoringFormat}>{FORMAT_LABEL[state.format]}{indiv ? ' · per-player entry' : ' · per-team entry'}</Text>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 80 }} keyboardShouldPersistTaps="handled">
        {state.teams.map(team => (
          <View key={team.id} style={styles.teamScoreCard}>
            <Text style={styles.teamScoreTitle}>{team.name}</Text>
            {indiv ? (
              team.players.map((pName, pi) => (
                <PlayerScoreRow key={pi} teamId={team.id} playerIdx={pi} playerName={pName || `Player ${pi + 1}`} hole={hole} />
              ))
            ) : (
              <TeamScoreRow teamId={team.id} hole={hole} par={par} />
            )}
          </View>
        ))}
        <View style={{ height: 20 }} />
        <TouchableOpacity style={styles.startBtn} onPress={() => state.setPhase('leaderboard')}>
          <Text style={styles.startBtnText}>View Leaderboard →</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function TeamScoreRow({ teamId, hole, par }: { teamId: string; hole: number; par: number }) {
  const score = useTournamentStore(s => s.teamScores[`${teamId}.${hole}`] ?? null);
  const set = useTournamentStore(s => s.setTeamScore);
  return (
    <View style={styles.scoreEntryRow}>
      <Text style={styles.scoreEntryLabel}>Score</Text>
      <Stepper value={score} suggested={par} onChange={(v) => set(teamId, hole, v)} />
    </View>
  );
}

function PlayerScoreRow({ teamId, playerIdx, playerName, hole }: { teamId: string; playerIdx: number; playerName: string; hole: number }) {
  const score = useTournamentStore(s => s.playerScores[`${teamId}.${playerIdx}.${hole}`] ?? null);
  const set = useTournamentStore(s => s.setPlayerScore);
  return (
    <View style={styles.scoreEntryRow}>
      <Text style={styles.scoreEntryLabel} numberOfLines={1}>{playerName}</Text>
      <Stepper value={score} suggested={4} onChange={(v) => set(teamId, playerIdx, hole, v)} />
    </View>
  );
}

function Stepper({ value, suggested, onChange }: { value: number | null; suggested: number; onChange: (v: number | null) => void }) {
  const display = value == null ? '—' : `${value}`;
  return (
    <View style={styles.stepper}>
      <TouchableOpacity onPress={() => onChange(value == null ? Math.max(1, suggested - 1) : Math.max(1, value - 1))} style={styles.stepBtn}>
        <Text style={styles.stepBtnText}>−</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => onChange(value == null ? suggested : value)}
        style={styles.stepValue}
        onLongPress={() => onChange(null)}
      >
        <Text style={[styles.stepValueText, value == null && { color: '#6b7280' }]}>{display}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => onChange(value == null ? suggested : Math.min(20, value + 1))} style={styles.stepBtn}>
        <Text style={styles.stepBtnText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── LEADERBOARD ───────────────────────────────────────────────────

function LeaderboardPanel() {
  const state = useTournamentStore();
  const result = useMemo(() => computeLeaderboard(state), [state]);
  const onShare = useCallback(async () => {
    const text = leaderboardAsText(state, result);
    try { await Share.share({ message: text, title: state.label || 'Tournament leaderboard' }); }
    catch (e) { console.log('[tournament] share failed', e); }
  }, [state, result]);

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 80 }}>
      <View style={styles.leaderHeaderRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.leaderTitle}>{state.label || 'Tournament'}</Text>
          <Text style={styles.leaderSub}>
            {FORMAT_LABEL[state.format]}{state.courseName ? ` · ${state.courseName}` : ''} · thru {result.maxThrough}/18
          </Text>
        </View>
        <TouchableOpacity onPress={onShare} style={styles.shareBtn}>
          <Ionicons name="share-outline" size={18} color="#060f09" />
          <Text style={styles.shareBtnText}>Share</Text>
        </TouchableOpacity>
      </View>

      {result.rows.map((row, idx) => (
        <View key={row.teamId} style={styles.leaderRow}>
          <Text style={styles.leaderPlace}>{idx + 1}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.leaderTeam}>{row.teamName}</Text>
            {!!row.secondary && <Text style={styles.leaderSec}>{row.secondary}</Text>}
          </View>
          <Text style={[styles.leaderPrimary, idx === 0 && { color: '#00C896' }]}>{row.primaryDisplay}</Text>
        </View>
      ))}

      <TouchableOpacity style={styles.startBtn} onPress={() => state.setPhase('scoring')}>
        <Text style={styles.startBtnText}>← Back to Scoring</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060f09' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#1e3a28',
  },
  back: { color: '#00C896', fontSize: 16, width: 60 },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  tabRow: { flexDirection: 'row', backgroundColor: '#0d2418', borderBottomWidth: 1, borderBottomColor: '#1e3a28' },
  tabBtn: { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabBtnActive: { borderBottomColor: '#00C896' },
  tabBtnText: { color: '#9ca3af', fontSize: 13, fontWeight: '600' },
  tabBtnTextActive: { color: '#00C896' },

  sectionLabel: { color: '#9ca3af', fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginTop: 18, marginBottom: 8 },
  subHint: { color: '#6b7280', fontSize: 11, marginBottom: 8 },
  textInput: {
    backgroundColor: '#0d2418', borderWidth: 1, borderColor: '#1e3a28', borderRadius: 8,
    color: '#e5e7eb', fontSize: 14, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8,
  },
  formatRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#0d2418', borderWidth: 1, borderColor: '#1e3a28', borderRadius: 8,
    padding: 12, marginBottom: 8,
  },
  formatRowActive: { borderColor: '#00C896', backgroundColor: '#0f2c1c' },
  formatTitle: { color: '#e5e7eb', fontSize: 14, fontWeight: '700' },
  formatHint: { color: '#9ca3af', fontSize: 11, marginTop: 2 },
  teamCard: { backgroundColor: '#0d2418', borderWidth: 1, borderColor: '#1e3a28', borderRadius: 8, padding: 12, marginBottom: 8 },
  teamHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  teamNameInput: { flex: 1, color: '#fff', fontSize: 14, fontWeight: '700', backgroundColor: '#0a1c12', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8 },
  removeBtn: { padding: 8, marginLeft: 8 },
  rosterMicBtn: { padding: 8, marginLeft: 4 },
  playerRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  playerIdx: { color: '#6b7280', fontSize: 12, width: 22 },
  playerNameInput: { flex: 1, color: '#d1d5db', fontSize: 13, backgroundColor: '#0a1c12', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
  addRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8, paddingVertical: 4 },
  addRowText: { color: '#00C896', fontSize: 12, fontWeight: '700', marginLeft: 4 },
  addTeamBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, backgroundColor: '#0d2418', borderWidth: 1, borderColor: '#1e3a28', borderRadius: 8, marginTop: 4 },
  addTeamText: { color: '#00C896', fontSize: 13, fontWeight: '700', marginLeft: 6 },
  matchPlayHint: { color: '#9ca3af', fontSize: 11, marginTop: 8, fontStyle: 'italic' },

  parGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  parCell: { width: '15.5%', backgroundColor: '#0d2418', borderWidth: 1, borderColor: '#1e3a28', borderRadius: 6, padding: 6, alignItems: 'center' },
  parCellHole: { color: '#6b7280', fontSize: 10 },
  parCellPar: { color: '#e5e7eb', fontSize: 12, fontWeight: '700' },

  startBtn: { backgroundColor: '#00C896', paddingVertical: 14, borderRadius: 10, alignItems: 'center', marginTop: 16 },
  startBtnText: { color: '#060f09', fontWeight: '900', fontSize: 14 },
  resetLink: { alignItems: 'center', paddingVertical: 14 },
  resetLinkText: { color: '#ef4444', fontSize: 12 },

  scoringHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#0d2418', borderBottomWidth: 1, borderBottomColor: '#1e3a28' },
  holeNavBtn: { padding: 8 },
  holeBig: { color: '#fff', fontSize: 22, fontWeight: '900' },
  parSmall: { color: '#9ca3af', fontSize: 11, marginTop: 2 },
  scoringFormat: { color: '#9ca3af', fontSize: 11, textAlign: 'center', paddingVertical: 8, backgroundColor: '#0d2418' },
  teamScoreCard: { backgroundColor: '#0d2418', borderWidth: 1, borderColor: '#1e3a28', borderRadius: 8, padding: 12, marginBottom: 10 },
  teamScoreTitle: { color: '#fff', fontSize: 14, fontWeight: '700', marginBottom: 8 },
  scoreEntryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  scoreEntryLabel: { color: '#d1d5db', fontSize: 13, flex: 1 },
  stepper: { flexDirection: 'row', alignItems: 'center' },
  stepBtn: { backgroundColor: '#143d2a', width: 36, height: 36, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  stepBtnText: { color: '#00C896', fontSize: 20, fontWeight: '900' },
  stepValue: { minWidth: 52, alignItems: 'center', paddingHorizontal: 10 },
  stepValueText: { color: '#fff', fontSize: 22, fontWeight: '900' },

  leaderHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  leaderTitle: { color: '#fff', fontSize: 17, fontWeight: '900' },
  leaderSub: { color: '#9ca3af', fontSize: 11, marginTop: 4 },
  shareBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#00C896', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  shareBtnText: { color: '#060f09', fontWeight: '900', fontSize: 13, marginLeft: 4 },
  leaderRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0d2418', borderWidth: 1, borderColor: '#1e3a28', borderRadius: 8, padding: 12, marginBottom: 8 },
  leaderPlace: { color: '#6b7280', fontSize: 16, fontWeight: '900', width: 28 },
  leaderTeam: { color: '#fff', fontSize: 14, fontWeight: '700' },
  leaderSec: { color: '#9ca3af', fontSize: 11, marginTop: 2 },
  leaderPrimary: { color: '#e5e7eb', fontSize: 18, fontWeight: '900', marginLeft: 8 },
});
