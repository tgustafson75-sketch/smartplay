/**
 * Phase T — Rules + Handicap reference surface.
 *
 * Three sections:
 *   1. Quick rules reference (searchable list of common rules with summaries)
 *   2. Handicap calculator (manual input for situations not auto-computed)
 *   3. Glossary (par/birdie/eagle/etc.)
 *
 * Voice queries can deep-link via ?rule=<rule_id> to scroll the rules
 * list to a specific entry.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, ScrollView, TouchableOpacity,
  StyleSheet, FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AppIcon from '../components/AppIcon';
import { RULES_REFERENCE, searchRules, RULES_EDITION, type RuleEntry } from '../data/rulesReference';
import {
  computeCourseHandicap, computeScoreDifferential, netDoubleBogeyCap,
} from '../services/handicapCalculator';
import { usePlayerProfileStore } from '../store/playerProfileStore';

type Tab = 'rules' | 'handicap' | 'glossary';

export default function ReferenceScreen() {
  const router = useRouter();
  const { rule } = useLocalSearchParams<{ rule?: string }>();
  // 2026-05-17 — Rules tab is the default on mount; deep-link `?rule=`
  // additionally scrolls + expands the named entry below. Previously
  // `useState<Tab>(rule ? 'rules' : 'rules')` looked like a tab switch
  // but both branches were 'rules' (no behavior, just noise).
  const [tab, setTab] = useState<Tab>('rules');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(rule ?? null);
  const listRef = useRef<FlatList<RuleEntry>>(null);

  const visibleRules = useMemo(
    () => (query.trim() ? searchRules(query) : RULES_REFERENCE),
    [query],
  );

  // Scroll to deep-linked rule on mount
  useEffect(() => {
    if (!rule) return;
    const idx = visibleRules.findIndex(r => r.rule_id === rule);
    if (idx >= 0) {
      setTimeout(() => listRef.current?.scrollToIndex({ index: idx, animated: true }), 200);
    }
  }, [rule, visibleRules]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.back}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Reference</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.tabRow}>
        <TabBtn label="Rules" active={tab === 'rules'} onPress={() => setTab('rules')} />
        <TabBtn label="Handicap" active={tab === 'handicap'} onPress={() => setTab('handicap')} />
        <TabBtn label="Glossary" active={tab === 'glossary'} onPress={() => setTab('glossary')} />
      </View>

      {tab === 'rules' && (
        <>
          <View style={styles.searchWrap}>
            <AppIcon name="search" size={16} color="#6b7280" />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search rules (e.g. 'embedded ball')"
              placeholderTextColor="#3a5a40"
            />
          </View>
          <FlatList
            ref={listRef}
            data={visibleRules}
            keyExtractor={r => r.rule_id}
            contentContainerStyle={styles.list}
            onScrollToIndexFailed={() => {}}
            renderItem={({ item }) => (
              <RuleRow
                rule={item}
                expanded={expanded === item.rule_id}
                onToggle={() => setExpanded(expanded === item.rule_id ? null : item.rule_id)}
              />
            )}
            ListFooterComponent={
              <Text style={styles.footnote}>Rules of Golf {RULES_EDITION} edition · USGA / R&amp;A</Text>
            }
          />
        </>
      )}

      {tab === 'handicap' && <HandicapPanel />}

      {tab === 'glossary' && <GlossaryPanel />}
    </SafeAreaView>
  );
}

function TabBtn({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.tabBtn, active && styles.tabBtnActive]}
      onPress={onPress}
    >
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function RuleRow({ rule, expanded, onToggle }: { rule: RuleEntry; expanded: boolean; onToggle: () => void }) {
  return (
    <TouchableOpacity style={[styles.ruleCard, expanded && styles.ruleCardExpanded]} onPress={onToggle} activeOpacity={0.85}>
      <View style={styles.ruleHeader}>
        <Text style={styles.ruleTitle}>{rule.title}</Text>
        <AppIcon name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color="#6b7280" />
      </View>
      <Text style={styles.ruleSummary}>{rule.rule_summary}</Text>
      {expanded && (
        <View style={styles.ruleDetail}>
          <Section label="THE FULL RULE" body={rule.detailed_explanation} />
          <Section label="TACTICAL ADVICE" body={rule.tactical_advice} />
          {rule.common_misconceptions && (
            <Section label="COMMON MISCONCEPTION" body={rule.common_misconceptions} accent="#fbbf24" />
          )}
          <Text style={styles.officialRef}>{rule.official_reference}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

function Section({ label, body, accent = '#00C896' }: { label: string; body: string; accent?: string }) {
  return (
    <View style={{ marginTop: 10 }}>
      <Text style={[styles.sectionLabel, { color: accent }]}>{label}</Text>
      <Text style={styles.sectionBody}>{body}</Text>
    </View>
  );
}

function HandicapPanel() {
  const idx = usePlayerProfileStore(s => s.handicap_index);
  const setIdx = usePlayerProfileStore(s => s.setHandicapIndex);
  const [indexInput, setIndexInput] = useState(idx != null ? String(idx) : '');
  const [rating, setRating] = useState('72.0');
  const [slope, setSlope] = useState('113');
  const [par, setPar] = useState('72');
  const [score, setScore] = useState('');

  const parsedIdx = parseFloat(indexInput);
  const parsedRating = parseFloat(rating);
  const parsedSlope = parseFloat(slope);
  const parsedPar = parseFloat(par);
  const parsedScore = parseFloat(score);

  const ch = (Number.isFinite(parsedIdx) && Number.isFinite(parsedRating) && Number.isFinite(parsedSlope) && Number.isFinite(parsedPar))
    ? computeCourseHandicap(parsedIdx, parsedRating, parsedSlope, parsedPar)
    : null;
  const diff = (Number.isFinite(parsedScore) && Number.isFinite(parsedRating) && Number.isFinite(parsedSlope))
    ? computeScoreDifferential(parsedScore, parsedRating, parsedSlope)
    : null;
  const ndb = (Number.isFinite(parsedPar) && ch != null)
    ? netDoubleBogeyCap(parsedPar, Math.max(0, Math.floor(ch / 18)))
    : null;

  return (
    <ScrollView contentContainerStyle={styles.panelScroll}>
      <Text style={styles.panelHeader}>WHS Calculator</Text>
      <Text style={styles.panelSub}>Manual inputs — for what-ifs and pre-tournament prep.</Text>

      <Field label="Handicap Index" value={indexInput} onChange={setIndexInput} placeholder="18.0" />
      <Field label="Course Rating" value={rating} onChange={setRating} placeholder="72.0" />
      <Field label="Slope Rating" value={slope} onChange={setSlope} placeholder="113" />
      <Field label="Par" value={par} onChange={setPar} placeholder="72" />
      <Field label="Score (for differential)" value={score} onChange={setScore} placeholder="optional" />

      <View style={styles.outBlock}>
        <Out label="Course Handicap" value={ch != null ? String(ch) : '—'} />
        <Out label="Score Differential" value={diff != null ? diff.toFixed(1) : '—'} />
        <Out label="Net Double Bogey (avg hole)" value={ndb != null ? String(ndb) : '—'} />
      </View>

      {idx == null && parsedIdx > 0 && (
        <TouchableOpacity style={styles.savePill} onPress={() => setIdx(parsedIdx)}>
          <Text style={styles.savePillText}>Save {parsedIdx.toFixed(1)} as my Index</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.fieldInput}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#3a5a40"
        keyboardType="decimal-pad"
      />
    </View>
  );
}

function Out({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.outRow}>
      <Text style={styles.outLabel}>{label}</Text>
      <Text style={styles.outValue}>{value}</Text>
    </View>
  );
}

function GlossaryPanel() {
  const TERMS = [
    { t: 'Par', d: 'Expected number of strokes for an expert golfer to play a hole.' },
    { t: 'Birdie', d: 'One stroke under par.' },
    { t: 'Eagle', d: 'Two strokes under par.' },
    { t: 'Albatross / Double Eagle', d: 'Three strokes under par. Rare.' },
    { t: 'Bogey', d: 'One stroke over par.' },
    { t: 'Double Bogey', d: 'Two strokes over par.' },
    { t: 'Net Double Bogey', d: 'Par + 2 + strokes received on the hole. WHS handicap-posting cap.' },
    { t: 'GIR (Greens in Regulation)', d: 'Reaching the green in (par − 2) strokes. Par 3 in 1, par 4 in 2, par 5 in 3.' },
    { t: 'FIR (Fairway in Regulation)', d: 'Tee shot finishing on the fairway on a par 4 or par 5.' },
    { t: 'Index', d: 'USGA Handicap Index — portable measure of playing ability based on your differentials.' },
    { t: 'Course Handicap', d: 'How many strokes you receive at a specific course/tee combo. Index × (Slope/113) + (Rating − Par).' },
    { t: 'Course Rating', d: 'Expected score for a scratch golfer on the course. Decimal (e.g. 72.5).' },
    { t: 'Slope Rating', d: 'Course difficulty for the bogey golfer relative to scratch. Range 55–155, average 113.' },
    { t: 'Score Differential', d: 'Per-round handicap measure. (113/Slope) × (Adjusted Gross − Course Rating).' },
    { t: 'Stroke Index (HCP column)', d: 'Per-hole difficulty rank, 1 (hardest) to 18. Determines stroke allocation.' },
    { t: 'Provisional', d: 'Second ball played when the original might be lost or OB. Saves the long walk back.' },
    { t: 'OB', d: 'Out of bounds. Stroke and distance penalty under standard rules.' },
    { t: 'Lateral / Red Penalty Area', d: 'Penalty area giving three relief options for one stroke.' },
    { t: 'GUR', d: 'Ground Under Repair. Marked area giving free relief.' },
  ];
  return (
    <ScrollView contentContainerStyle={styles.panelScroll}>
      <Text style={styles.panelHeader}>Glossary</Text>
      {TERMS.map(t => (
        <View key={t.t} style={styles.glossaryRow}>
          <Text style={styles.glossaryTerm}>{t.t}</Text>
          <Text style={styles.glossaryDef}>{t.d}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060f09' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  back: { color: '#00C896', fontSize: 16, fontWeight: '700' },
  title: { color: '#fff', fontSize: 18, fontWeight: '900' },

  tabRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 6, marginBottom: 8 },
  tabBtn: {
    flex: 1, paddingVertical: 10, alignItems: 'center',
    borderRadius: 10, borderWidth: 1, borderColor: '#1e3a28',
  },
  tabBtnActive: { backgroundColor: 'rgba(0,200,150,0.10)', borderColor: '#00C896' },
  tabLabel: { color: '#9ca3af', fontSize: 13, fontWeight: '700' },
  tabLabelActive: { color: '#00C896' },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: '#0d1a0d', borderColor: '#1e3a28', borderWidth: 1, borderRadius: 10,
  },
  searchInput: { flex: 1, color: '#fff', fontSize: 14, padding: 0 },

  list: { paddingHorizontal: 12, paddingBottom: 30 },
  ruleCard: {
    backgroundColor: '#0d1a0d', borderColor: '#1e3a28', borderWidth: 1, borderRadius: 12,
    padding: 12, marginVertical: 4,
  },
  ruleCardExpanded: { borderColor: '#00C896' },
  ruleHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  ruleTitle: { color: '#fff', fontSize: 15, fontWeight: '800', flex: 1 },
  ruleSummary: { color: '#d1d5db', fontSize: 13, marginTop: 6, lineHeight: 19 },
  ruleDetail: { marginTop: 8 },
  sectionLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  sectionBody: { color: '#d1d5db', fontSize: 13, lineHeight: 19, marginTop: 4 },
  officialRef: { color: '#6b7280', fontSize: 11, marginTop: 12, fontStyle: 'italic' },
  footnote: { color: '#6b7280', fontSize: 11, textAlign: 'center', marginTop: 16, fontStyle: 'italic' },

  panelScroll: { padding: 16, paddingBottom: 30 },
  panelHeader: { color: '#00C896', fontSize: 14, fontWeight: '800', letterSpacing: 1 },
  panelSub: { color: '#9ca3af', fontSize: 12, marginTop: 2, marginBottom: 14 },
  fieldRow: { marginBottom: 10 },
  fieldLabel: { color: '#9ca3af', fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginBottom: 4 },
  fieldInput: {
    backgroundColor: '#0d1a0d', borderColor: '#1e3a28', borderWidth: 1, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10, color: '#fff', fontSize: 15,
  },
  outBlock: {
    marginTop: 14, padding: 12,
    backgroundColor: '#0d1a0d', borderColor: '#00C896', borderWidth: 1, borderRadius: 10,
  },
  outRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  outLabel: { color: '#9ca3af', fontSize: 13, fontWeight: '600' },
  outValue: { color: '#fff', fontSize: 16, fontWeight: '900', fontVariant: ['tabular-nums'] },
  savePill: {
    marginTop: 14, alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 18,
    backgroundColor: '#00C896', borderRadius: 999,
  },
  savePillText: { color: '#0d1a0d', fontSize: 13, fontWeight: '900' },

  glossaryRow: {
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1e3a28',
  },
  glossaryTerm: { color: '#00C896', fontSize: 14, fontWeight: '800' },
  glossaryDef: { color: '#d1d5db', fontSize: 13, marginTop: 4, lineHeight: 19 },
});
