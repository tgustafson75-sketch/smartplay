/**
 * Phase R — Round photo capture.
 *
 * Small camera-icon affordance during active rounds. Tap → camera →
 * capture → photo lands on roundStore.currentRoundPhotos at the current
 * hole. Stored locally; surfaced in recap collage at round end.
 */

import React, { useState } from 'react';
import { TouchableOpacity, StyleSheet, Alert, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { useRoundStore } from '../../store/roundStore';

export default function PhotoCaptureButton() {
  const isRoundActive = useRoundStore(s => s.isRoundActive);
  const addRoundPhoto = useRoundStore(s => s.addRoundPhoto);
  const [busy, setBusy] = useState(false);

  if (!isRoundActive) return null;

  const onPress = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Camera permission needed', 'Allow camera access to capture round photos.');
        return;
      }
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
        allowsEditing: false,
      });
      if (result.canceled || !result.assets[0]?.uri) return;
      addRoundPhoto(result.assets[0].uri);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      console.log('[PhotoCapture] error', e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <TouchableOpacity onPress={onPress} style={styles.btn} activeOpacity={0.7}>
      <View style={styles.dot}>
        <Ionicons name="camera" size={18} color="#0d1a0d" />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: { padding: 4 },
  dot: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#00C896',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
});
