/**
 * Coach Mode — wrapper for "watching someone else swing."
 *
 * 2026-05-23 — Built for Tank (real golf instructor) to walk into the
 * range with a student, pick (or quick-add) the player, capture their
 * swing, and get the full AI swing analysis routed correctly (Phase K
 * full-body, not putting). Rides on Fix #7 (perspective threading): on
 * entry to a player, this screen sets familyStore.active_member_id —
 * the SmartMotion / Cage Mode / mediaCapture / CageSessionOverlay
 * record paths all already read that store and set perspective +
 * swinger correctly on ingest.
 *
 * What this screen IS:
 *   - Player picker over the existing family roster + quick "add by name"
 *   - Two capture surfaces: phone (→ /swinglab/quick-record) and glasses
 *     (voice "record this" — the existing mediaCapture path)
 *   - List of this player's past swings, tap to open the swing detail
 *   - Short skippable spoken + written tutorial on first entry
 *
 * What this screen is NOT (and intentionally defers to follow-ups):
 *   - Multi-swing session review with voice walkthrough — TODO, next layer
 *   - Voice-to-text for the coach note itself — TODO, text input first
 *   - In-screen video capture (we route to SmartMotion / quick-record
 *     so the existing camera UX stays the single source of truth)
 *
 * Additivity guarantees:
 *   - No edits to SmartMotion / Cage Mode / quick-record. They already
 *     respect active_member_id post Fix #7.
 *   - Coach Mode merely sets active_member_id; the existing capture
 *     pipes do the rest.
 *   - Account-holder POV flow (no member active) is unchanged.
 */

