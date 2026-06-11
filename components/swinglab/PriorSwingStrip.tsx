/**
 * 2026-05-26 — Fix AU: SmartMotion prior-swing strip.
 *
 * Tim: "when user records a swing and analyzes and gets their
 * information and then hits the record button to use another swing,
 * the previous swing with play buttons needs to be viewable side by
 * side with the new swing. But only the new analysis should show
 * unless you hit the old swing that has a little info icon with that
 * one's info."
 *
 * Then: "a very, very cool option is a cross analyze both swings
 * together and see if there's a difference."
 *
 * Renders up to 2 most-recent prior SmartMotion swings (live_cage
 * sessions OTHER than the one currently on screen) as a horizontal
 * strip below the current video. Each prior swing has:
 *   - Thumbnail (persisted fault frame)
 *   - Play button — opens the clip in a modal
 *   - Info button — modal with that swing's primary issue + drill
 *   - Compare button — POSTs both fault frames to /api/swing-compare,
 *     shows the conversational diff in the same modal (caddie voice,
 *     spoken aloud via userInitiated:true)
 *
 * Hides entirely when there's no prior swing OR the current session
 * has no persisted fault frame to compare against.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, Image, TouchableOpacity, Modal, ScrollView,
  ActivityIndicator, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Video, ResizeMode } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { useTheme } from '../../contexts/ThemeContext';
import { useCageStore, type CageSession } from '../../store/cageStore';
import { useSettingsStore } from '../../store/settingsStore';
import { getCaddieName } from '../../lib/persona';
import {
  speak, configureAudioForSpeech, stopSpeaking,
} from '../../services/voiceService';
import { getApiBaseUrl } from '../../services/apiBase';

interface Props {
  /** The clipUri of the CURRENT swing on screen (excluded from the
   *  prior-swing list and used as the "newer" frame in compare). */
  currentClipUri: string | null;
}

const apiUrl = getApiBaseUrl();

function getFaultFrame(s: CageSession): string | null {
  if (s.primary_issue?.visual_reference_path) return s.primary_issue.visual_reference_path;
  const perShot = s.shots.find(sh => sh.perShotAnalysis?.visual_reference_path);
  return perShot?.perShotAnalysis?.visual_reference_path ?? null;
}

function getClipUri(s: CageSession): string | null {
  return s.shots[0]?.clipUri ?? null;
}

type ModalMode = 'play' | 'info' | 'compare' | null;

