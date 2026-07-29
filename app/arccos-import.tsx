/**
 * 2026-07-29 (Tim — Arccos Air trial) — IMPORT ARCCOS DISTANCES screen.
 *
 * Pick a screenshot of the Arccos app's "Smart Club Distances" screen; our vision brain reads each
 * club's average, you confirm/edit, and it seeds your bag: an Arccos CARRY average becomes a stated
 * carry (My Bag), a TOTAL average lands in the total ladder. The Caddie brain then has your real
 * per-club yardages from day one. ([[club-tied-shot-tracking]], sibling of app/bag-scan.)
 *
 * HONEST: only clubs Arccos actually shows a number for are listed (never padded). You pick whether
 * the numbers are carry or total (Arccos's default club average is a TOTAL) so we never quote a
 * tee→rest total as a carry you must FLY a hazard.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../contexts/ThemeContext';
import { safeBack } from '../services/safeBack';
import { importArccosDistances, arccosRowsToBagUpdates, type ArccosDistanceKind } from '../services/arccosImport';
import { useClubStatsStore, type ClubName } from '../store/clubStatsStore';

type EditableRow = { club: ClubName; yards: string; include: boolean };
type Phase = 'idle' | 'scanning' | 'review';

export default function ArccosImportScreen() {
  const { colors } = useTheme();
  const [phase, setPhase] = useState<Phase>('idle');
  const [unit, setUnit] = useState<'carry' | 'total'>('total');
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  const includedCount = useMemo(() => rows.filter((r) => r.include).length, [rows]);

  const pickAndImport = async () => {
    setError(null);
    setApplied(false);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setError('Photo access is needed to read your Arccos screenshot.'); return; }
    let result: ImagePicker.ImagePickerResult;
    try {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        selectionLimit: 4,
        quality: 1,
      });
    } catch {
      setError('Could not open your photos. Try again.');
      return;
    }
    if (result.canceled || !result.assets?.length) return;
    setPhase('scanning');
    const uris = result.assets.map((a) => a.uri).filter(Boolean);
    const res = await importArccosDistances(uris);
    // Resolve to canonical bag updates using the unit Arccos was showing; the user can flip it below.
    const kind: ArccosDistanceKind = res.distance_kind;
    const nextUnit: 'carry' | 'total' = kind === 'carry' ? 'carry' : 'total';
    const updates = arccosRowsToBagUpdates(res.rows, kind, nextUnit);
    if (updates.length === 0) {
      setPhase('idle');
      setError('No club distances read from that screenshot. Open Arccos → your club distances screen, take a clean screenshot (good contrast, numbers visible), and try again.');
      return;
    }
    setUnit(nextUnit);
    setRows(updates.map((u) => ({ club: u.club, yards: String(u.yards), include: true })));
    setPhase('review');
  };

  const setYards = (club: ClubName, v: string) => {
    setRows((rs) => rs.map((r) => (r.club === club ? { ...r, yards: v.replace(/[^0-9]/g, '').slice(0, 3) } : r)));
  };
  const toggleInclude = (club: ClubName) => {
    setRows((rs) => rs.map((r) => (r.club === club ? { ...r, include: !r.include } : r)));
  };

  const apply = () => {
    const store = useClubStatsStore.getState();
    let n = 0;
    for (const r of rows) {
      if (!r.include) continue;
      const y = parseInt(r.yards, 10);
      if (!Number.isFinite(y) || y <= 0) continue;
      if (unit === 'carry') store.setManual(r.club, y);   // stated carry (My Bag)
      else store.recordTotal(r.club, y);                   // tee→rest total ladder
      n += 1;
    }
    setApplied(true);
    setRows((rs) => rs); // keep the review visible with a success banner
    if (n === 0) setError('Nothing to add — toggle at least one club on.');
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => safeBack()} style={styles.headerBtn} accessibilityRole="button">
          <Ionicons name="chevron-back" size={24} color={colors.text_primary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text_primary }]}>Import from Arccos</Text>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}>
        {phase === 'idle' && (
          <>
            <Text style={[styles.lead, { color: colors.text_primary }]}>
              Seed your bag from Arccos.
            </Text>
            <Text style={[styles.body, { color: colors.text_muted }]}>
              In the Arccos app, open your <Text style={{ fontWeight: '800' }}>Smart Club Distances</Text> screen and take a
              screenshot. Pick it here and I&apos;ll read every club average into your bag — so the Caddie has your real
              numbers, not chart defaults.
            </Text>
            <View style={[styles.tipCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Ionicons name="bulb-outline" size={16} color={colors.accent} />
              <Text style={[styles.tipText, { color: colors.text_secondary }]}>
                For the truest numbers, tag your clubs by hand in Arccos during your rounds — Arccos Air otherwise
                guesses the club from distance, which makes the averages less reliable.
              </Text>
            </View>
            <TouchableOpacity
              onPress={pickAndImport}
              style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
              accessibilityRole="button"
              accessibilityLabel="Pick an Arccos screenshot to import distances"
            >
              <Ionicons name="images-outline" size={18} color="#0a1410" />
              <Text style={styles.primaryBtnText}>Pick Arccos screenshot</Text>
            </TouchableOpacity>
            {error ? <Text style={[styles.error, { color: '#f5a623' }]}>{error}</Text> : null}
          </>
        )}

        {phase === 'scanning' && (
          <View style={styles.scanning}>
            <ActivityIndicator size="large" color={colors.accent} />
            <Text style={[styles.body, { color: colors.text_muted, textAlign: 'center', marginTop: 14 }]}>
              Reading your club distances…
            </Text>
          </View>
        )}

        {phase === 'review' && (
          <>
            {applied ? (
              <View style={[styles.successCard, { backgroundColor: colors.surface, borderColor: '#3FB950' }]}>
                <Ionicons name="checkmark-circle" size={18} color="#3FB950" />
                <Text style={[styles.successText, { color: colors.text_primary }]}>
                  Added to your bag. Your Fit Profile and the Caddie now use these {unit === 'carry' ? 'carries' : 'distances'}.
                </Text>
              </View>
            ) : (
              <Text style={[styles.body, { color: colors.text_muted, marginTop: 4 }]}>
                Confirm the numbers, then add them to your bag. Toggle off anything that misread.
              </Text>
            )}

            {/* Unit — Arccos's default club average is a TOTAL (includes roll). */}
            <View style={styles.unitRow}>
              <Text style={[styles.unitLabel, { color: colors.text_muted }]}>These are</Text>
              <View style={[styles.segment, { borderColor: colors.border }]}>
                {(['total', 'carry'] as const).map((u) => (
                  <TouchableOpacity
                    key={u}
                    onPress={() => setUnit(u)}
                    style={[styles.segBtn, unit === u && { backgroundColor: colors.accent }]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: unit === u }}
                  >
                    <Text style={[styles.segText, { color: unit === u ? '#0a1410' : colors.text_secondary }]}>
                      {u === 'total' ? 'Total' : 'Carry'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <Text style={[styles.unitHint, { color: colors.text_muted }]}>
              {unit === 'total'
                ? 'Tee-to-rest, includes roll (Arccos default). We derive your carry from it.'
                : 'Airtime carry — stored as your stated My Bag carry.'}
            </Text>

            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, paddingVertical: 4 }]}>
              {rows.map((r) => (
                <View key={r.club} style={styles.row}>
                  <Text style={[styles.rowClub, { color: r.include ? colors.text_primary : colors.text_muted }]}>{r.club}</Text>
                  <View style={styles.rowRight}>
                    <TextInput
                      value={r.yards}
                      onChangeText={(v) => setYards(r.club, v)}
                      keyboardType="number-pad"
                      maxLength={3}
                      editable={r.include}
                      placeholder="yds"
                      placeholderTextColor={colors.text_muted}
                      style={[styles.input, { color: colors.text_primary, borderColor: r.include ? colors.accent : colors.border, opacity: r.include ? 1 : 0.4 }]}
                      accessibilityLabel={`${r.club} distance in yards`}
                    />
                    <Text style={[styles.unitYd, { color: colors.text_muted }]}>yd</Text>
                    <Switch value={r.include} onValueChange={() => toggleInclude(r.club)} />
                  </View>
                </View>
              ))}
            </View>

            {error ? <Text style={[styles.error, { color: '#f5a623' }]}>{error}</Text> : null}

            <TouchableOpacity
              onPress={apply}
              disabled={includedCount === 0}
              style={[styles.primaryBtn, { backgroundColor: includedCount === 0 ? colors.border : colors.accent, marginTop: 16 }]}
              accessibilityRole="button"
              accessibilityLabel="Add these distances to my bag"
            >
              <Ionicons name="golf-outline" size={18} color="#0a1410" />
              <Text style={styles.primaryBtnText}>{applied ? 'Update bag' : `Add ${includedCount} to my bag`}</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={pickAndImport} style={styles.secondaryBtn} accessibilityRole="button">
              <Text style={[styles.secondaryText, { color: colors.text_muted }]}>Pick a different screenshot</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800' },
  lead: { fontSize: 18, fontWeight: '800', marginTop: 8 },
  body: { fontSize: 13.5, lineHeight: 20, marginTop: 8 },
  tipCard: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 14 },
  tipText: { fontSize: 12.5, lineHeight: 18, flex: 1 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, paddingVertical: 14, marginTop: 18 },
  primaryBtnText: { fontSize: 15, fontWeight: '800', color: '#0a1410' },
  secondaryBtn: { alignItems: 'center', paddingVertical: 14 },
  secondaryText: { fontSize: 13, fontWeight: '600' },
  error: { fontSize: 13, lineHeight: 19, marginTop: 14 },
  scanning: { alignItems: 'center', justifyContent: 'center', paddingVertical: 80 },
  successCard: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 8 },
  successText: { fontSize: 13, lineHeight: 19, flex: 1, fontWeight: '600' },
  unitRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
  unitLabel: { fontSize: 13, fontWeight: '700' },
  segment: { flexDirection: 'row', borderWidth: 1, borderRadius: 10, overflow: 'hidden' },
  segBtn: { paddingHorizontal: 16, paddingVertical: 7 },
  segText: { fontSize: 13, fontWeight: '800' },
  unitHint: { fontSize: 11.5, lineHeight: 16, marginTop: 6 },
  card: { borderWidth: 1, borderRadius: 14, marginTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(127,127,127,0.18)' },
  rowClub: { fontSize: 14, fontWeight: '700', width: 60 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { minWidth: 56, borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, fontSize: 14, fontWeight: '800', textAlign: 'right' },
  unitYd: { fontSize: 11, fontWeight: '600', marginRight: 2 },
});
