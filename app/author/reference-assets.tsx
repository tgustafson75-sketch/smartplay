/**
 * Phase 405b — Reference asset authoring screen.
 *
 * Internal-facing tool for the real instructor behind the Tank persona
 * (or any future author) to capture per-category swing references
 * directly inside the app. The captures land in
 * referenceAuthoringStore which the swing-references registry consults
 * at runtime — so the moment a capture is saved, the side-by-side
 * "See the moment" modal lights up with the new reference on this
 * device.
 *
 * Distribution to other users: this is a one-device authoring tool.
 * When Tank is happy with a capture, the per-category Share action
 * hands the underlying file to expo-sharing so it can be AirDropped /
 * emailed / Drive-uploaded to Tim. Tim drops the file into
 * assets/swing-references/<folder>/illustration.png and replaces
 * `image: null` with `require(...)` in services/swingReferences.ts.
 * One EAS Update later, every user sees the new reference.
 *
 * Out of scope for this screen:
 * - Direct push to a backend asset catalog (deferred to v1.2+).
 * - Editing captures inside the app (Tank can recapture but not
 *   crop / annotate here — that lives in the desktop pipeline).
 * - Video editing. The screen can CAPTURE a video, but rendering it
 *   in the side-by-side modal is a follow-up.
 */

import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Image,
  TextInput, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import {
  useReferenceAuthoringStore,
  type AuthoredReference,
} from '../../store/referenceAuthoringStore';
import { usePlayerProfileStore, isOwnerEmail } from '../../store/playerProfileStore';
import { safeBack } from '../../services/safeBack';

// Mirror the bundled registry's category order so the author screen
// reads top-to-bottom in the same order the modal cycles through.
type CategoryRow = {
  id: string;
  label: string;
  position: string;
  defaultCallout: string;
};

const CATEGORIES: CategoryRow[] = [
  { id: 'club_face_open',         label: 'Club face open',         position: 'Impact',             defaultCallout: 'Clubface square to the target at impact.' },
  { id: 'club_face_closed',       label: 'Club face closed',       position: 'Impact',             defaultCallout: 'Clubface square at impact.' },
  { id: 'swing_path_outside_in',  label: 'Outside-in path',        position: 'Downswing',          defaultCallout: 'Club approaching from inside the target line.' },
  { id: 'swing_path_inside_out',  label: 'Inside-out path',        position: 'Downswing',          defaultCallout: 'Club on plane through impact.' },
  { id: 'attack_angle_steep',     label: 'Steep attack angle',     position: 'Impact',             defaultCallout: 'Shallow, level approach into the ball.' },
  { id: 'attack_angle_shallow',   label: 'Shallow attack angle',   position: 'Impact',             defaultCallout: 'Slight descending blow into the ball.' },
  { id: 'early_extension',        label: 'Early extension',        position: 'Impact',             defaultCallout: 'Hips kept back through impact. Posture intact.' },
  { id: 'over_the_top',           label: 'Over the top',           position: 'Transition',         defaultCallout: 'Club dropping into the slot on transition.' },
  { id: 'chicken_wing',           label: 'Chicken wing',           position: 'Follow-through',     defaultCallout: 'Lead arm fully extended through impact.' },
  { id: 'reverse_pivot',          label: 'Reverse pivot',          position: 'Top of backswing',   defaultCallout: 'Weight loaded on the trail side at the top.' },
];

