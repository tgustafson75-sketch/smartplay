/**
 * 2026-07-29 (Tim — "a constant-updating What's New for the version in the tools menu, NOT a prompted
 * announcement that could mess with the voice path"). Visual changelog opened from Tools → What's New.
 * Reads the single source of truth (services/knowledgeBase/whatsNew.ts WHATS_NEW, newest-first) and
 * marks everything seen on open so the Tools-menu badge clears. To announce a feature: add one line to
 * WHATS_NEW — it shows here automatically, and the badge lights up for everyone who hasn't opened it.
 */
import React, { useEffect, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useTheme } from '../contexts/ThemeContext';
import { WHATS_NEW } from '../services/knowledgeBase/whatsNew';
import { useWhatsNewStore } from '../store/whatsNewStore';

export default function WhatsNewScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const seenCount = useWhatsNewStore((s) => s.seenCount);
  const markAllSeen = useWhatsNewStore((s) => s.markAllSeen);
  const version = Constants.expoConfig?.version ?? '1.0.0';

  // How many were unseen when this screen opened (snapshot before we mark them read),
  // so the newest N render with a NEW tag this visit.
  const unseenAtOpen = useMemo(() => Math.max(0, WHATS_NEW.length - seenCount), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { markAllSeen(); }, [markAllSeen]);

  const s = useMemo(() => StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      paddingHorizontal: 16, paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border ?? '#333',
    },
    headerTitle: { fontSize: 18, fontWeight: '800', color: colors.text_primary },
    versionPill: {
      marginLeft: 'auto',
      backgroundColor: colors.surface_elevated ?? 'rgba(255,255,255,0.06)',
      borderColor: colors.border ?? '#333', borderWidth: StyleSheet.hairlineWidth,
      borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4,
    },
    versionText: { fontSize: 12, fontWeight: '700', color: colors.text_muted },
    body: { padding: 18, paddingBottom: 60 },
    intro: { fontSize: 13, color: colors.text_muted, marginBottom: 16, lineHeight: 19 },
    card: {
      backgroundColor: colors.surface_elevated ?? 'rgba(255,255,255,0.05)',
      borderColor: colors.border ?? '#2a2a2a', borderWidth: StyleSheet.hairlineWidth,
      borderRadius: 14, padding: 14, marginBottom: 10, flexDirection: 'row', gap: 12,
    },
    dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6, backgroundColor: colors.accent },
    cardBody: { flex: 1 },
    whenRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
    when: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6, color: colors.text_muted, textTransform: 'uppercase' },
    newTag: {
      backgroundColor: colors.accent, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1,
    },
    newTagText: { fontSize: 9, fontWeight: '900', color: colors.background, letterSpacing: 0.6 },
    note: { fontSize: 14, lineHeight: 20, color: colors.text_primary },
  howTo: { marginTop: 6, paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: '#88F700', fontSize: 13, lineHeight: 18, fontStyle: 'italic', opacity: 0.85, color: '#9BA1A6' },
    empty: { color: colors.text_muted, fontSize: 14, textAlign: 'center', marginTop: 40 },
  }), [colors]);

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color={colors.text_primary} />
        </Pressable>
        <Text style={s.headerTitle}>What’s New</Text>
        <View style={s.versionPill}><Text style={s.versionText}>v{version}</Text></View>
      </View>
      <ScrollView contentContainerStyle={s.body}>
        <Text style={s.intro}>The latest updates to SmartPlay Caddie. You can also just ask your caddie “what’s new?” anytime.</Text>
        {WHATS_NEW.length === 0 ? (
          <Text style={s.empty}>No updates yet.</Text>
        ) : (
          WHATS_NEW.map((e, i) => (
            <View key={i} style={s.card}>
              <View style={s.dot} />
              <View style={s.cardBody}>
                <View style={s.whenRow}>
                  <Text style={s.when}>{e.when}</Text>
                  {i < unseenAtOpen ? (
                    <View style={s.newTag}><Text style={s.newTagText}>NEW</Text></View>
                  ) : null}
                </View>
                <Text style={s.note}>{e.note}</Text>
                {/* 2026-08-21 — same how-to hint as the hero card. A player who opens the full list
                    to work out how to use something must not find LESS than the card showed them. */}
                {e.howTo ? <Text style={s.howTo}>{e.howTo}</Text> : null}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
