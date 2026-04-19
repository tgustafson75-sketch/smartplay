import { useState, useEffect } from 'react';
import { Camera } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';

export function useCameraPermissions() {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      const camera = await Camera.requestCameraPermissionsAsync();
      const media = await MediaLibrary.requestPermissionsAsync();
      setHasPermission(camera.status === 'granted' && media.status === 'granted');
    })();
  }, []);

  return hasPermission;
}
