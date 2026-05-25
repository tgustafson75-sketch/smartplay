/**
 * Field Manual — verification checklist store.
 *
 * Persists per-item checked state + free-text notes so the owner can
 * walk the pre-beta verification list across multiple sessions without
 * losing progress. Keyed by `${sectionId}.${itemId}` (e.g.
 * "features.f1") so item ids can collide across sections without
 * conflict.
 *
 * Owner-only — the screen at app/field-manual.tsx gates access via
 * isOwnerEmail. Persisting publicly would still be safe (no PII), but
 * the gate keeps the UI surface owner-only.
 *
 * 2026-05-24 — Built per the field-manual sprint.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface ChecklistEntry {
  checked: boolean;
  notes: string;
  /** ms epoch of last write (checked toggle or notes edit). */
  updatedAt: number;
}

interface FieldManualChecklistState {
  entries: Record<string, ChecklistEntry>;
  /** ms epoch of last reset; surfaces in the export so a re-walk is dated. */
  lastResetAt: number | null;
  setChecked: (key: string, checked: boolean) => void;
  setNotes: (key: string, notes: string) => void;
  reset: () => void;
}

function blankEntry(): ChecklistEntry {
  return { checked: false, notes: '', updatedAt: 0 };
}

export const useFieldManualChecklistStore = create<FieldManualChecklistState>()(
  persist(
    (set, get) => ({
      entries: {},
      lastResetAt: null,
      setChecked: (key, checked) => set(s => {
        const prev = s.entries[key] ?? blankEntry();
        return {
          entries: { ...s.entries, [key]: { ...prev, checked, updatedAt: Date.now() } },
        };
      }),
      setNotes: (key, notes) => set(s => {
        const prev = s.entries[key] ?? blankEntry();
        return {
          entries: { ...s.entries, [key]: { ...prev, notes, updatedAt: Date.now() } },
        };
      }),
      reset: () => set({ entries: {}, lastResetAt: Date.now() }),
    }),
    {
      name: 'fieldManualChecklist-v1',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
    },
  ),
);

/** Read an entry by key; returns a blank entry if not yet stored. */
export function getEntry(key: string): ChecklistEntry {
  return useFieldManualChecklistStore.getState().entries[key] ?? blankEntry();
}

/** Build the export markdown blob — checked status, notes, and timing. */
export function exportAsMarkdown(opts: {
  sections: ReadonlyArray<{
    id: string;
    title: string;
    items: ReadonlyArray<{ id: string; label: string; detail?: string }>;
  }>;
  bundleHead?: string;
}): string {
  const state = useFieldManualChecklistStore.getState();
  const now = new Date().toISOString();
  const reset = state.lastResetAt ? new Date(state.lastResetAt).toISOString() : 'never';
  let totalChecks = 0;
  let totalChecked = 0;
  for (const s of opts.sections) totalChecks += s.items.length;
  for (const s of opts.sections) {
    for (const i of s.items) {
      const e = state.entries[`${s.id}.${i.id}`];
      if (e?.checked) totalChecked++;
    }
  }
  const lines: string[] = [];
  lines.push(`# Field Manual — Verification Checklist Export`);
  lines.push(``);
  lines.push(`- Exported: ${now}`);
  if (opts.bundleHead) lines.push(`- Bundle head: ${opts.bundleHead}`);
  lines.push(`- Last reset: ${reset}`);
  lines.push(`- Progress: ${totalChecked} / ${totalChecks}`);
  lines.push(``);
  for (const section of opts.sections) {
    lines.push(`## ${section.title}`);
    lines.push(``);
    for (const item of section.items) {
      const key = `${section.id}.${item.id}`;
      const e = state.entries[key];
      const mark = e?.checked ? 'x' : ' ';
      lines.push(`- [${mark}] ${item.label}`);
      if (item.detail) lines.push(`    > ${item.detail}`);
      if (e?.notes && e.notes.trim().length > 0) {
        // Indent notes so they read as nested under the item.
        for (const line of e.notes.split('\n')) {
          lines.push(`    ${line}`);
        }
      }
      if (e?.updatedAt) {
        lines.push(`    _updated ${new Date(e.updatedAt).toISOString()}_`);
      }
    }
    lines.push(``);
  }
  return lines.join('\n');
}
