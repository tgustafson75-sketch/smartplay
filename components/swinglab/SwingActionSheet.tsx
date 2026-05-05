/**
 * Phase BZ-v1 — Per-swing action sheet.
 *
 * Bottom sheet rendered from the swing detail screen ([swing_id].tsx)
 * when the user taps the "•••" button on a per-swing list row, or the
 * single-shot "Manage swing" button. Surfaces:
 *
 *   - Good rep / Bad rep toggle (3-state: good / none / bad)
 *   - Edit tags (feel / shape / contact / direction)
 *   - Add note (free-form, capped at 280 chars)
 *   - Compare with another swing (multi-shot sessions only)
 *   - Share this swing (system share sheet via expo-sharing)
 *   - Delete this swing (confirmation alert)
 *
 * All mutators come from cageStore. The component is presentational;
 * the parent owns the visibility state.
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import * as Sharing from 'expo-sharing';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { useCageStore, type CageShot } from '../../store/cageStore';

interface Props {
  visible: boolean;
  shot: CageShot | null;
  sessionId: string | null;
  onClose: () => void;
  /** When called, the parent enters compare mode with this shot as the
   *  "left" swing. The parent then prompts the user to select a second
   *  swing for the right pane. */
  onStartCompare?: (shotId: string) => void;
  /** When non-null, the parent is rendering this shot in a multi-shot
   *  list and Compare is meaningful. When null, single-shot — Compare
   *  is hidden. */
  multiShotSessionAvailable: boolean;
}

const FEEL_OPTIONS = ['flush', 'fat', 'thin', 'heel', 'toe'] as const;
const SHAPE_OPTIONS = ['draw', 'straight', 'fade', 'hook', 'slice'] as const;
const CONTACT_OPTIONS = ['pure', 'good', 'okay', 'bad'] as const;
const DIRECTION_OPTIONS = ['left', 'straight', 'right'] as const;

type Mode = 'main' | 'tags' | 'note';

export default function SwingActionSheet({
  visible,
  shot,
  sessionId,
  onClose,
  onStartCompare,
  multiShotSessionAvailable,
}: Props) {
  const { colors } = useTheme();
  const updateShotTags = useCageStore(s => s.updateShotTags);
  const markShotGoodRep = useCageStore(s => s.markShotGoodRep);
  const setShotNotes = useCageStore(s => s.setShotNotes);
  const deleteShot = useCageStore(s => s.deleteShot);

  const [mode, setMode] = useState<Mode>('main');
  const [noteDraft, setNoteDraft] = useState('');

  // Reset to main view + reload note draft whenever the sheet reopens
  // for a different shot.
  useEffect(() => {
    if (visible && shot) {
      setMode('main');
      setNoteDraft(shot.userNotes ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, shot?.id]);

  if (!shot || !sessionId) return null;

  const handleGoodRep = (next: boolean | null) => {
    markShotGoodRep(sessionId, shot.id, next);
  };

  const handleTagSet = (key: 'feel' | 'shape' | 'contact' | 'direction', value: string | null) => {
    updateShotTags(sessionId, shot.id, { [key]: value });
  };

  const handleSaveNote = () => {
    const trimmed = noteDraft.trim();
    setShotNotes(sessionId, shot.id, trimmed.length > 0 ? trimmed : null);
    setMode('main');
  };

  const handleShare = async () => {
    if (!shot.clipUri) {
      Alert.alert('Nothing to share', 'This swing has no video file attached.');
      return;
    }
    try {
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        Alert.alert('Sharing unavailable', 'Sharing is not available on this device.');
        return;
      }
      // Note: shares the master video URI. Per-clip mp4 extraction is
      // deferred (Phase BW Option D); when that ships, share the per-clip
      // file instead of the master.
      await Sharing.shareAsync(shot.clipUri, {
        mimeType: 'video/mp4',
        dialogTitle: 'Share swing',
      });
      onClose();
    } catch (e) {
      console.log('[SwingActionSheet] share failed', e);
    }
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete this swing?',
      'The video clip stays in the session, but this swing entry will be removed from the analysis.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteShot(sessionId, shot.id);
            onClose();
          },
        },
      ],
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={onClose}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ width: '100%' }}
        >
          <TouchableOpacity activeOpacity={1}>
            <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.handle} />

              {mode === 'main' && (
                <ScrollView showsVerticalScrollIndicator={false}>
                  <Text style={[styles.title, { color: colors.text_primary }]}>Manage swing</Text>

                  <View style={styles.repRow}>
                    <RepBtn
                      active={shot.isGoodRep === true}
                      icon="star"
                      label="Good rep"
                      onPress={() => handleGoodRep(shot.isGoodRep === true ? null : true)}
                    />
                    <RepBtn
                      active={shot.isGoodRep === false}
                      icon="close-circle"
                      label="Bad rep"
                      onPress={() => handleGoodRep(shot.isGoodRep === false ? null : false)}
                    />
                  </View>

                  <ActionRow icon="pricetags-outline" label="Edit tags" onPress={() => setMode('tags')} />
                  <ActionRow
                    icon="document-text-outline"
                    label={shot.userNotes ? 'Edit note' : 'Add note'}
                    onPress={() => setMode('note')}
                  />
                  {multiShotSessionAvailable && onStartCompare && (
                    <ActionRow
                      icon="git-compare-outline"
                      label="Compare with another swing"
                      onPress={() => {
                        onStartCompare(shot.id);
                        onClose();
                      }}
                    />
                  )}
                  <ActionRow icon="share-outline" label="Share swing" onPress={handleShare} />
                  <ActionRow icon="trash-outline" label="Delete swing" tone="danger" onPress={handleDelete} />

                  <TouchableOpacity onPress={onClose} style={styles.cancelBtn}>
                    <Text style={[styles.cancelText, { color: colors.text_muted }]}>Close</Text>
                  </TouchableOpacity>
                </ScrollView>
              )}

              {mode === 'tags' && (
                <ScrollView showsVerticalScrollIndicator={false}>
                  <Text style={[styles.title, { color: colors.text_primary }]}>Edit tags</Text>

                  <TagSection
                    label="FEEL"
                    options={FEEL_OPTIONS}
                    value={shot.feel}
                    onPress={v => handleTagSet('feel', v)}
                  />
                  <TagSection
                    label="SHAPE"
                    options={SHAPE_OPTIONS}
                    value={shot.shape}
                    onPress={v => handleTagSet('shape', v)}
                  />
                  <TagSection
                    label="CONTACT"
                    options={CONTACT_OPTIONS}
                    value={shot.contact}
                    onPress={v => handleTagSet('contact', v)}
                  />
                  <TagSection
                    label="DIRECTION"
                    options={DIRECTION_OPTIONS}
                    value={shot.direction}
                    onPress={v => handleTagSet('direction', v)}
                  />

                  <TouchableOpacity onPress={() => setMode('main')} style={styles.cancelBtn}>
                    <Text style={[styles.cancelText, { color: colors.text_muted }]}>‹ Back</Text>
                  </TouchableOpacity>
                </ScrollView>
              )}

              {mode === 'note' && (
                <View>
                  <Text style={[styles.title, { color: colors.text_primary }]}>
                    {shot.userNotes ? 'Edit note' : 'Add note'}
                  </Text>
                  <TextInput
                    value={noteDraft}
                    onChangeText={setNoteDraft}
                    placeholder="What did you feel? What would you change?"
                    placeholderTextColor={colors.text_muted}
                    multiline
                    maxLength={280}
                    style={[styles.noteInput, {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                      color: colors.text_primary,
                    }]}
                  />
                  <Text style={[styles.noteCount, { color: colors.text_muted }]}>
                    {noteDraft.length} / 280
                  </Text>
                  <View style={styles.noteBtnRow}>
                    <TouchableOpacity
                      onPress={() => setMode('main')}
                      style={[styles.noteBtn, { borderColor: colors.border }]}
                    >
                      <Text style={[styles.noteBtnText, { color: colors.text_muted }]}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={handleSaveNote}
                      style={[styles.noteBtn, { backgroundColor: colors.accent }]}
                    >
                      <Text style={[styles.noteBtnText, { color: '#fff' }]}>Save</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </TouchableOpacity>
    </Modal>
  );
}

