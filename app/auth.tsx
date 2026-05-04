import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform, Image } from 'react-native';
import { Audio } from 'expo-av';
import { useRouter } from 'expo-router';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { setDoc, getDoc, doc } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth, db } from '../lib/firebase';
import { useUserStore } from '../store/userStore';
import { usePlayerProfileStore } from '../store/playerProfileStore';

export default function AuthScreen() {
  const router = useRouter();
  const setIsGuest = useUserStore((s) => s.setIsGuest);
  const setName = useUserStore((s) => s.setName);
  const setFirstName = useUserStore((s) => s.setFirstName);
  const setLastName = useUserStore((s) => s.setLastName);
  const setDisplayName = useUserStore((s) => s.setDisplayName);
  const setHandicap = useUserStore((s) => s.setHandicap);
  const setOnboardingComplete = useUserStore((s) => s.setOnboardingComplete);
  const setProfileComplete = usePlayerProfileStore((s) => s.setProfileComplete);

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstNameInput] = useState('');
  const [lastName, setLastNameInput] = useState('');
  const [displayNameInput, setDisplayNameInput] = useState('');
  const [handicap, setHandicapInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resetSent, setResetSent] = useState(false);

  const handleResetPassword = async () => {
    if (!email.trim()) { setError('Enter your email above, then tap Reset Password.'); return; }
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setResetSent(true);
      setError('');
    } catch {
      setError('Could not send reset email. Check the address and try again.');
    }
  };

  const playLoginSound = async () => {
    try {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync(require('../assets/sounds/ball-in-cup.wav'), {
        shouldPlay: true,
        volume: 0.9,
      });
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) void sound.unloadAsync();
      });
    } catch {
      // no-op
    }
  };

  const handleSubmit = async () => {
    setError('');
    if (!email.trim() || !password) {
      setError('Please enter your email and password.');
      return;
    }
    setLoading(true);
    try {
      if (mode === 'register') {
        if (!firstName.trim() || !lastName.trim()) {
          setError('Please enter your first and last name.');
          setLoading(false);
          return;
        }
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        const chosenDisplay = displayNameInput.trim() || firstName.trim();
        const hcp = parseFloat(handicap) || 0;
        setFirstName(firstName.trim());
        setLastName(lastName.trim());
        setDisplayName(chosenDisplay);
        setName(chosenDisplay);
        setHandicap(hcp);
        // merge:true so v2 never clobbers fields the production v3 app may
        // have written to this same shared Firestore document. v2 only adds
        // the bootstrap fields it owns.
        await setDoc(doc(db, 'users', cred.user.uid), {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          displayName: chosenDisplay,
          name: chosenDisplay,
          email: email.trim(),
          handicap: hcp,
        }, { merge: true });
        setIsGuest(false);
        setOnboardingComplete(true);
        setProfileComplete(true);
        void AsyncStorage.multiSet([['introSeen', '1'], ['intro_completed', '1']]);
        void playLoginSound();
        router.replace('/tabs/caddie' as any);
        return;
      } else {
        const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
        const snap = await getDoc(doc(db, 'users', cred.user.uid));
        if (snap.exists()) {
          const data = snap.data();
          if (data.name) setName(data.name);
          if (typeof data.handicap === 'number') setHandicap(data.handicap);
        }
      }
      setIsGuest(false);
      void playLoginSound();
      router.replace('/tabs/caddie');
    } catch (e: any) {
      const code: string = e?.code ?? '';
      if (code === 'auth/email-already-in-use') setError('That email is already registered. Try logging in.');
      else if (code === 'auth/invalid-email') setError('Please enter a valid email address.');
      else if (code === 'auth/weak-password') setError('Password must be at least 6 characters.');
      else if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') setError('Incorrect email or password.');
      else setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const continueAsGuest = () => {
    setIsGuest(true);
    void playLoginSound();
    router.replace('/tabs/caddie');
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Image source={require('../assets/images/logo-transparent.png')} style={styles.logo} resizeMode="cover" />
      <Text style={styles.title}>
        <Text style={{ color: '#A7F3D0' }}>SmartPlay</Text>
        <Text style={{ color: '#fff' }}> Caddie</Text>
      </Text>
      <Text style={styles.tagline}>REAL-TIME CADDIE INTELLIGENCE</Text>
      <Text style={styles.subtitle}>{mode === 'login' ? 'Welcome back' : "Let's get started"}</Text>

      <TextInput
        style={styles.input}
        placeholder="Email"
        placeholderTextColor="#888"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        placeholderTextColor="#888"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      {mode === 'register' && (
        <>
          <View style={{ flexDirection: 'row', gap: 10, width: '100%' }}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder="First Name"
              placeholderTextColor="#888"
              autoCapitalize="words"
              value={firstName}
              onChangeText={setFirstNameInput}
            />
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder="Last Name"
              placeholderTextColor="#888"
              autoCapitalize="words"
              value={lastName}
              onChangeText={setLastNameInput}
            />
          </View>
          <TextInput
            style={styles.input}
            placeholder="Display Name (e.g. TigerG)"
            placeholderTextColor="#888"
            autoCapitalize="none"
            value={displayNameInput}
            onChangeText={(t) => setDisplayNameInput(t)}
          />
          <Text style={{ color: '#6ee7b7', fontSize: 11, alignSelf: 'flex-start', marginTop: -8, marginBottom: 10 }}>
            Display name is shown throughout the app. Defaults to first name if left blank.
          </Text>
          <TextInput
            style={styles.input}
            placeholder="Handicap Index (e.g. 18.5)"
            placeholderTextColor="#888"
            keyboardType="numeric"
            value={handicap}
            onChangeText={setHandicapInput}
          />
        </>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity style={styles.button} onPress={handleSubmit} disabled={loading}>
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>{mode === 'login' ? 'Login' : 'Register'}</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity onPress={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); setResetSent(false); }}>
        <Text style={styles.toggle}>
          {mode === 'login' ? "Don't have an account? Register" : 'Already have an account? Login'}
        </Text>
      </TouchableOpacity>

      {mode === 'login' && (
        <TouchableOpacity onPress={() => { void handleResetPassword(); }} style={{ marginTop: 4, paddingVertical: 6 }}>
          <Text style={{ color: resetSent ? '#4ade80' : '#6ee7b7', fontSize: 13, textAlign: 'center' }}>
            {resetSent ? '✅ Reset email sent — check your inbox' : 'Forgot password? Reset it'}
          </Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={[styles.button, styles.buttonGuest]} onPress={continueAsGuest}>
        <Text style={[styles.buttonText, styles.buttonTextGuest]}>Continue as Guest</Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => { setIsGuest(true); void playLoginSound(); router.replace('/tabs/caddie'); }}
        style={{ marginTop: 8, paddingVertical: 6 }}
      >
        <Text style={styles.skipAllText}>Skip all intake questions →</Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B3D2E',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  logo: {
    width: 120,
    height: 120,
    marginBottom: 16,
    borderRadius: 999,
    overflow: 'hidden',
  },
  title: {
    fontSize: 28,
    fontFamily: 'Outfit_700Bold',
    color: '#A7F3D0',
    marginBottom: 4,
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
  tagline: {
    fontSize: 13,
    fontFamily: 'Outfit_600SemiBold',
    color: '#A7F3D0',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 2,
    opacity: 0.75,
  },
  supporting: {
    fontSize: 13,
    fontFamily: 'Outfit_400Regular',
    color: 'rgba(255,255,255,0.55)',
    textAlign: 'center',
    marginBottom: 20,
    paddingHorizontal: 8,
  },
  subtitle: {
    fontSize: 16,
    fontFamily: 'Outfit_400Regular',
    color: '#66bb6a',
    marginBottom: 24,
  },
  input: {
    width: '100%',
    backgroundColor: '#ffffff',
    color: '#111',
    borderWidth: 1,
    borderColor: '#2e7d32',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    marginBottom: 10,
  },
  error: {
    color: '#ef5350',
    marginBottom: 12,
    textAlign: 'center',
    fontSize: 13,
  },
  button: {
    backgroundColor: '#2e7d32',
    width: '100%',
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 10,
    marginTop: 2,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 15,
    fontFamily: 'Outfit_700Bold',
  },
  toggle: {
    color: '#66bb6a',
    fontSize: 14,
    fontFamily: 'Outfit_400Regular',
    marginBottom: 14,
    textDecorationLine: 'underline',
  },
  buttonGuest: {
    backgroundColor: '#2e7d32',
    borderWidth: 1,
    borderColor: '#2e7d32',
    marginBottom: 0,
  },
  buttonTextGuest: {
    color: '#ffffff',
    fontWeight: '500',
  },
  skipAllText: {
    color: 'rgba(255,255,255,0.38)',
    fontSize: 12,
    textAlign: 'center',
    fontFamily: 'Outfit_400Regular',
  },
});

