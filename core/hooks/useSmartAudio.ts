/**
 * useSmartAudio
 * Lightweight audio cues for SmartVision interactions.
 * - tap     : soft swing-swoosh for target placement
 * - confirm : ball-in-cup tone for shot detection
 *
 * Safety:
 * - Volume locked to 0.3 (respects ambient feel)
 * - 400ms cooldown prevents overlapping / spam
 * - Each sound is created and unloaded per play (no persistent Sound objects)
 * - All errors silently swallowed — audio is non-critical
 */

import { useCallback, useRef } from 'react';
import { Audio } from 'expo-av';

const TAP_SOUND     = require('../../assets/sounds/swing-swoosh.mp3') as number;
const CONFIRM_SOUND = require('../../assets/sounds/ball-in-cup.wav')  as number;

const VOLUME  = 0.3;
const COOLDOWN_MS = 400;

async function _play(source: number): Promise<void> {
  const { sound } = await Audio.Sound.createAsync(source, { volume: VOLUME });
  await sound.playAsync();
  sound.setOnPlaybackStatusUpdate((status) => {
    if ('didJustFinish' in status && status.didJustFinish) {
      void sound.unloadAsync();
    }
  });
}

export function useSmartAudio() {
  const lastRef = useRef<number>(0);

  const _guardedPlay = useCallback((source: number) => {
    const now = Date.now();
    if (now - lastRef.current < COOLDOWN_MS) return;
    lastRef.current = now;
    _play(source).catch(() => {});
  }, []);

  const playSoundTap     = useCallback(() => _guardedPlay(TAP_SOUND),     [_guardedPlay]);
  const playSoundConfirm = useCallback(() => _guardedPlay(CONFIRM_SOUND), [_guardedPlay]);

  return { playSoundTap, playSoundConfirm };
}
