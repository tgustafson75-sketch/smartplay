/**
 * YouTube link helper.
 *
 * Wraps Linking.openURL with canOpenURL pre-flight + user-visible Alert
 * fallback so taps that fail to launch (rare on YouTube web URLs, but
 * possible on locked-down devices, kiosk profiles, restricted-mode
 * Android, missing default browser, etc.) don't silently no-op. Mirrors
 * the shape of services/teeTimeLink.ts so external-link calls stay
 * consistent.
 *
 * On a successful open, the OS chooser surfaces the YouTube app first
 * when installed, then web. We use the canonical https URL form rather
 * than youtube:// so iOS Safari + Android Chrome both handle gracefully
 * when the app isn't installed.
 */

import { Alert, Linking } from 'react-native';

const FAILURE_TITLE = 'Couldn’t open YouTube';
const FAILURE_BODY = 'YouTube is unreachable on this device right now. You can also search the title in your browser.';

async function safeOpen(url: string, label: string): Promise<void> {
  try {
    const can = await Linking.canOpenURL(url);
    if (!can) {
      console.log(`[youtubeLinks] canOpenURL=false for ${label}`);
      Alert.alert(FAILURE_TITLE, FAILURE_BODY);
      return;
    }
    await Linking.openURL(url);
  } catch (e) {
    console.log(`[youtubeLinks] ${label} openURL failed:`, e);
    Alert.alert(FAILURE_TITLE, FAILURE_BODY);
  }
}

/** Open a YouTube search results page for an instructional query. */
export async function openYouTubeSearch(query: string): Promise<void> {
  const q = encodeURIComponent(query.trim());
  if (!q) return;
  const url = `https://www.youtube.com/results?search_query=${q}`;
  await safeOpen(url, 'search');
}

/** Open a YouTube channel by handle (e.g. "@smartplaycaddie"). */
export async function openYouTubeChannel(handle: string): Promise<void> {
  const h = handle.trim();
  if (!h) return;
  const slug = h.startsWith('@') ? h : `@${h}`;
  const url = `https://www.youtube.com/${encodeURIComponent(slug)}`;
  await safeOpen(url, 'channel');
}
