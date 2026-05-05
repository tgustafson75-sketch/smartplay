import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { useSettingsStore } from '../store/settingsStore';
import { getCaddieName, type Persona } from '../lib/persona';

export default function Intro() {
  const router = useRouter();
  const { setName, completeSetup } = usePlayerProfileStore();
  const persistedPersona = useSettingsStore(s => s.caddiePersonality);
  const setCaddiePersonality = useSettingsStore(s => s.setCaddiePersonality);

  const [step, setStep] = useState(0);
  const [playerName, setPlayerName] = useState('');
  // If the user previously chose a persona, default Step 0's "Hey. I'm X."
  // greeting to that one. First-launch users default to Kevin.
  const [selectedPersona, setSelectedPersona] = useState<Persona>(persistedPersona ?? 'kevin');
  const [pendingPersona, setPendingPersona] = useState<Persona | null>(null);
  const introCaddieName = getCaddieName(selectedPersona);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    fadeAnim.setValue(0);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 800,
      useNativeDriver: true,
    }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const goToStep = (n: number) => {
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      setStep(n);
    });
  };

  const handleNameSubmit = () => {
    if (!playerName.trim()) return;
    setName(playerName.trim());
    goToStep(1);
  };

  const handleCaddieSelect = (p: Persona) => {
    setSelectedPersona(p);
    setCaddiePersonality(p);
    goToStep(2);
  };

  // Persona-aware "I'm X. Let's go." for Step 2.
  const step2OpenLine = (() => {
    switch (selectedPersona) {
      case 'serena': return "I'm Serena. Let's go.";
      case 'harry':  return "I'm Harry. Let's play some golf.";
      case 'tank':   return "I'm Tank. Let's GO.";
      case 'kevin':
      default:       return "I'm Kevin. Let's go play some golf.";
    }
  })();

  // Avatar source per persona (uses primary portraits — Tank/Harry will
  // fall back to studio portrait until per-state assets land).
  const portraitFor = (p: Persona) => {
    switch (p) {
      case 'serena': return require('../assets/avatars/serena_portrait.jpg');
      case 'harry':  return require('../assets/avatars/harry_portrait.png');
      case 'tank':   return require('../assets/avatars/tank_portrait.png');
      case 'kevin':
      default:       return require('../assets/avatars/kevin_portrait.jpg');
    }
  };

  const handleFinish = () => {
    completeSetup();
    router.replace('/(tabs)/caddie');
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.inner}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >

        {/* CADDIE IMAGE — switches with selectedPersona */}
        <View style={styles.avatarFrame}>
          <Image
            source={portraitFor(selectedPersona)}
            style={styles.avatarImage}
            resizeMode="contain"
          />
        </View>

        {/* STEP 0 — NAME */}
        {step === 0 && (
          <Animated.View style={[styles.stepContainer, { opacity: fadeAnim }]}>
            <Text style={styles.kevinSays}>Hey. I&apos;m {introCaddieName}.</Text>
            <Text style={styles.kevinSub}>What should I call you?</Text>
            <TextInput
              style={styles.nameInput}
              placeholder="Your first name"
              placeholderTextColor="#374151"
              value={playerName}
              onChangeText={setPlayerName}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleNameSubmit}
              autoCapitalize="words"
            />
            <TouchableOpacity
              style={[styles.btn, !playerName.trim() && styles.btnDisabled]}
              onPress={handleNameSubmit}
              disabled={!playerName.trim()}
            >
              <Text style={styles.btnText}>That&apos;s me</Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* STEP 1 — CADDIE CHOICE (4-card 2x2 grid) */}
        {step === 1 && (
          <Animated.View style={[styles.stepContainer, { opacity: fadeAnim }]}>
            <Text style={styles.kevinSays}>
              {'Good to meet you, ' + playerName + '.'}
            </Text>
            <Text style={styles.kevinSub}>You have a team of four caddies. Pick whoever you want greeting you first — we&apos;ll set sensible defaults for the rest of your game (Cage, Drills, Play). Customize anytime in Settings.</Text>
            <View style={styles.caddieGrid}>
              {(['kevin', 'serena', 'harry', 'tank'] as Persona[]).map(p => (
                <TouchableOpacity
                  key={p}
                  style={[
                    styles.caddieCardSmall,
                    pendingPersona === p && styles.caddieCardSelected,
                  ]}
                  onPress={() => {
                    setPendingPersona(p);
                    setTimeout(() => handleCaddieSelect(p), 300);
                  }}
                  activeOpacity={0.85}
                >
                  <Image
                    source={portraitFor(p)}
                    style={styles.caddieThumbSmall}
                    resizeMode="cover"
                  />
                  <Text style={styles.caddieName}>{getCaddieName(p)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </Animated.View>
        )}

        {/* STEP 2 — READY */}
        {step === 2 && (
          <Animated.View style={[styles.stepContainer, { opacity: fadeAnim }]}>
            <Text style={styles.kevinSays}>{step2OpenLine}</Text>
            <Text style={styles.kevinSub}>
              You can tell me more about your game as we go.
            </Text>
            <TouchableOpacity style={styles.btn} onPress={handleFinish}>
              <Text style={styles.btnText}>Let&apos;s go</Text>
            </TouchableOpacity>
          </Animated.View>
        )}

      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#060f09',
  },
  inner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  avatarFrame: {
    width: 240,
    height: 300,
    marginBottom: 24,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#060f09',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  stepContainer: {
    width: '100%',
    alignItems: 'center',
  },
  kevinSays: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '900',
    lineHeight: 34,
    textAlign: 'center',
    marginBottom: 8,
  },
  kevinSub: {
    color: '#6b7280',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 24,
  },
  nameInput: {
    width: '100%',
    backgroundColor: '#0d2418',
    borderWidth: 1.5,
    borderColor: '#1e3a28',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 20,
    color: '#ffffff',
    fontSize: 18,
    marginBottom: 16,
    textAlign: 'center',
  },
  btn: {
    width: '100%',
    backgroundColor: '#00C896',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  btnDisabled: {
    backgroundColor: '#1e3a28',
    opacity: 0.5,
  },
  btnText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '800',
  },
  caddieRow: {
    flexDirection: 'row',
    gap: 16,
    width: '100%',
  },
  // 2x2 grid layout — flex-wrap with calc(50%-gap) per card so
  // four cards fit two-per-row on Fold-closed and standard phones.
  caddieGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    width: '100%',
    justifyContent: 'center',
  },
  caddieCard: {
    flex: 1,
    backgroundColor: '#0d2418',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#1e3a28',
    overflow: 'hidden',
    alignItems: 'center',
    paddingBottom: 12,
  },
  caddieCardSmall: {
    width: '47%',
    backgroundColor: '#0d2418',
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#1e3a28',
    overflow: 'hidden',
    alignItems: 'center',
    paddingBottom: 10,
  },
  caddieCardSelected: {
    borderColor: '#00C896',
    backgroundColor: '#0d3020',
  },
  caddieThumb: {
    width: '100%',
    height: 180,
    marginBottom: 8,
  },
  caddieThumbSmall: {
    width: '100%',
    height: 130,
    marginBottom: 6,
  },
  caddieName: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
});
