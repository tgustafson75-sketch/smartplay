import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

const DEBOUNCE_MS = 800;

interface UseVolumeButtonTriggerOptions {
  enabled: boolean;
  onTrigger: () => void;
}

export function useVolumeButtonTrigger({
  enabled,
  onTrigger,
}: UseVolumeButtonTriggerOptions): void {
  if (Platform.OS === 'web') return;

  const lastTriggerRef = useRef<number>(0);
  const onTriggerRef   = useRef(onTrigger);
  useEffect(() => { onTriggerRef.current = onTrigger; }, [onTrigger]);

  useEffect(() => {
    if (!enabled) return;

    let VolumeManager: { addVolumeListener: (cb: (r: { volume: number }) => void) => { remove: () => void } } | null = null;

    try {
      // Guard against missing native module (Expo Go, web)
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      VolumeManager = require('react-native-volume-manager').VolumeManager;
    } catch {
      console.log('[VolumeButton] react-native-volume-manager not available');
      return;
    }

    if (!VolumeManager) return;

    const sub = VolumeManager.addVolumeListener(() => {
      const now = Date.now();
      if (now - lastTriggerRef.current < DEBOUNCE_MS) return;
      lastTriggerRef.current = now;
      onTriggerRef.current();
    });

    return () => {
      sub.remove();
    };
  }, [enabled]);
}
