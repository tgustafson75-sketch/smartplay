import React, { memo } from 'react';
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';
import { View } from 'react-native';

const ShotVideoPlayer = memo(function ShotVideoPlayer({
  uri,
  onReadyForDisplay,
  onFinished,
}: {
  uri: string;
  onReadyForDisplay?: () => void;
  onFinished?: () => void;
}) {
  const handleStatus = (status: AVPlaybackStatus) => {
    if (status.isLoaded && status.didJustFinish) onFinished?.();
  };

  return (
    <View style={{ width: '100%', height: 300 }}>
      <Video
        source={{ uri }}
        style={{ flex: 1 }}
        resizeMode={ResizeMode.COVER}
        shouldPlay
        isLooping={false}
        onReadyForDisplay={onReadyForDisplay}
        onPlaybackStatusUpdate={handleStatus}
      />
    </View>
  );
});

export default ShotVideoPlayer;