export default function ReferenceAssetAuthoringScreen() {
  // useRouter kept available for future "Preview in cage" affordance —
  // not used today; suppress unused warning until the link lands.
  void useRouter;
  const insets = useSafeAreaInsets();
  // 2026-05-25 — Beta-blocker fix: owner-only gate defended at the
  // route too (Tools menu hides the row, but a deep-link / future
  // suggested-action could still navigate here). Non-owner renders
  // null so the route silently no-ops.
  const profileEmail = usePlayerProfileStore(s => s.email);
  if (!isOwnerEmail(profileEmail)) return null;
  const byCategory = useReferenceAuthoringStore(s => s.byCategory);
  const setImage = useReferenceAuthoringStore(s => s.setImage);
  const setVideo = useReferenceAuthoringStore(s => s.setVideo);
  const setCallout = useReferenceAuthoringStore(s => s.setCallout);
  const clear = useReferenceAuthoringStore(s => s.clear);
  const clearAll = useReferenceAuthoringStore(s => s.clearAll);

  const [busyCategory, setBusyCategory] = useState<string | null>(null);

  // Persist captured asset under a per-category filename inside the
  // app's document directory so it survives app restarts AND has a
  // stable name we can share externally. Each capture overwrites the
  // previous file for the same category — keeps the directory tidy.
  const saveToDocuments = useCallback(async (
    sourceUri: string,
    category: string,
    kind: 'image' | 'video',
  ): Promise<string> => {
    const dir = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
    if (!dir) throw new Error('No writable directory available.');
    const folder = `${dir}reference-authoring`;
    await FileSystem.makeDirectoryAsync(folder, { intermediates: true }).catch(() => {});
    const ext = kind === 'image' ? 'jpg' : 'mp4';
    // Append a short timestamp suffix so iOS Photos doesn't cache the
    // same URI across recaptures (caused stale thumbnails in testing).
    const stamp = Date.now().toString(36);
    const dest = `${folder}/${category}_${stamp}.${ext}`;
    await FileSystem.copyAsync({ from: sourceUri, to: dest });
    return dest;
  }, []);

  const handleCaptureImage = useCallback(async (category: string) => {
    setBusyCategory(category);
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Camera permission required.');
        return;
      }
      const shot = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.9,
        allowsEditing: false,
      });
      if (shot.canceled) return;
      const asset = shot.assets[0];
      if (!asset?.uri) return;
      const stableUri = await saveToDocuments(asset.uri, category, 'image');
      setImage(category, stableUri);
    } catch (e) {
      console.log('[ref-author] image capture failed:', e);
      Alert.alert('Capture failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusyCategory(null);
    }
  }, [saveToDocuments, setImage]);

  const handleCaptureVideo = useCallback(async (category: string) => {
    setBusyCategory(category);
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Camera permission required.');
        return;
      }
      const shot = await ImagePicker.launchCameraAsync({
        mediaTypes: ['videos'],
        quality: 0.7,
        videoMaxDuration: 30,
      });
      if (shot.canceled) return;
      const asset = shot.assets[0];
      if (!asset?.uri) return;
      const stableUri = await saveToDocuments(asset.uri, category, 'video');
      setVideo(category, stableUri);
    } catch (e) {
      console.log('[ref-author] video capture failed:', e);
      Alert.alert('Capture failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusyCategory(null);
    }
  }, [saveToDocuments, setVideo]);

  const handlePickFromLibrary = useCallback(async (category: string) => {
    setBusyCategory(category);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.9,
        allowsEditing: false,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset?.uri) return;
      const stableUri = await saveToDocuments(asset.uri, category, 'image');
      setImage(category, stableUri);
    } catch (e) {
      console.log('[ref-author] picker failed:', e);
      Alert.alert('Pick failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusyCategory(null);
    }
  }, [saveToDocuments, setImage]);

  const handleShareImage = useCallback(async (category: string, entry: AuthoredReference) => {
    if (!entry.imageUri) return;
    try {
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        Alert.alert('Sharing unavailable on this device.');
        return;
      }
      await Sharing.shareAsync(entry.imageUri, {
        mimeType: 'image/jpeg',
        dialogTitle: `Share reference: ${category}`,
      });
    } catch (e) {
      console.log('[ref-author] share image failed:', e);
    }
  }, []);

  const handleShareVideo = useCallback(async (category: string, entry: AuthoredReference) => {
    if (!entry.videoUri) return;
    try {
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        Alert.alert('Sharing unavailable on this device.');
        return;
      }
      await Sharing.shareAsync(entry.videoUri, {
        mimeType: 'video/mp4',
        dialogTitle: `Share reference video: ${category}`,
      });
    } catch (e) {
      console.log('[ref-author] share video failed:', e);
    }
  }, []);

  const handleClearAll = useCallback(() => {
    Alert.alert(
      'Clear all captures?',
      'This removes every authored reference on this device. Files on disk are not deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: () => clearAll() },
      ],
    );
  }, [clearAll]);

  const total = CATEGORIES.length;
  const captured = CATEGORIES.filter(c => {
    const e = byCategory[c.id];
    return e && (e.imageUri || e.videoUri);
  }).length;

  return (
    <SafeAreaView style={[styles.root, { paddingTop: insets.top }]} edges={['left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => safeBack()}
          style={styles.iconBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel="Close authoring tool"
        >
          <Ionicons name="close" size={22} color="#9ca3af" />
        </TouchableOpacity>
        <View style={styles.titleWrap}>
          <Text style={styles.title}>Reference Authoring</Text>
          <Text style={styles.subtitle}>{captured} of {total} captured</Text>
        </View>
        <TouchableOpacity
          onPress={handleClearAll}
          style={styles.iconBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel="Clear all authored references"
        >
          <Ionicons name="trash-outline" size={20} color="#ef4444" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.hint}>
          <Text style={styles.hintText}>
            Captured references appear instantly in the side-by-side fault modal on this device.
            To distribute to all users, tap Share on each capture and drop the file into the repo at
            assets/swing-references/&lt;category&gt;/illustration.png, then ship via EAS Update.
          </Text>
        </View>

        {CATEGORIES.map(cat => {
          const entry = byCategory[cat.id] ?? null;
          const hasImage = !!entry?.imageUri;
          const hasVideo = !!entry?.videoUri;
          const calloutText = entry?.callout ?? '';
          const isBusy = busyCategory === cat.id;
          return (
            <View key={cat.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardLabel}>{cat.label.toUpperCase()}</Text>
                  <Text style={styles.cardPosition}>Position: {cat.position}</Text>
                </View>
                {(hasImage || hasVideo) && (
                  <TouchableOpacity
                    onPress={() => clear(cat.id)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="close-circle" size={20} color="#6b7280" />
                  </TouchableOpacity>
                )}
              </View>

              {hasImage && entry?.imageUri && (
                <View style={styles.previewWrap}>
                  <Image
                    source={{ uri: entry.imageUri }}
                    style={styles.previewImage}
                    resizeMode="cover"
                  />
                  <View style={styles.previewBadge}>
                    <Ionicons name="image" size={11} color="#00C896" />
                    <Text style={styles.previewBadgeText}>IMAGE</Text>
                  </View>
                </View>
              )}

              {hasVideo && entry?.videoUri && (
                <View style={styles.videoChip}>
                  <Ionicons name="videocam" size={14} color="#00C896" />
                  <Text style={styles.videoChipText} numberOfLines={1}>
                    Video captured · stored at {entry.videoUri.split('/').slice(-1)[0]}
                  </Text>
                </View>
              )}

              <View style={styles.calloutBlock}>
                <Text style={styles.calloutLabel}>Callout (caddie cue)</Text>
                <TextInput
                  style={styles.calloutInput}
                  value={calloutText}
                  onChangeText={(t) => setCallout(cat.id, t)}
                  placeholder={cat.defaultCallout}
                  placeholderTextColor="#4b5563"
                  multiline
                  maxLength={200}
                />
              </View>

              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={[styles.actionBtn, isBusy && styles.actionBtnBusy]}
                  onPress={() => handleCaptureImage(cat.id)}
                  disabled={isBusy}
                >
                  {isBusy ? (
                    <ActivityIndicator color="#00C896" size="small" />
                  ) : (
                    <>
                      <Ionicons name="camera" size={14} color="#00C896" />
                      <Text style={styles.actionBtnText}>Photo</Text>
                    </>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, isBusy && styles.actionBtnBusy]}
                  onPress={() => handleCaptureVideo(cat.id)}
                  disabled={isBusy}
                >
                  <Ionicons name="videocam" size={14} color="#00C896" />
                  <Text style={styles.actionBtnText}>Video</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, isBusy && styles.actionBtnBusy]}
                  onPress={() => handlePickFromLibrary(cat.id)}
                  disabled={isBusy}
                >
                  <Ionicons name="folder-open-outline" size={14} color="#00C896" />
                  <Text style={styles.actionBtnText}>Pick</Text>
                </TouchableOpacity>
              </View>

              {(hasImage || hasVideo) && entry && (
                <View style={styles.shareRow}>
                  {hasImage && (
                    <TouchableOpacity
                      style={styles.shareBtn}
                      onPress={() => handleShareImage(cat.id, entry)}
                    >
                      <Ionicons name="share-outline" size={13} color="#fbbf24" />
                      <Text style={styles.shareBtnText}>Share image</Text>
                    </TouchableOpacity>
                  )}
                  {hasVideo && (
                    <TouchableOpacity
                      style={styles.shareBtn}
                      onPress={() => handleShareVideo(cat.id, entry)}
                    >
                      <Ionicons name="share-outline" size={13} color="#fbbf24" />
                      <Text style={styles.shareBtnText}>Share video</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          );
        })}
        <View style={{ height: 8 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#060f09' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: '#1f2937',
  },
  titleWrap: { flex: 1, alignItems: 'center' },
  title: { color: '#ffffff', fontSize: 16, fontWeight: '900', letterSpacing: 0.4 },
  subtitle: { color: '#9ca3af', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginTop: 1 },
  iconBtn: {
    width: 44, height: 44,
    alignItems: 'center', justifyContent: 'center',
  },
  scroll: { paddingHorizontal: 16, paddingTop: 12 },
  hint: {
    backgroundColor: 'rgba(0,200,150,0.08)',
    borderColor: 'rgba(0,200,150,0.4)',
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    marginBottom: 16,
  },
  hintText: { color: '#9ca3af', fontSize: 12, lineHeight: 17 },
  card: {
    backgroundColor: '#0a0a0a',
    borderColor: '#1f2937',
    borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  cardLabel: {
    color: '#ffffff', fontSize: 13, fontWeight: '900', letterSpacing: 0.8,
  },
  cardPosition: {
    color: '#6b7280', fontSize: 11, fontWeight: '700', letterSpacing: 0.4, marginTop: 2,
  },
  previewWrap: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#0d1a0d',
    marginBottom: 10,
    position: 'relative',
  },
  previewImage: { width: '100%', height: '100%' },
  previewBadge: {
    position: 'absolute', top: 6, left: 6,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderWidth: 1, borderColor: 'rgba(0,200,150,0.4)',
  },
  previewBadgeText: {
    color: '#00C896', fontSize: 9, fontWeight: '900', letterSpacing: 0.8,
  },
  videoChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(0,200,150,0.08)',
    borderWidth: 1, borderColor: 'rgba(0,200,150,0.3)',
    marginBottom: 10,
  },
  videoChipText: { color: '#9ca3af', fontSize: 11, flex: 1 },
  calloutBlock: { marginBottom: 10 },
  calloutLabel: {
    color: '#6b7280', fontSize: 10, fontWeight: '800', letterSpacing: 1, marginBottom: 4,
  },
  calloutInput: {
    color: '#e8f5e9', fontSize: 13,
    paddingHorizontal: 10, paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1, borderColor: '#1f2937',
    backgroundColor: '#0d1a0d',
    minHeight: 56,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1, borderColor: '#1f2937',
    backgroundColor: '#0d1a0d',
  },
  actionBtnBusy: { opacity: 0.6 },
  actionBtnText: {
    color: '#00C896', fontSize: 12, fontWeight: '900', letterSpacing: 0.4,
  },
  shareRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  shareBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1, borderColor: 'rgba(251,191,36,0.5)',
    backgroundColor: 'rgba(251,191,36,0.08)',
  },
  shareBtnText: {
    color: '#fbbf24', fontSize: 11, fontWeight: '900', letterSpacing: 0.4,
  },
});
