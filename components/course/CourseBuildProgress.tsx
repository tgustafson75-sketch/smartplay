/**
 * 2026-09-23 (Tim) — "you could watch a progress on the load of the course live on the card and then
 * once it's done it could be added to your courses."
 *
 * The live progress of the ONE course-build pipeline (services/courseDownloadEngine.downloadCourse),
 * drawn on whichever card the player is looking at. Pass every id that card holds — a near-you row's
 * `place:` id, a search result's id — because the pipeline publishes under all of them.
 *
 * Renders nothing when the course is neither building, failed nor built, so it can sit in any row.
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { useDownloadedCoursesStore, type CourseBuildStage } from '../../store/downloadedCoursesStore';

const STAGE_KEY: Record<CourseBuildStage, string> = {
  card: 'course_build.finding',
  map: 'course_build.mapping',
  imagery: 'course_build.imagery',
  notes: 'course_build.notes',
};

export default function CourseBuildProgress({ ids }: { ids: (string | null | undefined)[] }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // Select the store's own maps (stable references) and look the card's ids up outside the selector —
  // a selector must never allocate what it returns (see a-selector-must-not-build-what-it-returns).
  const downloadingMap = useDownloadedCoursesStore((s) => s.downloading);
  const downloadedMap = useDownloadedCoursesStore((s) => s.downloaded);
  const cardIds = ids.filter((x): x is string => !!x);
  const building = cardIds.map((id) => downloadingMap[id]).find(Boolean);
  const built = cardIds.map((id) => downloadedMap[id]).find(Boolean);

  if (building?.failed) {
    return <Text style={styles.failed} numberOfLines={2}>{building.failed}</Text>;
  }
  if (building) {
    const pct = Math.round(Math.max(0.05, Math.min(1, building.progress)) * 100);
    return (
      <View style={styles.wrap} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }}>
        <View style={styles.track}><View style={[styles.fill, { width: `${pct}%` }]} /></View>
        <Text style={styles.label} numberOfLines={1}>{t(STAGE_KEY[building.stage ?? 'card'])}</Text>
      </View>
    );
  }
  if (built) {
    const greens = built.greens;
    return (
      <Text style={[styles.label, greens === 0 && styles.warn]} numberOfLines={1}>
        {/* greens undefined = recorded before the count existed: UNKNOWN, so no number is claimed. */}
        {greens === 0
          ? t('course_build.ready_no_greens')
          : greens == null ? t('course_build.ready_unmeasured') : t('course_build.ready', { count: greens })}
      </Text>
    );
  }
  return null;
}

function makeStyles(c: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    wrap: { marginTop: 6 },
    track: { height: 4, borderRadius: 2, backgroundColor: c.border, overflow: 'hidden' },
    fill: { height: 4, borderRadius: 2, backgroundColor: c.accent },
    label: { marginTop: 4, fontSize: 12, color: c.text_muted },
    warn: { color: c.text_muted, fontStyle: 'italic' },
    failed: { marginTop: 4, fontSize: 12, color: c.text_muted },
  });
}
