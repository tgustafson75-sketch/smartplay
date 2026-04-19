/**
 * VoiceRecorder.tsx
 *
 * Simple voice recording widget for adding spoken notes to a hole.
 * Uses expo-av Audio for recording. Transcription is mocked for now —
 * replace mockTranscribe() with a real STT call when ready.
 */

import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Audio } from 'expo-av';

// ── Mock transcription (replace with real STT / Whisper call) ─────────────────

const mockTranscribe = (): string => {
  const templates = [
    'Aim at the left edge of the fairway.',
    'Bunker right side — play safe left.',
    'Tee shot needs to carry 180 yards to clear the hazard.',
    'Wind usually comes off the ocean — club up.',
    'Long par 3. Aim centre and take extra club.',
  ];
  return templates[Math.floor(Math.random() * templates.length)];
};

// ── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  onTranscribed: (text: string) => void;
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function VoiceRecorder({ onTranscribed }: Props) {
  const [recording, setRecording]       = useState<Audio.Recording | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [status, setStatus]             = useState<'idle' | 'recording' | 'transcribing'>('idle');

  const startRecording = async () => {
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        Alert.alert('Microphone access needed', 'Please allow microphone access to record notes.');
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await rec.startAsync();
      setRecording(rec);
      setStatus('recording');
    } catch (err) {
      Alert.alert('Could not start recording', String(err));
    }
  };

  const stopRecording = async () => {
    if (!recording) return;
    try {
      await recording.stopAndUnloadAsync();
      setRecording(null);
      setStatus('transcribing');
      setTranscribing(true);

      // Simulate async transcription
      await new Promise((r) => setTimeout(r, 1000));
      const text = mockTranscribe();
      setTranscribing(false);
      setStatus('idle');
      onTranscribed(text);
    } catch (err) {
      setStatus('idle');
      setTranscribing(false);
      Alert.alert('Recording error', String(err));
    }
  };

  return (
    <View style={s.container}>
      <Text style={s.label}>🎙️  Voice Note</Text>

      {status === 'idle' && (
        <Pressable style={s.btn} onPress={startRecording}>
          <Text style={s.btnText}>Start Recording</Text>
        </Pressable>
      )}

      {status === 'recording' && (
        <Pressable style={[s.btn, s.btnActive]} onPress={stopRecording}>
          <Text style={s.btnText}>⏹  Stop Recording</Text>
        </Pressable>
      )}

      {status === 'transcribing' && (
        <View style={s.transcribingRow}>
          <ActivityIndicator color="#A7F3D0" />
          <Text style={s.transcribingText}>Transcribing…</Text>
        </View>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container:        { marginTop: 8, marginBottom: 8 },
  label:            { color: '#9CA3AF', fontSize: 12, fontWeight: '600', letterSpacing: 0.8, marginBottom: 8 },
  btn:              { backgroundColor: '#1F3A22', borderRadius: 8, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: '#2D5A32' },
  btnActive:        { backgroundColor: '#065F46', borderColor: '#059669' },
  btnText:          { color: '#A7F3D0', fontSize: 14, fontWeight: '600' },
  transcribingRow:  { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  transcribingText: { color: '#A7F3D0', fontSize: 14 },
});