function RepBtn({ active, icon, label, onPress }: { active: boolean; icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        styles.repBtn,
        { borderColor: active ? colors.accent : colors.border, backgroundColor: active ? colors.accent_muted : 'transparent' },
      ]}
    >
      <Ionicons name={icon} size={20} color={active ? colors.accent : colors.text_muted} />
      <Text style={[styles.repBtnText, { color: active ? colors.accent : colors.text_primary }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function ActionRow({
  icon,
  label,
  onPress,
  tone,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  tone?: 'danger';
}) {
  const { colors } = useTheme();
  const color = tone === 'danger' ? '#ef4444' : colors.text_primary;
  return (
    <TouchableOpacity onPress={onPress} style={[styles.actionRow, { borderTopColor: colors.border }]}>
      <Ionicons name={icon} size={20} color={color} />
      <Text style={[styles.actionLabel, { color }]}>{label}</Text>
      <Text style={[styles.chev, { color: colors.text_muted }]}>›</Text>
    </TouchableOpacity>
  );
}

function TagSection({
  label,
  options,
  value,
  onPress,
}: {
  label: string;
  options: readonly string[];
  value: string | null | undefined;
  onPress: (v: string | null) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.tagSection}>
      <Text style={[styles.tagLabel, { color: colors.text_muted }]}>{label}</Text>
      <View style={styles.tagRow}>
        {options.map(opt => {
          const active = value === opt;
          return (
            <TouchableOpacity
              key={opt}
              onPress={() => onPress(active ? null : opt)}
              style={[
                styles.tagPill,
                { borderColor: active ? colors.accent : colors.border, backgroundColor: active ? colors.accent_muted : 'transparent' },
              ]}
            >
              <Text style={[styles.tagPillText, { color: active ? colors.accent : colors.text_primary }]}>
                {opt}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: 16,
    paddingBottom: 32,
    maxHeight: '85%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#9ca3af',
    alignSelf: 'center',
    marginBottom: 12,
    opacity: 0.5,
  },
  title: { fontSize: 16, fontWeight: '900', marginBottom: 14 },
  repRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  repBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  repBtnText: { fontSize: 13, fontWeight: '700' },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actionLabel: { flex: 1, fontSize: 14, fontWeight: '600' },
  chev: { fontSize: 20, fontWeight: '300' },
  cancelBtn: { paddingVertical: 14, alignItems: 'center', marginTop: 6 },
  cancelText: { fontSize: 13, fontWeight: '700' },
  tagSection: { marginBottom: 16 },
  tagLabel: { fontSize: 11, fontWeight: '900', letterSpacing: 1.2, marginBottom: 8 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tagPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1.5,
  },
  tagPillText: { fontSize: 13, fontWeight: '600', textTransform: 'capitalize' },
  noteInput: {
    minHeight: 100,
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  noteCount: { fontSize: 11, marginTop: 6, textAlign: 'right' },
  noteBtnRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  noteBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
  },
  noteBtnText: { fontSize: 13, fontWeight: '800' },
});
