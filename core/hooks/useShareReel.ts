/**
 * useShareReel
 *
 * Handles one-tap sharing for the highlight reel.
 *
 * Strategy:
 *  1. If the current clip has a video URI (frameTag) → share the file via
 *     expo-sharing so the native share sheet receives a real media file.
 *  2. If no media file is available → fall back to sharing the text caption
 *     via the RN Share API (works on iOS + Android with no extra deps).
 *  3. Always generates and includes the branded text caption.
 *
 * Returns:
 *  - handleShare(clip, courseName, totalShots, allClips) — async trigger
 *  - shareToast — brief feedback string or null
 *  - clearToast — dismisses the toast
 */

import { useCallback, useRef, useState } from 'react';
import { Share, Platform } from 'react-native';
import * as Sharing from 'expo-sharing';

import { generateShareCaption } from '../../features/replay/CaptionEngine';
import type { ScoredShot } from '../../features/replay/HighlightEngine';

export function useShareReel() {
  const [shareToast, setShareToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setShareToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setShareToast(null), 2500);
  }, []);

  const clearToast = useCallback(() => {
    setShareToast(null);
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const handleShare = useCallback(async (
    clip: ScoredShot | null,
    courseName: string | undefined,
    totalShots: number,
    allClips: ScoredShot[],
  ) => {
    const caption = generateShareCaption({
      courseName,
      shotsLogged: totalShots,
      topShots: allClips,
    });

    // ── Path 1: share actual video file ────────────────────────────────────
    const videoUri = clip?.frameTag?.split('#')[0];
    if (videoUri) {
      try {
        const available = await Sharing.isAvailableAsync();
        if (available) {
          await Sharing.shareAsync(videoUri, {
            dialogTitle: 'Share Highlights',
            mimeType: 'video/mp4',
            UTI: 'public.movie',
          });
          showToast('Shared!');
          return;
        }
      } catch {
        // Fall through to text share
      }
    }

    // ── Path 2: text / caption share (iOS sheet or Android intent) ─────────
    try {
      const result = await Share.share(
        Platform.OS === 'ios'
          ? { message: caption }
          : { message: caption, title: 'SmartCaddie Highlights' },
      );
      if (result.action === Share.sharedAction) {
        showToast('Shared!');
      }
    } catch {
      showToast('Could not share — try again.');
    }
  }, [showToast]);

  return { handleShare, shareToast, clearToast };
}
