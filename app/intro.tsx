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

export default function Intro() {
  const router = useRouter();
  const { setName, completeSetup } = usePlayerProfileStore();
  const { setVoiceGender } = useSettingsStore();

  const [step, setStep] = useState(0);
  const [playerName, setPlayerName] = useState('');
  const [selectedGender, setSelectedGender] = useState<'male' | 'female'>('male');
  const [selectedCaddie, setSelectedCaddie] = useState<'male' | 'female' | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    fadeAnim.setValue(0);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 800,
      useNativeDriver: true,
    }).start();
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

  const handleCaddieSelect = (gender: 'male' | 'female') => {
    setSelectedGender(gender);
    setVoiceGender(gender);
    goToStep(2);
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

        {/* KEVIN IMAGE */}
        <View style={styles.avatarFrame}>
          <Image
            source={
              selectedGender === 'female'
                ? require('../assets/avatars/serena_portrait.jpg')
                : require('../assets/avatars/kevin_portrait.jpg')
            }
            style={styles.avatarImage}
            resizeMode="contain"
          />
        </View>

        {/* STEP 0 — NAME */}
        {step === 0 && (
          <Animated.View style={[styles.stepContainer, { opacity: fadeAnim }]}>
            <Text style={styles.kevinSays}>Hey. I'm Kevin.</Text>
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
              <Text style={styles.btnText}>That's me</Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* STEP 1 — CADDIE CHOICE */}
        {step === 1 && (
          <Animated.View style={[styles.stepContainer, { opacity: fadeAnim }]}>
            <Text style={styles.kevinSays}>
              {'Good to meet you, ' + playerName + '.'}
            </Text>
            <Text style={styles.kevinSub}>Your caddie — Kevin or Serena?</Text>
            <View style={styles.caddieRow}>
              <TouchableOpacity
                style={[
                  styles.caddieCard,
                  selectedCaddie === 'male' && styles.caddieCardSelected,
                ]}
                onPress={() => {
                  setSelectedCaddie('male');
                  setTimeout(() => handleCaddieSelect('male'), 300);
                }}
                activeOpacity={0.85}
              >
                <Image
                  source={require('../assets/avatars/kevin_portrait.jpg')}
                  style={styles.caddieThumb}
                  resizeMode="cover"
                />
                <Text style={styles.caddieName}>Kevin</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.caddieCard,
                  selectedCaddie === 'female' && styles.caddieCardSelected,
                ]}
                onPress={() => {
                  setSelectedCaddie('female');
                  setTimeout(() => handleCaddieSelect('female'), 300);
                }}
                activeOpacity={0.85}
              >
                <Image
                  source={require('../assets/avatars/serena_portrait.jpg')}
                  style={styles.caddieThumb}
                  resizeMode="cover"
                />
                <Text style={styles.caddieName}>Serena</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        )}

        {/* STEP 2 — READY */}
        {step === 2 && (
          <Animated.View style={[styles.stepContainer, { opacity: fadeAnim }]}>
            <Text style={styles.kevinSays}>
              {selectedGender === 'female'
                ? "I'm Serena. Let's go."
                : "Let's go play some golf."}
            </Text>
            <Text style={styles.kevinSub}>
              You can tell me more about your game as we go.
            </Text>
            <TouchableOpacity style={styles.btn} onPress={handleFinish}>
              <Text style={styles.btnText}>Let's go</Text>
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
  caddieCardSelected: {
    borderColor: '#00C896',
    backgroundColor: '#0d3020',
  },
  caddieThumb: {
    width: '100%',
    height: 180,
    marginBottom: 8,
  },
  caddieName: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
});
