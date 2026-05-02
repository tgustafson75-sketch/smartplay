/**
 * Phase R — Round photo collage in recap.
 *
 * Horizontal scroll of memory photos captured during the round. Each
 * photo carries a hole-number badge. Tap to expand to full-screen.
 */

import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Image, Modal,
  StyleSheet, Dimensions, Pressable,
} from 'react-native';
import type { RoundPhoto } from '../../store/roundStore';

const SCREEN_W = Dimensions.get('window').width;

export default function PhotoCollage({ photos }: { photos: RoundPhoto[] }) {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (photos.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>MOMENTS</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {photos.map((p, i) => (
          <TouchableOpacity key={i} onPress={() => setExpanded(i)} style={styles.thumbWrap}>
            <Image source={{ uri: p.uri }} style={styles.thumb} />
            <View style={styles.holeBadge}>
              <Text style={styles.holeBadgeText}>H{p.hole}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Modal visible={expanded != null} transparent animationType="fade" onRequestClose={() => setExpanded(null)}>
        <Pressable style={styles.lightboxBg} onPress={() => setExpanded(null)}>
          {expanded != null && (
            <>
              <Image source={{ uri: photos[expanded].uri }} style={styles.lightboxImage} resizeMode="contain" />
              <View style={styles.lightboxOverlay}>
                <Text style={styles.lightboxText}>Hole {photos[expanded].hole}</Text>
              </View>
            </>
          )}
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 12, marginBottom: 12 },
  label: {
    color: '#6b7280', fontSize: 11, fontWeight: '700', letterSpacing: 1.5,
    paddingHorizontal: 16, marginBottom: 8,
  },
  row: { paddingHorizontal: 12 },
  thumbWrap: {
    width: 110, height: 110, marginHorizontal: 4, borderRadius: 10, overflow: 'hidden',
    backgroundColor: '#0d1a0d',
  },
  thumb: { width: '100%', height: '100%' },
  holeBadge: {
    position: 'absolute', top: 6, right: 6,
    backgroundColor: 'rgba(0,200,150,0.9)',
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
  },
  holeBadgeText: { color: '#0d1a0d', fontSize: 11, fontWeight: '900' },
  lightboxBg: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.95)',
    alignItems: 'center', justifyContent: 'center',
  },
  lightboxImage: { width: SCREEN_W, height: SCREEN_W },
  lightboxOverlay: {
    position: 'absolute', bottom: 60, left: 0, right: 0,
    alignItems: 'center',
  },
  lightboxText: {
    color: '#fff', fontSize: 16, fontWeight: '700',
    backgroundColor: 'rgba(0,200,150,0.7)',
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
  },
});
