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

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Linking, StyleSheet, Image, useWindowDimensions, Modal, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import type { PrimaryIssueEntry } from '../constants/primaryIssueCatalog';
import { getInstructorVideo } from '../constants/instructorVideos';

interface Props {
  entry: PrimaryIssueEntry;
  /** When true, renders a "From your sessions" badge at top-right. */
  isPersonalized?: boolean;
  /** When the entry has a related drill, this fires when "Try drill" tapped. */
  onTryDrill?: (drillId: string) => void;
  /** Phase 111-followup — start expanded vs collapsed. Default false
   *  (collapsed) so the stack reads as a tight list. */
  defaultExpanded?: boolean;
}

export default function PrimaryIssueCard({ entry, isPersonalized, onTryDrill, defaultExpanded = false }: Props) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  // Tap-to-zoom modal state — when entry has a photo asset, tapping it
  // opens a fullscreen lightbox sized to the device viewport. Tap to
  // dismiss. Modal isolates state per-card so Z Fold open/close doesn't
  // disturb other cards.
  const [zoomOpen, setZoomOpen] = useState(false);
  const { colors } = useTheme();
  const video = getInstructorVideo(entry.category);
  const Illustration = entry.Illustration;
  // Phase 111-followup — collapsibility per Tim feedback ("cards take up
  // too much space and require too much scrolling"). Collapsed renders
  // as title + brief one-line + chevron; tap expands to full card.
  const [expanded, setExpanded] = useState(defaultExpanded);

  const onWatch = () => {
    Linking.openURL(video.url).catch(() => {
      // Silent — Linking will throw on web/SSR builds. On a real device
      // this opens the system browser or the YouTube app.
    });
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <TouchableOpacity
        style={styles.headerRow}
        onPress={() => setExpanded(e => !e)}
        activeOpacity={0.7}
      >
        <View style={{ flex: 1 }}>
          <View style={styles.titleRow}>
            <Text style={[styles.title, { color: colors.text_primary }]}>{entry.title}</Text>
            {isPersonalized ? (
              <View style={[styles.badge, { backgroundColor: colors.accent + '22', borderColor: colors.accent }]}>
                <Text style={[styles.badgeText, { color: colors.accent }]}>From your sessions</Text>
              </View>
            ) : null}
          </View>
          {!expanded ? (
            <Text style={[styles.bodyShort, { color: colors.text_muted }]} numberOfLines={1}>
              {entry.description}
            </Text>
          ) : null}
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={colors.text_muted}
          style={{ marginLeft: 8 }}
        />
      </TouchableOpacity>

      {expanded ? (
        <>
          <View style={styles.illoWrap}>
            {entry.image ? (
              // Tim's authored photo set — one per fault category. Tap-to-
              // zoom opens a fullscreen lightbox; falls back to the vector
              // Illustration for any category without a photo. useWindow
              // Dimensions read here so the photo reflows cleanly on Z
              // Fold open/close (cap width to keep aspect predictable).
              <TouchableOpacity
                onPress={() => setZoomOpen(true)}
                accessibilityRole="button"
                accessibilityLabel={`Zoom ${entry.title} fault illustration`}
                activeOpacity={0.85}
              >
                <Image
                  source={entry.image}
                  style={[styles.faultImage, { width: Math.min(screenW - 64, 360) }]}
                  resizeMode="contain"
                />
                <View style={styles.zoomHintWrap}>
                  <Ionicons name="expand-outline" size={14} color="#ffffff" />
                  <Text style={styles.zoomHintText}>Tap to zoom</Text>
                </View>
              </TouchableOpacity>
            ) : (
              <Illustration size={220} okColor={colors.accent} warnColor="#ef4444" />
            )}
          </View>

          {/* Lightbox — only mounts when zoom is open AND there's an image
              to show. Pressable backdrop dismisses; image sized to device
              viewport with contain so the full asset is visible without
              cropping on any aspect ratio (Z Fold open + closed alike). */}
          {entry.image ? (
            <Modal
              visible={zoomOpen}
              transparent
              animationType="fade"
              onRequestClose={() => setZoomOpen(false)}
            >
              <Pressable
                style={styles.lightboxBg}
                onPress={() => setZoomOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Close zoomed image"
              >
                <Image
                  source={entry.image}
                  style={{ width: screenW, height: screenH * 0.85 }}
                  resizeMode="contain"
                />
                <View style={[styles.lightboxLabel, { bottom: 60 }]}>
                  <Text style={styles.lightboxLabelText}>{entry.title}</Text>
                </View>
                <View style={[styles.lightboxClose, { top: 50 }]}>
                  <Ionicons name="close" size={26} color="#ffffff" />
                </View>
              </Pressable>
            </Modal>
          ) : null}

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
        </>
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
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bodyShort: {
    fontSize: 12,
    marginTop: 2,
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
  faultImage: {
    height: undefined,
    aspectRatio: 1,
    borderRadius: 12,
  },
  zoomHintWrap: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  zoomHintText: { color: '#ffffff', fontSize: 10, fontWeight: '700', letterSpacing: 0.4 },
  lightboxBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxLabel: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: 'rgba(0,200,150,0.85)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 12,
  },
  lightboxLabelText: { color: '#0d1a0d', fontSize: 14, fontWeight: '900', letterSpacing: 0.5 },
  lightboxClose: {
    position: 'absolute',
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
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
