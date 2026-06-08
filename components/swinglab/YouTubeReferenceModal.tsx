/**
 * 2026-05-23 — YouTube Reference ingestion modal.
 *
 * Replaces the previous Alert.prompt-based flow in
 * app/swinglab/library.tsx — which was iOS-only and didn't render
 * at all on Android.
 *
 * Flow:
 *   1. User taps "Add YouTube reference" in the Library header.
 *   2. This modal opens with a URL TextInput.
 *   3. As the user pastes / types, we debounce-call
 *      previewYouTubeReference to fetch the thumbnail + title.
 *   4. The preview card surfaces:
 *        - thumbnail (from oEmbed when available, hqdefault fallback)
 *        - fetched title (auto-fills the label field; editable)
 *        - fetched channel name (auto-fills proName; editable)
 *        - alreadyExists badge when this video is already in the
 *          library
 *   5. User optionally edits label / pro name / club, then taps
 *      "Add reference". We call addReferenceSwing with the preview's
 *      addInput merged with the user's edits.
 *
 * Cross-platform: pure RN — TextInput + Pressable + Modal. No
 * Alert.prompt, no platform-specific APIs.
 *
 * Defensive: every step has a null guard; the preview fetch is
 * cancellable so rapid URL edits don't pile up callbacks; oEmbed
 * failure falls through gracefully (preview still works without
 * the title).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal, View, Text, TextInput, Pressable, Image,
  StyleSheet, KeyboardAvoidingView, Platform, Keyboard,
  ActivityIndicator, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import {
  previewYouTubeReference,
  addReferenceSwing,
  type YouTubePreview,
} from '../../services/swingDatabase';
import { useToastStore } from '../../store/toastStore';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Optional default club to pre-fill (when invoked from a club-
   *  specific surface). */
  defaultClub?: string | null;
}

