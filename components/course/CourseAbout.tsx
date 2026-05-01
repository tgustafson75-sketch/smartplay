import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';

type Props = {
  about: string | null;
  caddieTips: string[] | null;
  loading?: boolean;
};

/**
 * Renders the ABOUT paragraph and CADDIE TIPS bullets. Pure presentation;
 * data comes from /api/course-content via courseContentService.
 *
 * Loading state shows a quiet spinner per section so the page lays out
 * stably while content streams in.
 */
export default function CourseAbout({ about, caddieTips, loading }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>ABOUT</Text>
      {loading && !about ? (
        <ActivityIndicator color="#00C896" style={styles.loader} />
      ) : (
        <Text style={styles.paragraph}>{about || 'Course preview loading.'}</Text>
      )}

      <Text style={[styles.heading, styles.headingSpaced]}>CADDIE TIPS</Text>
      {loading && (!caddieTips || caddieTips.length === 0) ? (
        <ActivityIndicator color="#00C896" style={styles.loader} />
      ) : caddieTips && caddieTips.length > 0 ? (
        <View style={styles.tips}>
          {caddieTips.map((tip, i) => (
            <View key={i} style={styles.tipRow}>
              <Text style={styles.tipBullet}>•</Text>
              <Text style={styles.tipText}>{tip}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.empty}>No tips yet.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingVertical: 8 },
  heading: {
    color: '#00C896',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.6,
    marginBottom: 8,
  },
  headingSpaced: { marginTop: 22 },
  paragraph: {
    color: '#e8f5e9',
    fontSize: 14,
    lineHeight: 21,
  },
  tips: { gap: 8 },
  tipRow: { flexDirection: 'row', gap: 8, paddingRight: 8 },
  tipBullet: { color: '#00C896', fontSize: 14, lineHeight: 20 },
  tipText: { color: '#e8f5e9', fontSize: 14, lineHeight: 20, flex: 1 },
  empty: { color: '#6b7280', fontSize: 13, fontStyle: 'italic' },
  loader: { alignSelf: 'flex-start', marginVertical: 4 },
});
