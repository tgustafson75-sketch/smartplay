/**
 * holeData.js — Static hole layout data with pin/fairway coords and hazards.
 *
 * Each entry contains:
 *   pin           — GPS centre of the green (used for live distance calc)
 *   fairwayCenter — safe landing zone (default aim when hazards threaten)
 *   hazards       — array of {type, lat, lng, radius} in yards
 *
 * Coords are intentionally zeroed out so the file ships without revealing
 * a specific course. Walk to the relevant position and update the lat/lng
 * values (or wire into the calibration system via saveGreenLocation).
 *
 * The structure mirrors menifeeLakes.js but adds GPS geometry for the
 * strategy engine to do proximity math via getDistanceToTarget().
 */

// Placeholder coords — replace with real values per course.
// Format: { lat: <decimal-degrees>, lng: <decimal-degrees> }
const PLACEHOLDER = { lat: 0, lng: 0 };

export const holeData = {
  1: {
    pin: { ...PLACEHOLDER },
    fairwayCenter: { ...PLACEHOLDER },
    hazards: [
      { type: 'water', lat: 0, lng: 0, radius: 25 },
    ],
  },
  2: {
    pin: { ...PLACEHOLDER },
    fairwayCenter: { ...PLACEHOLDER },
    hazards: [
      { type: 'bunker', lat: 0, lng: 0, radius: 15 },
    ],
  },
  3: {
    pin: { ...PLACEHOLDER },
    fairwayCenter: { ...PLACEHOLDER },
    hazards: [],
  },
  4: {
    pin: { ...PLACEHOLDER },
    fairwayCenter: { ...PLACEHOLDER },
    hazards: [
      { type: 'water', lat: 0, lng: 0, radius: 30 },
    ],
  },
  5: {
    pin: { ...PLACEHOLDER },
    fairwayCenter: { ...PLACEHOLDER },
    hazards: [
      { type: 'bunker', lat: 0, lng: 0, radius: 20 },
    ],
  },
  6:  { pin: { ...PLACEHOLDER }, fairwayCenter: { ...PLACEHOLDER }, hazards: [] },
  7:  { pin: { ...PLACEHOLDER }, fairwayCenter: { ...PLACEHOLDER }, hazards: [] },
  8:  { pin: { ...PLACEHOLDER }, fairwayCenter: { ...PLACEHOLDER }, hazards: [] },
  9:  { pin: { ...PLACEHOLDER }, fairwayCenter: { ...PLACEHOLDER }, hazards: [] },
  10: { pin: { ...PLACEHOLDER }, fairwayCenter: { ...PLACEHOLDER }, hazards: [] },
  11: { pin: { ...PLACEHOLDER }, fairwayCenter: { ...PLACEHOLDER }, hazards: [] },
  12: { pin: { ...PLACEHOLDER }, fairwayCenter: { ...PLACEHOLDER }, hazards: [] },
  13: { pin: { ...PLACEHOLDER }, fairwayCenter: { ...PLACEHOLDER }, hazards: [] },
  14: { pin: { ...PLACEHOLDER }, fairwayCenter: { ...PLACEHOLDER }, hazards: [] },
  15: { pin: { ...PLACEHOLDER }, fairwayCenter: { ...PLACEHOLDER }, hazards: [] },
  16: { pin: { ...PLACEHOLDER }, fairwayCenter: { ...PLACEHOLDER }, hazards: [] },
  17: { pin: { ...PLACEHOLDER }, fairwayCenter: { ...PLACEHOLDER }, hazards: [] },
  18: { pin: { ...PLACEHOLDER }, fairwayCenter: { ...PLACEHOLDER }, hazards: [] },
};
