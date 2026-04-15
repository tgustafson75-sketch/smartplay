import { initializeApp, getApps } from 'firebase/app';
import { Auth, initializeAuth, getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = {
  apiKey: 'AIzaSyCphVXA5fd6DVbj2-ktrTOyJiTRn9L6vLc',
  authDomain: 'smartplaycaddie.firebaseapp.com',
  projectId: 'smartplaycaddie',
  storageBucket: 'smartplaycaddie.firebasestorage.app',
  messagingSenderId: '987722432168',
  appId: '1:987722432168:web:0ba689568c80951f318c9d',
};

// Prevent re-initialization on hot reload
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

// Firebase 12 removed getReactNativePersistence — getAuth() handles persistence
// safely in Expo Go / React Native environments.
let auth: Auth;
try {
  auth = initializeAuth(app);
} catch {
  auth = getAuth(app);
}

export { auth };
export const db = getFirestore(app);
export default app;
