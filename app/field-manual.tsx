/**
 * Field Manual — open to all testers (NOT owner-gated).
 *
 * Three panels:
 *   1. View Manual — index of the 7 doc sections (docs/field-manual/*.md).
 *      Tapping a section opens the on-GitHub URL via Linking; we don't
 *      embed a markdown renderer to keep the screen lightweight.
 *   2. Verification Checklist — every item from
 *      services/fieldManual/checklistItems.ts, checkable + notes per item.
 *      State persists via store/fieldManualChecklistStore.ts so the
 *      tester can walk the list across sessions.
 *   3. Export — exports the checklist state as markdown via Share.
 *
 * 2026-05-24 — Built per the field-manual sprint. Owner gate removed
 * the same day so beta testers can run the verification walk.
 */

import React, { useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, TextInput, Share, Alert, Linking, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { CHECKLIST_SECTIONS, totalCheckCount } from '../services/fieldManual/checklistItems';
import { useFieldManualChecklistStore, exportAsMarkdown } from '../store/fieldManualChecklistStore';

type Tab = 'manual' | 'checklist';

const GITHUB_REPO_DOC_BASE = 'https://github.com/tgustafson75-sketch/smartplay/blob/main/docs/field-manual';

const MANUAL_SECTIONS: Array<{ file: string; title: string; hint: string }> = [
  { file: 'README.md', title: 'README — start here', hint: 'How to read this manual.' },
  { file: '01-product.md', title: '01 — Product', hint: 'Vision, three pillars, persona equality, positioning.' },
  { file: '02-architecture.md', title: '02 — Architecture', hint: 'Brain, voice, GPS, metrics, capture, Trust Spectrum.' },
  { file: '03-feature-state.md', title: '03 — Feature state', hint: 'Working / partial / stubbed / deferred per feature.' },
  { file: '04-conventions.md', title: '04 — Conventions & rules', hint: 'Git, persona-equality, honesty, responsive, branding.' },
  { file: '05-file-map.md', title: '05 — File map', hint: 'Where the key stores, services, intents, components, APIs live.' },
  { file: '06-ship-status.md', title: '06 — Ship status', hint: 'Launch spine, beta vs first-release, gap-closer status.' },
  { file: '07-known-issues-roadmap.md', title: '07 — Known issues & roadmap', hint: 'P2 deferrals, 1.x items, billing, watch IMU, cloud backup.' },
];

export default function FieldManualScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('manual');

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Header onBack={() => router.back()} />
      <View style={styles.tabRow}>
        <TabBtn label="View Manual" active={tab === 'manual'} onPress={() => setTab('manual')} />
        <TabBtn label="Checklist" active={tab === 'checklist'} onPress={() => setTab('checklist')} />
      </View>
      {tab === 'manual' ? <ManualPanel /> : <ChecklistPanel />}
    </SafeAreaView>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
        <Text style={styles.back}>‹ Back</Text>
      </TouchableOpacity>
      <Text style={styles.title}>Field Manual</Text>
      <View style={{ width: 60 }} />
    </View>
  );
}

function TabBtn({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.tabBtn, active && styles.tabBtnActive]}>
      <Text style={[styles.tabBtnText, active && styles.tabBtnTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function ManualPanel() {
  const open = (file: string) => {
    const url = `${GITHUB_REPO_DOC_BASE}/${file}`;
    Linking.openURL(url).catch(() => Alert.alert('Could not open', url));
  };
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 64 }}>
      <Text style={styles.panelIntro}>
        Comprehensive current-state reference. Each section is a separate markdown file under
        docs/field-manual/. Tap to open on GitHub.
      </Text>
      {MANUAL_SECTIONS.map(s => (
        <TouchableOpacity key={s.file} style={styles.linkRow} onPress={() => open(s.file)} activeOpacity={0.7}>
          <Text style={styles.linkTitle}>{s.title}</Text>
          <Text style={styles.linkHint}>{s.hint}</Text>
        </TouchableOpacity>
      ))}
      <Text style={[styles.panelIntro, { marginTop: 24, fontSize: 12 }]}>
        Run the verification checklist (tab above) when walking through pre-beta. Notes persist
        across sessions; export the whole thing as markdown when you’re done.
      </Text>
    </ScrollView>
  );
}

