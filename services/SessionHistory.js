/**
 * SessionHistory.js
 *
 * Local session storage for practice sessions.
 * Persists to AsyncStorage under 'session-history'.
 *
 * Schema:
 *   [{ id, date, shots, summary, shotShapeData?, missBias? }]
 *
 * API:
 *   saveSession(sessionData)  → Promise<void>
 *   getHistory()              → Promise<SessionEntry[]>
 *   clearHistory()            → Promise<void>
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'session-history';
const MAX_SESSIONS = 50; // cap to prevent unbounded growth

/**
 * @typedef {Object} SessionEntry
 * @property {string}  id           - Unique identifier (timestamp-based)
 * @property {string}  date         - ISO date string
 * @property {number}  shots        - Total shots logged
 * @property {Object}  summary      - { goodCount, leftCount, rightCount, straightPct, confidenceScore }
 * @property {Array}   [shotShapeData] - [{ ballStart, finish }] from ball tracking
 * @property {string}  [missBias]   - 'left' | 'right' | 'neutral'
 * @property {string}  [shapeTrend] - Dominant flight shape
 */

/**
 * Load the raw history array from AsyncStorage.
 * @returns {Promise<SessionEntry[]>}
 */
async function _load() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/**
 * Save sessionData as a new history entry.
 *
 * @param {{
 *   totalShots:    number,
 *   goodShots:     number,
 *   missLeft:      number,
 *   missRight:     number,
 *   shotShapeData?: Array<{ ballStart: string, finish: string }>,
 *   missBias?:     string,
 *   shapeTrend?:   string,
 * }} sessionData
 * @returns {Promise<SessionEntry>} the saved entry
 */
export async function saveSession(sessionData) {
  const {
    totalShots    = 0,
    goodShots     = 0,
    missLeft      = 0,
    missRight     = 0,
    shotShapeData,
    missBias,
    shapeTrend,
  } = sessionData;

  if (totalShots === 0) return null;

  const straightPct = totalShots > 0 ? Math.round((goodShots / totalShots) * 100) : 0;

  // Confidence score: weighted by straight %, penalised for extreme bias
  const biasCount = Math.max(missLeft, missRight);
  const biasRatio = totalShots > 0 ? biasCount / totalShots : 0;
  const rawConfidence = straightPct - Math.round(biasRatio * 30);
  const confidenceScore = Math.max(0, Math.min(100, rawConfidence));

  const entry = {
    id:            `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    date:          new Date().toISOString(),
    shots:         totalShots,
    summary: {
      goodCount:       goodShots,
      leftCount:       missLeft,
      rightCount:      missRight,
      straightPct,
      confidenceScore,
    },
    shotShapeData: shotShapeData ?? [],
    missBias:      missBias ?? 'neutral',
    shapeTrend:    shapeTrend ?? 'neutral',
  };

  const history = await _load();
  const updated = [entry, ...history].slice(0, MAX_SESSIONS);

  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch { /* silent — local store not critical */ }

  return entry;
}

/**
 * Return the full session history, newest first.
 * @returns {Promise<SessionEntry[]>}
 */
export async function getHistory() {
  return _load();
}

/**
 * Return only the most recent N sessions.
 * @param {number} [n=5]
 * @returns {Promise<SessionEntry[]>}
 */
export async function getRecentSessions(n = 5) {
  const history = await _load();
  return history.slice(0, n);
}

/**
 * Delete all stored sessions.
 * @returns {Promise<void>}
 */
export async function clearHistory() {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
