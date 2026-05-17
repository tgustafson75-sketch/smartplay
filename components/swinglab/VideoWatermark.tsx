import { Image, View, Text, StyleSheet } from 'react-native';

/**
 * SmartPlay Caddie watermark overlay for video / thumbnail surfaces.
 *
 * Ported from V3 (components/caddie/VideoWatermark.tsx). Renders the
 * round badge + brand wordmark in a corner of the parent frame. Use as
 * an absolute-positioned child of a relative-positioned container that
 * holds the Video / Image. Visible across all in-app video displays so
 * testers' shared screenshots / screen-records carry the brand mark.
 *
 * This overlay sits at the React Native view layer — it's painted ON TOP
 * of the video at display time. It does NOT modify the underlying file.
 * To bake the watermark INTO the mp4 so it persists through OS share-sheet
 * sharing to Instagram / TikTok / iMessage, a future native pass needs to
 * post-process via ffmpeg-kit-react-native. v1.x deferred work; the in-app
 * display watermark is the v1 deliverable.
 */

type Position = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';

type Props = {
  position?: Position;
  size?: number;
  opacity?: number;
};

export default function VideoWatermark({
  position = 'bottomRight',
  size = 36,
  opacity = 0.85,
}: Props): React.ReactElement {
  const positionStyle = positionStyles[position];
  return (
    <View pointerEvents="none" style={[styles.wrap, positionStyle, { opacity }]}>
      <Image
        source={require('../../assets/avatars/smartplay_caddie_badge.png')}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        resizeMode="cover"
      />
      <Text style={[styles.wordmark, { fontSize: Math.round(size * 0.28) }]}>
        SmartPlay Caddie
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(6,15,9,0.6)',
  },
  wordmark: {
    color: '#00C896',
    fontWeight: '900',
    letterSpacing: 0.6,
  },
});

const positionStyles = StyleSheet.create({
  topLeft: { top: 8, left: 8 },
  topRight: { top: 8, right: 8 },
  bottomLeft: { bottom: 8, left: 8 },
  bottomRight: { bottom: 8, right: 8 },
});