function ChecklistPanel() {
  const entries = useFieldManualChecklistStore(s => s.entries);
  const setChecked = useFieldManualChecklistStore(s => s.setChecked);
  const setNotes = useFieldManualChecklistStore(s => s.setNotes);
  const reset = useFieldManualChecklistStore(s => s.reset);

  const stats = useMemo(() => {
    const total = totalCheckCount();
    let checked = 0;
    for (const section of CHECKLIST_SECTIONS) {
      for (const item of section.items) {
        if (entries[`${section.id}.${item.id}`]?.checked) checked++;
      }
    }
    return { checked, total };
  }, [entries]);

  const onExport = async () => {
    const md = exportAsMarkdown({ sections: CHECKLIST_SECTIONS as never });
    try {
      await Share.share({ message: md, title: 'SmartPlay field-manual verification' });
    } catch (e) {
      console.log('[field-manual] share failed', e);
    }
  };

  const onReset = () => {
    Alert.alert(
      'Reset checklist?',
      'All checked items and notes will be cleared. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: () => reset() },
      ],
    );
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.statsRow}>
        <Text style={styles.statsText}>{stats.checked} / {stats.total} verified</Text>
        <View style={{ flexDirection: 'row' }}>
          <TouchableOpacity onPress={onReset} style={styles.secondaryBtn}>
            <Text style={styles.secondaryBtnText}>Reset</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onExport} style={[styles.primaryBtn, { marginLeft: 8 }]}>
            <Text style={styles.primaryBtnText}>Export</Text>
          </TouchableOpacity>
        </View>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 80 }} keyboardShouldPersistTaps="handled">
        {CHECKLIST_SECTIONS.map(section => (
          <View key={section.id}>
            <Text style={styles.sectionLabel}>{section.title}</Text>
            {section.hint && <Text style={styles.sectionHint}>{section.hint}</Text>}
            {section.items.map(item => {
              const key = `${section.id}.${item.id}`;
              const entry = entries[key];
              const checked = !!entry?.checked;
              return (
                <View key={key} style={styles.itemRow}>
                  <TouchableOpacity
                    style={[styles.checkbox, checked && styles.checkboxChecked]}
                    onPress={() => setChecked(key, !checked)}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  >
                    {checked && <Text style={styles.checkboxTick}>✓</Text>}
                  </TouchableOpacity>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.itemLabel, checked && styles.itemLabelChecked]}>{item.label}</Text>
                    {item.detail && <Text style={styles.itemDetail}>{item.detail}</Text>}
                    <TextInput
                      style={styles.notesInput}
                      placeholder="Notes…"
                      placeholderTextColor="#4b5563"
                      value={entry?.notes ?? ''}
                      onChangeText={t => setNotes(key, t)}
                      multiline
                    />
                  </View>
                </View>
              );
            })}
          </View>
        ))}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060f09' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1e3a28',
  },
  back: { color: '#00C896', fontSize: 16, width: 60 },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  tabRow: {
    flexDirection: 'row',
    backgroundColor: '#0d2418',
    borderBottomWidth: 1,
    borderBottomColor: '#1e3a28',
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabBtnActive: { borderBottomColor: '#00C896' },
  tabBtnText: { color: '#9ca3af', fontSize: 13, fontWeight: '600' },
  tabBtnTextActive: { color: '#00C896' },
  panelIntro: { color: '#9ca3af', fontSize: 13, marginBottom: 16, lineHeight: 19 },
  linkRow: {
    backgroundColor: '#0d2418',
    borderWidth: 1,
    borderColor: '#1e3a28',
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
  },
  linkTitle: { color: '#00C896', fontSize: 14, fontWeight: '700' },
  linkHint: { color: '#9ca3af', fontSize: 12, marginTop: 4 },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#0d2418',
    borderBottomWidth: 1,
    borderBottomColor: '#1e3a28',
  },
  statsText: { color: '#d1d5db', fontSize: 13, fontWeight: '600' },
  primaryBtn: { backgroundColor: '#00C896', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  primaryBtnText: { color: '#060f09', fontWeight: '700', fontSize: 13 },
  secondaryBtn: { backgroundColor: '#143d2a', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  secondaryBtnText: { color: '#00C896', fontWeight: '700', fontSize: 13 },
  sectionLabel: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    paddingHorizontal: 16,
    paddingTop: 18,
  },
  sectionHint: { color: '#6b7280', fontSize: 11, paddingHorizontal: 16, paddingTop: 2, paddingBottom: 6 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#0a1c12',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#3a5a40',
    marginRight: 12,
    marginTop: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: '#00C896', borderColor: '#00C896' },
  checkboxTick: { color: '#060f09', fontSize: 14, fontWeight: '900', lineHeight: 14 },
  itemLabel: { color: '#e5e7eb', fontSize: 13, lineHeight: 18 },
  itemLabelChecked: { color: '#6b7280', textDecorationLine: 'line-through' },
  itemDetail: { color: '#9ca3af', fontSize: 11, marginTop: 4, fontStyle: 'italic' },
  notesInput: {
    backgroundColor: '#0a1c12',
    borderWidth: 1,
    borderColor: '#1e3a28',
    borderRadius: 6,
    color: '#d1d5db',
    fontSize: 12,
    marginTop: 8,
    padding: 8,
    minHeight: 38,
  },
  lockedBody: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  lockedText: { color: '#9ca3af', fontSize: 14, textAlign: 'center', lineHeight: 22 },
});
