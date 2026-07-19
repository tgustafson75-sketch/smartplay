/**
 * 2026-07-18 — Legal document viewer. `?doc=terms` or `?doc=privacy`. Renders the real
 * in-app Terms of Service / Privacy Policy (constants/legalText.ts) with a lightweight
 * markdown renderer (headings, bullets, bold, paragraphs) — no markdown dependency.
 */
import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { TERMS_OF_SERVICE, PRIVACY_POLICY } from '../constants/legalText';

// Split **bold** spans so we can render them inline.
function renderInline(text: string, baseStyle: object, boldColor: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) {
      return <Text key={i} style={[baseStyle, { fontWeight: '800', color: boldColor }]}>{p.slice(2, -2)}</Text>;
    }
    return <Text key={i} style={baseStyle}>{p}</Text>;
  });
}

export default function LegalScreen() {
  const { doc } = useLocalSearchParams<{ doc?: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const isTerms = String(doc ?? '').toLowerCase().startsWith('term');
  const title = isTerms ? 'Terms of Service' : 'Privacy Policy';
  const raw = isTerms ? TERMS_OF_SERVICE : PRIVACY_POLICY;

  const blocks = useMemo(() => raw.split('\n'), [raw]);

  const s = useMemo(() => StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      paddingHorizontal: 16, paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border ?? '#333',
    },
    headerTitle: { fontSize: 18, fontWeight: '800', color: colors.text_primary },
    body: { padding: 20, paddingBottom: 60 },
    h1: { fontSize: 22, fontWeight: '900', color: colors.text_primary, marginTop: 4, marginBottom: 10 },
    h2: { fontSize: 16, fontWeight: '800', color: colors.accent, marginTop: 22, marginBottom: 6 },
    p: { fontSize: 14.5, lineHeight: 21, color: colors.text_primary, marginBottom: 10 },
    bulletRow: { flexDirection: 'row', gap: 8, marginBottom: 5, paddingLeft: 4 },
    bulletDot: { color: colors.accent, fontSize: 14.5, lineHeight: 21 },
    bulletText: { flex: 1, fontSize: 14.5, lineHeight: 21, color: colors.text_primary },
  }), [colors]);

  return (
    <SafeAreaView style={s.root} edges={['top', 'bottom']}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color={colors.text_primary} />
        </Pressable>
        <Text style={s.headerTitle}>{title}</Text>
      </View>
      <ScrollView contentContainerStyle={s.body}>
        {blocks.map((line, i) => {
          const t = line.trim();
          if (t === '') return <View key={i} style={{ height: 2 }} />;
          if (t.startsWith('## ')) return <Text key={i} style={s.h2}>{t.slice(3)}</Text>;
          if (t.startsWith('# ')) return <Text key={i} style={s.h1}>{t.slice(2)}</Text>;
          if (t.startsWith('* ') || t.startsWith('- ')) {
            return (
              <View key={i} style={s.bulletRow}>
                <Text style={s.bulletDot}>•</Text>
                <Text style={s.bulletText}>{renderInline(t.slice(2), s.bulletText, colors.text_primary)}</Text>
              </View>
            );
          }
          return <Text key={i} style={s.p}>{renderInline(t, s.p, colors.text_primary)}</Text>;
        })}
      </ScrollView>
    </SafeAreaView>
  );
}
