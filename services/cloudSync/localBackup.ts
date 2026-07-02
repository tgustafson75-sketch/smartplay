/**
 * Local backup · export/import to a FILE. Zero backend, zero config, offline.
 *
 * This is the bulletproof safety net: "Back up to a file" writes the same
 * structured snapshot (rounds, bag, CNS, profile, custom courses, settings…) to
 * a .json the user saves anywhere (Files / Drive / email / AirDrop); "Restore
 * from a file" reads it back. No account, no Supabase, no network — the user
 * fully owns the file. Use it before a phone swap and you can never lose data.
 *
 * Shares the exact gather/apply core as cloud backup (./snapshot.ts), so the two
 * paths are interchangeable.
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { gatherSnapshot, applySnapshot, SNAPSHOT_SCHEMA_VERSION, type Snapshot } from './snapshot';

const FILE_MAGIC = 'smartplay-backup';

interface BackupFile {
  magic: typeof FILE_MAGIC;
  schema_version: number;
  exported_at: string;
  app: 'smartplay-caddie';
  payload: Snapshot;
}

/** Write the current snapshot to a JSON file and open the share sheet. */
export async function exportBackupToFile(): Promise<{ ok: boolean; reason?: string }> {
  try {
    const snapshot = await gatherSnapshot();
    const file: BackupFile = {
      magic: FILE_MAGIC,
      schema_version: SNAPSHOT_SCHEMA_VERSION,
      // Caller stamps a real date string; keep it simple + human-readable.
      exported_at: new Date().toISOString(),
      app: 'smartplay-caddie',
      payload: snapshot,
    };
    const dir = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
    if (!dir) return { ok: false, reason: 'no_fs' };
    // Date-stamped filename so multiple backups don't clobber each other.
    const stamp = new Date().toISOString().slice(0, 10);
    const uri = `${dir}smartplay-backup-${stamp}.json`;
    await FileSystem.writeAsStringAsync(uri, JSON.stringify(file), { encoding: FileSystem.EncodingType.UTF8 });
    const canShare = await Sharing.isAvailableAsync();
    if (!canShare) return { ok: false, reason: 'sharing_unavailable' };
    await Sharing.shareAsync(uri, { mimeType: 'application/json', dialogTitle: 'Save your SmartPlay backup' });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'export_failed' };
  }
}

/**
 * Pick a previously-exported backup file and restore it. Writes AsyncStorage;
 * the CALLER must reload the app so the stores rehydrate. Returns how many
 * stores were restored.
 */
export async function importBackupFromFile(): Promise<{ ok: boolean; restored: number; reason?: string }> {
  try {
    const picked = await DocumentPicker.getDocumentAsync({
      type: ['application/json', 'text/plain', '*/*'],
      copyToCacheDirectory: true,
    });
    if (picked.canceled || !picked.assets?.[0]?.uri) return { ok: false, restored: 0, reason: 'canceled' };
    const raw = await FileSystem.readAsStringAsync(picked.assets[0].uri, { encoding: FileSystem.EncodingType.UTF8 });
    let parsed: BackupFile;
    try {
      parsed = JSON.parse(raw) as BackupFile;
    } catch {
      return { ok: false, restored: 0, reason: 'not_a_backup' };
    }
    if (parsed?.magic !== FILE_MAGIC || !parsed.payload || typeof parsed.payload !== 'object') {
      return { ok: false, restored: 0, reason: 'not_a_backup' };
    }
    // 2026-07-01 (re-audit) — refuse a file written by a NEWER schema than this
    // build understands, rather than applying an unmigrated payload blindly.
    if (typeof parsed.schema_version === 'number' && parsed.schema_version > SNAPSHOT_SCHEMA_VERSION) {
      return { ok: false, restored: 0, reason: 'newer_version' };
    }
    const restored = await applySnapshot(parsed.payload);
    return { ok: true, restored };
  } catch (e) {
    return { ok: false, restored: 0, reason: e instanceof Error ? e.message : 'import_failed' };
  }
}
