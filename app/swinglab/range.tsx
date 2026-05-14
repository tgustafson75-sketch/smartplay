/**
 * Range Mode — multi-shot range / studio / backyard session
 * (Phase v3-port 4/5).
 *
 * Ported from v3. Pro had no equivalent; the closest was Cage Mode,
 * which is a single-environment camera setup. Range Mode is the
 * pre-flight planning surface BEFORE you swing — it sets the target
 * distance, camera distance, and starting club, then the user proceeds
 * to a session screen (currently routes to the existing
 * /swinglab/cage-drill capture; can be swapped to a dedicated Range
 * Session screen later without changing this UI).
 *
 * Layout (matches v3 screenshot):
 *   - Header: < SwingLab + brand badge
 *   - "RANGE" eyebrow + "Range Mode" title + multi-shot copy
 *   - SETUP — 3 numbered steps (Position the phone / Distance / Lighting)
 *     Each step is a static informational row, not a checklist (the
 *     full pre-flight checklist lives on the Camera Setup screen).
 *   - SHOT TARGETS — target distance (yards to aim point) + camera
 *     distance (feet from stance). Both editable.
 *   - STARTING CLUB — single-row picker showing current club + average
 *     yardage. Tap to switch (modal stub for now).
 *   - "Start Session" primary CTA at the bottom.
 *
 * Non-developer note: Range Mode is a planning surface — it doesn't
 * capture anything itself. After "Start Session", we route to the
 * camera screen. The values entered here can be read by future
 * session code via React Navigation params or a small session store.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  Image,
  TextInput,
  TouchableOpacity,
  Pressable,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';

interface SetupStep {
  num: number;
  title: string;
  body: string;
}

const SETUP: SetupStep[] = [
  {
    num: 1,
    title: 'Position the phone',
    body: 'Phone vertical, lens at hip-to-chest height. Stable mount or alignment stick — handheld will blur on a full swing.',
  },
  {
    num: 2,
    title: 'Distance',
    body: '6–8 feet from your stance for face-on (wedges, irons). 8–10 feet down-the-line. Frame should show full backswing-to-finish.',
  },
  {
    num: 3,
    title: 'Lighting',
    body: 'Backlight is the worst case — keep the sun (or studio light) at your back, not behind the phone.',
  },
];

export default function RangeMode() {
  const router = useRouter();
  const { colors } = useTheme();

  // User-editable session params. Default starting club is Driver — most
  // common range session opener. Camera distance defaults to 8 ft
  // (mid-range of the face-on guidance above).
  const [targetDistance, setTargetDistance] = useState<string>(''); // yards (blank by default)
  const [cameraDistance, setCameraDistance] = useState<string>('8');
  const [startingClub, setStartingClub] = useState<string>('Driver');

  // Average yardage shown next to the picked club. v3 reads from the
  // user's bag-distances store; Pro doesn't have that pulled into a
  // ready selector yet — show a static placeholder so the UI feels
  // complete. Wire to relationshipStore.confidenceByClub or a future
  // bag-distances store when available.
  const startingClubAvgYds = startingClub === 'Driver' ? 240 : null;

  const handleStartSession = () => {
    // Route to the existing single-swing capture; future work can
    // build a dedicated multi-shot range-session screen and swap
    // this route without changing this UI.
    router.push('/swinglab/cage-drill' as never);
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* HEADER */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Back to SwingLab"
            style={styles.backBtn}
          >
            <Ionicons name="chevron-back" size={22} color={colors.accent} />
            <Text style={[styles.backText, { color: colors.accent }]}>SwingLab</Text>
          </Pressable>
          <Image
            source={require('../../assets/avatars/smartplay_caddie_badge.png')}
            style={styles.headerBadge}
            resizeMode="contain"
          />
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <Text style={[styles.eyebrow, { color: colors.accent }]}>RANGE</Text>
          <Text style={[styles.title, { color: colors.text_primary }]}>Range Mode</Text>
          <Text style={[styles.subtitle, { color: colors.text_muted }]}>
            Multi-swing capture for the range, studio, or backyard. Set the phone, set a
            club, swing, capture. Tap “Change club” between sets to keep tagging accurate.
          </Text>

          {/* SETUP — 3 numbered info steps */}
          <Text style={[styles.sectionLabel, { color: colors.text_muted }]}>SETUP</Text>
          <View style={[styles.setupCard, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
            {SETUP.map((step, idx) => (
              <View key={step.num}>
                {idx > 0 && <View style={[styles.divider, { backgroundColor: colors.border }]} />}
                <View style={styles.setupRow}>
                  <View style={[styles.numBadge, { borderColor: colors.accent }]}>
                    <Text style={[styles.numBadgeText, { color: colors.accent }]}>{step.num}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.setupTitle, { color: colors.text_primary }]}>{step.title}</Text>
                    <Text style={[styles.setupBody, { color: colors.text_muted }]}>{step.body}</Text>
                  </View>
                </View>
              </View>
            ))}
          </View>

          {/* SHOT TARGETS */}
          <Text style={[styles.sectionLabel, { color: colors.text_muted }]}>SHOT TARGETS</Text>
          <View style={[styles.targetsCard, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
            <TargetRow
              label="Target distance"
              sub="yards to your aim point"
              value={targetDistance}
              onChange={setTargetDistance}
              suffix=""
              colors={colors}
            />
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <TargetRow
              label="Camera distance"
              sub="feet from stance"
              value={cameraDistance}
              onChange={setCameraDistance}
              suffix="ft"
              colors={colors}
            />
          </View>

          {/* STARTING CLUB */}
          <Text style={[styles.sectionLabel, { color: colors.text_muted }]}>STARTING CLUB</Text>
          <Pressable
            onPress={() => {
              // Stub: a real club picker can land here. For now we let
              // the user toggle between Driver and 7-iron as a
              // placeholder — covers the two most common range
              // openers without dragging in a full club-picker yet.
              setStartingClub(startingClub === 'Driver' ? '7-iron' : 'Driver');
            }}
            accessibilityRole="button"
            accessibilityLabel={`Change starting club. Current: ${startingClub}`}
            style={[styles.clubCard, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.clubName, { color: colors.text_primary }]}>{startingClub}</Text>
              {startingClubAvgYds != null && (
                <Text style={[styles.clubAvg, { color: colors.text_muted }]}>{startingClubAvgYds} yds avg</Text>
              )}
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.text_muted} />
          </Pressable>

          {/* START SESSION CTA */}
          <TouchableOpacity
            onPress={handleStartSession}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Start Session"
            style={[styles.cta, { backgroundColor: colors.accent }]}
          >
            <Ionicons name="videocam" size={20} color={colors.background} />
            <Text style={[styles.ctaText, { color: colors.background }]}>Start Session</Text>
          </TouchableOpacity>

          <Text style={[styles.tip, { color: colors.text_muted }]}>
            Tip: tap and hold the badge and say <Text style={{ fontWeight: '700' }}>“record”</Text> to start another swing while you’re hands-free.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

interface TargetRowProps {
  label: string;
  sub: string;
  value: string;
  onChange: (v: string) => void;
  suffix: string;
  colors: ReturnType<typeof useTheme>['colors'];
}

function TargetRow({ label, sub, value, onChange, suffix, colors }: TargetRowProps) {
  return (
    <View style={styles.targetRow}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.targetLabel, { color: colors.text_primary }]}>{label}</Text>
        <Text style={[styles.targetSub, { color: colors.text_muted }]}>{sub}</Text>
      </View>
      <View style={styles.targetInputWrap}>
        <TextInput
          value={value}
          onChangeText={onChange}
          keyboardType="number-pad"
          maxLength={4}
          placeholder="—"
          placeholderTextColor={colors.text_muted}
          accessibilityLabel={label}
          style={[
            styles.targetInput,
            { borderColor: colors.border, backgroundColor: colors.background, color: colors.accent },
          ]}
        />
        {suffix.length > 0 && (
          <Text style={[styles.targetSuffix, { color: colors.text_muted }]}>{suffix}</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', padding: 4 },
  backText: { fontSize: 17, fontWeight: '700' },
  headerBadge: { width: 40, height: 40, borderRadius: 20 },
  scroll: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32 },
  eyebrow: { fontSize: 12, fontWeight: '800', letterSpacing: 2, marginBottom: 6 },
  title: { fontSize: 32, fontWeight: '900', marginBottom: 8 },
  subtitle: { fontSize: 14, lineHeight: 20, marginBottom: 16 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginTop: 18,
    marginBottom: 8,
  },
  setupCard: { borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 14 },
  setupRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14 },
  numBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  numBadgeText: { fontSize: 14, fontWeight: '800' },
  setupTitle: { fontSize: 15, fontWeight: '800' },
  setupBody: { fontSize: 13, lineHeight: 18, marginTop: 4 },
  targetsCard: { borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  targetRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  targetLabel: { fontSize: 15, fontWeight: '700' },
  targetSub: { fontSize: 12, marginTop: 2 },
  targetInputWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  targetInput: {
    minWidth: 64,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  targetSuffix: { fontSize: 13, fontWeight: '700' },
  clubCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  clubName: { fontSize: 17, fontWeight: '800' },
  clubAvg: { fontSize: 12, marginTop: 2 },
  cta: {
    marginTop: 20,
    paddingVertical: 16,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  ctaText: { fontSize: 15, fontWeight: '800', letterSpacing: 0.4 },
  tip: { fontSize: 12, fontStyle: 'italic', textAlign: 'center', marginTop: 16, paddingHorizontal: 12 },
});
