/**
 * 2026-08-10 (Tim — "if any new things have been added since they last loaded, it comes out first as a
 * hero what's-new card"). A dismissible hero that surfaces the NEW changelog entries (services/
 * knowledgeBase/whatsNew WHATS_NEW, newest-first) the player hasn't seen yet. Renders nothing when
 * there's nothing new. "Got it" marks them seen so it won't nag again until the next update.
 *
 * NON-blocking by design: it sits at the top of the Play scroll (not a modal over the voice caddie), so
 * it never gates the hands-free "open → caddie helping" flow.
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { WHATS_NEW } from '../services/knowledgeBase/whatsNew';
import { useWhatsNewStore } from '../store/whatsNewStore';

const MAX_SHOWN = 6;

export default function WhatsNewHeroCard() {
  const { colors } = useTheme();
  const seenCount = useWhatsNewStore((s) => s.seenCount);
  const markAllSeen = useWhatsNewStore((s) => s.markAllSeen);

  // WHATS_NEW is newest-first; the first (WHATS_NEW.length - seenCount) entries are the unseen ones.
  const unseen = useMemo(() => WHATS_NEW.slice(0, Math.max(0, WHATS_NEW.length - seenCount)), [seenCount]);
  if (unseen.length === 0) return null;

  const shown = unseen.slice(0, MAX_SHOWN);
  const extra = unseen.length - shown.length;

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.accent }]}>
      <View style={styles.headerRow}>
        <View style={styles.titleWrap}>
          <Ionicons name="sparkles" size={18} color={colors.accent} />
          <Text style={[styles.title, { color: colors.text_primary }]}>What&apos;s New</Text>
          <View style={[styles.countPill, { backgroundColor: colors.accent }]}>
            <Text style={styles.countText}>{unseen.length}</Text>
          </View>
        </View>
        <TouchableOpacity onPress={markAllSeen} hitSlop={10} accessibilityRole="button" accessibilityLabel="Dismiss what's new">
          <Ionicons name="close" size={20} color={colors.text_muted} />
        </TouchableOpacity>
      </View>

      {shown.map((e, i) => (
        <View key={i} style={styles.itemRow}>
          <View style={[styles.dot, { backgroundColor: colors.accent }]} />
          <Text style={[styles.itemText, { color: colors.text_primary }]}>{e.note}</Text>
        </View>
      ))}
      {extra > 0 ? (
        <Text style={[styles.more, { color: colors.text_muted }]}>+{extra} more — ask your caddie &ldquo;what&apos;s new?&rdquo;</Text>
      ) : null}

      <TouchableOpacity onPress={markAllSeen} style={[styles.gotIt, { borderColor: colors.accent }]} accessibilityRole="button">
        <Text style={[styles.gotItText, { color: colors.accent }]}>Got it</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 16, marginTop: 4, marginBottom: 12, borderRadius: 14, borderWidth: 1, padding: 14 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  titleWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 16, fontWeight: '800' },
  countPill: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  countText: { color: '#06281b', fontSize: 12, fontWeight: '800' },
  itemRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  dot: { width: 6, height: 6, borderRadius: 3, marginTop: 6 },
  itemText: { flex: 1, fontSize: 13, lineHeight: 18 },
  more: { fontSize: 12, marginTop: 2, marginBottom: 4 },
  gotIt: { alignSelf: 'flex-start', marginTop: 8, paddingVertical: 6, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1 },
  gotItText: { fontSize: 13, fontWeight: '700' },
});
