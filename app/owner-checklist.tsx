/**
 * 2026-09-09 (Tim: "put my checklists of to dos on the phone in owners tool with a reminder when I
 * open. We should have done that months ago") — HE IS RIGHT THAT IT IS OVERDUE.
 *
 * Every field test this year has run off a list living in a chat window or a sprint log — i.e. on the
 * laptop, which is the one place it is not needed. The list is needed on a first tee, one-handed,
 * wearing a glove, in sun.
 *
 * So: big tap targets, the outstanding work first, and no chrome that does not earn its space. Ticks
 * persist, because a round is long and the app gets backgrounded.
 *
 * OWNER-GATED AT THE SCREEN, not just hidden in the menu — a route can be reached by voice, by deep
 * link, or by typing it, so the gate lives where the render is. Same as owner-card.
 */
import React, { useCallback, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { isOwnerEmail, usePlayerProfileStore } from '../store/playerProfileStore';
import { useOwnerChecklistStore, GROUP_LABEL, type ChecklistGroup } from '../store/ownerChecklistStore';
import { useTheme } from '../contexts/ThemeContext';

const GROUP_ORDER: ChecklistGroup[] = ['field', 'watch', 'ship'];

export default function OwnerChecklist() {
  const router = useRouter();
  const { colors } = useTheme();
  const email = usePlayerProfileStore((s) => s.email);
  const isOwner = isOwnerEmail(email);
  const items = useOwnerChecklistStore((s) => s.items);
  const toggle = useOwnerChecklistStore((s) => s.toggle);
  const resetAll = useOwnerChecklistStore((s) => s.resetAll);

  const remaining = useMemo(() => items.filter((i) => !i.done).length, [items]);
  const grouped = useMemo(
    () => GROUP_ORDER.map((g) => ({ group: g, rows: items.filter((i) => i.group === g) })).filter((s) => s.rows.length > 0),
    [items],
  );

  const back = useCallback(() => {
    try { router.back(); } catch { router.replace('/settings' as never); }
  }, [router]);

  if (!isOwner) {
    return (
      <SafeAreaView style={[styles.fill, { backgroundColor: colors.background }]}>
        <View style={styles.centered}>
          <Text style={[styles.emptyText, { color: colors.text_muted }]}>Owner tools only.</Text>
          <TouchableOpacity onPress={back} style={styles.backLink} accessibilityRole="button">
            <Text style={{ color: colors.accent }}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={back} accessibilityRole="button" accessibilityLabel="Back" hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color={colors.text_primary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.text_primary }]}>Checklist</Text>
          <Text style={[styles.sub, { color: colors.text_muted }]}>
            {remaining === 0 ? 'All clear' : `${remaining} still open`} · ask the caddie to read it
          </Text>
        </View>
        <TouchableOpacity onPress={resetAll} accessibilityRole="button" accessibilityLabel="Reset all items" hitSlop={12}>
          <Ionicons name="refresh-outline" size={22} color={colors.text_muted} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {grouped.map(({ group, rows }) => (
          <View key={group} style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.text_muted }]}>{GROUP_LABEL[group].toUpperCase()}</Text>
            {rows.map((item) => (
              <TouchableOpacity
                key={item.id}
                style={[styles.row, { borderColor: colors.border, backgroundColor: colors.surface }]}
                onPress={() => toggle(item.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: item.done }}
                accessibilityLabel={item.title}
              >
                <Ionicons
                  name={item.done ? 'checkmark-circle' : 'ellipse-outline'}
                  size={26}
                  color={item.done ? colors.accent : colors.text_muted}
                  style={styles.check}
                />
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      styles.rowTitle,
                      { color: item.done ? colors.text_muted : colors.text_primary },
                      item.done && styles.struck,
                    ]}
                  >
                    {item.title}
                  </Text>
                  <Text style={[styles.rowDetail, { color: colors.text_muted }]}>{item.detail}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        ))}
        <Text style={[styles.footer, { color: colors.text_muted }]}>
          Items are added in store/ownerChecklistStore.ts and merge in by id — ticking survives, new work appears.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { fontSize: 15 },
  backLink: { padding: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 20, fontWeight: '800' },
  sub: { fontSize: 12, marginTop: 2 },
  body: { padding: 16, paddingBottom: 48 },
  section: { marginBottom: 22 },
  sectionLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 8 },
  // 48px min touch target: this gets used one-handed, wearing a glove.
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14, minHeight: 48, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, marginBottom: 10 },
  check: { marginTop: 1 },
  rowTitle: { fontSize: 15, fontWeight: '700' },
  struck: { textDecorationLine: 'line-through' },
  rowDetail: { fontSize: 12, lineHeight: 17, marginTop: 4 },
  footer: { fontSize: 11, lineHeight: 16, marginTop: 4 },
});
