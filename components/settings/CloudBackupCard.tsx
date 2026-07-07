/**
 * Settings · Cloud Backup & Sync card.
 *
 * Email-OTP sign-in → per-account backup of the structured stores so a phone
 * swap never wipes the player's data again (the Wachusett warranty-swap loss).
 * Auto-backs-up in the background; offers a one-tap restore on a fresh device.
 *
 * Honest states: when the cloud isn't configured yet (anon key not set) it says
 * so plainly instead of pretending to work.
 */

import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Updates from 'expo-updates';
import { useTheme } from '../../contexts/ThemeContext';
import { isCloudConfigured } from '../../services/cloudSync/cloudClient';
import {
  useCloudBackupStore,
  requestLoginCode,
  verifyLoginCode,
  backupNow,
  restoreFromCloud,
  signOutCloud,
} from '../../services/cloudSync/cloudBackup';
import { shouldOfferRestore } from '../../services/cloudSync/autoBackup';
import { exportBackupToFile, importBackupFromFile } from '../../services/cloudSync/localBackup';
import { useServerBackupStore, serverBackupNow, serverRestore } from '../../services/cloudSync/serverBackup';

function timeAgo(ms: number | null): string {
  if (!ms) return 'never';
  const d = Date.now() - ms;
  if (d < 60_000) return 'just now';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}

