/**
 * The player's distance unit, for components.
 *
 * A thin selector over settingsStore plus the formatters bound to it, so a screen never has to
 * remember to pass the unit to services/distanceUnits and never has to decide what to do with a
 * null. Every conversion still happens in that one pure module — this only saves the lookup.
 *
 * Subscribed, not read once: `distance_unit` is changeable from Settings AND by voice
 * ("switch to metres"), so a screen already on-screen has to re-render when it changes. Reading
 * `getState()` here instead would leave the hole view in yards until the player navigated away and
 * back, which is the shape of bug this repo calls a half-wired fix.
 */
import { useCallback } from 'react';
import { useSettingsStore } from '../store/settingsStore';
import {
  formatDistance,
  formatDistanceCompact,
  formatDistanceRange,
  toDisplayDistance,
  unitLabel,
  compactUnitLabel,
  type DistanceUnit,
} from '../services/distanceUnits';

export function useDistanceUnit(): DistanceUnit {
  return useSettingsStore((s) => (s.distance_unit === 'meters' ? 'meters' : 'yards'));
}

export function useDistanceFormat() {
  const unit = useDistanceUnit();
  return {
    unit,
    /** "145 yds" / "133 m" */
    fmt: useCallback((yards: number | null | undefined, opts?: { dash?: string; space?: boolean }) =>
      formatDistance(yards, unit, opts), [unit]),
    /** "145y" / "133m" — for readouts under a big numeral */
    fmtCompact: useCallback((yards: number | null | undefined, dash?: string) =>
      formatDistanceCompact(yards, unit, dash), [unit]),
    /** "138-145 yds" / "126-133 m" */
    fmtRange: useCallback((lo: number | null | undefined, hi: number | null | undefined) =>
      formatDistanceRange(lo, hi, unit), [unit]),
    /** The converted NUMBER only, for a layout that renders the suffix separately. */
    toDisplay: useCallback((yards: number | null | undefined) => toDisplayDistance(yards, unit), [unit]),
    /** 'yds' | 'm' */
    label: unitLabel(unit),
    /** 'y' | 'm' */
    labelShort: compactUnitLabel(unit),
  };
}
