import React, { useState } from 'react';
import { View, Text, Image, TouchableOpacity, Modal, StyleSheet, useWindowDimensions, FlatList, type ImageSourcePropType } from 'react-native';

type HolePhoto = {
  hole_number: number;
  url: string;
  /** Optional bundled image (Palms curated screenshots). Wins over url when present. */
  palmsImage?: ImageSourcePropType;
};

type Props = {
  photos: HolePhoto[];
};

/**
 * 3-column grid of hole photos with a hole-number badge in the corner of each.
 * Tap a photo to open a swipe-navigable full-screen viewer.
 *
 * Empty state: when no photos are available (golfcourseapi rarely exposes
 * them today), renders a quiet placeholder rather than hiding the section.
 */
export default function HolePhotosGrid({ photos }: Props) {
  const { width } = useWindowDimensions();
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  const cell = Math.floor((width - 16 * 2 - 8 * 2) / 3);

  if (photos.length === 0) {
    return (
      <View style={styles.placeholderWrap}>
        <Text style={styles.placeholderText}>Hole photos coming soon.</Text>
      </View>
    );
  }

  return (
    <>
      <View style={styles.grid}>
        {photos.map((p, i) => (
          <TouchableOpacity
            key={p.hole_number}
            style={[styles.cell, { width: cell, height: cell }]}
            onPress={() => setActiveIdx(i)}
            activeOpacity={0.85}
          >
            {p.palmsImage ? (
              <Image source={p.palmsImage} style={StyleSheet.absoluteFill} resizeMode="cover" />
            ) : (
              <Image source={{ uri: p.url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            )}
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{p.hole_number}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>

      <Modal visible={activeIdx != null} transparent={false} animationType="fade" onRequestClose={() => setActiveIdx(null)}>
        <View style={styles.viewer}>
          <FlatList
            horizontal
            pagingEnabled
            data={photos}
            keyExtractor={p => String(p.hole_number)}
            initialScrollIndex={activeIdx ?? 0}
            getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
            renderItem={({ item }) => (
              <View style={[styles.viewerSlide, { width }]}>
                {item.palmsImage ? (
                  <Image source={item.palmsImage} style={styles.viewerImg} resizeMode="contain" />
                ) : (
                  <Image source={{ uri: item.url }} style={styles.viewerImg} resizeMode="contain" />
                )}
                <View style={styles.viewerLabel}>
                  <Text style={styles.viewerLabelText}>Hole {item.hole_number}</Text>
                </View>
              </View>
            )}
          />
          <TouchableOpacity onPress={() => setActiveIdx(null)} style={styles.viewerClose}>
            <Text style={styles.viewerCloseText}>Close</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
  },
  cell: {
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#0d2418',
  },
  badge: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeText: { color: '#ffffff', fontSize: 11, fontWeight: '800' },
  placeholderWrap: {
    marginHorizontal: 16,
    paddingVertical: 32,
    alignItems: 'center',
    backgroundColor: '#0d2418',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e3a28',
    borderStyle: 'dashed',
  },
  placeholderText: { color: '#6b7280', fontSize: 12, fontStyle: 'italic' },
  viewer: { flex: 1, backgroundColor: '#000' },
  viewerSlide: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  viewerImg: { width: '100%', height: '100%' },
  viewerLabel: {
    position: 'absolute',
    bottom: 36,
    left: 16,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  viewerLabelText: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
  viewerClose: {
    position: 'absolute',
    top: 40,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  viewerCloseText: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
});
