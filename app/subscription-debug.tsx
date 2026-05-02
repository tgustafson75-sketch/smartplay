import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Sentry from '@sentry/react-native';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { trialDaysLeft } from '../services/featureAccess';
import { forcePaywall } from '../services/paywallGuard';

export default function SubscriptionDebugScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    subscription_status,
    first_opened_at,
    trial_started_at,
    setSubscriptionStatus,
    initTrial: _initTrial,
  } = usePlayerProfileStore();

  const daysLeft = trialDaysLeft(trial_started_at);

  const rows: { label: string; value: string }[] = [
    { label: 'subscription_status', value: subscription_status },
    { label: 'first_opened_at', value: first_opened_at ? new Date(first_opened_at).toISOString() : 'null' },
    { label: 'trial_started_at', value: trial_started_at ? new Date(trial_started_at).toISOString() : 'null' },
    { label: 'trial_days_left', value: daysLeft !== null ? String(daysLeft) : 'N/A' },
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Subscription Debug</Text>

        <View style={styles.stateCard}>
          {rows.map(r => (
            <View key={r.label} style={styles.stateRow}>
              <Text style={styles.stateKey}>{r.label}</Text>
              <Text style={styles.stateVal}>{r.value}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.section}>Force Status</Text>

        {(['trial', 'expired', 'active', 'free'] as const).map(s => (
          <TouchableOpacity
            key={s}
            style={[styles.btn, subscription_status === s && styles.btnActive]}
            onPress={() => setSubscriptionStatus(s)}
          >
            <Text style={[styles.btnText, subscription_status === s && styles.btnTextActive]}>
              Set → {s}
            </Text>
          </TouchableOpacity>
        ))}

        <Text style={styles.section}>Actions</Text>

        <TouchableOpacity
          style={styles.btn}
          onPress={() => {
            const sevenDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
            usePlayerProfileStore.setState({ trial_started_at: sevenDaysAgo, subscription_status: 'trial' });
            Alert.alert('Done', 'trial_started_at set 8 days ago — reopen app to expire.');
          }}
        >
          <Text style={styles.btnText}>Force expire (set trial 8 days ago)</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.btn}
          onPress={() => {
            usePlayerProfileStore.setState({
              first_opened_at: null,
              trial_started_at: null,
              subscription_status: 'free',
            });
            Alert.alert('Done', 'Reset to fresh install state.');
          }}
        >
          <Text style={styles.btnText}>Reset to fresh install</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.btn}
          onPress={() => router.push('/paywall' as never)}
        >
          <Text style={styles.btnText}>Trigger paywall screen</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.btn, styles.btnForce]}
          onPress={() => forcePaywall(() => router.push('/paywall' as never))}
        >
          <Text style={[styles.btnText, { color: '#fbbf24' }]}>[DEBUG] Force Paywall Now</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.btn, styles.btnDanger]}
          onPress={() => {
            Sentry.captureException(new Error('[SubscriptionDebug] Manual crash test'));
            Alert.alert('Sent', 'Exception sent to Sentry (if DSN is configured).');
          }}
        >
          <Text style={[styles.btnText, { color: '#ef4444' }]}>Trigger Sentry crash</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.closeBtn} onPress={() => router.back()}>
          <Text style={styles.closeBtnText}>Close</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#060f09',
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  title: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '900',
    marginBottom: 20,
  },
  stateCard: {
    backgroundColor: '#0d2418',
    borderRadius: 12,
    padding: 16,
    gap: 10,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#1e3a28',
  },
  stateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  stateKey: {
    color: '#6b7280',
    fontSize: 12,
    fontFamily: 'monospace',
    flex: 1,
  },
  stateVal: {
    color: '#00C896',
    fontSize: 12,
    fontFamily: 'monospace',
    flex: 2,
    textAlign: 'right',
  },
  section: {
    color: '#6b7280',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 10,
    marginTop: 4,
  },
  btn: {
    backgroundColor: '#0d2418',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1e3a28',
  },
  btnActive: {
    borderColor: '#00C896',
    backgroundColor: '#003d20',
  },
  btnDanger: {
    borderColor: '#ef4444',
    marginTop: 8,
  },
  btnForce: {
    borderColor: '#fbbf24',
    marginTop: 4,
  },
  btnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  btnTextActive: {
    color: '#00C896',
  },
  closeBtn: {
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  closeBtnText: {
    color: '#6b7280',
    fontSize: 14,
  },
});