import React, { useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, TextInput,
  Modal, Alert, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { useFamilyStore, type FamilyMember } from '../../store/familyStore';
import { useCageStore } from '../../store/cageStore';
import { useSettingsStore } from '../../store/settingsStore';
import { speak } from '../../services/voiceService';
import { getCaddieName } from '../../lib/persona';

const COACH_TUTORIAL_KEY = 'coach_mode';

export default function CoachMode() {
  const router = useRouter();
  const { colors } = useTheme();
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';

  // ── Family roster + active member ───────────────────────────────
  const members = useFamilyStore(s => s.members);
  const activeMemberId = useFamilyStore(s => s.active_member_id);
  const setActiveMember = useFamilyStore(s => s.setActiveMember);
  const addMember = useFamilyStore(s => s.addMember);
  // Members excluding archived ones — Tank shouldn't pick a retired student.
  const roster = useMemo(() => members.filter(m => !m.archived), [members]);
  const activeMember = roster.find(m => m.id === activeMemberId) ?? null;

  // ── Settings + tutorial gate ────────────────────────────────────
  const tutorialsSeen = useSettingsStore(s => s.tutorialsSeen);
  const markTutorialSeen = useSettingsStore(s => s.markTutorialSeen);
  const voiceEnabled = useSettingsStore(s => s.voiceEnabled);
  const voiceGender = useSettingsStore(s => s.voiceGender);
  const language = useSettingsStore(s => s.language);
  const persona = useSettingsStore(s => s.caddiePersonality);
  const caddieName = getCaddieName(persona);

  // Tutorial visibility: first time only, then dismissed forever via
  // tutorialsSeen[COACH_TUTORIAL_KEY] = true. Honors the existing
  // tutorial-seen mechanism so it appears in /reset-tutorials.
  const [tutorialOpen, setTutorialOpen] = useState<boolean>(
    !tutorialsSeen[COACH_TUTORIAL_KEY]
  );

  // ── Past swings for the active player ──────────────────────────
  // Coach Mode v1 filters by upload.swinger === activeMember.firstName.
  // Robust against renames is a follow-up (tag a coached_member_id at
  // ingest time, filter by that). For now: name-match.
  const sessionHistory = useCageStore(s => s.sessionHistory);
  const hasHydrated = useCageStore(s => s.hasHydrated);
  const playerSwings = useMemo(() => {
    if (!activeMember) return [];
    const targetName = activeMember.firstName.trim().toLowerCase();
    return sessionHistory
      .filter(sess => (sess.upload?.swinger ?? '').trim().toLowerCase() === targetName)
      .sort((a, b) => b.date - a.date);
  }, [sessionHistory, activeMember]);

  // ── Quick-add input state ──────────────────────────────────────
  const [newPlayerName, setNewPlayerName] = useState('');

  // ── Spoken tutorial. Fires once on mount when the tutorial modal
  // is visible. Persona-aware (uses the active caddie persona's
  // voice/gender), per Tim's spec ("Tank's own voice if Tank is the
  // active caddie — fitting, since the real Tank is using it"). The
  // spoken line is shorter than the written copy so it doesn't drag.
  React.useEffect(() => {
    if (!tutorialOpen) return;
    if (!voiceEnabled) return;
    const text =
      `Coach Mode. Pick your player. Point glasses or phone at their swing. ` +
      `Say record this — I'll break it down, and you can add your own notes.`;
    // userInitiated: false here because this fires on navigation (the
    // user tapped into Coach Mode, but the speak() guard reads the
    // tap as launch-context). If voice stays silent the written copy
    // is enough — and skipping the tutorial dismisses both.
    speak(text, voiceGender, language, apiUrl).catch(() => {});
  }, [tutorialOpen, voiceEnabled, voiceGender, language, apiUrl]);

  const dismissTutorial = () => {
    setTutorialOpen(false);
    markTutorialSeen(COACH_TUTORIAL_KEY);
  };

  // ── Player selection ────────────────────────────────────────────
  const pickPlayer = (member: FamilyMember) => {
    setActiveMember(member.id);
  };

  const quickAddPlayer = () => {
    const name = newPlayerName.trim();
    if (!name) return;
    // Sensible defaults for a quick-add. Tank doesn't fill out a full
    // roster profile — he just names the student. Other fields can be
    // edited later in /family/[memberId] if desired.
    const id = addMember({
      firstName: name,
      relationship: 'other',
      age: null,
      skillLevel: 'developing',
      handedness: 'unknown',
      approximate_handicap: null,
      avatar_emoji: '🏌️',
    });
    setActiveMember(id);
    setNewPlayerName('');
  };

  // ── Capture handoffs ────────────────────────────────────────────
  // 2026-06-07 — Phone capture now uses the new unified Smart Motion
  // interface (was the old quick-record "goofy" screen). Smart Motion
  // reads familyStore.active_member_id on ingest, so the swing is
  // attributed to the active student with perspective 'watching_someone'.
  // The glasses path is voice-driven ("record this"); we show an
  // instruction card instead of taking a tap action.
  const startPhoneCapture = () => {
    if (!activeMember) {
      Alert.alert('Pick a player first', 'Tap a player or add one to get started.');
      return;
    }
    router.push('/swinglab/smartmotion' as never);
  };

  const exitCoachMode = () => {
    // Don't auto-clear active_member_id — leaving it sticky is the
    // documented family-mode pattern (KidSwingGuideOverlay etc. rely
    // on it). Tank can pick a different player or "Account holder"
    // explicitly via the picker when he's done coaching.
    router.back();
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* HEADER */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={exitCoachMode}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Exit Coach Mode"
        >
          <Ionicons name="chevron-back" size={26} color={colors.accent} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text_primary }]}>Coach Mode</Text>
        <TouchableOpacity
          onPress={() => setTutorialOpen(true)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Show tutorial again"
        >
          <Ionicons name="help-circle-outline" size={22} color={colors.text_muted} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* PLAYER PICKER */}
        <Text style={[styles.sectionHeader, { color: colors.text_muted }]}>PLAYER</Text>
        {roster.length > 0 && (
          <View style={styles.rosterWrap}>
            {roster.map(m => {
              const selected = activeMember?.id === m.id;
              return (
                <View key={m.id} style={styles.memberCardWrap}>
                  <TouchableOpacity
                    onPress={() => pickPlayer(m)}
                    style={[
                      styles.memberCard,
                      {
                        backgroundColor: colors.surface,
                        borderColor: selected ? colors.accent : colors.border,
                      },
                      selected && { backgroundColor: colors.accent_muted },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Coach ${m.firstName}`}
                    accessibilityState={{ selected }}
                  >
                    <Text style={styles.memberAvatar}>{m.avatar_emoji ?? '🏌️'}</Text>
                    <Text style={[styles.memberName, { color: colors.text_primary }]} numberOfLines={1}>
                      {m.firstName}
                    </Text>
                    {selected && <Ionicons name="checkmark-circle" size={16} color={colors.accent} />}
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => router.push(`/swinglab/player-library/${m.id}` as never)}
                    style={[styles.playerLibraryBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
                    accessibilityRole="button"
                    accessibilityLabel={`${m.firstName} Player Library`}
                  >
                    <Ionicons name="library-outline" size={13} color={colors.text_muted} />
                    <Text style={[styles.playerLibraryBtnText, { color: colors.text_muted }]}>Player Library</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        )}

        {/* QUICK-ADD */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.label, { color: colors.text_muted }]}>QUICK-ADD A PLAYER</Text>
          <View style={styles.quickAddRow}>
            <TextInput
              style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text_primary }]}
              value={newPlayerName}
              onChangeText={setNewPlayerName}
              placeholder="First name (e.g. Mike)"
              placeholderTextColor={colors.text_muted}
              returnKeyType="done"
              onSubmitEditing={quickAddPlayer}
              autoCorrect={false}
              autoCapitalize="words"
            />
            <TouchableOpacity
              style={[
                styles.addBtn,
                {
                  backgroundColor: newPlayerName.trim() ? colors.accent : colors.surface_elevated,
                  borderColor: colors.border,
                },
              ]}
              onPress={quickAddPlayer}
              disabled={!newPlayerName.trim()}
              accessibilityRole="button"
              accessibilityLabel="Add player"
            >
              <Ionicons
                name="add"
                size={22}
                color={newPlayerName.trim() ? '#0d1a0d' : colors.text_muted}
              />
            </TouchableOpacity>
          </View>
        </View>

        {/* CAPTURE BUTTONS */}
        <Text style={[styles.sectionHeader, { color: colors.text_muted, marginTop: 16 }]}>CAPTURE</Text>
        <TouchableOpacity
          style={[
            styles.captureCard,
            {
              backgroundColor: colors.surface,
              borderColor: activeMember ? colors.accent : colors.border,
              opacity: activeMember ? 1 : 0.5,
            },
          ]}
          onPress={startPhoneCapture}
          disabled={!activeMember}
          accessibilityRole="button"
          accessibilityLabel="Record with phone camera"
        >
          <View style={[styles.captureIcon, { backgroundColor: colors.accent_muted, borderColor: colors.accent }]}>
            <Ionicons name="phone-portrait-outline" size={26} color={colors.accent} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.captureTitle, { color: colors.text_primary }]}>Record with phone</Text>
            <Text style={[styles.captureSub, { color: colors.text_muted }]}>
              Tap to open SmartMotion. Full swing analysis runs automatically.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.text_muted} />
        </TouchableOpacity>

        <View
          style={[
            styles.captureCard,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              opacity: activeMember ? 1 : 0.5,
            },
          ]}
        >
          <View style={[styles.captureIcon, { backgroundColor: colors.accent_muted, borderColor: colors.accent }]}>
            <Ionicons name="glasses-outline" size={26} color={colors.accent} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.captureTitle, { color: colors.text_primary }]}>Record with glasses</Text>
            <Text style={[styles.captureSub, { color: colors.text_muted }]}>
              Say &ldquo;{caddieName}, record this&rdquo; while you&apos;re watching the swing.
              I&apos;ll capture and analyze.
            </Text>
          </View>
        </View>

        {/* PAST SWINGS UNDER THIS PLAYER */}
        {activeMember && (
          <>
            <Text style={[styles.sectionHeader, { color: colors.text_muted, marginTop: 16 }]}>
              {activeMember.firstName.toUpperCase()}&apos;S SWINGS
            </Text>
            {!hasHydrated ? (
              <Text style={[styles.emptyHint, { color: colors.text_muted }]}>Loading…</Text>
            ) : playerSwings.length === 0 ? (
              <Text style={[styles.emptyHint, { color: colors.text_muted }]}>
                No swings yet. Capture one above and it&apos;ll land here.
              </Text>
            ) : (
              playerSwings.map(sess => {
                const dateStr = new Date(sess.date).toLocaleDateString(undefined, {
                  month: 'short', day: 'numeric',
                });
                const thumb = sess.primary_issue?.visual_reference_path ?? null;
                return (
                  <TouchableOpacity
                    key={sess.id}
                    onPress={() => router.push(`/swinglab/swing/${sess.id}` as never)}
                    style={[styles.swingRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${activeMember.firstName}'s swing from ${dateStr}`}
                  >
                    <View style={[styles.thumb, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
                      {thumb ? (
                        <Image source={{ uri: thumb }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                      ) : (
                        <Ionicons name="golf-outline" size={22} color={colors.text_muted} />
                      )}
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.swingTitle, { color: colors.text_primary }]} numberOfLines={1}>
                        {sess.club} · {dateStr}
                      </Text>
                      {sess.primary_issue?.name && (
                        <Text style={[styles.swingMeta, { color: colors.accent }]} numberOfLines={1}>
                          {sess.primary_issue.name}
                        </Text>
                      )}
                      {sess.coach_note && (
                        <Text style={[styles.swingMeta, { color: colors.text_muted }]} numberOfLines={1}>
                          📝 {sess.coach_note}
                        </Text>
                      )}
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.text_muted} />
                  </TouchableOpacity>
                );
              })
            )}
          </>
        )}

        {/* Roadmap note — visible in code, not on screen */}
        {/* TODO (Coach Mode v2):
            - Multi-swing session review with voice walkthrough (Kevin
              narrates the swings sequentially with comparison commentary).
            - Voice-to-text for the coach note itself (currently text only).
            - Tag coached_member_id on the upload at ingest time so the
              player-swing filter is robust against renames.
        */}
      </ScrollView>

      {/* TUTORIAL MODAL — short, skippable, spoken+written. */}
      <Modal
        visible={tutorialOpen}
        transparent
        animationType="fade"
        onRequestClose={dismissTutorial}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.modalIconWrap}>
              <Ionicons name="school-outline" size={32} color={colors.accent} />
            </View>
            <Text style={[styles.modalTitle, { color: colors.text_primary }]}>Coach Mode</Text>
            <Text style={[styles.modalLine, { color: colors.text_primary }]}>
              1. Pick the player you&apos;re coaching.
            </Text>
            <Text style={[styles.modalLine, { color: colors.text_primary }]}>
              2. Point glasses or phone at their swing.
            </Text>
            <Text style={[styles.modalLine, { color: colors.text_primary }]}>
              3. Say &ldquo;{caddieName}, record this&rdquo; — I&apos;ll break it down.
            </Text>
            <Text style={[styles.modalLine, { color: colors.text_primary }]}>
              4. Add your own coach notes alongside the AI read.
            </Text>
            <TouchableOpacity
              style={[styles.modalBtn, { backgroundColor: colors.accent }]}
              onPress={dismissTutorial}
              accessibilityRole="button"
              accessibilityLabel="Got it, dismiss tutorial"
            >
              <Text style={styles.modalBtnText}>Got it</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={dismissTutorial}
              accessibilityRole="button"
              accessibilityLabel="Skip tutorial"
            >
              <Text style={[styles.modalSkip, { color: colors.text_muted }]}>Skip</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  title: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '900', letterSpacing: 0.2 },
  scroll: { padding: 12, paddingBottom: 40, gap: 8 },
  sectionHeader: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginTop: 6,
    marginBottom: 6,
    paddingHorizontal: 4,
  },
  rosterWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4,
  },
  memberCardWrap: {
    gap: 6,
  },
  memberCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  memberAvatar: { fontSize: 18 },
  memberName: { fontSize: 14, fontWeight: '700' },
  playerLibraryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 9,
    borderWidth: 1,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  playerLibraryBtnText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  card: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  quickAddRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 15,
    minHeight: 44,
  },
  addBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 4,
  },
  captureIcon: {
    width: 52,
    height: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureTitle: { fontSize: 16, fontWeight: '800', marginBottom: 4 },
  captureSub: { fontSize: 12, lineHeight: 17 },
  swingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  swingTitle: { fontSize: 14, fontWeight: '800' },
  swingMeta: { fontSize: 11, fontWeight: '700', marginTop: 2 },
  emptyHint: { fontSize: 13, paddingHorizontal: 4, paddingVertical: 8, fontStyle: 'italic' },

  // Tutorial modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 18,
    borderWidth: 1,
    padding: 22,
    alignItems: 'stretch',
    gap: 8,
  },
  modalIconWrap: { alignSelf: 'center', marginBottom: 4 },
  modalTitle: { fontSize: 22, fontWeight: '900', textAlign: 'center', marginBottom: 8 },
  modalLine: { fontSize: 14, lineHeight: 22 },
  modalBtn: {
    marginTop: 14,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalBtnText: { color: '#0d1a0d', fontSize: 15, fontWeight: '900', letterSpacing: 0.4 },
  modalSkip: {
    textAlign: 'center',
    marginTop: 10,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
