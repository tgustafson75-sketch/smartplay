/**
 * 2026-07-23 (Tim — Bag Vision, Phase 1: scan → populate).
 *
 * Record a short VIDEO panning across your clubs (far less annoying than photographing 14 of
 * them). We pull a few frames, our vision brain reads every distinct club + its make/model, and
 * you confirm/edit before it lands in your bag. The populated bag then sharpens live auto club
 * detection (services/clubRecognition.reconcileClubWithBag) and feeds the Fit Gap analysis.
 *
 * HONEST: only clubs actually seen are listed (never padded to 14); brand/model are blank when
 * not legible rather than guessed. You can edit any field and toggle any club off before adding.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../contexts/ThemeContext';
import { safeBack } from '../services/safeBack';
import { scanBagFromVideo, type ScannedClub } from '../services/bagScan';
import { useClubBagStore } from '../store/clubBagStore';
import type { ClubId } from '../services/clubRecognition';

type EditableClub = ScannedClub & { include: boolean };
type Phase = 'idle' | 'scanning' | 'review';

const VIDEO_MAX_SECONDS = 10;

export default function BagScanScreen() {
  const { colors } = useTheme();
  const registerClub = useClubBagStore((s) => s.registerClub);
  const [phase, setPhase] = useState<Phase>('idle');
  const [clubs, setClubs] = useState<EditableClub[]>([]);
  const [error, setError] = useState<string | null>(null);

  const recordAndScan = async () => {
    setError(null);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { setError('Camera permission is needed to scan your bag.'); return; }
    let result: ImagePicker.ImagePickerResult;
    try {
      result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        videoMaxDuration: VIDEO_MAX_SECONDS,
        quality: 0.7,
        allowsEditing: false,
      });
    } catch {
      setError('Could not open the camera. Try again.');
      return;
    }
    if (result.canceled || !result.assets?.[0]?.uri) return;
    setPhase('scanning');
    const detected = await scanBagFromVideo(result.assets[0].uri);
    if (detected.length === 0) {
      setPhase('idle');
      setError('No clubs read from that clip. Pan slowly across the heads in good light and try again — or add clubs manually.');
      return;
    }
    setClubs(detected.map((c) => ({ ...c, include: true })));
    setPhase('review');
  };

  const edit = (i: number, field: 'brand' | 'model' | 'loft', v: string) =>
    setClubs((prev) => prev.map((c, idx) => (idx === i ? { ...c, [field]: v } : c)));
  const toggle = (i: number) =>
    setClubs((prev) => prev.map((c, idx) => (idx === i ? { ...c, include: !c.include } : c)));

  const addToBag = () => {
    const chosen = clubs.filter((c) => c.include);
    for (const c of chosen) {
      registerClub(c.club_id as ClubId, {
        source: 'camera',
        brand: c.brand || undefined,
        model: c.model || undefined,
        loft: c.loft || undefined,
      });
    }
    safeBack();
  };

  const includedCount = clubs.filter((c) => c.include).length;
  const s = makeStyles(colors);

  return (
    <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => safeBack()} style={s.headerBtn} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.text_primary} />
        </TouchableOpacity>
        <Text style={s.title}>Scan My Bag</Text>
        <View style={s.headerBtn} />
      </View>

      {phase === 'scanning' ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={s.dim}>Reading your clubs…</Text>
        </View>
      ) : phase === 'review' ? (
        <>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}>
            <Text style={s.reviewHint}>
              {clubs.length} club{clubs.length === 1 ? '' : 's'} detected. Fix any make/model and untick anything wrong before adding.
            </Text>
            {clubs.map((c, i) => (
              <View key={`${c.club_id}-${i}`} style={[s.card, !c.include && { opacity: 0.5 }]}>
                <View style={s.cardHead}>
                  <Text style={s.clubId}>{c.club_id}</Text>
                  <Text style={s.clubType}>{c.club_type}</Text>
                  <View style={[s.confPill, c.confidence === 'high' ? s.confHigh : c.confidence === 'medium' ? s.confMed : s.confLow]}>
                    <Text style={s.confText}>{c.confidence}</Text>
                  </View>
                  <View style={{ flex: 1 }} />
                  <Switch
                    value={c.include}
                    onValueChange={() => toggle(i)}
                    trackColor={{ false: colors.border, true: colors.accent }}
                    thumbColor="#ffffff"
                  />
                </View>
                <View style={s.fieldRow}>
                  <TextInput style={s.field} value={c.brand} onChangeText={(v) => edit(i, 'brand', v)} placeholder="Brand" placeholderTextColor={colors.text_muted} />
                  <TextInput style={s.field} value={c.model} onChangeText={(v) => edit(i, 'model', v)} placeholder="Model" placeholderTextColor={colors.text_muted} />
                  <TextInput style={[s.field, { flex: 0.5 }]} value={c.loft} onChangeText={(v) => edit(i, 'loft', v)} placeholder="Loft" placeholderTextColor={colors.text_muted} />
                </View>
              </View>
            ))}
            <TouchableOpacity onPress={recordAndScan} style={s.rescanBtn} accessibilityRole="button">
              <Ionicons name="refresh" size={16} color={colors.accent} />
              <Text style={s.rescanText}>Re-scan</Text>
            </TouchableOpacity>
          </ScrollView>
          <View style={s.footer}>
            <TouchableOpacity onPress={addToBag} disabled={includedCount === 0} style={[s.primaryBtn, includedCount === 0 && { opacity: 0.5 }]} accessibilityRole="button">
              <Text style={s.primaryText}>Add {includedCount} to my bag</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <View style={s.center}>
          <Ionicons name="videocam-outline" size={48} color={colors.accent} />
          <Text style={s.pitch}>Record a slow pan across your clubs</Text>
          <Text style={s.dim}>Keep the heads in view and well-lit. A few seconds is plenty — we read the set from the video, so you don&apos;t have to photograph each club.</Text>
          {error && <Text style={s.err}>{error}</Text>}
          <TouchableOpacity onPress={recordAndScan} style={s.primaryBtn} accessibilityRole="button">
            <Ionicons name="videocam" size={18} color="#0d1a0d" />
            <Text style={s.primaryText}>Record my bag</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

function makeStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10 },
    headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    title: { color: colors.text_primary, fontSize: 18, fontWeight: '800' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 14 },
    pitch: { color: colors.text_primary, fontSize: 18, fontWeight: '800', textAlign: 'center' },
    dim: { color: colors.text_muted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
    err: { color: '#F0803C', fontSize: 13, fontWeight: '700', textAlign: 'center' },
    reviewHint: { color: colors.text_muted, fontSize: 13, marginVertical: 12, lineHeight: 19 },
    card: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 10, gap: 10 },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    clubId: { color: colors.text_primary, fontSize: 18, fontWeight: '900' },
    clubType: { color: colors.text_muted, fontSize: 13, fontWeight: '600' },
    confPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
    confHigh: { backgroundColor: 'rgba(0,200,150,0.2)' },
    confMed: { backgroundColor: 'rgba(240,192,48,0.2)' },
    confLow: { backgroundColor: 'rgba(240,128,60,0.2)' },
    confText: { color: colors.text_primary, fontSize: 11, fontWeight: '700' },
    fieldRow: { flexDirection: 'row', gap: 8 },
    field: { flex: 1, backgroundColor: colors.background, borderRadius: 8, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 10, paddingVertical: 8, color: colors.text_primary, fontSize: 13 },
    rescanBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12 },
    rescanText: { color: colors.accent, fontSize: 14, fontWeight: '700' },
    footer: { paddingHorizontal: 16, paddingTop: 8 },
    primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.accent, borderRadius: 24, paddingVertical: 14, paddingHorizontal: 24 },
    primaryText: { color: '#0d1a0d', fontSize: 16, fontWeight: '800' },
  });
}
