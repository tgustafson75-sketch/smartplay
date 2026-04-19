/**
 * ScorecardLoader.tsx
 *
 * Allows the user to pick a scorecard photo from their library,
 * preview it, and "parse" it into 18 holes via a mock parser.
 *
 * Real OCR + AI parsing can replace mockParseScorecard() in the future
 * without touching any surrounding code.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Image,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import { CameraView, useCameraPermissions } from 'expo-camera';

// ── Types ─────────────────────────────────────────────────────────────────────

type ParsedHole = {
  hole: number;
  par: number;
  yardage: number;
};

type Props = {
  onParsed: (holes: ParsedHole[]) => void;
  onCancel: () => void;
};

// ── Mock parser (replace with OCR + AI in v2) ─────────────────────────────────

const mockParseScorecard = (): ParsedHole[] => [
  { hole: 1,  par: 4, yardage: 385 },
  { hole: 2,  par: 3, yardage: 165 },
  { hole: 3,  par: 5, yardage: 520 },
  { hole: 4,  par: 4, yardage: 395 },
  { hole: 5,  par: 4, yardage: 410 },
  { hole: 6,  par: 3, yardage: 175 },
  { hole: 7,  par: 5, yardage: 535 },
  { hole: 8,  par: 4, yardage: 370 },
  { hole: 9,  par: 4, yardage: 400 },
  { hole: 10, par: 4, yardage: 420 },
  { hole: 11, par: 3, yardage: 185 },
  { hole: 12, par: 5, yardage: 555 },
  { hole: 13, par: 4, yardage: 375 },
  { hole: 14, par: 4, yardage: 390 },
  { hole: 15, par: 3, yardage: 155 },
  { hole: 16, par: 5, yardage: 510 },
  { hole: 17, par: 4, yardage: 365 },
  { hole: 18, par: 4, yardage: 410 },
];

// ── Component ─────────────────────────────────────────────────────────────────

export default function ScorecardLoader({ onParsed, onCancel }: Props) {
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [mediaPermission, requestMediaPermission] = MediaLibrary.usePermissions();

  const pickImage = async () => {
    // Request media library permission
    if (!mediaPermission?.granted) {
      const { granted } = await requestMediaPermission();
      if (!granted) {
        Alert.alert(
          'Permission needed',
          'Please allow access to your photo library to upload a scorecard.',
        );
        return;
      }
    }

    // Use CameraView's static launcher to open the image library
    const result = await (CameraView as any).launchImageLibraryAsync?.({
      mediaTypes: 'images',
      quality: 0.8,
    });

    if (result && !result.canceled && result.assets?.[0]?.uri) {
      setImageUri(result.assets[0].uri);
    }
  };

  const parseScorecard = async () => {
    setParsing(true);
    // Simulate async parse delay (replace with real OCR call here)
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const holes = mockParseScorecard();
    setParsing(false);
    onParsed(holes);
  };

  return (
    <View style={s.container}>
      <Text style={s.title}>Load Scorecard</Text>
      <Text style={s.subtitle}>
        Upload a photo of your scorecard. We'll fill in all 18 holes instantly.
      </Text>

      {/* Image preview */}
      {imageUri ? (
        <Image source={{ uri: imageUri }} style={s.preview} resizeMode="contain" />
      ) : (
        <View style={s.placeholder}>
          <Text style={s.placeholderIcon}>🏌️</Text>
          <Text style={s.placeholderText}>No scorecard selected</Text>
        </View>
      )}

      {/* Upload button */}
      <Pressable style={s.btnPrimary} onPress={pickImage}>
        <Text style={s.btnText}>📷  Upload Scorecard Image</Text>
      </Pressable>

      {/* Parse button — only active once image is selected */}
      {imageUri && !parsing && (
        <Pressable style={[s.btnPrimary, s.btnGreen]} onPress={parseScorecard}>
          <Text style={s.btnText}>⚡  Parse Scorecard</Text>
        </Pressable>
      )}

      {parsing && (
        <View style={s.parsingRow}>
          <ActivityIndicator color="#A7F3D0" />
          <Text style={s.parsingText}>Detecting holes…</Text>
        </View>
      )}

      <Pressable style={s.btnCancel} onPress={onCancel}>
        <Text style={s.btnCancelText}>Cancel</Text>
      </Pressable>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#0a1a0e', padding: 20 },
  title:           { color: '#fff', fontSize: 22, fontWeight: '700', marginBottom: 6 },
  subtitle:        { color: '#9CA3AF', fontSize: 14, marginBottom: 24, lineHeight: 20 },
  preview:         { width: '100%', height: 220, borderRadius: 12, marginBottom: 20, backgroundColor: '#111' },
  placeholder:     { width: '100%', height: 220, borderRadius: 12, backgroundColor: '#111E14', marginBottom: 20, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#1F3A22', borderStyle: 'dashed' },
  placeholderIcon: { fontSize: 40, marginBottom: 8 },
  placeholderText: { color: '#4B5563', fontSize: 14 },
  btnPrimary:      { backgroundColor: '#1F3A22', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginBottom: 12, borderWidth: 1, borderColor: '#2D5A32' },
  btnGreen:        { backgroundColor: '#065F46', borderColor: '#059669' },
  btnText:         { color: '#A7F3D0', fontSize: 15, fontWeight: '600' },
  parsingRow:      { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12, justifyContent: 'center' },
  parsingText:     { color: '#A7F3D0', fontSize: 14 },
  btnCancel:       { alignItems: 'center', paddingVertical: 12 },
  btnCancelText:   { color: '#6B7280', fontSize: 14 },
});
