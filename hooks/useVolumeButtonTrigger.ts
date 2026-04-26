interface UseVolumeButtonTriggerOptions {
  enabled: boolean;
  onTrigger: () => void;
}

export function useVolumeButtonTrigger(_options: UseVolumeButtonTriggerOptions): void {
  // react-native-volume-manager removed; volume button trigger disabled.
  // Primary voice interaction is avatar tap.
}
