/**
 * Camera Setup — pre-flight gate before swing capture (Phase v3-port 2/5).
 *
 * v3 has a dedicated Camera Setup screen that walks the user through
 * positioning the phone before recording a swing: face-on vs down-the-line
 * toggle, a dashed positioning guide, a 5-item checklist, and a primary
 * CTA. Pro didn't have this — capture flows jumped straight to the camera
 * which led to blurry handheld swings that the analysis couldn't read.
 *
 * Routing:
 *   - Call site: any swing capture entry that wants a setup gate should
 *     route here with a `next` query param (where to go after setup):
 *       router.push('/swinglab/camera-setup?next=/swinglab/cage-drill')
 *   - "Skip" header action routes directly to `next` (or back if no next).
 *   - Primary CTA enables once all 5 checklist items are checked.
 *
 * Non-developer note: this is purely a UX gate — it doesn't open the
 * camera itself. After the user passes the checklist + taps the CTA,
 * we route to whatever screen owns the camera (Pro's existing cage-drill,
 * or any future SmartMotion screen). Skipping is allowed; the gate is
 * advisory, not blocking.
 *
 * Theme + accessibility:
 *   - Theme tokens throughout. Dashed visual is rendered with View
 *     borderStyle: 'dashed' — no SVG dep added.
 *   - Each checklist row is a TouchableOpacity with role=checkbox so
 *     screen readers can navigate the checklist.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';

type CameraAngle = 'face-on' | 'down-the-line';

interface ChecklistItem {
  key: string;
  label: string;
  sub: string;
}

const CHECKLIST: ChecklistItem[] = [
  { key: 'vertical',  label: 'Phone is vertical',          sub: 'Portrait orientation, screen up' },
  { key: 'height',    label: 'Lens at hip-to-chest height', sub: 'Mounted on a tripod or alignment stick' },
  { key: 'stable',    label: 'Stable mount, no handheld',  sub: 'Handheld blurs the swing — won\'t analyze cleanly' },
  { key: 'distance',  label: 'Camera distance set',        sub: '' /* sub rendered inline below with input */ },
  { key: 'light',     label: 'Light at your back',         sub: 'Sun (or studio light) behind YOU, not behind the phone' },
];

