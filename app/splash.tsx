import { View, Text, Pressable, StyleSheet, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { Audio } from 'expo-av';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useState, useEffect } from 'react';

export default function LandingScreen() {
  const router = useRouter();
  const profileComplete = usePlayerProfileStore((s) => s.profileComplete);
  const [hasDraft, setHasDraft] = useState(false);

  const playStartRoundSound = async () => {
    try {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync(require('../assets/sounds/swing-swoosh.mp3'), {
        shouldPlay: true,
        volume: 0.85,
      });
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) void sound.unloadAsync();
      });
    } catch {
      // no-op
    }
  };

  // Only show "Resume Round" if there's an actual draft in storage
  useEffect(() => {
    AsyncStorage.getItem('draftShots').then((v) => {
      if (v) { try { setHasDraft((JSON.parse(v) as any[]).length > 0); } catch { /* ignore */ } }
    });
  }, []);

  return (
    <View style={styles.container}>

      {/* Branding */}
      <View style={styles.top}>
        <Image source={require('../assets/images/logo.png')} style={{ width: 80, height: 80, marginBottom: 10, borderRadius: 999, overflow: 'hidden' }} resizeMode="cover" />
        <Text style={styles.logo}>SmartPlay Caddie</Text>
        <Text style={styles.tagline}>The intelligent approach to better golf.</Text>
      </View>

      {/* Value prop */}
      <View style={styles.middle}>
        <Text style={styles.value}>Club selection. Shot tracking. Real-time coaching.</Text>
      </View>

      {/* Bottom actions */}
      <View style={styles.bottom}>

        {/* Resume round — only shows when a real draft exists */}
        {hasDraft && (
          <Pressable
            onPress={() => router.push('/(tabs)/play')}
            style={({ pressed }) => [styles.btn, styles.btnResume, pressed && { opacity: 0.85 }]}
          >
            <Text style={[styles.btnText, { color: '#000' }]}>Resume Round</Text>
          </Pressable>
        )}

        {/* Start new round */}
        <Pressable
          onPress={() => { void playStartRoundSound(); router.push('/(tabs)/play'); }}
          style={({ pressed }) => [styles.btn, styles.btnPrimary, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.btnText}>Start Round</Text>
        </Pressable>

        {/* Practice mode */}
        <Pressable
          onPress={() => router.push('/(tabs)/practice')}
          style={({ pressed }) => [styles.btn, styles.btnSecondary, pressed && { opacity: 0.85 }]}
        >
          <Text style={[styles.btnText, { color: '#ccc' }]}>Practice Mode</Text>
        </Pressable>

        {/* Player profile nudge */}
        <Pressable
          onPress={() => router.push('/profile-setup')}
          style={({ pressed }) => [styles.btn, styles.btnProfile, pressed && { opacity: 0.8 }]}
        >
          <Text style={[styles.btnText, { color: profileComplete ? '#A7F3D0' : '#FFD700', fontSize: 14 }]}>
            {profileComplete ? 'Update My Profile' : '+ Set Up My Profile'}
          </Text>
        </Pressable>

      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B3D2E',
    justifyContent: 'space-between',
    padding: 28,
  },
  top: {
    alignItems: 'center',
    marginTop: 80,
  },
  logo: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  tagline: {
    color: '#A7F3D0',
    fontSize: 15,
    marginTop: 8,
    textAlign: 'center',
  },
  middle: {
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  value: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
  },
  bottom: {
    gap: 10,
    marginBottom: 20,
  },
  btn: {
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  btnResume: {
    backgroundColor: '#66bb6a',
  },
  btnPrimary: {
    backgroundColor: '#2e7d32',
  },
  btnSecondary: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  btnProfile: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.3)',
  },
  btnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
