/**
 * LockScreen.tsx
 *
 * Fullscreen biometric / passcode gate shown when the app requires
 * re-authentication. Designed to be fast, low-distraction, and
 * compatible with Low Power Mode (no animations on mount).
 *
 * Props:
 *   onUnlock  — called with no args when auth succeeds
 */

import { useState, useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  Image,
} from 'react-native';
import { authenticateUser, getSupportedTypes } from '../services/BiometricService';
import * as LocalAuthentication from 'expo-local-authentication';

const LOGO = require('../assets/images/logo.png');

interface LockScreenProps {
  onUnlock: () => void;
}

export default function LockScreen({ onUnlock }: LockScreenProps) {
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [btnLabel,  setBtnLabel]  = useState('Use Face ID / Fingerprint');

  // Customise button label based on what the device actually supports
  useEffect(() => {
    getSupportedTypes().then((types) => {
      const hasFace = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
      const hasFingerprint = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);
      if (hasFace && hasFingerprint) {
        setBtnLabel('Use Face ID / Fingerprint');
      } else if (hasFace) {
        setBtnLabel('Use Face ID');
      } else if (hasFingerprint) {
        setBtnLabel('Use Fingerprint');
      } else {
        setBtnLabel('Use Passcode');
      }
    });
  }, []);

  // Auto-prompt on mount for fastest path to unlock
  useEffect(() => {
    handleUnlock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUnlock = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const success = await authenticateUser();
      if (success) {
        onUnlock();
      } else {
        setError('Authentication failed. Please try again.');
      }
    } catch {
      setError('Authentication error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        {/* Logo */}
        <Image source={LOGO} style={styles.logo} resizeMode="contain" />

        <Text style={styles.title}>Unlock Caddie</Text>
        <Text style={styles.subtitle}>Secure access enabled</Text>

        {/* Auth button */}
        <Pressable
          onPress={handleUnlock}
          disabled={loading}
          style={({ pressed }) => [
            styles.button,
            pressed && styles.buttonPressed,
            loading && styles.buttonDisabled,
          ]}
        >
          {loading ? (
            <ActivityIndicator color="#0B3D2E" size="small" />
          ) : (
            <Text style={styles.buttonText}>{btnLabel}</Text>
          )}
        </Pressable>

        {/* Error message */}
        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0f0a',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#111a11',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#2d6a4f',
    padding: 32,
    alignItems: 'center',
    gap: 16,
    shadowColor: '#000',
    shadowOpacity: 0.6,
    shadowRadius: 20,
    elevation: 10,
  },
  logo: {
    width: 72,
    height: 72,
    marginBottom: 4,
  },
  title: {
    color: '#A7F3D0',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  subtitle: {
    color: '#6b7280',
    fontSize: 13,
    textAlign: 'center',
  },
  button: {
    marginTop: 8,
    width: '100%',
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: '#A7F3D0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    backgroundColor: '#6ee7b7',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#0B3D2E',
    fontSize: 15,
    fontWeight: '800',
  },
  errorBox: {
    width: '100%',
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ef4444',
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  errorText: {
    color: '#fca5a5',
    fontSize: 13,
    textAlign: 'center',
  },
});
