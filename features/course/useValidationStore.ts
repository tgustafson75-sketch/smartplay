/**
 * useValidationStore.ts
 *
 * Local-only state for Course Validation Mode.
 * Tracks per-hole yardage adjustments, par overrides, and play-condition tags.
 * No Zustand, no backend — pure useState with helpers.
 */

import { useState, useCallback } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

export const VALIDATION_TAGS = [
  'Plays Longer',
  'Plays Shorter',
  'Tight Fairway',
  'Wide Fairway',
  'Trouble Left',
  'Trouble Right',
  'Water in Play',
  'Elevated Green',
  'Blind Shot',
] as const;

export type ValidationTag = typeof VALIDATION_TAGS[number];

export type HoleValidation = {
  holeId: number;
  yardageAdjustment: number;   // signed delta: +10, -20, 0…
  parOverride?: number;        // only set if user changed par
  tags: ValidationTag[];
  timestamp: number;
};

type ValidationMap = Record<number, HoleValidation>;

// ── Hook ──────────────────────────────────────────────────────────────────────

export const useValidationStore = () => {
  const [validationMode, setValidationMode] = useState(false);
  const [validations, setValidations]       = useState<ValidationMap>({});

  const getHoleValidation = useCallback(
    (holeId: number): HoleValidation =>
      validations[holeId] ?? {
        holeId,
        yardageAdjustment: 0,
        tags: [],
        timestamp: 0,
      },
    [validations],
  );

  const setYardageAdjustment = useCallback(
    (holeId: number, delta: number) => {
      setValidations((prev) => {
        const current = prev[holeId] ?? { holeId, yardageAdjustment: 0, tags: [], timestamp: 0 };
        return {
          ...prev,
          [holeId]: { ...current, yardageAdjustment: delta, timestamp: Date.now() },
        };
      });
    },
    [],
  );

  const setParOverride = useCallback(
    (holeId: number, par: number | undefined) => {
      setValidations((prev) => {
        const current = prev[holeId] ?? { holeId, yardageAdjustment: 0, tags: [], timestamp: 0 };
        return {
          ...prev,
          [holeId]: { ...current, parOverride: par, timestamp: Date.now() },
        };
      });
    },
    [],
  );

  const toggleTag = useCallback(
    (holeId: number, tag: ValidationTag) => {
      setValidations((prev) => {
        const current = prev[holeId] ?? { holeId, yardageAdjustment: 0, tags: [], timestamp: 0 };
        const tags = current.tags.includes(tag)
          ? current.tags.filter((t) => t !== tag)
          : [...current.tags, tag];
        return {
          ...prev,
          [holeId]: { ...current, tags, timestamp: Date.now() },
        };
      });
    },
    [],
  );

  const clearHole = useCallback((holeId: number) => {
    setValidations((prev) => {
      const next = { ...prev };
      delete next[holeId];
      return next;
    });
  }, []);

  const getEffectiveYardage = useCallback(
    (holeId: number, baseYardage: number) =>
      baseYardage + (validations[holeId]?.yardageAdjustment ?? 0),
    [validations],
  );

  const getEffectivePar = useCallback(
    (holeId: number, basePar: number) =>
      validations[holeId]?.parOverride ?? basePar,
    [validations],
  );

  // ── Summary stats ──────────────────────────────────────────────────────────

  const getSummary = useCallback(() => {
    const entries = Object.values(validations);
    const adjusted = entries.filter((e) => e.yardageAdjustment !== 0);
    const avgAdj =
      adjusted.length > 0
        ? Math.round(adjusted.reduce((a, e) => a + e.yardageAdjustment, 0) / adjusted.length)
        : 0;

    // Count tag occurrences across all holes
    const tagCounts: Partial<Record<ValidationTag, number>> = {};
    for (const e of entries) {
      for (const tag of e.tags) {
        tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
      }
    }
    const topTags = (Object.entries(tagCounts) as [ValidationTag, number][])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    return { adjusted, avgAdj, topTags, totalValidated: entries.length };
  }, [validations]);

  return {
    validationMode,
    setValidationMode,
    validations,
    getHoleValidation,
    setYardageAdjustment,
    setParOverride,
    toggleTag,
    clearHole,
    getEffectiveYardage,
    getEffectivePar,
    getSummary,
  };
};
