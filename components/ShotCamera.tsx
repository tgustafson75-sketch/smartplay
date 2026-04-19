import { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';

interface ShotCameraProps {
  onCapture: (uri: string) => void;
}

export default function ShotCamera({ onCapture }: ShotCameraProps) {
  const cameraRef = useRef<CameraView>(null);
  const [recording, setRecording] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  const record = async () => {
    if (!cameraRef.current || recording) return;
    // Request permission if not yet granted — if denied, close modal gracefully
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        onCapture(''); // empty string signals caller to close modal
        return;
      }
    }
    setRecording(true);
    try {
      const video = await cameraRef.current.recordAsync({ maxDuration: 6 });
      if (video?.uri) {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onCapture(video.uri);
      }
    } catch {
      // recordAsync can throw if camera hardware is unavailable — close modal gracefully
      onCapture('');
    } finally {
      setRecording(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <CameraView
        ref={cameraRef}
        style={{ flex: 1 }}
        facing={'back' as CameraType}
        mode="video"
      />
      <Pressable
        onPress={record}
        disabled={recording}
        style={{
          position: 'absolute',
          bottom: 24,
          alignSelf: 'center',
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: recording ? '#C0392B' : '#FFFFFF',
          borderWidth: 3,
          borderColor: recording ? '#ff6b6b' : '#ccc',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <Text style={{ fontSize: 10, color: recording ? '#fff' : '#333', fontWeight: '600' }}>
          {recording ? 'REC' : 'RECORD'}
        </Text>
      </Pressable>
    </View>
  );
}
