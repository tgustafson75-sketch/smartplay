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

  const doRestore = async () => {
    const r = await restoreFromCloud();
    if (r.ok) {
      Alert.alert(
        'Restored',
        `Brought back ${r.restored} data set${r.restored === 1 ? '' : 's'}. The app will reload to apply it.`,
        [{ text: 'Reload', onPress: () => { void Updates.reloadAsync().catch(() => {}); } }],
      );
    } else {
      Alert.alert('Nothing to restore', r.reason === 'no_backup' ? 'No cloud backup found for this account yet.' : r.reason ?? 'Restore failed.');
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
      Alert.alert(
        'Restored',
        `Brought back ${r.restored} data set${r.restored === 1 ? '' : 's'} from the file. The app will reload to apply it.`,
        [{ text: 'Reload', onPress: () => { void Updates.reloadAsync().catch(() => {}); } }],
      );
    } else if (r.reason !== 'canceled') {
      const msg = r.reason === 'not_a_backup' ? 'That file isn’t a SmartPlay backup.'
        : r.reason === 'newer_version' ? 'That backup was made by a newer version of the app. Update SmartPlay, then restore.'
        : r.reason ?? 'Import failed.';
      Alert.alert('Couldn’t restore', msg);
    }
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
        <Text style={[s.title, { fontSize: 14 }]}>Auto-sync to your account (optional)</Text>
      </View>

      {!configured ? (
        <Text style={s.muted}>
          Optional: hands-free background sync + one-tap restore on a new phone. Not set up on this build yet —
          the file backup above already protects your data with no account.
        </Text>
      ) : userId ? (
        // ── Signed in ────────────────────────────────────────────
        <>
          <Text style={s.body}>Signed in as <Text style={s.bold}>{email}</Text></Text>
          <Text style={s.muted}>Last backup: {timeAgo(lastBackupAt)}{status === 'backing_up' ? ' · backing up…' : ''}</Text>

          <View style={s.toggleRow}>
            <Text style={s.body}>Auto-backup</Text>
            <TouchableOpacity onPress={() => setAutoBackup(!autoBackupEnabled)} style={[s.toggle, { backgroundColor: autoBackupEnabled ? colors.accent : colors.border }]}>
              <View style={[s.knob, { alignSelf: autoBackupEnabled ? 'flex-end' : 'flex-start' }]} />
            </TouchableOpacity>
          </View>

          <View style={s.btnRow}>
            <TouchableOpacity style={[s.btn, { backgroundColor: colors.accent }]} onPress={onBackupNow} disabled={busy}>
              {status === 'backing_up' ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Back up now</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={[s.btn, s.btnOutline, { borderColor: colors.accent }]} onPress={doRestore} disabled={busy}>
              {status === 'restoring' ? <ActivityIndicator color={colors.accent} /> : <Text style={[s.btnText, { color: colors.accent }]}>Restore</Text>}
            </TouchableOpacity>
          </View>
          <TouchableOpacity onPress={signOutCloud} style={{ marginTop: 10 }}>
            <Text style={[s.muted, { color: colors.text_secondary }]}>Sign out</Text>
          </TouchableOpacity>
        </>
      ) : phase === 'signed_out' ? (
        // ── Signed out — enter email ─────────────────────────────
        <>
          <Text style={s.muted}>Sign in with your email to back up + restore your data. We’ll send a one-time code — no password.</Text>
          <TextInput
            style={s.input}
            placeholder="you@example.com"
            placeholderTextColor={colors.text_muted}
            value={emailInput}
            onChangeText={setEmailInput}
            autoCapitalize="none"
            keyboardType="email-address"
            autoCorrect={false}
          />
          <TouchableOpacity style={[s.btn, { backgroundColor: colors.accent, marginTop: 10 }]} onPress={onSendCode} disabled={busy || emailInput.trim().length === 0}>
            {status === 'sending_code' ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Send code</Text>}
          </TouchableOpacity>
        </>
      ) : (
        // ── Code sent — enter code ───────────────────────────────
        <>
          <Text style={s.muted}>Enter the 6-digit code we sent to <Text style={s.bold}>{emailInput}</Text>.</Text>
          <TextInput
            style={s.input}
            placeholder="123456"
            placeholderTextColor={colors.text_muted}
            value={codeInput}
            onChangeText={setCodeInput}
            keyboardType="number-pad"
            maxLength={8}
          />
          <View style={s.btnRow}>
            <TouchableOpacity style={[s.btn, { backgroundColor: colors.accent }]} onPress={onVerify} disabled={busy || codeInput.trim().length < 4}>
              {status === 'verifying' ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Verify</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={[s.btn, s.btnOutline, { borderColor: colors.border }]} onPress={() => { setPhase('signed_out'); setCodeInput(''); }} disabled={busy}>
              <Text style={[s.btnText, { color: colors.text_secondary }]}>Back</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {status === 'error' && lastError ? <Text style={[s.muted, { color: '#ef4444' }]}>{lastError}</Text> : null}
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