export default function CloudBackupCard() {
  const { colors } = useTheme();
  const configured = isCloudConfigured();
  const { email, userId, autoBackupEnabled, lastBackupAt, status, lastError, setAutoBackup } = useCloudBackupStore();

  const [emailInput, setEmailInput] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [phase, setPhase] = useState<'signed_out' | 'code_sent'>('signed_out');
  const busy = status === 'sending_code' || status === 'verifying' || status === 'backing_up' || status === 'restoring';

  const promptRestoreIfFresh = async () => {
    const { offer, updatedAt } = await shouldOfferRestore();
    if (!offer) return;
    const when = updatedAt ? new Date(updatedAt).toLocaleString() : 'your last backup';
    Alert.alert(
      'Restore your data?',
      `We found a cloud backup from ${when}. Restore it to this device?`,
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Restore', onPress: doRestore },
      ],
    );
  };

  const onSendCode = async () => {
    const r = await requestLoginCode(emailInput);
    if (r.ok) { setPhase('code_sent'); }
    else if (r.reason === 'bad_email') Alert.alert('Check your email', 'That email address doesn’t look right.');
    else Alert.alert('Couldn’t send code', r.reason);
  };

  const onVerify = async () => {
    const r = await verifyLoginCode(emailInput, codeInput);
    if (r.ok) {
      setPhase('signed_out');
      setCodeInput('');
      await promptRestoreIfFresh();
    } else {
      Alert.alert('Couldn’t verify', r.reason === 'verify_failed' ? 'That code didn’t work — try again.' : r.reason);
    }
  };

  // 2026-07-06 (elite audit) — reload IMMEDIATELY after a successful restore.
  // applySnapshot multiSets AsyncStorage, but every already-hydrated store still
  // holds its PRE-restore state in memory — any set() in the gap re-persists the
  // old data over the restored blob, and Android's back button could dismiss the
  // old "tap Reload" Alert entirely, leaving the app in that hazard window
  // indefinitely. No cancelable gap allowed. The fallback Alert only appears when
  // reloadAsync itself fails (dev client) and offers no way to skip the restart.
  const reloadAfterRestore = async () => {
    try {
      await Updates.reloadAsync();
    } catch {
      Alert.alert('Restart needed', 'Your data was restored. Close and reopen the app to finish applying it.');
    }
  };

  const doRestore = async () => {
    const r = await restoreFromCloud();
    if (r.ok) {
      await reloadAfterRestore();
    } else {
      const msg = r.reason === 'no_backup' ? 'No cloud backup found for this account yet.'
        : r.reason === 'newer_version' ? 'That backup was made by a newer version of the app. Update SmartPlay, then restore.'
        : r.reason ?? 'Restore failed.';
      Alert.alert('Nothing to restore', msg);
    }
  };

  const onBackupNow = async () => {
    const r = await backupNow({ force: true });
    if (r.ok) Alert.alert('Backed up', 'Your data is saved to the cloud.');
    else Alert.alert('Backup failed', r.reason);
  };

  const [fileBusy, setFileBusy] = useState(false);
  const onExportFile = async () => {
    setFileBusy(true);
    const r = await exportBackupToFile();
    setFileBusy(false);
    if (!r.ok && r.reason !== 'canceled') Alert.alert('Couldn’t save backup', r.reason ?? 'Export failed.');
  };
  const onImportFile = async () => {
    setFileBusy(true);
    const r = await importBackupFromFile();
    setFileBusy(false);
    if (r.ok) {
      // Same no-gap rule as doRestore — see reloadAfterRestore.
      await reloadAfterRestore();
    } else if (r.reason !== 'canceled') {
      const msg = r.reason === 'not_a_backup' ? 'That file isn’t a SmartPlay backup.'
        : r.reason === 'newer_version' ? 'That backup was made by a newer version of the app. Update SmartPlay, then restore.'
        : r.reason ?? 'Import failed.';
      Alert.alert('Couldn’t restore', msg);
    }
  };

  // ── Server-mediated auto-backup (the OTA path: app → our API → Supabase) ──
  const { backupKey, autoOn, lastBackupAt: serverLastAt, setBackupKey, setAutoOn } = useServerBackupStore();
  const [keyInput, setKeyInput] = useState(backupKey);
  const [serverBusy, setServerBusy] = useState(false);

  const onServerBackup = async () => {
    const k = keyInput.trim().toLowerCase();
    if (!k) { Alert.alert('Add a Backup ID', 'Enter an email as your Backup ID first.'); return; }
    setBackupKey(k);
    setServerBusy(true);
    const r = await serverBackupNow(k);
    setServerBusy(false);
    if (r.ok) Alert.alert('Backed up', 'Your data is saved to your account. It’ll auto-back-up from now on.');
    else Alert.alert('Backup failed', r.reason === 'not_configured' ? 'Cloud isn’t reachable yet — the file backup above still protects you.' : (r.reason ?? 'Try again.'));
  };
  const onServerRestore = async () => {
    const k = keyInput.trim().toLowerCase();
    if (!k) { Alert.alert('Add a Backup ID', 'Enter the email you backed up with.'); return; }
    setBackupKey(k);
    setServerBusy(true);
    const r = await serverRestore(k);
    setServerBusy(false);
    if (r.ok) await reloadAfterRestore();
    else Alert.alert('Nothing to restore', r.reason === 'not_found' ? 'No backup found for that Backup ID yet.' : (r.reason ?? 'Restore failed.'));
  };

  const s = makeStyles(colors);

  return (
    <View style={s.card}>
      <View style={s.headerRow}>
        <Ionicons name="save-outline" size={20} color={colors.accent} style={{ marginRight: 8 }} />
        <Text style={s.title}>Backup & Restore</Text>
      </View>

      {/* ── Local file backup — ALWAYS available, no account/config needed ── */}
      <Text style={s.muted}>
        Save a backup file of your rounds, bag, caddie memory, courses + settings. Keep it in Files / Drive /
        email — restore it any time, even on a new phone. No account needed.
      </Text>
      <View style={s.btnRow}>
        <TouchableOpacity style={[s.btn, { backgroundColor: colors.accent }]} onPress={onExportFile} disabled={fileBusy}>
          {fileBusy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Save backup file</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={[s.btn, s.btnOutline, { borderColor: colors.accent }]} onPress={onImportFile} disabled={fileBusy}>
          <Text style={[s.btnText, { color: colors.accent }]}>Restore from file</Text>
        </TouchableOpacity>
      </View>

      <View style={s.divider} />
      <View style={s.headerRow}>
        <Ionicons name="cloud-outline" size={18} color={colors.text_secondary} style={{ marginRight: 8 }} />
        <Text style={[s.title, { fontSize: 14 }]}>Auto-backup to your account</Text>
      </View>
      <Text style={s.muted}>
        Enter an email as your Backup ID. Your data auto-backs-up and restores on ANY phone with the same ID —
        no password, no sign-in. This is what makes a new phone pick up right where you left off.
      </Text>
      <TextInput
        style={s.input}
        placeholder="you@example.com"
        placeholderTextColor={colors.text_muted}
        value={keyInput}
        onChangeText={setKeyInput}
        autoCapitalize="none"
        keyboardType="email-address"
        autoCorrect={false}
      />
      <Text style={s.muted}>Last cloud backup: {timeAgo(serverLastAt)}</Text>
      <View style={s.toggleRow}>
        <Text style={s.body}>Auto-backup</Text>
        <TouchableOpacity onPress={() => setAutoOn(!autoOn)} style={[s.toggle, { backgroundColor: autoOn ? colors.accent : colors.border }]}>
          <View style={[s.knob, { alignSelf: autoOn ? 'flex-end' : 'flex-start' }]} />
        </TouchableOpacity>
      </View>
      <View style={s.btnRow}>
        <TouchableOpacity style={[s.btn, { backgroundColor: colors.accent }]} onPress={onServerBackup} disabled={serverBusy}>
          {serverBusy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Back up now</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={[s.btn, s.btnOutline, { borderColor: colors.accent }]} onPress={onServerRestore} disabled={serverBusy}>
          <Text style={[s.btnText, { color: colors.accent }]}>Restore</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    card: { backgroundColor: colors.surface_elevated, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 14 },
    headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
    title: { fontSize: 16, fontWeight: '800', color: colors.text_primary },
    body: { fontSize: 14, color: colors.text_primary, marginTop: 4 },
    bold: { fontWeight: '800' },
    muted: { fontSize: 13, color: colors.text_muted, marginTop: 6, lineHeight: 18 },
    input: { marginTop: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: colors.text_primary, fontSize: 15, backgroundColor: colors.background },
    btnRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
    btn: { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
    btnOutline: { backgroundColor: 'transparent', borderWidth: 1.5 },
    btnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
    divider: { height: 1, backgroundColor: colors.border, marginVertical: 16 },
    toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
    toggle: { width: 46, height: 28, borderRadius: 14, padding: 3, justifyContent: 'center' },
    knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff' },
  });
}
