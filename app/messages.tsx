/**
 * 2026-06-30 — Minimal in-app messaging (Tim ↔ Tank to start). A real thread on the
 * existing Supabase (/api/messages), identity = account email. "Minimal to start, not
 * the full social integration" (Tim). Enter the other person's email once (remembered),
 * then send + see the thread (polls every 5s).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Redirect, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../contexts/ThemeContext';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { sendMessage, fetchThread, type ChatMessage } from '../services/messaging';
import { MESSAGING_ENABLED } from '../constants/featureFlags';

const RECIP_KEY = 'msg_recipient_v1';

// 2026-07-21 (Tim) — messaging is a RELEASE feature, off in beta. This hook-less outer gate
// guards the route so a deep-link / stale nav can't reach it when disabled, even though its
// entry points are hidden. Keeping it hook-free (delegating to the inner component) avoids a
// hooks-after-conditional-return violation.
export default function MessagesScreen() {
  if (!MESSAGING_ENABLED) return <Redirect href={'/(tabs)/caddie' as never} />;
  return <MessagesScreenInner />;
}

function MessagesScreenInner() {
  const router = useRouter();
  const { colors } = useTheme();
  const myEmail = (usePlayerProfileStore(s => s.email) ?? '').trim().toLowerCase();

  const [recipient, setRecipient] = useState('');
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  // Load the remembered recipient once.
  useEffect(() => {
    AsyncStorage.getItem(RECIP_KEY).then(v => { if (v) setRecipient(v); }).catch(() => {});
  }, []);

  const recipOk = /^[^,()\s@]+@[^,()\s@]+\.[^,()\s@]+$/.test(recipient.trim().toLowerCase());

  const refresh = useCallback(async () => {
    if (!myEmail || !recipOk) return;
    const thread = await fetchThread(myEmail, recipient.trim().toLowerCase());
    setMessages(thread);
  }, [myEmail, recipient, recipOk]);

  // Poll every 5s while a valid thread is open.
  useEffect(() => {
    if (!myEmail || !recipOk) return;
    let active = true;
    setLoading(true);
    refresh().finally(() => { if (active) setLoading(false); });
    const id = setInterval(() => { void refresh(); }, 5000);
    return () => { active = false; clearInterval(id); };
  }, [myEmail, recipOk, refresh]);

  const onSend = useCallback(async () => {
    const text = draft.trim();
    const to = recipient.trim().toLowerCase();
    if (!text || !recipOk || !myEmail || sending) return;
    setSending(true);
    await AsyncStorage.setItem(RECIP_KEY, to).catch(() => {});
    const ok = await sendMessage(myEmail, to, text);
    if (ok) { setDraft(''); await refresh(); }
    setSending(false);
  }, [draft, recipient, recipOk, myEmail, sending, refresh]);

  const renderItem = ({ item }: { item: ChatMessage }) => {
    const mine = item.from_email === myEmail;
    return (
      <View style={[styles.bubbleRow, { justifyContent: mine ? 'flex-end' : 'flex-start' }]}>
        <View style={[
          styles.bubble,
          mine
            ? { backgroundColor: colors.accent, borderColor: colors.accent }
            : { backgroundColor: colors.surface_elevated, borderColor: colors.border },
        ]}>
          <Text style={[styles.bubbleText, { color: mine ? '#06281c' : colors.text_primary }]}>{item.body}</Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color={colors.accent} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text_primary }]}>Messages</Text>
        <View style={{ width: 26 }} />
      </View>

      {/* Recipient */}
      <View style={[styles.recipRow, { borderColor: colors.border }]}>
        <Text style={[styles.recipLabel, { color: colors.text_muted }]}>To</Text>
        <TextInput
          value={recipient}
          onChangeText={setRecipient}
          placeholder="their account email (e.g. Tank's)"
          placeholderTextColor={colors.text_muted}
          autoCapitalize="none"
          keyboardType="email-address"
          style={[styles.recipInput, { color: colors.text_primary }]}
        />
      </View>

      {!myEmail ? (
        <View style={styles.center}><Text style={[styles.note, { color: colors.text_muted }]}>Set your account email in Settings to message.</Text></View>
      ) : !recipOk ? (
        <View style={styles.center}><Text style={[styles.note, { color: colors.text_muted }]}>Enter the other person&apos;s account email above to start a thread.</Text></View>
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={8}>
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={m => String(m.id)}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            ListEmptyComponent={
              loading
                ? <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
                : <Text style={[styles.note, { color: colors.text_muted, textAlign: 'center', marginTop: 24 }]}>No messages yet. Say hi 👋</Text>
            }
          />
          <View style={[styles.inputRow, { borderColor: colors.border, backgroundColor: colors.background }]}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Message"
              placeholderTextColor={colors.text_muted}
              multiline
              style={[styles.input, { color: colors.text_primary, backgroundColor: colors.surface_elevated, borderColor: colors.border }]}
            />
            <TouchableOpacity
              onPress={onSend}
              disabled={!draft.trim() || sending}
              style={[styles.sendBtn, { backgroundColor: draft.trim() && !sending ? colors.accent : colors.border }]}
              accessibilityRole="button"
              accessibilityLabel="Send message"
            >
              {sending
                ? <ActivityIndicator color="#06281c" size="small" />
                : <Ionicons name="arrow-up" size={20} color={draft.trim() ? '#06281c' : colors.text_muted} />}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10 },
  title: { fontSize: 18, fontWeight: '900' },
  recipRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1 },
  recipLabel: { fontSize: 13, fontWeight: '800' },
  recipInput: { flex: 1, fontSize: 14, paddingVertical: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  note: { fontSize: 13, lineHeight: 19 },
  listContent: { padding: 12, gap: 6, flexGrow: 1 },
  bubbleRow: { flexDirection: 'row', width: '100%' },
  bubble: { maxWidth: '78%', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, borderWidth: 1 },
  bubbleText: { fontSize: 15, lineHeight: 20 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1 },
  input: { flex: 1, minHeight: 40, maxHeight: 120, borderRadius: 20, borderWidth: 1, paddingHorizontal: 14, paddingTop: 9, paddingBottom: 9, fontSize: 15 },
  sendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