export default function CameraSetup() {
  const router = useRouter();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const { colors } = useTheme();

  const [angle, setAngle] = useState<CameraAngle>('face-on');
  // Distance in feet — 8 ft default per v3 guidance (6-8 face-on, 8-10 dtl).
  const [distanceFt, setDistanceFt] = useState<string>('8');
  // Checklist state — keyed by item.key so we can flip individually.
  // distance auto-checks when user types a valid number.
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const toggleCheck = (key: string) => {
    setChecked((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // distance "checked" whenever the input parses to a positive number.
  // Memo-light: just compute on each render — value is one parseInt.
  const distanceValid = (() => {
    const n = parseInt(distanceFt, 10);
    return !Number.isNaN(n) && n > 0;
  })();
  const checkedWithDistance: Record<string, boolean> = {
    ...checked,
    distance: distanceValid,
  };
  const allChecked = CHECKLIST.every((c) => checkedWithDistance[c.key]);

  const handleSkip = () => {
    if (typeof next === 'string' && next.length > 0) {
      router.replace(next as never);
    } else {
      router.back();
    }
  };

  const handleProceed = () => {
    if (typeof next === 'string' && next.length > 0) {
      router.replace(next as never);
    } else {
      router.back();
    }
  };

  // Distance hint per angle — matches v3's guidance.
  const distanceHint = angle === 'face-on'
    ? '6–8 ft from your stance for face-on (wedges, irons)'
    : '8–10 ft from your stance for down-the-line';

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* HEADER */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={10} accessibilityLabel="Cancel setup" accessibilityRole="button">
            <Ionicons name="close" size={26} color={colors.text_primary} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text_primary }]}>Camera Setup</Text>
          <TouchableOpacity onPress={handleSkip} hitSlop={10} accessibilityLabel="Skip setup checklist" accessibilityRole="button">
            <Text style={[styles.headerAction, { color: colors.text_muted }]}>Skip</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {/* ANGLE TOGGLE */}
          <View style={styles.toggleRow}>
            <ToggleBtn
              label="FACE-ON"
              active={angle === 'face-on'}
              onPress={() => setAngle('face-on')}
              colors={colors}
            />
            <ToggleBtn
              label="DOWN-THE-LINE"
              active={angle === 'down-the-line'}
              onPress={() => setAngle('down-the-line')}
              colors={colors}
            />
          </View>

          {/* DASHED POSITIONING GUIDE — purely visual. The dashed box
              represents where the player should stand in the camera
              frame; the wider outer frame is the camera's field of view.
              We render with nested Views + borderStyle: 'dashed' so no
              SVG dependency is needed. */}
          <View style={[styles.guideOuter, { borderColor: colors.border }]}>
            <View style={[styles.guideFrame, { borderColor: colors.text_muted }]} />
            <View style={[styles.guideStance, { borderColor: colors.accent, backgroundColor: 'rgba(0,200,150,0.10)' }]} />
            <View style={[styles.guideGround, { borderTopColor: colors.text_muted }]} />
            <Text style={[styles.guideCaption, { color: colors.text_muted }]}>
              Position yourself inside the dashed box
            </Text>
          </View>

          {/* CHECKLIST */}
          <Text style={[styles.sectionHeader, { color: colors.text_muted }]}>SETUP CHECKLIST</Text>
          <View style={[styles.checklistCard, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
            {CHECKLIST.map((item, idx) => {
              const isDistance = item.key === 'distance';
              const isOn = isDistance ? distanceValid : !!checked[item.key];
              return (
                <View key={item.key}>
                  {idx > 0 && <View style={[styles.divider, { backgroundColor: colors.border }]} />}
                  <Pressable
                    onPress={isDistance ? undefined : () => toggleCheck(item.key)}
                    disabled={isDistance}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: isOn }}
                    accessibilityLabel={item.label}
                    style={styles.row}
                  >
                    <View style={[
                      styles.checkbox,
                      { borderColor: colors.accent, backgroundColor: isOn ? colors.accent_muted : 'transparent' },
                    ]}>
                      {isOn && <Ionicons name="checkmark" size={16} color={colors.accent} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowLabel, { color: colors.text_primary }]}>{item.label}</Text>
                      {isDistance ? (
                        <View style={styles.distanceRow}>
                          <TextInput
                            value={distanceFt}
                            onChangeText={setDistanceFt}
                            keyboardType="number-pad"
                            maxLength={3}
                            accessibilityLabel="Camera distance in feet"
                            style={[
                              styles.distanceInput,
                              {
                                borderColor: colors.border,
                                backgroundColor: colors.background,
                                color: colors.accent,
                              },
                            ]}
                          />
                          <Text style={[styles.distanceUnit, { color: colors.text_muted }]}>ft</Text>
                          <Text style={[styles.rowSub, { color: colors.text_muted }]} numberOfLines={2}>
                            {' · ' + distanceHint}
                          </Text>
                        </View>
                      ) : (
                        <Text style={[styles.rowSub, { color: colors.text_muted }]} numberOfLines={2}>
                          {item.sub}
                        </Text>
                      )}
                    </View>
                  </Pressable>
                </View>
              );
            })}
          </View>

          {/* PRIMARY CTA — enabled once all 5 checks pass. Pressing it
              routes to the `next` param (or back if not provided).
              Even when disabled, the user can use the header's Skip. */}
          <TouchableOpacity
            onPress={handleProceed}
            disabled={!allChecked}
            accessibilityRole="button"
            accessibilityLabel={allChecked ? 'Start recording' : 'Check all items first'}
            style={[
              styles.cta,
              {
                backgroundColor: allChecked ? colors.accent : colors.surface_elevated,
                borderColor: allChecked ? colors.accent : colors.border,
              },
            ]}
          >
            <Ionicons
              name="videocam"
              size={20}
              color={allChecked ? colors.background : colors.text_muted}
            />
            <Text style={[styles.ctaText, { color: allChecked ? colors.background : colors.text_muted }]}>
              {allChecked ? 'Start recording' : 'Check all items first'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

interface ToggleBtnProps {
  label: string;
  active: boolean;
  colors: ReturnType<typeof useTheme>['colors'];
  onPress: () => void;
}

function ToggleBtn({ label, active, colors, onPress }: ToggleBtnProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.toggleBtn,
        {
          backgroundColor: active ? colors.accent : colors.surface_elevated,
          borderColor: active ? colors.accent : colors.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <Text
        style={[
          styles.toggleBtnText,
          { color: active ? colors.background : colors.text_primary },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 17, fontWeight: '700' },
  headerAction: { fontSize: 15, fontWeight: '600' },
  scroll: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 24,
  },
  toggleRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  toggleBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 999,
    borderWidth: 1.5,
    alignItems: 'center',
  },
  toggleBtnText: { fontSize: 13, fontWeight: '800', letterSpacing: 1.4 },
  // Positioning guide
  guideOuter: {
    height: 240,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    position: 'relative',
  },
  guideFrame: {
    // Outer "camera frame" — the wider field of view.
    position: 'absolute',
    top: 16,
    left: '20%',
    right: '20%',
    bottom: 30,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
  },
  guideStance: {
    // The dashed stance box — where the player should stand.
    position: 'absolute',
    top: 36,
    left: '38%',
    right: '38%',
    bottom: 36,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: 4,
  },
  guideGround: {
    // Faint ground line at the bottom — visual ground reference.
    position: 'absolute',
    left: '12%',
    right: '12%',
    bottom: 30,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
  },
  guideCaption: {
    position: 'absolute',
    bottom: 8,
    fontSize: 11,
    fontStyle: 'italic',
  },
  // Checklist
  sectionHeader: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginTop: 14,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  checklistCard: {
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 14 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  rowLabel: { fontSize: 15, fontWeight: '700' },
  rowSub: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  distanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    flexWrap: 'wrap',
  },
  distanceInput: {
    minWidth: 60,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  distanceUnit: { fontSize: 14, fontWeight: '700' },
  // CTA
  cta: {
    marginTop: 20,
    paddingVertical: 16,
    borderRadius: 999,
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  ctaText: { fontSize: 15, fontWeight: '800', letterSpacing: 0.5 },
});
