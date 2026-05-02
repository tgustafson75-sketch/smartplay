/**
 * Course Detail info modal — opened by tapping the (i) icon next to the
 * course title on the Course Detail screen. Legacy-app format: course
 * photos at top, hole-by-hole list with per-hole thumbnails + notes.
 *
 * Imagery comes from Mapbox (services/mapboxImagery.ts) since the
 * golfcourseapi data doesn't include course photos. Each hole renders
 * a small Mapbox tile centered on its tee→green axis. Cached to disk
 * by the underlying mapboxImagery service so this modal is cheap on
 * repeat opens.
 */

import React from 'react';
import {
  Modal, View, Text, ScrollView, Image, TouchableOpacity, StyleSheet,
  Pressable, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getHoleThumbnailUrl, getCourseImageryUrl } from '../../services/mapboxImagery';

const SCREEN_W = Dimensions.get('window').width;

export type ModalHole = {
  hole_number: number;
  par: number;
  yardage: number;
  note?: string;
  tee: { lat: number; lng: number } | null;
  green: { lat: number; lng: number } | null;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  courseName: string;
  location: string;
  holes: ModalHole[];
};

export default function CourseDetailModal({ visible, onClose, courseName, location, holes }: Props) {
  const courseUrl = getCourseImageryUrl({
    courseId: null,
    holes: holes.map(h => ({ tee: h.tee, green: h.green })),
  }, Math.round(SCREEN_W * 0.92), Math.round(SCREEN_W * 0.92 * 0.55));

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle} numberOfLines={1}>{courseName}</Text>
            <Text style={styles.headerSub} numberOfLines={1}>{location}</Text>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={26} color="#fff" />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Course-wide aerial */}
          <Text style={styles.sectionLabel}>COURSE AERIAL</Text>
          {courseUrl ? (
            <Image source={{ uri: courseUrl }} style={styles.courseAerial} resizeMode="cover" />
          ) : (
            <View style={[styles.courseAerial, styles.placeholderTile]}>
              <Text style={styles.placeholderText}>Aerial unavailable</Text>
            </View>
          )}

          {/* Hole-by-hole */}
          <Text style={[styles.sectionLabel, { marginTop: 22 }]}>HOLE BY HOLE</Text>
          {holes.map(h => {
            const thumbUrl = getHoleThumbnailUrl({
              courseId: null,
              holeNumber: h.hole_number,
              par: h.par,
              yardage: h.yardage,
              tee: h.tee,
              green: h.green,
            });
            return (
              <View key={h.hole_number} style={styles.holeRow}>
                <View style={styles.thumbWrap}>
                  {thumbUrl ? (
                    <Image source={{ uri: thumbUrl }} style={styles.thumb} resizeMode="cover" />
                  ) : (
                    <View style={[styles.thumb, styles.placeholderTile]}>
                      <Text style={styles.placeholderTextSm}>—</Text>
                    </View>
                  )}
                  <View style={styles.holeBadge}>
                    <Text style={styles.holeBadgeText}>{h.hole_number}</Text>
                  </View>
                </View>
                <View style={styles.holeMain}>
                  <Text style={styles.holeStat}>Par {h.par} · {h.yardage}y</Text>
                  {h.note ? (
                    <Text style={styles.holeNote} numberOfLines={3}>{h.note}</Text>
                  ) : (
                    <Text style={styles.holeNoteMuted}>No note for this hole.</Text>
                  )}
                </View>
              </View>
            );
          })}

          <View style={{ height: 30 }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060f09' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#1e3a28',
  },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: '900' },
  headerSub: { color: '#9ca3af', fontSize: 12, marginTop: 2 },
  closeBtn: { padding: 6 },
  scroll: { padding: 16, paddingBottom: 30 },
  sectionLabel: {
    color: '#00C896', fontSize: 11, fontWeight: '800',
    letterSpacing: 1.6, marginBottom: 10,
  },
  courseAerial: {
    width: '100%', aspectRatio: 16 / 9,
    borderRadius: 12, backgroundColor: '#0d1a0d',
  },
  placeholderTile: {
    backgroundColor: '#0d1a0d',
    alignItems: 'center', justifyContent: 'center',
  },
  placeholderText: { color: '#6b7280', fontSize: 13 },
  placeholderTextSm: { color: '#6b7280', fontSize: 11 },
  holeRow: {
    flexDirection: 'row', gap: 12,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1e3a28',
  },
  thumbWrap: { width: 100, height: 70, borderRadius: 8, overflow: 'hidden', position: 'relative' },
  thumb: { width: 100, height: 70 },
  holeBadge: {
    position: 'absolute', top: 4, left: 4,
    backgroundColor: 'rgba(0,200,150,0.9)',
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5,
  },
  holeBadgeText: { color: '#0d1a0d', fontSize: 10, fontWeight: '900' },
  holeMain: { flex: 1, justifyContent: 'center' },
  holeStat: { color: '#fff', fontSize: 14, fontWeight: '700' },
  holeNote: { color: '#9ca3af', fontSize: 12, marginTop: 4, lineHeight: 17 },
  holeNoteMuted: { color: '#4b5563', fontSize: 12, marginTop: 4, fontStyle: 'italic' },
});
