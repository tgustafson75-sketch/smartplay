/**
 * SaveProgressModal.tsx
 *
 * Non-blocking prompt shown after a round completes (or when the user taps
 * "Save Progress" from the header). Offers two paths:
 *   • Continue as Guest — dismiss, data stays in local session
 *   • Create Account    — navigate to /auth for registration
 *
 * Rendered as a bottom-sheet-style modal. Never blocks play.
 */

import React from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  visible: boolean;
  onDismiss: () => void;
  /** Optional context string, e.g. "You completed 9 holes." */
  contextMessage?: string;
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function SaveProgressModal({ visible, onDismiss, contextMessage }: Props) {
  const router = useRouter();

  const handleCreateAccount = () => {
    onDismiss();
    router.push('/auth');
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onDismiss}
    >
      {/* Scrim — tap outside to dismiss */}
      <Pressable style={s.scrim} onPress={onDismiss}>
        {/* Bottom sheet — stop tap propagation so inner presses don't close */}
        <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
          {/* Handle */}
          <View style={s.handle} />

          <Text style={s.headline}>Save your rounds</Text>
          <Text style={s.sub}>
            {contextMessage
              ? contextMessage + '\n\n'
              : ''}
            Create a free account to unlock SmartPlay Caddie memory, history, and multi-device sync.
          </Text>

          <Pressable style={s.primaryBtn} onPress={handleCreateAccount}>
            <Text style={s.primaryBtnText}>Create Account</Text>
          </Pressable>

          <Pressable style={s.ghostBtn} onPress={onDismiss}>
            <Text style={s.ghostBtnText}>Continue as Guest</Text>
          </Pressable>

          <Text style={s.disclaimer}>
            Your current session data is safe — creating an account just adds cloud backup.
          </Text>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  scrim:       { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet:       { backgroundColor: '#0c1a0f', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40 },
  handle:      { width: 40, height: 4, borderRadius: 2, backgroundColor: '#2a3e2e', alignSelf: 'center', marginBottom: 20 },

  headline:    { color: '#fff', fontSize: 20, fontWeight: '800', textAlign: 'center', marginBottom: 10 },
  sub:         { color: '#9CA3AF', fontSize: 14, lineHeight: 21, textAlign: 'center', marginBottom: 24 },

  primaryBtn:     { backgroundColor: '#059669', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 10 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  ghostBtn:     { backgroundColor: '#111E14', borderRadius: 12, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: '#1F3A22', marginBottom: 16 },
  ghostBtnText: { color: '#6B7280', fontSize: 15, fontWeight: '600' },

  disclaimer:  { color: '#374151', fontSize: 11, textAlign: 'center', lineHeight: 16 },
});
