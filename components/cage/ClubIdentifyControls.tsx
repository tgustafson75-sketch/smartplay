/**
 * Phase 402 — Vision-based club ID controls for the cage session header.
 *
 * Two-element row:
 *   1. Current-club chip — always rendered during an active session.
 *      Reads from cageStore.activeSession.currentClub (or initial .club).
 *      Tapping it opens the manual picker (ClubPickerModal).
 *   2. ID-club camera button — launches expo-image-picker for a sole
 *      photo, sends it to /api/club-recognition via recognizeClubFromUri,
 *      routes the outcome by confidence tier:
 *
 *        high     → setActiveClub(id, 'vision', 'high'), brief inline
 *                   "Got it: 7-iron" confirmation; auto-dismiss.
 *        medium   → "Looks like your 7-iron — confirm?" with Yes / Pick
 *                   another buttons. Yes commits, Pick another opens the
 *                   manual picker.
 *        low / unknown / no_network / error → "Can't read clearly —
 *                   pick manually" prompt that opens the manual picker.
 *
 * This is the missing UI surface identified in
 * docs/audit-402-club-detection-state.md. The vision pipeline already
 * existed end-to-end — it just had no call site.
 */

import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useCageStore } from '../../store/cageStore';
import {
  recognizeClubFromUri,
  clubLabel,
  type ClubId,
  type ClubRecognitionOutcome,
} from '../../services/clubRecognition';
import { getApiBaseUrl } from '../../services/apiBase';

// 2026-07-06 (audit) — read at fetch time, not module load: a module-scope
// snapshot would defeat the mid-session dual-host failover (see apiBase.ts).
const API_URL = (): string => getApiBaseUrl();

type PendingConfirm = {
  club_id: ClubId;
  reasoning: string;
};

type LowConfState = {
  kind: 'low_conf' | 'no_network' | 'error' | 'unknown';
  detail: string;
};

