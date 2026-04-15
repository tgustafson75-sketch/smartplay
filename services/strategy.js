/**
 * strategy.js — GPS-aware target + aim strategy engine.
 *
 * Combines live player location, hole geometry (pin, fairway centre, hazards),
 * and shot dispersion bias to produce a recommended aim point and a plain-
 * English strategy note for the caddie prompt.
 *
 * Returns null when location or hole data is unavailable so callers can safely
 * skip without crashing.
 *
 * Usage:
 *   import { getTargetStrategy } from '../services/strategy';
 *   const s = getTargetStrategy({ playerLocation, hole: holeData[currentHole], dispersion });
 *   // { aimPoint: { lat, lng }, strategyNote: 'Favor left side...' }
 */

import { getDistanceToTarget } from './distance';

/**
 * @param {{
 *   playerLocation: { latitude: number; longitude: number } | null,
 *   hole: { pin: object, fairwayCenter: object, hazards: Array } | null,
 *   dispersion: { bias: string, tendency: string },
 * }} params
 * @returns {{ aimPoint: object, strategyNote: string } | null}
 */
export const getTargetStrategy = ({ playerLocation, hole, dispersion }) => {
  if (!playerLocation || !hole) return null;

  const { pin, fairwayCenter, hazards = [] } = hole;

  // Default: attack the pin
  let aimPoint = pin;
  let strategyNote = 'Attack pin';

  // Adjust aim for dispersion bias — start with player tendency
  if (dispersion?.bias === 'right') {
    aimPoint = fairwayCenter;
    strategyNote = 'Favor left side to offset miss right';
  } else if (dispersion?.bias === 'left') {
    aimPoint = fairwayCenter;
    strategyNote = 'Favor right side to offset miss left';
  }

  // Override if player is within danger range of a hazard (±20 yd buffer)
  // Pin coords being zero means no real data yet — skip proximity check.
  if (playerLocation.latitude !== 0 && playerLocation.longitude !== 0) {
    for (const hazard of hazards) {
      if (!hazard.lat || !hazard.lng) continue; // placeholder coord — skip
      const distToHazard = getDistanceToTarget(
        { latitude: playerLocation.latitude, longitude: playerLocation.longitude },
        { latitude: hazard.lat, longitude: hazard.lng }
      );
      if (distToHazard < hazard.radius + 20) {
        aimPoint = fairwayCenter;
        strategyNote = `Avoid ${hazard.type} — play safe center`;
        break; // first hazard threat wins
      }
    }
  }

  return { aimPoint, strategyNote };
};
