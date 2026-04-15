/**
 * holeData.js — Menifee Lakes (Palms) hole layout data.
 *
 * GPS pin/fairway coordinates are placeholder zeros until calibrated on-course
 * via the in-app green calibration system (saveGreenLocation).
 * Hazard types and radii are real course data.
 */

const PLACEHOLDER = { lat: 0, lng: 0 };

export const holeData = {
  1:  { pin: { ...PLACEHOLDER }, fairwayCenter: { ...PLACEHOLDER }, hazards: [] },
  2:  { pin: { ...PLACEHOLDER }, fairwayCenter: { ...PLACEHOLDER }, hazards: [
        { type: 'water',  lat: 0, lng: 0, radius: 30, position: 'short-left' },
      ]},
  3:  { pin: { ...PLACEHOLDER }, fairwayCenter: { ...PLACEHOLDER }, hazards: [
        { type: 'trees',  lat: 0, lng: 0, radius: 20, position: 'right' },
      ]},
  4:  { pin: { ...PLACEHOLDER }, fairwayCenter: { ...PLACEHOLDER }, hazards: [
        { type: 'bunker', lat: 0, lng: 0, radius: 18, position: 'right' },
      ]},
  5:  { pin: { ...PLACEHOLDER }, fairwayCenter: { ...PLACEHOLDER }, hazards: [] },
  6:  { pin: { ...PLACEHOLDER }, fairwayCenter: { ...PLACEHOLDER }, hazards: [
        { type: 'bunker', lat: 0, lng: 0, radius: 15, position: 'front' },
      ]},
  7:  { pin: { ...PLACEHOLDER }, fairwayCenter: { ...PLACEHOLDER }, hazards: [
        { type: 'water',  lat: 0, lng: 0, radius: 25, position: 'right' },
      ]},
  8:  { pin: { ...PLACEHOLDER }, fairwayCenter: { ...PLACEHOLDER }, hazards: [
        { type: 'bunker', lat: 0, lng: 0, radius: 15, position: 'short-left' },
      ]},
  9:  { pin: { ...PLACEHOLDER }, fairwayCenter: { ...PLACEHOLDER }, hazards: [] },
  10: { pin: { ...PLACEHOLDER }, fairwayCenter: { ...PLACEHOLDER }, hazards: [] },
  11: { pin: { ...PLACEHOLDER }, fairwayCenter: { ...PLACEHOLDER }, hazards: [] },
  12: { pin: { ...PLACEHOLDER }, fairwayCenter: { ...PLACEHOLDER }, hazards: [] },
  13: { pin: { ...PLACEHOLDER }, fairwayCenter: { ...PLACEHOLDER }, hazards: [
        { type: 'bunker', lat: 0, lng: 0, radius: 18, position: 'left' },
        { type: 'bunker', lat: 0, lng: 0, radius: 18, position: 'right' },
      ]},
  14: { pin: { ...PLACEHOLDER }, fairwayCenter: { ...PLACEHOLDER }, hazards: [] },
  15: { pin: { ...PLACEHOLDER }, fairwayCenter: { ...PLACEHOLDER }, hazards: [
        { type: 'water',  lat: 0, lng: 0, radius: 20, position: 'short' },
      ]},
  16: { pin: { ...PLACEHOLDER }, fairwayCenter: { ...PLACEHOLDER }, hazards: [
        { type: 'water',  lat: 0, lng: 0, radius: 40, position: 'surrounds' },
      ]},
  17: { pin: { ...PLACEHOLDER }, fairwayCenter: { ...PLACEHOLDER }, hazards: [
        { type: 'water',  lat: 0, lng: 0, radius: 30, position: 'left' },
      ]},
  18: { pin: { ...PLACEHOLDER }, fairwayCenter: { ...PLACEHOLDER }, hazards: [] },
};