export default function ClubIdentifyControls() {
  const activeSession = useCageStore(s => s.activeSession);
  const setActiveClub = useCageStore(s => s.setActiveClub);
  const setClubMenuOpen = useCageStore(s => s.setClubMenuOpen);

  const currentClub = activeSession?.currentClub ?? activeSession?.club ?? null;

  const [identifying, setIdentifying] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [lowConf, setLowConf] = useState<LowConfState | null>(null);
  const [recentAck, setRecentAck] = useState<string | null>(null);

  const dismissBanners = useCallback(() => {
    setPendingConfirm(null);
    setLowConf(null);
  }, []);

  const fallToManual = useCallback(
    (state: LowConfState) => {
      setLowConf(state);
      // Don't auto-open the picker — user reads the reason first and
      // taps "Pick manually" so the action stays intentional.
    },
    [],
  );

  const handleOutcome = useCallback(
    (outcome: ClubRecognitionOutcome) => {
      if (outcome.kind === 'no_network') {
        fallToManual({
          kind: 'no_network',
          detail: "No network — pick manually.",
        });
        return;
      }
      if (outcome.kind === 'error') {
        fallToManual({
          kind: 'error',
          detail: "Vision unavailable — pick manually.",
        });
        return;
      }
      // ok
      const { club_id, confidence, reasoning } = outcome;
      if (club_id === 'unknown') {
        fallToManual({
          kind: 'unknown',
          detail: "Can't read the stamp — pick manually.",
        });
        return;
      }
      if (confidence === 'high') {
        setActiveClub(club_id, 'vision', 'high');
        setRecentAck(`Got it: ${clubLabel(club_id)}.`);
        // Auto-clear after a short pause so the chip is the source of truth.
        setTimeout(() => setRecentAck(null), 2200);
        return;
      }
      if (confidence === 'medium') {
        setPendingConfirm({ club_id, reasoning });
        return;
      }
      // low
      fallToManual({
        kind: 'low_conf',
        detail: "Can't see clearly — pick manually.",
      });
    },
    [setActiveClub, fallToManual],
  );

  const runVisionCapture = useCallback(async () => {
    dismissBanners();
    setRecentAck(null);
    if (!API_URL()) {
      fallToManual({ kind: 'error', detail: 'API not configured — pick manually.' });
      return;
    }
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        fallToManual({ kind: 'error', detail: 'Camera permission denied — pick manually.' });
        return;
      }
      const shot = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.7,
        allowsEditing: false,
        base64: false,
      });
      if (shot.canceled) return;
      const asset = shot.assets[0];
      if (!asset?.uri) {
        fallToManual({ kind: 'error', detail: 'No image captured — pick manually.' });
        return;
      }
      setIdentifying(true);
      const outcome = await recognizeClubFromUri(asset.uri, API_URL());
      handleOutcome(outcome);
    } catch (e) {
      console.log('[ClubIdentify] capture/recognize failed', e);
      fallToManual({ kind: 'error', detail: 'Capture failed — pick manually.' });
    } finally {
      setIdentifying(false);
    }
  }, [handleOutcome, dismissBanners, fallToManual]);

  const acceptPending = useCallback(() => {
    if (!pendingConfirm) return;
    setActiveClub(pendingConfirm.club_id, 'vision', 'medium');
    setRecentAck(`Confirmed: ${clubLabel(pendingConfirm.club_id)}.`);
    setTimeout(() => setRecentAck(null), 2200);
    setPendingConfirm(null);
  }, [pendingConfirm, setActiveClub]);

  const openManualFromConfirm = useCallback(() => {
    setPendingConfirm(null);
    setClubMenuOpen(true);
  }, [setClubMenuOpen]);

  const openManualFromLow = useCallback(() => {
    setLowConf(null);
    setClubMenuOpen(true);
  }, [setClubMenuOpen]);

  const openManualFromChip = useCallback(() => setClubMenuOpen(true), [setClubMenuOpen]);

  if (!activeSession) return null;

  return (
    <View style={styles.root}>
      <View style={styles.row}>
        <TouchableOpacity
          style={styles.chip}
          onPress={openManualFromChip}
          accessibilityRole="button"
          accessibilityLabel={`Current club: ${currentClub ? clubLabel(currentClub) : 'none'}. Tap to change.`}
        >
          <Ionicons name="golf-outline" size={14} color="#00C896" />
          <Text style={styles.chipText}>
            {currentClub ? clubLabel(currentClub).toUpperCase() : 'PICK CLUB'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.idBtn}
          onPress={runVisionCapture}
          disabled={identifying}
          accessibilityRole="button"
          accessibilityLabel="Identify club by photographing the sole"
        >
          {identifying ? (
            <ActivityIndicator color="#00C896" size="small" />
          ) : (
            <>
              <Ionicons name="camera-outline" size={14} color="#00C896" />
              <Text style={styles.idBtnText}>ID</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {recentAck && (
        <View style={[styles.banner, styles.bannerOk]}>
          <Ionicons name="checkmark-circle" size={14} color="#00C896" />
          <Text style={styles.bannerOkText}>{recentAck}</Text>
        </View>
      )}

      {pendingConfirm && (
        <View style={[styles.banner, styles.bannerConfirm]}>
          <Text style={styles.bannerConfirmText}>
            Looks like your {clubLabel(pendingConfirm.club_id)} — confirm?
          </Text>
          <View style={styles.bannerActions}>
            <TouchableOpacity style={styles.bannerBtn} onPress={acceptPending}>
              <Text style={styles.bannerBtnYes}>Yes</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.bannerBtn} onPress={openManualFromConfirm}>
              <Text style={styles.bannerBtnNo}>Pick another</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {lowConf && (
        <View style={[styles.banner, styles.bannerLow]}>
          <Ionicons name="alert-circle-outline" size={14} color="#fbbf24" />
          <Text style={styles.bannerLowText}>{lowConf.detail}</Text>
          <TouchableOpacity style={styles.bannerBtn} onPress={openManualFromLow}>
            <Text style={styles.bannerBtnYes}>Pick manually</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 6,
    gap: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(0,200,150,0.45)',
    backgroundColor: 'rgba(0,200,150,0.10)',
  },
  chipText: {
    color: '#00C896',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  idBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1f2937',
    backgroundColor: '#0a0a0a',
    minWidth: 56,
    justifyContent: 'center',
  },
  idBtnText: {
    color: '#00C896',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  bannerOk: {
    borderColor: 'rgba(0,200,150,0.5)',
    backgroundColor: 'rgba(0,200,150,0.10)',
  },
  bannerOkText: {
    color: '#00C896',
    fontSize: 12,
    fontWeight: '700',
  },
  bannerConfirm: {
    borderColor: 'rgba(251,191,36,0.5)',
    backgroundColor: 'rgba(251,191,36,0.10)',
    flexWrap: 'wrap',
  },
  bannerConfirmText: {
    color: '#fbbf24',
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
  },
  bannerLow: {
    borderColor: 'rgba(251,191,36,0.5)',
    backgroundColor: 'rgba(251,191,36,0.10)',
  },
  bannerLowText: {
    color: '#fbbf24',
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
  },
  bannerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  bannerBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1f2937',
    backgroundColor: '#0a0a0a',
  },
  bannerBtnYes: {
    color: '#00C896',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  bannerBtnNo: {
    color: '#9ca3af',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
});
