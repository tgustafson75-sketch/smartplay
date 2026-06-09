/**
 * 2026-05-22 — Family Coaching: Roster editor.
 *
 * Single screen for adding, editing, and archiving family members
 * (kids, partner, friends). Roster lives in store/familyStore.ts;
 * everything here is a thin UI in front of those actions.
 *
 * Flow:
 *   - Empty state: "Add your first family member" CTA + voice hint
 *   - Roster list: name + emoji + relationship + age pill, tap to edit
 *   - Add / Edit modal: name, nickname, relationship, age, skill,
 *     handedness, avatar emoji (small preset palette — no upload
 *     surface; privacy-first, kid records stay device-local)
 *   - Each row → "Open library" navigates to per-member roll-up
 *
 * Defensive:
 *   - Trim + validate names before save (can't save empty)
 *   - Age clamps to 1..120 when typed
 *   - Archive is soft (records preserved); Remove is hard (confirm)
 */

import React, { useState, useMemo } from 'react';
import {
  View, Text, ScrollView, Pressable, TextInput, StyleSheet, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../contexts/ThemeContext';
import {
  useFamilyStore,
  ageBand,
  type FamilyMember,
  type FamilyRelationship,
  type SkillLevel,
  type AgeBand,
} from '../../store/familyStore';

const RELATIONSHIPS: { id: FamilyRelationship; label: string }[] = [
  { id: 'child', label: 'Child' },
  { id: 'partner', label: 'Partner' },
  { id: 'sibling', label: 'Sibling' },
  { id: 'parent', label: 'Parent' },
  { id: 'friend', label: 'Friend' },
  { id: 'other', label: 'Other' },
];

const SKILL_LEVELS: { id: SkillLevel; label: string }[] = [
  { id: 'first_swings', label: 'First swings' },
  { id: 'learning', label: 'Learning' },
  { id: 'developing', label: 'Developing' },
  { id: 'competitive', label: 'Competitive' },
];

const HANDEDNESS: { id: FamilyMember['handedness']; label: string }[] = [
  { id: 'right', label: 'Right' },
  { id: 'left', label: 'Left' },
  { id: 'unknown', label: 'Not sure' },
];

const EMOJI_PALETTE = ['👧', '👦', '🧒', '👨', '👩', '🧓', '👴', '👵', '⛳️', '🏌️‍♂️', '🏌️‍♀️', '🌟'];

const BAND_LABEL: Record<AgeBand, string> = {
  tiny: 'Tiny',
  junior: 'Junior',
  teen: 'Teen',
  adult: 'Adult',
};

export default function FamilyRosterScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  // 2026-05-22 — Roster editor shows FAMILY members only (kids,
  // partner, siblings, parents, friends). Teammates + coaches live
  // under the Captain screen (app/family/captain.tsx) to keep the
  // two contexts visually distinct without forking the data model.
  const roster = useFamilyStore((s) => s.familyOnlyRoster());
  const addMember = useFamilyStore((s) => s.addMember);
  const updateMember = useFamilyStore((s) => s.updateMember);
  const archiveMember = useFamilyStore((s) => s.archiveMember);
  const removeMember = useFamilyStore((s) => s.removeMember);

  // Editing modal state. `editingId === null` = add mode.
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditableDraft>(emptyDraft());

  const openAdd = () => {
    setEditingId(null);
    setDraft(emptyDraft());
    setEditorOpen(true);
  };

  const openEdit = (m: FamilyMember) => {
    setEditingId(m.id);
    setDraft({
      firstName: m.firstName,
      nickname: m.nickname ?? '',
      relationship: m.relationship,
      age: m.age != null ? String(m.age) : '',
      skillLevel: m.skillLevel,
      handedness: m.handedness,
      avatar_emoji: m.avatar_emoji,
    });
    setEditorOpen(true);
  };

  const onSave = () => {
    const trimmed = draft.firstName.trim();
    if (!trimmed) {
      Alert.alert('Name required', 'Enter a first name before saving.');
      return;
    }
    const ageNum = draft.age.trim() ? Math.max(1, Math.min(120, parseInt(draft.age, 10))) : null;
    const payload = {
      firstName: trimmed,
      nickname: draft.nickname.trim() || null,
      relationship: draft.relationship,
      age: Number.isFinite(ageNum as number) ? (ageNum as number) : null,
      skillLevel: draft.skillLevel,
      handedness: draft.handedness,
      approximate_handicap: null,
      avatar_emoji: draft.avatar_emoji,
    };
    if (editingId) {
      updateMember(editingId, payload);
    } else {
      addMember(payload);
    }
    setEditorOpen(false);
  };

  const onRemove = () => {
    if (!editingId) return;
    Alert.alert(
      'Remove from family?',
      `${draft.firstName} will be removed from your roster. Their swing history stays on device but won't be tagged anymore.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            removeMember(editingId);
            setEditorOpen(false);
          },
        },
      ],
    );
  };

  const onArchive = () => {
    if (!editingId) return;
    archiveMember(editingId);
    setEditorOpen(false);
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerBack}>
          <Text style={[styles.headerBackText, { color: colors.accent }]}>← Settings</Text>
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text_primary }]}>Family Coaching</Text>
        <Pressable onPress={openAdd} hitSlop={10} style={styles.headerAdd}>
          <Text style={[styles.headerAddText, { color: colors.accent }]}>＋ Add</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {roster.length === 0 ? (
          <View style={[styles.empty, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.emptyTitle, { color: colors.text_primary }]}>
              Add your first family member
            </Text>
            <Text style={[styles.emptyHint, { color: colors.text_muted }]}>
              Coaches kids + partners + friends with age-appropriate feedback. Record their swings hands-free on the glasses: &quot;Record Emma&apos;s swing.&quot;
            </Text>
            <Pressable
              onPress={openAdd}
              style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
            >
              <Text style={styles.primaryBtnText}>＋ Add a family member</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {roster.map((m) => (
              <View
                key={m.id}
                style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <Pressable
                  style={styles.rowMain}
                  onPress={() => router.push(`/family/${m.id}` as never)}
                >
                  <Text style={styles.rowAvatar}>{m.avatar_emoji}</Text>
                  <View style={styles.rowText}>
                    <Text style={[styles.rowName, { color: colors.text_primary }]} numberOfLines={1}>
                      {m.firstName}
                      {m.nickname ? (
                        <Text style={[styles.rowNickname, { color: colors.text_muted }]}>
                          {`  "${m.nickname}"`}
                        </Text>
                      ) : null}
                    </Text>
                    <Text style={[styles.rowMeta, { color: colors.text_muted }]} numberOfLines={1}>
                      {labelForRelationship(m.relationship)}
                      {m.age != null ? ` · ${m.age}y · ${BAND_LABEL[ageBand(m.age)]} band` : ''}
                      {` · ${labelForSkill(m.skillLevel)}`}
                    </Text>
                  </View>
                  <Text style={[styles.rowChevron, { color: colors.text_muted }]}>›</Text>
                </Pressable>
                <Pressable
                  onPress={() => openEdit(m)}
                  hitSlop={8}
                  style={[styles.rowEdit, { borderColor: colors.border }]}
                >
                  <Text style={[styles.rowEditText, { color: colors.text_muted }]}>Edit</Text>
                </Pressable>
              </View>
            ))}
            <View style={[styles.tipCard, { borderColor: colors.border }]}>
              <Text style={[styles.tipTitle, { color: colors.text_primary }]}>Hands-free flow</Text>
              <Text style={[styles.tipBody, { color: colors.text_muted }]}>
                Once a member is on the roster, you can say:
                {'\n'}• &quot;Coach Emma&apos;s swing&quot; — starts a tagged recording
                {'\n'}• &quot;Analyze Emma&apos;s swing&quot; — runs the junior analyzer + speaks the result
                {'\n'}• &quot;How&apos;s Emma&apos;s progress?&quot; — reads recent trend
                {'\n'}• &quot;Stop recording&quot; — ends the family session
              </Text>
            </View>
          </>
        )}
      </ScrollView>

      {editorOpen && (
        <View style={[styles.modalScrim, { backgroundColor: 'rgba(0,0,0,0.7)' }]}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text_primary }]}>
                {editingId ? 'Edit member' : 'Add member'}
              </Text>
              <Pressable onPress={() => setEditorOpen(false)} hitSlop={10}>
                <Text style={[styles.modalClose, { color: colors.text_muted }]}>Close</Text>
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.modalBody}>
              <DraftField
                label="First name"
                value={draft.firstName}
                onChange={(v) => setDraft((d) => ({ ...d, firstName: v }))}
                placeholder="Emma"
                colors={colors}
              />
              <DraftField
                label="Nickname (optional)"
                value={draft.nickname}
                onChange={(v) => setDraft((d) => ({ ...d, nickname: v }))}
                placeholder="Buddy / Champ / Emma-bug"
                colors={colors}
              />
              <DraftPicker
                label="Relationship"
                value={draft.relationship}
                options={RELATIONSHIPS.map((r) => ({ id: r.id, label: r.label }))}
                onChange={(v) => setDraft((d) => ({ ...d, relationship: v as FamilyRelationship }))}
                colors={colors}
              />
              <DraftField
                label="Age"
                value={draft.age}
                onChange={(v) => setDraft((d) => ({ ...d, age: v.replace(/[^0-9]/g, '').slice(0, 3) }))}
                placeholder="9"
                keyboardType="number-pad"
                colors={colors}
              />
              <DraftPicker
                label="Skill"
                value={draft.skillLevel}
                options={SKILL_LEVELS.map((s) => ({ id: s.id, label: s.label }))}
                onChange={(v) => setDraft((d) => ({ ...d, skillLevel: v as SkillLevel }))}
                colors={colors}
              />
              <DraftPicker
                label="Handedness"
                value={draft.handedness}
                options={HANDEDNESS.map((h) => ({ id: h.id, label: h.label }))}
                onChange={(v) => setDraft((d) => ({ ...d, handedness: v as FamilyMember['handedness'] }))}
                colors={colors}
              />
              <EmojiPicker
                value={draft.avatar_emoji}
                onChange={(e) => setDraft((d) => ({ ...d, avatar_emoji: e }))}
                colors={colors}
              />

              <Pressable
                onPress={onSave}
                style={[styles.primaryBtn, { backgroundColor: colors.accent, marginTop: 18 }]}
              >
                <Text style={styles.primaryBtnText}>
                  {editingId ? 'Save changes' : 'Add to family'}
                </Text>
              </Pressable>
              {editingId && (
                <View style={styles.dangerRow}>
                  <Pressable
                    onPress={onArchive}
                    style={[styles.secondaryBtn, { borderColor: colors.border }]}
                  >
                    <Text style={[styles.secondaryBtnText, { color: colors.text_muted }]}>Archive</Text>
                  </Pressable>
                  <Pressable
                    onPress={onRemove}
                    style={[styles.secondaryBtn, { borderColor: '#7f1d1d' }]}
                  >
                    <Text style={[styles.secondaryBtnText, { color: '#f87171' }]}>Remove…</Text>
                  </Pressable>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

// ─── Small subcomponents ────────────────────────────────────────────────

interface EditableDraft {
  firstName: string;
  nickname: string;
  relationship: FamilyRelationship;
  age: string;
  skillLevel: SkillLevel;
  handedness: FamilyMember['handedness'];
  avatar_emoji: string;
}

function emptyDraft(): EditableDraft {
  return {
    firstName: '',
    nickname: '',
    relationship: 'child',
    age: '',
    skillLevel: 'first_swings',
    // 2026-06-08 (audit #2) — default 'unknown' (form shows "Not sure") so a
    // left-handed child isn't silently given right-handed cues when the
    // parent skips the picker. Analysis handles 'unknown' safely.
    handedness: 'unknown',
    avatar_emoji: '👧',
  };
}

interface ColorProps {
  colors: ReturnType<typeof useTheme>['colors'];
}

function DraftField({
  label, value, onChange, placeholder, keyboardType, colors,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; keyboardType?: 'default' | 'number-pad';
} & ColorProps) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.text_muted }]}>{label}</Text>
      <TextInput
        style={[styles.fieldInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text_primary }]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.text_muted}
        keyboardType={keyboardType ?? 'default'}
      />
    </View>
  );
}

function DraftPicker({
  label, value, options, onChange, colors,
}: {
  label: string; value: string; options: { id: string; label: string }[];
  onChange: (v: string) => void;
} & ColorProps) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.text_muted }]}>{label}</Text>
      <View style={styles.pickerRow}>
        {options.map((o) => {
          const active = o.id === value;
          return (
            <Pressable
              key={o.id}
              onPress={() => onChange(o.id)}
              style={[
                styles.pill,
                { borderColor: active ? colors.accent : colors.border, backgroundColor: active ? colors.accent_muted : colors.surface_elevated },
              ]}
            >
              <Text style={[styles.pillText, { color: active ? colors.accent : colors.text_muted, fontWeight: active ? '700' : '500' }]}>
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function EmojiPicker({
  value, onChange, colors,
}: { value: string; onChange: (e: string) => void } & ColorProps) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.text_muted }]}>Avatar</Text>
      <View style={styles.emojiRow}>
        {EMOJI_PALETTE.map((e) => {
          const active = e === value;
          return (
            <Pressable
              key={e}
              onPress={() => onChange(e)}
              style={[
                styles.emojiPill,
                { borderColor: active ? colors.accent : colors.border, backgroundColor: active ? colors.accent_muted : colors.surface_elevated },
              ]}
            >
              <Text style={styles.emojiPillText}>{e}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────

function labelForRelationship(r: FamilyRelationship): string {
  return RELATIONSHIPS.find((x) => x.id === r)?.label ?? 'Other';
}
function labelForSkill(s: SkillLevel): string {
  return SKILL_LEVELS.find((x) => x.id === s)?.label ?? '';
}

// Reference to silence unused-variable warning during prototyping —
// useMemo is reserved here for future filtering UI (search box / archived view).
void useMemo;

// ─── Styles ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerBack: { flex: 1 },
  headerBackText: { fontSize: 14, fontWeight: '600' },
  headerTitle: { flex: 2, textAlign: 'center', fontSize: 16, fontWeight: '800', letterSpacing: 0.3 },
  headerAdd: { flex: 1, alignItems: 'flex-end' },
  headerAddText: { fontSize: 15, fontWeight: '700' },
  scroll: { padding: 16, gap: 12 },

  empty: {
    borderWidth: 1, borderRadius: 14, padding: 22, alignItems: 'center', gap: 12,
  },
  emptyTitle: { fontSize: 17, fontWeight: '800', textAlign: 'center' },
  emptyHint: { fontSize: 13, textAlign: 'center', lineHeight: 19 },

  row: {
    flexDirection: 'row',
    borderWidth: 1, borderRadius: 14, padding: 12, gap: 10,
  },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowAvatar: { fontSize: 28 },
  rowText: { flex: 1, gap: 2 },
  rowName: { fontSize: 16, fontWeight: '800' },
  rowNickname: { fontSize: 13, fontWeight: '500' },
  rowMeta: { fontSize: 11, fontWeight: '600', letterSpacing: 0.2 },
  rowChevron: { fontSize: 22, fontWeight: '300' },
  rowEdit: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1,
    alignSelf: 'center',
  },
  rowEditText: { fontSize: 11, fontWeight: '700', letterSpacing: 1 },

  tipCard: {
    borderWidth: 1, borderRadius: 12, padding: 14, gap: 6, marginTop: 4,
  },
  tipTitle: { fontSize: 13, fontWeight: '800', letterSpacing: 0.4 },
  tipBody: { fontSize: 12, lineHeight: 18 },

  primaryBtn: { paddingHorizontal: 18, paddingVertical: 13, borderRadius: 12, alignItems: 'center' },
  primaryBtnText: { color: '#0a1410', fontWeight: '900', fontSize: 14, letterSpacing: 0.6 },
  secondaryBtn: { flex: 1, paddingVertical: 11, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  secondaryBtnText: { fontWeight: '700', fontSize: 12, letterSpacing: 1 },
  dangerRow: { flexDirection: 'row', gap: 10, marginTop: 12 },

  modalScrim: {
    ...StyleSheet.absoluteFillObject,
    paddingTop: 80, paddingHorizontal: 16,
  },
  modalCard: {
    borderRadius: 18, borderWidth: 1, padding: 18, maxHeight: '92%',
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  modalTitle: { fontSize: 16, fontWeight: '800' },
  modalClose: { fontSize: 13, fontWeight: '700' },
  modalBody: { gap: 12, paddingBottom: 24 },

  field: { gap: 6 },
  fieldLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  fieldInput: {
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15,
  },
  pickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  pillText: { fontSize: 12, letterSpacing: 0.3 },
  emojiRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  emojiPill: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  emojiPillText: { fontSize: 22 },
});