export default function YouTubeReferenceModal({ visible, onClose, defaultClub = null }: Props) {
  const { colors } = useTheme();

  // Form state.
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [proName, setProName] = useState('');
  const [club, setClub] = useState(defaultClub ?? '');

  // Preview state.
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<YouTubePreview | null>(null);

  // Save state.
  const [saving, setSaving] = useState(false);

  // Reset when the modal closes — clean slate on next open.
  useEffect(() => {
    if (!visible) {
      setUrl('');
      setLabel('');
      setProName('');
      setClub(defaultClub ?? '');
      setPreview(null);
      setPreviewing(false);
      setSaving(false);
    }
  }, [visible, defaultClub]);

  // Debounced preview fetch. Re-runs ~400ms after the user stops
  // typing the URL. AbortController-style: we use a ref to detect
  // stale callbacks vs cancellation.
  const previewSeqRef = useRef(0);
  useEffect(() => {
    if (!visible) return;
    const trimmed = url.trim();
    if (!trimmed) {
      setPreview(null);
      setPreviewing(false);
      return;
    }
    const seq = ++previewSeqRef.current;
    setPreviewing(true);
    const timer = setTimeout(async () => {
      try {
        const result = await previewYouTubeReference(trimmed);
        if (seq !== previewSeqRef.current) return; // stale
        setPreview(result);
        if (result.kind === 'ok') {
          // Auto-fill the editable fields from the preview's fetched
          // metadata, but only when the user hasn't typed into them
          // yet (so we don't overwrite their input on subsequent
          // URL edits).
          if (!label && result.fetchedTitle) setLabel(result.fetchedTitle);
          if (!proName && result.fetchedAuthorName) setProName(result.fetchedAuthorName);
        }
      } catch {
        if (seq !== previewSeqRef.current) return;
        setPreview({ kind: 'invalid', reason: 'Preview failed — check the URL and your network.' });
      } finally {
        if (seq === previewSeqRef.current) setPreviewing(false);
      }
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, visible]);

  const handleAdd = useCallback(async () => {
    if (!preview || preview.kind !== 'ok' || preview.alreadyExists || saving) return;
    setSaving(true);
    try {
      const merged = {
        ...preview.addInput,
        // User edits take precedence over preview's autofilled values.
        label: label.trim() || preview.addInput.label,
        proName: proName.trim() || preview.addInput.proName || null,
        club: club.trim() || preview.addInput.club || null,
      };
      const id = await addReferenceSwing(merged);
      useToastStore.getState().show(`Added "${merged.label}" to your library`);
      Keyboard.dismiss();
      onClose();
      // Don't await beyond onClose — caller resets its own state on
      // mount via the visible-effect above.
      void id;
    } catch {
      useToastStore.getState().show('Couldn\'t add reference. Try again.');
    } finally {
      setSaving(false);
    }
  }, [preview, saving, label, proName, club, onClose]);

  const canAdd = preview?.kind === 'ok' && !preview.alreadyExists && !saving;
  const previewOK = preview?.kind === 'ok';
  const previewInvalid = preview?.kind === 'invalid';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.root}
      >
        <Pressable style={styles.scrim} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.handleRow}>
            <View style={[styles.handle, { backgroundColor: colors.text_muted, opacity: 0.4 }]} />
          </View>

          <View style={styles.headerRow}>
            <Ionicons name="logo-youtube" size={20} color="#ef4444" />
            <Text style={[styles.heading, { color: colors.text_primary }]}>Add YouTube reference</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={[styles.closeText, { color: colors.text_muted }]}>Close</Text>
            </Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
            <Text style={[styles.fieldLabel, { color: colors.text_muted }]}>YOUTUBE URL OR VIDEO ID</Text>
            <TextInput
              value={url}
              onChangeText={setUrl}
              placeholder="https://youtube.com/watch?v=… or 11-char ID"
              placeholderTextColor={colors.text_muted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={[styles.input, { color: colors.text_primary, borderColor: colors.border, backgroundColor: colors.background }]}
            />

            {/* Preview card */}
            {previewing && !preview ? (
              <View style={styles.previewLoading}>
                <ActivityIndicator color={colors.accent} />
                <Text style={[styles.previewLoadingText, { color: colors.text_muted }]}>Reading the URL…</Text>
              </View>
            ) : null}

            {previewInvalid ? (
              <View style={[styles.invalidCard, { borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.10)' }]}>
                <Ionicons name="alert-circle" size={18} color="#ef4444" />
                <Text style={[styles.invalidText, { color: '#ef4444' }]}>
                  {preview && preview.kind === 'invalid' ? preview.reason : ''}
                </Text>
              </View>
            ) : null}

            {previewOK && preview?.kind === 'ok' ? (
              <View style={[styles.previewCard, { borderColor: colors.border, backgroundColor: colors.surface_elevated }]}>
                <Image
                  source={{ uri: preview.thumbnailUri }}
                  style={styles.previewThumb}
                  resizeMode="cover"
                />
                <View style={styles.previewBody}>
                  <Text style={[styles.previewTitle, { color: colors.text_primary }]} numberOfLines={2}>
                    {preview.fetchedTitle ?? preview.addInput.label}
                  </Text>
                  {preview.fetchedAuthorName ? (
                    <Text style={[styles.previewAuthor, { color: colors.text_muted }]} numberOfLines={1}>
                      {preview.fetchedAuthorName}
                    </Text>
                  ) : null}
                  <Text style={[styles.previewId, { color: colors.text_muted }]} numberOfLines={1}>
                    video {preview.videoId}
                  </Text>
                  {preview.alreadyExists ? (
                    <View style={[styles.existsBadge, { borderColor: '#fbbf24' }]}>
                      <Text style={[styles.existsBadgeText, { color: '#fbbf24' }]}>
                        ALREADY IN YOUR LIBRARY
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
            ) : null}

            {/* Editable fields — only render when we have a valid preview. */}
            {previewOK && preview?.kind === 'ok' && !preview.alreadyExists ? (
              <>
                <Text style={[styles.fieldLabel, { color: colors.text_muted }]}>LABEL</Text>
                <TextInput
                  value={label}
                  onChangeText={setLabel}
                  placeholder={preview.addInput.label}
                  placeholderTextColor={colors.text_muted}
                  style={[styles.input, { color: colors.text_primary, borderColor: colors.border, backgroundColor: colors.background }]}
                />

                <View style={styles.fieldRow}>
                  <View style={styles.fieldHalf}>
                    <Text style={[styles.fieldLabel, { color: colors.text_muted }]}>PRO NAME</Text>
                    <TextInput
                      value={proName}
                      onChangeText={setProName}
                      placeholder="e.g. Scottie Scheffler"
                      placeholderTextColor={colors.text_muted}
                      style={[styles.input, { color: colors.text_primary, borderColor: colors.border, backgroundColor: colors.background }]}
                    />
                  </View>
                  <View style={styles.fieldHalf}>
                    <Text style={[styles.fieldLabel, { color: colors.text_muted }]}>CLUB</Text>
                    <TextInput
                      value={club}
                      onChangeText={setClub}
                      placeholder="e.g. 7i"
                      placeholderTextColor={colors.text_muted}
                      autoCapitalize="none"
                      style={[styles.input, { color: colors.text_primary, borderColor: colors.border, backgroundColor: colors.background }]}
                    />
                  </View>
                </View>
              </>
            ) : null}

            <Pressable
              onPress={handleAdd}
              disabled={!canAdd}
              style={({ pressed }) => [
                styles.primaryBtn,
                {
                  backgroundColor: canAdd ? colors.accent : colors.surface_elevated,
                  opacity: pressed && canAdd ? 0.85 : 1,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Add YouTube reference to your library"
            >
              {saving ? (
                <ActivityIndicator color="#0a1410" />
              ) : (
                <Text style={[styles.primaryBtnText, { color: canAdd ? '#0a1410' : colors.text_muted }]}>
                  {preview?.kind === 'ok' && preview.alreadyExists
                    ? 'Already in your library'
                    : 'Add reference swing'}
                </Text>
              )}
            </Pressable>

            <Text style={[styles.footnote, { color: colors.text_muted }]}>
              We store the link + thumbnail only — no video data is downloaded. You can delete the reference any time.
            </Text>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1,
    paddingHorizontal: 16, paddingBottom: 32, paddingTop: 8,
    maxHeight: '92%',
  },
  handleRow: { alignItems: 'center', marginBottom: 6 },
  handle: { width: 44, height: 4, borderRadius: 2 },

  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  heading: { flex: 1, fontSize: 17, fontWeight: '800' },
  closeText: { fontSize: 13, fontWeight: '700' },

  scroll: { gap: 8, paddingBottom: 16 },

  fieldLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 1.2, marginTop: 8, marginBottom: 4 },
  input: {
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, fontWeight: '600',
  },
  fieldRow: { flexDirection: 'row', gap: 10 },
  fieldHalf: { flex: 1 },

  previewLoading: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  previewLoadingText: { fontSize: 12, fontStyle: 'italic' },

  invalidCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    borderWidth: 1, borderRadius: 10, padding: 10, marginTop: 8,
  },
  invalidText: { flex: 1, fontSize: 12, fontWeight: '600', lineHeight: 16 },

  previewCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderRadius: 12, padding: 10, marginTop: 8,
  },
  previewThumb: { width: 96, height: 72, borderRadius: 8, backgroundColor: '#000' },
  previewBody: { flex: 1, gap: 2 },
  previewTitle: { fontSize: 14, fontWeight: '800', lineHeight: 18 },
  previewAuthor: { fontSize: 12, fontWeight: '600' },
  previewId: { fontSize: 10, letterSpacing: 0.4 },
  existsBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 6, borderWidth: 1,
    marginTop: 4,
  },
  existsBadgeText: { fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },

  primaryBtn: {
    paddingVertical: 14, borderRadius: 12, alignItems: 'center',
    marginTop: 12,
  },
  primaryBtnText: { fontSize: 14, fontWeight: '900', letterSpacing: 0.4 },

  footnote: { fontSize: 11, lineHeight: 16, marginTop: 8, textAlign: 'center', fontStyle: 'italic' },
});