export default function PriorSwingStrip({ currentClipUri }: Props) {
  const { colors } = useTheme();
  const sessionHistory = useCageStore(s => s.sessionHistory);
  const caddiePersonality = useSettingsStore(s => s.caddiePersonality);
  const voiceGender = useSettingsStore(s => s.voiceGender);
  const language = useSettingsStore(s => s.language);

  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [activePriorId, setActivePriorId] = useState<string | null>(null);
  const [compareBusy, setCompareBusy] = useState(false);
  const [compareAnswer, setCompareAnswer] = useState<string | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [compareProvider, setCompareProvider] = useState<string | null>(null);

  const { currentSession, priorSwings } = useMemo(() => {
    // Newest live_cage sessions first. The current screen's session is
    // identified by clipUri; everything before it is "prior."
    const liveCage = sessionHistory
      .filter(s => s.source === 'live_cage')
      .sort((a, b) => b.date - a.date);
    const current = liveCage.find(s => getClipUri(s) === currentClipUri) ?? null;
    const prior = liveCage.filter(s => s !== current).slice(0, 2);
    return { currentSession: current, priorSwings: prior };
  }, [sessionHistory, currentClipUri]);

  const activePrior = activePriorId
    ? priorSwings.find(s => s.id === activePriorId) ?? null
    : null;

  const closeModal = useCallback(() => {
    void stopSpeaking().catch(() => {});
    setModalMode(null);
    setActivePriorId(null);
    setCompareAnswer(null);
    setCompareError(null);
    setCompareProvider(null);
    setCompareBusy(false);
  }, []);

  const onCompare = useCallback(async (priorSession: CageSession) => {
    setActivePriorId(priorSession.id);
    setModalMode('compare');
    setCompareAnswer(null);
    setCompareError(null);
    setCompareProvider(null);
    setCompareBusy(true);

    const olderUri = getFaultFrame(priorSession);
    const newerUri = currentSession ? getFaultFrame(currentSession) : null;
    if (!olderUri || !newerUri) {
      setCompareError('Need both swings analyzed before I can compare them.');
      setCompareBusy(false);
      return;
    }

    try {
      const [olderB64, newerB64] = await Promise.all([
        FileSystem.readAsStringAsync(olderUri, { encoding: 'base64' }),
        FileSystem.readAsStringAsync(newerUri, { encoding: 'base64' }),
      ]);
      const res = await fetch(`${apiUrl}/api/swing-compare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          older_frame: { b64: olderB64, media_type: 'image/jpeg' },
          newer_frame: { b64: newerB64, media_type: 'image/jpeg' },
          context: {
            caddie_name: getCaddieName(caddiePersonality),
            club: currentSession?.club ?? null,
            language,
          },
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(typeof errBody.error === 'string' ? errBody.error : `HTTP ${res.status}`);
      }
      const data = await res.json() as { answer: string; provider: string };
      if (!data.answer) throw new Error('Empty answer');
      setCompareAnswer(data.answer);
      setCompareProvider(data.provider);
      await configureAudioForSpeech();
      void speak(data.answer, voiceGender, language as 'en' | 'es' | 'zh', apiUrl, { userInitiated: true });
    } catch (e) {
      setCompareError(e instanceof Error ? e.message : 'Compare failed');
    } finally {
      setCompareBusy(false);
    }
  }, [currentSession, caddiePersonality, voiceGender, language]);

  if (priorSwings.length === 0) return null;

  return (
    <>
      <View style={[styles.strip, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.headerRow}>
          <Ionicons name="time-outline" size={14} color={colors.text_muted} />
          <Text style={[styles.headerLabel, { color: colors.text_muted }]}>
            EARLIER SWING{priorSwings.length === 1 ? '' : 'S'}
          </Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
          {priorSwings.map((s, i) => {
            const thumb = getFaultFrame(s);
            const dateLabel = new Date(s.date).toLocaleTimeString(undefined, {
              hour: 'numeric', minute: '2-digit',
            });
            return (
              <View
                key={s.id}
                style={[styles.priorCard, { borderColor: colors.border, backgroundColor: colors.background }]}
              >
                <View style={[styles.thumb, { backgroundColor: colors.surface_elevated }]}>
                  {thumb ? (
                    <Image source={{ uri: thumb }} style={styles.thumbImage} resizeMode="cover" />
                  ) : (
                    <Ionicons name="golf-outline" size={20} color={colors.text_muted} />
                  )}
                </View>
                <Text style={[styles.priorLabel, { color: colors.text_muted }]}>
                  {i === 0 ? 'Last' : 'Prior'} · {dateLabel}
                </Text>
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    onPress={() => { setActivePriorId(s.id); setModalMode('play'); }}
                    style={[styles.iconBtn, { borderColor: colors.border }]}
                    hitSlop={6}
                    accessibilityLabel="Play this earlier swing"
                  >
                    <Ionicons name="play" size={14} color={colors.accent} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => { setActivePriorId(s.id); setModalMode('info'); }}
                    style={[styles.iconBtn, { borderColor: colors.border }]}
                    hitSlop={6}
                    accessibilityLabel="See this earlier swing's analysis"
                  >
                    <Ionicons name="information-circle-outline" size={14} color={colors.accent} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => onCompare(s)}
                    style={[styles.compareBtn, { backgroundColor: colors.accent_muted, borderColor: colors.accent }]}
                    hitSlop={4}
                    accessibilityLabel="Cross-analyze both swings"
                  >
                    <Ionicons name="git-compare-outline" size={12} color={colors.accent} />
                    <Text style={[styles.compareBtnText, { color: colors.accent }]}>Compare</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </ScrollView>
      </View>

      <Modal visible={modalMode != null} animationType="slide" transparent onRequestClose={closeModal}>
        <View style={styles.modalScrim}>
          <View style={[styles.modalSheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text_primary }]}>
                {modalMode === 'play' && 'Earlier Swing'}
                {modalMode === 'info' && 'Earlier Swing — Analysis'}
                {modalMode === 'compare' && 'Compare Swings'}
              </Text>
              <TouchableOpacity onPress={closeModal} hitSlop={8} accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={colors.text_primary} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.modalBody}>
              {modalMode === 'play' && activePrior && (() => {
                const uri = getClipUri(activePrior);
                if (!uri) {
                  return <Text style={{ color: colors.text_muted }}>No video for this swing.</Text>;
                }
                return (
                  <Video
                    source={{ uri }}
                    style={styles.modalVideo}
                    useNativeControls
                    resizeMode={ResizeMode.CONTAIN}
                    shouldPlay
                    isLooping
                  />
                );
              })()}
              {modalMode === 'info' && activePrior && (
                <View>
                  {activePrior.primary_issue ? (
                    <>
                      <Text style={[styles.infoLabel, { color: colors.accent }]}>PRIMARY READ</Text>
                      <Text style={[styles.infoTitle, { color: colors.text_primary }]}>
                        {activePrior.primary_issue.name}
                      </Text>
                      <Text style={[styles.infoBody, { color: colors.text_primary }]}>
                        {activePrior.primary_issue.mechanical_breakdown}
                      </Text>
                      {activePrior.primary_issue.feel_cue && (
                        <>
                          <Text style={[styles.infoLabel, { color: colors.accent, marginTop: 14 }]}>FEEL CUE</Text>
                          <Text style={[styles.infoBody, { color: colors.text_primary }]}>
                            {activePrior.primary_issue.feel_cue}
                          </Text>
                        </>
                      )}
                      {activePrior.drill_recommendation && (
                        <>
                          <Text style={[styles.infoLabel, { color: colors.accent, marginTop: 14 }]}>DRILL</Text>
                          <Text style={[styles.infoBody, { color: colors.text_primary }]}>
                            {activePrior.drill_recommendation.drill_name}
                          </Text>
                          <Text style={[styles.infoBody, { color: colors.text_muted, fontSize: 13 }]}>
                            {activePrior.drill_recommendation.reason}
                          </Text>
                        </>
                      )}
                    </>
                  ) : (
                    <Text style={[styles.infoBody, { color: colors.text_muted }]}>
                      No analysis attached to this swing yet.
                    </Text>
                  )}
                </View>
              )}
              {modalMode === 'compare' && (
                <View>
                  {compareBusy && (
                    <View style={styles.busyRow}>
                      <ActivityIndicator size="small" color={colors.accent} />
                      <Text style={[styles.busyText, { color: colors.text_muted }]}>
                        Cross-analyzing both swings…
                      </Text>
                    </View>
                  )}
                  {compareAnswer && (
                    <>
                      <Text style={[styles.infoBody, { color: colors.text_primary }]}>
                        {compareAnswer}
                      </Text>
                      {compareProvider && (
                        <Text style={[styles.providerTag, { color: colors.text_muted }]}>
                          via {compareProvider}
                        </Text>
                      )}
                    </>
                  )}
                  {compareError && (
                    <Text style={[styles.errorText, { color: '#ef4444' }]}>{compareError}</Text>
                  )}
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  strip: {
    marginHorizontal: 16, marginTop: 12, borderRadius: 14,
    borderWidth: 1, padding: 12,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 },
  headerLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  priorCard: {
    width: 130, padding: 8, borderRadius: 10, borderWidth: 1,
    alignItems: 'stretch',
  },
  thumb: {
    width: '100%', height: 72, borderRadius: 6, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
  },
  thumbImage: { width: '100%', height: '100%' },
  priorLabel: {
    fontSize: 10, fontWeight: '700', letterSpacing: 0.5,
    marginTop: 6, textAlign: 'center',
  },
  actionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: 6, justifyContent: 'space-between',
  },
  iconBtn: {
    width: 28, height: 28, borderRadius: 14, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  compareBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingVertical: 4, paddingHorizontal: 6,
    borderRadius: 6, borderWidth: 1,
  },
  compareBtnText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.3 },
  modalScrim: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: 16, borderTopRightRadius: 16,
    borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#222',
  },
  modalTitle: { fontSize: 16, fontWeight: '800' },
  modalBody: { padding: 16 },
  modalVideo: { width: '100%', aspectRatio: 9 / 16, borderRadius: 10, backgroundColor: '#000' },
  infoLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1, marginBottom: 4 },
  infoTitle: { fontSize: 17, fontWeight: '800', marginBottom: 6 },
  infoBody: { fontSize: 14, lineHeight: 21, marginTop: 4 },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  busyText: { fontSize: 13 },
  providerTag: { fontSize: 10, marginTop: 10, letterSpacing: 0.5 },
  errorText: { fontSize: 13, fontStyle: 'italic' },
});
