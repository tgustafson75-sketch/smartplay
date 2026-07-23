import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  TextInput,
  Image,
  useWindowDimensions,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import PALMS_IMAGES from '../data/palmsImages';
import type { Landmark } from '../services/landmarks';

const STORAGE_KEY = 'landmark_curate_draft';
const COURSE_ID = 'palms';
const LANDMARK_TYPES: Landmark['type'][] = ['bunker', 'water', 'tree', 'rough', 'hazard', 'marker'];
const LANDMARK_SIDES: Landmark['side'][] = ['left', 'center', 'right'];

const IMAGE_WIDTH_RATIO = 0.92;

function generateId(course_id: string, hole_number: number, name: string): string {
  return `${course_id}_h${hole_number}_${name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')}`;
}

export default function LandmarkCurateScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const imgW = Math.floor(width * IMAGE_WIDTH_RATIO);
  const imgH = Math.floor(imgW * 0.65);

  const [selectedHole, setSelectedHole] = useState(1);
  const [landmarks, setLandmarks] = useState<Landmark[]>([]);
  const [pendingPos, setPendingPos] = useState<{ x: number; y: number } | null>(null);

  // 2026-07-23 (QA) — the draft was WRITTEN to AsyncStorage on add/remove but never READ back, so
  // curation work was silently lost on restart. Hydrate it on mount (best-effort).
  useEffect(() => {
    let live = true;
    void AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (!live || !raw) return;
      try {
        const saved = JSON.parse(raw) as Landmark[];
        if (Array.isArray(saved)) setLandmarks(saved);
      } catch { /* ignore corrupt draft */ }
    }).catch(() => {});
    return () => { live = false; };
  }, []);

  // Form state for new landmark
  const [form, setForm] = useState({
    name: '',
    description: '',
    side: 'center' as Landmark['side'],
    type: 'bunker' as Landmark['type'],
  });

  const [exported, setExported] = useState<string | null>(null);

  const holeImage = PALMS_IMAGES[selectedHole];

  const handleImageTap = useCallback((evt: { nativeEvent: { locationX: number; locationY: number } }) => {
    const { locationX, locationY } = evt.nativeEvent;
    setPendingPos({
      x: parseFloat((locationX / imgW).toFixed(3)),
      y: parseFloat((locationY / imgH).toFixed(3)),
    });
  }, [imgW, imgH]);

  const handleAddLandmark = () => {
    if (!form.name.trim()) { Alert.alert('Name required'); return; }
    const lm: Landmark = {
      id: generateId(COURSE_ID, selectedHole, form.name),
      course_id: COURSE_ID,
      hole_number: selectedHole,
      name: form.name.trim(),
      description: form.description.trim() || form.name.trim(),
      side: form.side,
      type: form.type,
      position: pendingPos ?? undefined,
    };
    setLandmarks(prev => [...prev, lm]);
    setForm({ name: '', description: '', side: 'center', type: 'bunker' });
    setPendingPos(null);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([...landmarks, lm]));
  };

  const handleRemove = (id: string) => {
    const updated = landmarks.filter(l => l.id !== id);
    setLandmarks(updated);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  };

  const handleExport = () => {
    const json = JSON.stringify(landmarks, null, 2);
    setExported(json);
    Alert.alert('Export ready', 'JSON shown below. Copy it to data/landmarks/palms.json');
  };

  const holeList = landmarks.filter(l => l.hole_number === selectedHole);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Landmark Curator — Palms</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>

        {/* HOLE SELECTOR */}
        <Text style={styles.section}>HOLE</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.holeScroll}>
          <View style={styles.holeRow}>
            {Array.from({ length: 9 }, (_, i) => i + 1).map(h => (
              <TouchableOpacity
                key={h}
                style={[styles.holeChip, selectedHole === h && styles.holeChipActive]}
                onPress={() => { setSelectedHole(h); setPendingPos(null); }}
              >
                <Text style={[styles.holeChipText, selectedHole === h && styles.holeChipTextActive]}>
                  {h}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        {/* HOLE IMAGE — tap to place */}
        <Text style={styles.section}>TAP IMAGE TO PLACE</Text>
        <TouchableOpacity activeOpacity={0.95} onPress={handleImageTap}>
          <View style={{ width: imgW, height: imgH, borderRadius: 10, overflow: 'hidden', position: 'relative' }}>
            {holeImage ? (
              <Image source={holeImage} style={{ width: imgW, height: imgH }} resizeMode="cover" />
            ) : (
              <View style={[styles.imagePlaceholder, { width: imgW, height: imgH }]}>
                <Text style={styles.imagePlaceholderText}>No image for hole {selectedHole}</Text>
              </View>
            )}
            {/* Existing landmarks for this hole */}
            {holeList.map(lm =>
              lm.position ? (
                <View
                  key={lm.id}
                  style={[styles.dot, { left: lm.position.x * imgW - 6, top: lm.position.y * imgH - 6, backgroundColor: '#00C896' }]}
                >
                  <Text style={styles.dotLabel}>{lm.name[0]}</Text>
                </View>
              ) : null
            )}
            {/* Pending tap */}
            {pendingPos && (
              <View
                style={[styles.dot, { left: pendingPos.x * imgW - 6, top: pendingPos.y * imgH - 6, backgroundColor: '#F5A623' }]}
              />
            )}
          </View>
        </TouchableOpacity>
        {pendingPos && (
          <Text style={styles.pendingText}>Tap position: ({pendingPos.x}, {pendingPos.y})</Text>
        )}

        {/* ADD FORM */}
        <Text style={styles.section}>ADD LANDMARK</Text>
        <View style={styles.formCard}>
          <TextInput
            style={styles.input}
            placeholder="Name (e.g. Left Bunker)"
            placeholderTextColor="#4b5563"
            value={form.name}
            onChangeText={t => setForm(f => ({ ...f, name: t }))}
          />
          <TextInput
            style={styles.input}
            placeholder="Description"
            placeholderTextColor="#4b5563"
            value={form.description}
            onChangeText={t => setForm(f => ({ ...f, description: t }))}
          />
          <View style={styles.chipRow}>
            {LANDMARK_SIDES.map(s => (
              <TouchableOpacity
                key={s}
                style={[styles.chip, form.side === s && styles.chipActive]}
                onPress={() => setForm(f => ({ ...f, side: s }))}
              >
                <Text style={[styles.chipText, form.side === s && styles.chipTextActive]}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.chipRow}>
            {LANDMARK_TYPES.map(t => (
              <TouchableOpacity
                key={t}
                style={[styles.chip, form.type === t && styles.chipActive]}
                onPress={() => setForm(f => ({ ...f, type: t }))}
              >
                <Text style={[styles.chipText, form.type === t && styles.chipTextActive]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={styles.addBtn} onPress={handleAddLandmark}>
            <Text style={styles.addBtnText}>+ Add to Hole {selectedHole}</Text>
          </TouchableOpacity>
        </View>

        {/* HOLE LANDMARK LIST */}
        {holeList.length > 0 && (
          <>
            <Text style={styles.section}>HOLE {selectedHole} LANDMARKS ({holeList.length})</Text>
            {holeList.map(lm => (
              <View key={lm.id} style={styles.lmRow}>
                <View style={styles.lmInfo}>
                  <Text style={styles.lmName}>{lm.name}</Text>
                  <Text style={styles.lmMeta}>{lm.type} · {lm.side}{lm.position ? ` · (${lm.position.x}, ${lm.position.y})` : ''}</Text>
                </View>
                <TouchableOpacity onPress={() => handleRemove(lm.id)}>
                  <Text style={styles.removeBtn}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
          </>
        )}

        {/* ALL LANDMARKS SUMMARY */}
        <Text style={styles.section}>ALL LANDMARKS ({landmarks.length})</Text>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(h => {
          const count = landmarks.filter(l => l.hole_number === h).length;
          if (count === 0) return null;
          return (
            <Text key={h} style={styles.summaryLine}>H{h}: {count} landmark{count !== 1 ? 's' : ''}</Text>
          );
        })}

        {/* EXPORT */}
        <TouchableOpacity style={styles.exportBtn} onPress={handleExport}>
          <Text style={styles.exportBtnText}>Export JSON</Text>
        </TouchableOpacity>

        {exported && (
          <View style={styles.exportCard}>
            <Text style={styles.exportLabel}>data/landmarks/palms.json</Text>
            <ScrollView horizontal>
              <Text style={styles.exportText} selectable>{exported}</Text>
            </ScrollView>
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060f09' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
  },
  backBtn: { width: 80 },
  backText: { color: '#00C896', fontSize: 16, fontWeight: '600' },
  title: { color: '#ffffff', fontSize: 14, fontWeight: '800', textAlign: 'center', flex: 1 },
  content: { padding: 16, paddingBottom: 80 },
  section: {
    color: '#6b7280', fontSize: 10, fontWeight: '800', letterSpacing: 2,
    marginTop: 16, marginBottom: 8,
  },
  holeScroll: { marginBottom: 4 },
  holeRow: { flexDirection: 'row', gap: 6 },
  holeChip: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#1e3a28', backgroundColor: '#0d2418',
  },
  holeChipActive: { borderColor: '#00C896', backgroundColor: '#003d20' },
  holeChipText: { color: '#6b7280', fontSize: 15, fontWeight: '700' },
  holeChipTextActive: { color: '#00C896' },
  imagePlaceholder: { backgroundColor: '#0d2418', alignItems: 'center', justifyContent: 'center' },
  imagePlaceholderText: { color: '#374151', fontSize: 14 },
  dot: {
    position: 'absolute', width: 12, height: 12, borderRadius: 6,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#060f09',
  },
  dotLabel: { color: '#060f09', fontSize: 7, fontWeight: '900' },
  pendingText: { color: '#F5A623', fontSize: 11, marginTop: 4 },
  formCard: {
    backgroundColor: '#0d2418', borderRadius: 10,
    borderWidth: 1, borderColor: '#1e3a28', padding: 12, gap: 8,
  },
  input: {
    backgroundColor: '#060f09', borderRadius: 8, borderWidth: 1, borderColor: '#1e3a28',
    color: '#ffffff', fontSize: 14, paddingHorizontal: 12, paddingVertical: 9,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8,
    borderWidth: 1, borderColor: '#1e3a28', backgroundColor: '#060f09',
  },
  chipActive: { borderColor: '#00C896', backgroundColor: '#003d20' },
  chipText: { color: '#6b7280', fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: '#00C896' },
  addBtn: {
    backgroundColor: '#00C896', borderRadius: 8, paddingVertical: 10, alignItems: 'center',
  },
  addBtnText: { color: '#060f09', fontSize: 14, fontWeight: '700' },
  lmRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#0d2418', borderRadius: 8,
    borderWidth: 1, borderColor: '#1e3a28',
    padding: 10, marginBottom: 6,
  },
  lmInfo: { flex: 1 },
  lmName: { color: '#ffffff', fontSize: 13, fontWeight: '600' },
  lmMeta: { color: '#6b7280', fontSize: 11, marginTop: 2 },
  removeBtn: { color: '#ef4444', fontSize: 16, paddingLeft: 12 },
  summaryLine: { color: '#9ca3af', fontSize: 13, marginBottom: 3 },
  exportBtn: {
    marginTop: 20, backgroundColor: '#1e3a28', borderRadius: 10,
    paddingVertical: 13, alignItems: 'center',
  },
  exportBtnText: { color: '#00C896', fontSize: 14, fontWeight: '700' },
  exportCard: {
    marginTop: 10, backgroundColor: '#0d2418', borderRadius: 8,
    borderWidth: 1, borderColor: '#1e3a28', padding: 10,
  },
  exportLabel: { color: '#6b7280', fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 6 },
  exportText: { color: '#9ca3af', fontSize: 11, fontFamily: 'monospace' },
});
