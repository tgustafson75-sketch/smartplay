/**
 * 2026-07-01 (Tim — "I can ingest a card ahead of time... take a screenshot and wire in the
 * scorecard" / "load a course not in the DB from a scorecard photo").
 *
 * Add a custom course from a scorecard photo: pick → parse (/api/course-import) → confirm the
 * per-hole par + yardage → save to customCourseStore. Self-contained; reached from the Play tab's
 * "Add course from photo" affordance. Playability (appearing in the Play list + starting a round
 * on it) is wired separately in the Play/Caddie resolution.
 */

import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../contexts/ThemeContext';
import AppIcon from '../components/AppIcon';
import {
  pickManyFromLibrary,
  parseCourseScreenshots,
  saveCourseFromParse,
  type CourseImportResult,
} from '../services/courseImport';
import { useToastStore } from '../store/toastStore';
import { useTranslation } from 'react-i18next';

type Phase = 'intro' | 'parsing' | 'confirm' | 'error';

export default function AddCourseScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('intro');
  const [result, setResult] = useState<CourseImportResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');

  const pickAndParse = async () => {
    // 2026-08-10 (Tim — "it only allows for one picture, and it hits an error"). A scorecard is too
    // wide to shoot legibly in one frame, so people photograph the front nine and the back nine
    // separately. Take up to 4 and merge them into one course.
    const picked = await pickManyFromLibrary(4);
    if (picked.kind === 'permission_denied') { setErrorMsg('Photo access is off — enable it in Settings to pick a scorecard.'); setPhase('error'); return; }
    if (picked.kind !== 'ok') return; // cancelled / error — stay on intro
    setPhase('parsing');
    const parsed = await parseCourseScreenshots(picked.uris);
    if (parsed.kind === 'ok') { setResult(parsed.result); setPhase('confirm'); return; }
    setErrorMsg(
      parsed.kind === 'not_a_scorecard' ? "That doesn't look like a scorecard — try a clearer photo of the card."
      : parsed.kind === 'too_large' ? 'That image is too large — try a screenshot instead.'
      : parsed.kind === 'no_network' ? 'No signal — connect and try again.'
      : parsed.message,
    );
    setPhase('error');
  };

  const save = () => {
    if (!result) return;
    const id = saveCourseFromParse(result);
    useToastStore.getState().show(`Saved ${result.course_name?.trim() || 'course'} — find it in Play.`);
    void id;
    router.back();
  };

  const readCount = result?.holes.filter(h => h.par != null).length ?? 0;
  const withYardage = result?.holes.filter(h => h.yardage != null).length ?? 0;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('add_course.accessibility_label.back')}>
          <AppIcon name="chevron-back" size={26} color={colors.text_primary} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text_primary }]}>{t('add_course.add_course_screen.add_course_from_photo')}</Text>
        <View style={{ width: 26 }} />
      </View>

      {phase === 'intro' && (
        <View style={styles.center}>
          <AppIcon name="camera-outline" size={48} color={colors.accent} />
          <Text style={[styles.lead, { color: colors.text_primary }]}>{t('add_course.add_course_screen.snap_or_pick_a_scorecard')}</Text>
          <Text style={[styles.sub, { color: colors.text_secondary }]}>
            {t('add_course.add_course_screen.course_not_in_the_database')}
          </Text>
          <TouchableOpacity style={[styles.cta, { backgroundColor: colors.accent }]} onPress={pickAndParse}>
            <Text style={styles.ctaText}>{t('add_course.add_course_screen.pick_scorecard_photo')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {phase === 'parsing' && (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={[styles.sub, { color: colors.text_secondary, marginTop: 16 }]}>{t('add_course.add_course_screen.reading_the_card')}</Text>
        </View>
      )}

      {phase === 'error' && (
        <View style={styles.center}>
          <AppIcon name="alert-circle-outline" size={44} color={colors.error ?? '#e5484d'} />
          <Text style={[styles.sub, { color: colors.text_secondary }]}>{errorMsg}</Text>
          <TouchableOpacity style={[styles.cta, { backgroundColor: colors.accent }]} onPress={() => setPhase('intro')}>
            <Text style={styles.ctaText}>{t('add_course.add_course_screen.try_again')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {phase === 'confirm' && result && (
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <Text style={[styles.courseName, { color: colors.text_primary }]}>{result.course_name?.trim() || 'My Course'}</Text>
          <Text style={[styles.sub, { color: colors.text_secondary, textAlign: 'left', marginBottom: 4 }]}>
            {result.tee_name ? `${result.tee_name} tees · ` : ''}{readCount} holes read{withYardage < readCount ? ` · ${withYardage} with yardage` : ''}
          </Text>
          {result.confidence === 'low' && (
            <Text style={[styles.warn, { color: colors.error ?? '#e5484d' }]}>{t('add_course.add_course_screen.low_confidence_double_check_the')}</Text>
          )}
          <View style={[styles.tableHead, { borderColor: colors.border }]}>
            <Text style={[styles.cellH, { color: colors.text_secondary, flex: 1 }]}>{t('add_course.add_course_screen.hole')}</Text>
            <Text style={[styles.cellH, { color: colors.text_secondary, flex: 1 }]}>{t('scorecard.par')}</Text>
            <Text style={[styles.cellH, { color: colors.text_secondary, flex: 2 }]}>{t('add_course.add_course_screen.yards')}</Text>
            <Text style={[styles.cellH, { color: colors.text_secondary, flex: 1 }]}>{t('add_course.add_course_screen.hcp')}</Text>
          </View>
          {result.holes.map((h) => (
            <View key={h.hole} style={[styles.row, { borderColor: colors.border }]}>
              <Text style={[styles.cell, { color: colors.text_primary, flex: 1 }]}>{h.hole}</Text>
              <Text style={[styles.cell, { color: colors.text_primary, flex: 1 }]}>{h.par ?? '—'}</Text>
              <Text style={[styles.cell, { color: colors.text_primary, flex: 2 }]}>{h.yardage ?? '—'}</Text>
              <Text style={[styles.cell, { color: colors.text_secondary, flex: 1 }]}>{h.handicap ?? '—'}</Text>
            </View>
          ))}
          <TouchableOpacity style={[styles.cta, { backgroundColor: colors.accent, marginTop: 20 }]} onPress={save}>
            <Text style={styles.ctaText}>{t('add_course.add_course_screen.save_course')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.retry} onPress={() => setPhase('intro')}>
            <Text style={[styles.retryText, { color: colors.text_secondary }]}>{t('add_course.add_course_screen.pick_a_different_photo')}</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12 },
  title: { fontSize: 17, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14 },
  lead: { fontSize: 20, fontWeight: '700', marginTop: 8 },
  sub: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  cta: { borderRadius: 14, paddingVertical: 15, paddingHorizontal: 28, alignItems: 'center', marginTop: 10 },
  ctaText: { color: '#06140c', fontSize: 16, fontWeight: '700' },
  courseName: { fontSize: 22, fontWeight: '800', marginBottom: 2 },
  warn: { fontSize: 13, marginBottom: 8, fontWeight: '600' },
  tableHead: { flexDirection: 'row', borderBottomWidth: 1, paddingVertical: 8, marginTop: 8 },
  cellH: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  row: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 10 },
  cell: { fontSize: 15 },
  retry: { alignItems: 'center', paddingVertical: 14 },
  retryText: { fontSize: 14 },
});
