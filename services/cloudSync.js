/**
 * cloudSync.js
 *
 * One-way sync of key player data to Firestore.
 * Called after data changes — never blocks the UI.
 * All calls are fire-and-forget with silent error handling.
 *
 * Restore (new device) is called once on login
 * to pull cloud data back into AsyncStorage.
 *
 * v2-isolation: This app shares the `smartplaycaddie` Firestore project
 * with the production v3 app. To guarantee v2 never overwrites v3's user
 * data on the canonical `users/{uid}/profile/...` path, all WRITES go to
 * a namespaced `users/{uid}/_v2_preview/profile/...` subtree. READS try
 * v2's namespace first and fall back to the canonical path so a v2 build
 * inherits v3's existing data on first launch but never mutates it.
 */

import { doc, setDoc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import AsyncStorage from '@react-native-async-storage/async-storage';

// clubTracker.js uses this key
const CLUB_KEY = 'clubTrackerData';
// handicapTracker.js uses this key
const HCP_KEY  = 'handicapDifferentials';

// Namespace prefix so v2 writes never overlap v3's canonical path.
const V2_NS = '_v2_preview';

// ── PUSH (local → cloud) ─────────────────────────────────────────────────────

export async function syncClubDistances(userId) {
  if (!userId) return;
  try {
    const raw = await AsyncStorage.getItem(CLUB_KEY);
    if (!raw) return;
    await setDoc(
      doc(db, 'users', userId, V2_NS, 'profile', 'clubDistances'),
      { data: raw, updatedAt: new Date().toISOString() },
      { merge: true }
    );
  } catch {}
}

export async function syncHandicapDifferentials(userId) {
  if (!userId) return;
  try {
    const raw = await AsyncStorage.getItem(HCP_KEY);
    if (!raw) return;
    await setDoc(
      doc(db, 'users', userId, V2_NS, 'profile', 'handicapDifferentials'),
      { data: raw, updatedAt: new Date().toISOString() },
      { merge: true }
    );
  } catch {}
}

export async function syncPlayerSettings(userId, settings) {
  if (!userId) return;
  try {
    await setDoc(
      doc(db, 'users', userId, V2_NS, 'profile', 'settings'),
      { ...settings, updatedAt: new Date().toISOString() },
      { merge: true }
    );
  } catch {}
}

// ── PULL (cloud → local, new device restore) ─────────────────────────────────

/**
 * Pull cloud data into AsyncStorage — only writes when local key is absent.
 * Returns { restored: boolean, settings?: object }
 */
export async function restoreFromCloud(userId) {
  if (!userId) return { restored: false };
  let restored = false;

  // Try v2's namespace first; fall back to v3's canonical path so a v2
  // preview build inherits the production user's existing cloud data on
  // first launch.
  const tryGet = async (...pathSegs) => {
    try {
      const ref = doc(db, ...pathSegs);
      const snap = await getDoc(ref);
      return snap.exists() ? snap : null;
    } catch { return null; }
  };

  try {
    // Club distances
    const clubSnap =
      (await tryGet('users', userId, V2_NS, 'profile', 'clubDistances')) ??
      (await tryGet('users', userId, 'profile', 'clubDistances'));
    if (clubSnap?.data()?.data) {
      const existing = await AsyncStorage.getItem(CLUB_KEY);
      if (!existing) {
        await AsyncStorage.setItem(CLUB_KEY, clubSnap.data().data);
        restored = true;
      }
    }

    // Handicap differentials
    const hcpSnap =
      (await tryGet('users', userId, V2_NS, 'profile', 'handicapDifferentials')) ??
      (await tryGet('users', userId, 'profile', 'handicapDifferentials'));
    if (hcpSnap?.data()?.data) {
      const existing = await AsyncStorage.getItem(HCP_KEY);
      if (!existing) {
        await AsyncStorage.setItem(HCP_KEY, hcpSnap.data().data);
        restored = true;
      }
    }

    // Player settings
    const settingsSnap =
      (await tryGet('users', userId, V2_NS, 'profile', 'settings')) ??
      (await tryGet('users', userId, 'profile', 'settings'));
    if (settingsSnap) {
      return { restored, settings: settingsSnap.data() };
    }
  } catch {}
  return { restored };
}
