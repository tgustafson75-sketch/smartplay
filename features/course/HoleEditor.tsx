/**
 * HoleEditor.tsx
 *
 * Inline editor for a single hole entry.
 * Supports: par, yardage, notes, features (text tags), and an optional hole image.
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  Image,
  ScrollView,
  StyleSheet,
  Alert,
} from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import { CameraView } from 'expo-camera';
import type { HoleData } from './useCourseState';

// ── Feature tags a user can toggle ───────────────────────────────────────────

const FEATURE_OPTIONS = [
  'Water hazard',
  'Bunker',
  'Dog-leg left',
  'Dog-leg right',
  'Elevation change',
  'Tight fairway',
  'Reachable par 5',
  'Risk/reward',
];

// ── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  hole: HoleData;
  onSave: (updated: HoleData) => void;
  onCancel: () => void;
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function HoleEditor({ hole, onSave, onCancel }: Props) {
  const [par,      setPar]      = useState(String(hole.par));
  const [yardage,  setYardage]  = useState(String(hole.yardage));
  const [notes,    setNotes]    = useState(hole.notes ?? '');
  const [features, setFeatures] = useState<string[]>(hole.features ?? []);
  const [imageUri, setImageUri] = useState<string | undefined>(hole.imageUri);
  const [mediaPermission, requestMediaPermission] = MediaLibrary.usePermissions();

  // Keep state in sync if parent swaps to a different hole
  useEffect(() => {
    setPar(String(hole.par));
    setYardage(String(hole.yardage));
    setNotes(hole.notes ?? '');
    setFeatures(hole.features ?? []);
    setImageUri(hole.imageUri);
  }, [hole.hole]);

  const toggleFeature = (f: string) => {
    setFeatures((prev) =>
      prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f],
    );
  };

  const pickImage = async () => {
    if (!mediaPermission?.granted) {
      const { granted } = await requestMediaPermission();
      if (!granted) {
        Alert.alert('Permission needed', 'Allow photo access to add a hole image.');
        return;
      }
    }
    const result = await (CameraView as any).launchImageLibraryAsync?.({
      mediaTypes: 'images',
      quality: 0.7,
    });
    if (result && !result.canceled && result.assets?.[0]?.uri) {
      setImageUri(result.assets[0].uri);
    }
  };

  const handleSave = () => {
    const parsedPar = parseInt(par, 10);
    const parsedYardage = parseInt(yardage, 10);
    if (isNaN(parsedPar) || parsedPar < 3 || parsedPar > 6) {
      Alert.alert('Invalid par', 'Par must be between 3 and 6.');
      return;
    }
    if (isNaN(parsedYardage) || parsedYardage < 50 || parsedYardage > 700) {
      Alert.alert('Invalid yardage', 'Yardage must be between 50 and 700.');
      return;
    }
    onSave({
      ...hole,
      par: parsedPar,
      yardage: parsedYardage,
      notes,
      features,
      imageUri,
    });
  };

  return (
    <ScrollView style={s.container} contentContainerStyle={{ paddingBottom: 40 }}>
      {/* Header */}
      <Text style={s.title}>Hole {hole.hole}</Text>

      {/* Hole image */}
      {imageUri ? (
        <Image source={{ uri: imageUri }} style={s.holeImage} resizeMode="cover" />
      ) : null}
      <Pressable style={s.imgBtn} onPress={pickImage}>
        <Text style={s.imgBtnText}>{imageUri ? '🔄  Change Hole Image' : '📷  Add Hole Image'}</Text>
      </Pressable>

      {/* Par + Yardage row */}
      <View style={s.row}>
        <View style={s.fieldHalf}>
          <Text style={s.label}>Par</Text>
          <TextInput
            style={s.input}
            keyboardType="number-pad"
            value={par}
            onChangeText={setPar}
            maxLength={1}
            selectTextOnFocus
          />
        </View>
        <View style={s.fieldHalf}>
          <Text style={s.label}>Yardage</Text>
          <TextInput
            style={s.input}
            keyboardType="number-pad"
            value={yardage}
            onChangeText={setYardage}
            maxLength={3}
            selectTextOnFocus
          />
        </View>
      </View>

      {/* Notes */}
      <Text style={s.label}>Notes</Text>
      <TextInput
        style={[s.input, s.textArea]}
        placeholder="e.g. Aim at the left bunker, avoid right OB…"
        placeholderTextColor="#4B5563"
        value={notes}
        onChangeText={setNotes}
        multiline
        numberOfLines={3}
      />

      {/* Feature tags */}
      <Text style={s.label}>Features</Text>
      <View style={s.tagGrid}>
        {FEATURE_OPTIONS.map((f) => (
          <Pressable
            key={f}
            style={[s.tag, features.includes(f) && s.tagActive]}
            onPress={() => toggleFeature(f)}
          >
            <Text style={[s.tagText, features.includes(f) && s.tagTextActive]}>{f}</Text>
          </Pressable>
        ))}
      </View>

      {/* Actions */}
      <Pressable style={s.btnSave} onPress={handleSave}>
        <Text style={s.btnSaveText}>Save Hole</Text>
      </Pressable>
      <Pressable style={s.btnCancel} onPress={onCancel}>
        <Text style={s.btnCancelText}>Cancel</Text>
      </Pressable>
    </ScrollView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container:     { flex: 1, backgroundColor: '#0a1a0e', padding: 20 },
  title:         { color: '#fff', fontSize: 22, fontWeight: '700', marginBottom: 16 },
  holeImage:     { width: '100%', height: 160, borderRadius: 10, marginBottom: 12 },
  imgBtn:        { backgroundColor: '#111E14', borderRadius: 8, paddingVertical: 10, alignItems: 'center', marginBottom: 20, borderWidth: 1, borderColor: '#1F3A22' },
  imgBtnText:    { color: '#A7F3D0', fontSize: 14 },
  row:           { flexDirection: 'row', gap: 12, marginBottom: 12 },
  fieldHalf:     { flex: 1 },
  label:         { color: '#9CA3AF', fontSize: 12, fontWeight: '600', letterSpacing: 0.8, marginBottom: 6, marginTop: 8 },
  input:         { backgroundColor: '#111E14', borderRadius: 8, borderWidth: 1, borderColor: '#1F3A22', color: '#fff', fontSize: 16, paddingHorizontal: 12, paddingVertical: 10 },
  textArea:      { height: 80, textAlignVertical: 'top' },
  tagGrid:       { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  tag:           { backgroundColor: '#111E14', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: '#1F3A22' },
  tagActive:     { backgroundColor: '#065F46', borderColor: '#059669' },
  tagText:       { color: '#6B7280', fontSize: 13 },
  tagTextActive: { color: '#A7F3D0' },
  btnSave:       { backgroundColor: '#059669', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginBottom: 12 },
  btnSaveText:   { color: '#fff', fontSize: 15, fontWeight: '700' },
  btnCancel:     { alignItems: 'center', paddingVertical: 12 },
  btnCancelText: { color: '#6B7280', fontSize: 14 },
});
