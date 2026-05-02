import React, { useEffect, useState } from 'react';
import { TouchableOpacity, Text, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { notifyEarbudTap } from '../services/earbudControl';
import { getSessionState } from '../services/listeningSession';
import { useSettingsStore } from '../store/settingsStore';

/**
 * Phase O — manual fallback for the earbud tap-to-talk pipeline.
 *
 * Until a native media-key detector ships, this button is the primary
 * trigger for opening Kevin's listening session. After the native
 * detector lands the button can stay as an on-screen alternative.
 */
export default function TapToTalkButton() {
  const enabled = useSettingsStore(s => s.earbudTapToTalk);
  const [state, setState] = useState(getSessionState());

  useEffect(() => {
    const i = setInterval(() => setState(getSessionState()), 250);
    return () => clearInterval(i);
  }, []);

  if (!enabled) return null;

  const active = state !== 'idle';
  const label =
    state === 'opening' ? 'Opening...' :
    state === 'listening' ? 'Listening' :
    state === 'thinking' ? 'Thinking' :
    state === 'responding' ? 'Speaking' :
    'Tap to talk';

  return (
    <TouchableOpacity
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        notifyEarbudTap();
      }}
      activeOpacity={0.8}
      style={[styles.btn, active && styles.btnActive]}
    >
      <View style={styles.row}>
        <Ionicons name="mic" size={16} color={active ? '#0d1a0d' : '#00C896'} />
        <Text style={[styles.text, active && styles.textActive]}>{label}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    backgroundColor: 'rgba(0,200,150,0.12)',
    borderColor: '#00C896',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignSelf: 'center',
  },
  btnActive: {
    backgroundColor: '#00C896',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  text: {
    color: '#00C896',
    fontSize: 13,
    fontWeight: '700',
  },
  textActive: {
    color: '#0d1a0d',
  },
});
