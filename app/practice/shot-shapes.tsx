/**
 * 2026-06-15 (Tim — shot-shape drills) — "WHAT DO YOU WANT TO PRACTICE?"
 * short-game shot-shape picker (mockup-driven). Pick a shot type → its intended
 * shape is the goal → record through Smart Motion's drill flow → the review shows
 * intended-vs-actual launch (origin→departure read). Honest sense-of-progress,
 * not lab precision ([[shot-shape-drills]]).
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import { SHOT_SHAPES, type ShotShapeDef } from '../../services/practice/shotShapes';
import { safeBack } from '../../services/safeBack';
import { ACCENT_GREEN, ACCENT_AMBER, ACCENT_SKY } from '../../theme/tokens';

// 2026-06-23 (Tim) — launch-height tints on the disciplined 3-color brand
// palette (was green/orange/cyan): high=GREEN, medium=AMBER, low=SKY.
const HEIGHT_TINT: Record<string, string> = { high: ACCENT_GREEN, medium: ACCENT_AMBER, low: ACCENT_SKY };

export default function ShotShapesPicker() {
  const router = useRouter();
  const { colors } = useTheme();

  /**
   * 2026-09-01 (Tim — "our shot shape drill shouldn't be here. I'll watch you do shot shape drills.
   * It should FIRST teach you how to do different shot shapes and why, in terms that users can
   * understand.") — TEACH, THEN RECORD.
   *
   * Tapping a tile used to start a recording immediately. That grades a skill the app never taught,
   * and the verdict that comes back ("that came out more like a running chip") reads as a mark rather
   * than as coaching to a golfer who was never shown the shot. Now the tile opens the lesson — when
   * you'd play it, the club to try, the setup, and the one feel — and RECORD is the second tap.
   *
   * The lesson is a step, not a gate: "I know this one" goes straight to the capture, so the golfer
   * who already has the shot is never made to sit through it twice. [[time-constrained-golfer-lens]]
   */
  const [teaching, setTeaching] = useState<ShotShapeDef | null>(null);

  const pick = (s: ShotShapeDef) => {
    setTeaching(null);
    // Ride Smart Motion's existing drill capture flow; drillShotType carries the
    // intended shape into the review for the intended-vs-actual compare card.
    router.push(
      `/swinglab/smartmotion?drillId=shot_${s.id}&drillName=${encodeURIComponent(s.name)}&drillShots=3&drillFocus=shot_shape&drillShotType=${s.id}` as never,
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => safeBack()} style={styles.headerBtn} accessibilityRole="button">
          <Ionicons name="chevron-back" size={24} color={colors.text_primary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text_primary }]}>What do you want to practice?</Text>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.grid}>
        <Text style={[styles.sub, { color: colors.text_muted }]}>
          Pick a shot. I&apos;ll show you when to play it and how to hit it, then record it and show you what you went for vs. what came out — launch + direction. Sense of progress, not a TrackMan.
        </Text>
        {SHOT_SHAPES.map((s) => (
          <TouchableOpacity
            key={s.id}
            style={[styles.tile, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={() => setTeaching(s)}
            accessibilityRole="button"
            accessibilityLabel={`Learn and practice ${s.name}`}
          >
            <View style={[styles.tileIcon, { backgroundColor: `${HEIGHT_TINT[s.intendedHeight]}22` }]}>
              <Ionicons name={s.icon as React.ComponentProps<typeof Ionicons>['name']} size={22} color={HEIGHT_TINT[s.intendedHeight]} />
            </View>
            <Text style={[styles.tileName, { color: colors.text_primary }]}>{s.name}</Text>
            <Text style={[styles.tileBlurb, { color: colors.text_muted }]}>{s.blurb}</Text>
            <Text style={[styles.tileMeta, { color: HEIGHT_TINT[s.intendedHeight] }]}>
              {s.intendedHeight.toUpperCase()} LAUNCH
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* THE LESSON. Opens on tap; RECORD is the second tap. */}
      <Modal visible={!!teaching} animationType="slide" transparent onRequestClose={() => setTeaching(null)}>
        <View style={styles.sheetBackdrop}>
          <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {teaching ? (
              <>
                <View style={styles.sheetHead}>
                  <View style={[styles.tileIcon, { backgroundColor: `${HEIGHT_TINT[teaching.intendedHeight]}22`, marginBottom: 0 }]}>
                    <Ionicons
                      name={teaching.icon as React.ComponentProps<typeof Ionicons>['name']}
                      size={22}
                      color={HEIGHT_TINT[teaching.intendedHeight]}
                    />
                  </View>
                  <Text style={[styles.sheetTitle, { color: colors.text_primary }]}>{teaching.name}</Text>
                  <TouchableOpacity onPress={() => setTeaching(null)} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel="Close">
                    <Ionicons name="close" size={22} color={colors.text_muted} />
                  </TouchableOpacity>
                </View>

                <ScrollView style={styles.sheetScroll} contentContainerStyle={{ paddingBottom: 12 }}>
                  <Text style={[styles.sheetLabel, { color: colors.text_muted }]}>WHEN YOU&apos;D PLAY IT</Text>
                  <Text style={[styles.sheetBody, { color: colors.text_primary }]}>{teaching.why}</Text>

                  <Text style={[styles.sheetLabel, { color: colors.text_muted }]}>CLUB</Text>
                  <Text style={[styles.sheetBody, { color: colors.text_primary }]}>{teaching.club}</Text>

                  <Text style={[styles.sheetLabel, { color: colors.text_muted }]}>HOW TO HIT IT</Text>
                  {teaching.how.map((step, i) => (
                    <View key={i} style={styles.stepRow}>
                      <Text style={[styles.stepNum, { color: HEIGHT_TINT[teaching.intendedHeight] }]}>{i + 1}</Text>
                      <Text style={[styles.sheetBody, { color: colors.text_primary, flex: 1, marginBottom: 0 }]}>{step}</Text>
                    </View>
                  ))}
                </ScrollView>

                <TouchableOpacity
                  style={[styles.recordBtn, { backgroundColor: HEIGHT_TINT[teaching.intendedHeight] }]}
                  onPress={() => pick(teaching)}
                  accessibilityRole="button"
                  accessibilityLabel={`Record three ${teaching.name} attempts`}
                >
                  <Ionicons name="videocam" size={18} color="#04140b" />
                  <Text style={styles.recordBtnText}>Record 3 of these</Text>
                </TouchableOpacity>
                {/* A step, never a gate — the golfer who already owns the shot skips straight past. */}
                <TouchableOpacity onPress={() => pick(teaching)} accessibilityRole="button" style={styles.skipBtn}>
                  <Text style={[styles.skipText, { color: colors.text_muted }]}>I know this one — just record</Text>
                </TouchableOpacity>
              </>
            ) : null}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '800', flex: 1, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 16, paddingBottom: 40, justifyContent: 'space-between' },
  sub: { width: '100%', fontSize: 14, lineHeight: 20, marginBottom: 6 },
  tile: { width: '47%', borderWidth: 1, borderRadius: 14, padding: 14 },
  tileIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  tileName: { fontSize: 15, fontWeight: '800' },
  tileBlurb: { fontSize: 12, lineHeight: 17, marginTop: 4, minHeight: 34 },
  tileMeta: { fontSize: 10, fontWeight: '900', letterSpacing: 1, marginTop: 8 },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, paddingHorizontal: 18, paddingTop: 14, paddingBottom: 22, maxHeight: '86%' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  sheetTitle: { flex: 1, fontSize: 20, fontWeight: '800' },
  sheetScroll: { flexGrow: 0 },
  sheetLabel: { fontSize: 11, fontWeight: '900', letterSpacing: 1, marginTop: 14, marginBottom: 6 },
  sheetBody: { fontSize: 15, lineHeight: 22, marginBottom: 2 },
  stepRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  stepNum: { fontSize: 15, fontWeight: '900', width: 16, lineHeight: 22 },
  recordBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, paddingVertical: 15, marginTop: 16 },
  recordBtnText: { color: '#04140b', fontSize: 16, fontWeight: '800' },
  skipBtn: { alignItems: 'center', paddingVertical: 12 },
  skipText: { fontSize: 13, fontWeight: '600' },
});
