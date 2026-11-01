import { parseSwingRx, type ParseResult } from './swingRxParse';

/**
 * Pick a Caddie export off the device and parse it.
 *
 * Caddie's export goes out through the system share sheet as TEXT, so what
 * lands on disk is a .txt (Files/Drive/Notes) or a .json if the payload came
 * from a structured export. Both are read as UTF-8 and handed to the same
 * parser the paste box uses — one code path, no second contract.
 *
 * expo-document-picker is a native module: on a dev client built before it
 * was added, requiring it throws. That's caught and reported as
 * 'picker_unavailable' so the paste box stays the working path instead of the
 * screen crashing.
 */

export type FileImportResult =
  | { kind: 'parsed'; result: ParseResult; filename: string }
  | { kind: 'canceled' }
  | { kind: 'picker_unavailable' }
  | { kind: 'read_failed'; message: string };

declare const require: (id: string) => unknown;

interface PickedAsset {
  uri: string;
  name?: string;
  mimeType?: string;
}

interface DocumentPickerModule {
  getDocumentAsync: (opts: {
    type?: string[];
    copyToCacheDirectory?: boolean;
  }) => Promise<{ canceled: boolean; assets?: PickedAsset[] | null }>;
}

export async function importSwingRxFromFile(now?: number): Promise<FileImportResult> {
  let picker: DocumentPickerModule;
  try {
    picker = require('expo-document-picker') as DocumentPickerModule;
    if (typeof picker?.getDocumentAsync !== 'function') return { kind: 'picker_unavailable' };
  } catch {
    return { kind: 'picker_unavailable' };
  }

  let asset: PickedAsset;
  try {
    const picked = await picker.getDocumentAsync({
      type: ['text/plain', 'application/json', 'text/*', '*/*'],
      copyToCacheDirectory: true,
    });
    if (picked.canceled || !picked.assets?.[0]?.uri) return { kind: 'canceled' };
    asset = picked.assets[0];
  } catch (err) {
    // A missing native module surfaces here on some platforms rather than at
    // require time — treat it the same way, not as a corrupt file.
    const message = err instanceof Error ? err.message : 'picker_failed';
    if (/native module|not available|doesn't exist|NativeModule/i.test(message)) {
      return { kind: 'picker_unavailable' };
    }
    return { kind: 'read_failed', message };
  }

  try {
    const { File } = (await import('expo-file-system')) as { File: new (uri: string) => { text: () => Promise<string> } };
    const raw = await new File(asset.uri).text();
    return {
      kind: 'parsed',
      result: parseSwingRx(raw, now),
      filename: asset.name ?? 'export',
    };
  } catch (err) {
    return { kind: 'read_failed', message: err instanceof Error ? err.message : 'read_failed' };
  }
}
