/**
 * Smart Capture markup — the fullscreen frozen frame + draw tools SmartMotion's review opens when the video is
 * tapped. Moved out of app/swinglab/smartmotion.tsx on 2026-10-27 (audit R6).
 *
 * R6: the modal opened on frame 0 of the clip while the review underneath kept PLAYING, sound and all — the
 * player tapped to freeze the moment they were looking at and got a different one. Opening now freezes the
 * replay (freezeReplayForMarkup) and the markup shows the frame it was frozen on.
 */
import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import VideoAnnotationOverlay from '../swinglab/VideoAnnotationOverlay';

/** Freeze the review replay for markup; returns the moment (ms) to show. */
export async function freezeReplayForMarkup(input: {
  video: { pauseAsync: () => Promise<unknown> } | null | undefined;
  setVideoPaused: (paused: boolean) => void;
  playbackMs: number;
}): Promise<number> {
  input.setVideoPaused(true);
  try { await input.video?.pauseAsync(); } catch { /* an unloaded player is already still */ }
  return Math.max(0, Math.round(input.playbackMs));
}

export function ReplayMarkupModal(props: {
  open: boolean;
  clipUri: string | null;
  /** The frozen moment (ms) the markup shows. */
  atMs: number;
  onClose: () => void;
  topInset: number;
  closeLabel: string;
}) {
  const { open, clipUri, atMs, onClose, topInset, closeLabel } = props;
  return (
    <Modal visible={open} animationType="fade" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <View style={styles.markupRoot}>
        {clipUri ? (
          <Video testID="markup-video" source={{ uri: clipUri }} style={StyleSheet.absoluteFill} resizeMode={ResizeMode.CONTAIN} shouldPlay={false} positionMillis={atMs} isMuted useNativeControls={false} />
        ) : null}
        <VideoAnnotationOverlay topOffset={topInset + 60} />
        <Pressable onPress={onClose} style={[styles.markupClose, { top: topInset + 8 }]} accessibilityRole="button" accessibilityLabel={closeLabel}>
          <Ionicons name="close" size={26} color="#fff" />
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  markupRoot: { flex: 1, backgroundColor: '#000' },
  markupClose: { position: 'absolute', right: 16, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
});
