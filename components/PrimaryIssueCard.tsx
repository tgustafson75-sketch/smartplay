/**
 * Phase 111 — Primary Issue Card.
 *
 * Renders one PrimaryIssueEntry with:
 *   - Title
 *   - Illustration (geometric SVG, not a body silhouette)
 *   - Brief description
 *   - "Watch" button → opens the curated instructor video for this category
 *   - "Try drill" button (when entry.relatedDrillId is set)
 *   - Optional personalization badge (when this is the user's most-frequent issue)
 *
 * Sized for comfortable thumb reach on phone aspect; scales cleanly
 * on Fold open via percentage widths set by the parent container.
 */

import React from 'react';
import { View, Text, TouchableOpacity, Linking, StyleSheet } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import type { PrimaryIssueEntry } from '../constants/primaryIssueCatalog';
import { getInstructorVideo } from '../constants/instructorVideos';

interface Props {
  entry: PrimaryIssueEntry;
  /** When true, renders a "From your sessions" badge at top-right. */
  isPersonalized?: boolean;
  /** When the entry has a related drill, this fires when "Try drill" tapped. */
  onTryDrill?: (drillId: string) => void;
}

export default function PrimaryIssueCard({ entry, isPersonalized, onTryDrill }: Props) {
  const { colors } = useTheme();
  const video = getInstructorVideo(entry.category);
  const Illustration = entry.Illustration;

  const onWatch = () => {
    Linking.openURL(video.url).catch(() => {
      // Silent — Linking will throw on web/SSR builds. On a real device
      // this opens the system browser or the YouTube app.
    });
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: colors.text_primary }]}>{entry.title}</Text>
        {isPersonalized ? (
          <View style={[styles.badge, { backgroundColor: colors.accent + '22', borderColor: colors.accent }]}>
            <Text style={[styles.badgeText, { color: colors.accent }]}>From your sessions</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.illoWrap}>
        <Illustration size={220} okColor={colors.accent} warnColor="#ef4444" />
      </View>

      <Text style={[styles.body, { color: colors.text_primary }]}>{entry.description}</Text>

      <View style={styles.actions}>
        <TouchableOpacity onPress={onWatch} style={[styles.btn, styles.btnPrimary, { backgroundColor: colors.accent }]}>
          <Text style={styles.btnTextPrimary}>Watch</Text>
        </TouchableOpacity>
        <Text style={[styles.attribution, { color: colors.text_muted }]}>
          {video.title} · {video.instructor}
        </Text>
      </View>

      {entry.relatedDrillId && onTryDrill ? (
        <TouchableOpacity
          onPress={() => onTryDrill(entry.relatedDrillId as string)}
          style={[styles.btn, styles.btnSecondary, { borderColor: colors.border }]}
        >
          <Text style={[styles.btnTextSecondary, { color: colors.text_primary }]}>Try drill</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
  },
  badge: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  illoWrap: {
    alignItems: 'center',
    marginVertical: 8,
  },
  body: {
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 12,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  btn: {
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnPrimary: {},
  btnSecondary: {
    borderWidth: 1,
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  btnTextPrimary: {
    color: '#000',
    fontSize: 13,
    fontWeight: '700',
  },
  btnTextSecondary: {
    fontSize: 13,
    fontWeight: '600',
  },
  attribution: {
    flex: 1,
    fontSize: 11,
  },
});
