/**
 * features/playView/data/hazards.ts
 *
 * Per-hole hazard definitions. Each hazard has a GPS position, a type
 * (water | bunker | ob | tree), and a display label.
 *
 * GPS values are placeholders — replace with on-course measurements
 * or Google Maps coordinates aligned to the hole image.
 */

export type HazardType = 'water' | 'bunker' | 'ob' | 'tree';
export type HazardSide = 'left' | 'right' | 'center';

export interface Hazard {
  type:   HazardType;
  lat:    number;
  lng:    number;
  label:  string;
  /** Which side of the fairway the hazard sits on */
  side?:  HazardSide;
}

export const hazards: Record<number, Hazard[]> = {
  1: [
    { type: 'water',  lat: 33.6880, lng: -117.1814, label: 'Water Right',    side: 'right'  },
    { type: 'bunker', lat: 33.6877, lng: -117.1808, label: 'Front Bunker',   side: 'center' },
  ],
  2: [
    { type: 'bunker', lat: 33.6883, lng: -117.1824, label: 'Left Bunker',    side: 'left'   },
    { type: 'bunker', lat: 33.6884, lng: -117.1818, label: 'Right Bunker',   side: 'right'  },
  ],
  3: [
    { type: 'water',  lat: 33.6891, lng: -117.1840, label: 'Pond Left',      side: 'left'   },
  ],
  4: [
    { type: 'bunker', lat: 33.6896, lng: -117.1851, label: 'Fairway Bunker', side: 'right'  },
    { type: 'bunker', lat: 33.6891, lng: -117.1846, label: 'Greenside',      side: 'center' },
  ],
  5: [
    { type: 'ob',     lat: 33.6910, lng: -117.1855, label: 'OB Right',       side: 'right'  },
    { type: 'bunker', lat: 33.6904, lng: -117.1860, label: 'Left Bunker',    side: 'left'   },
  ],
  6: [
    { type: 'water',  lat: 33.6920, lng: -117.1880, label: 'Lake Left',      side: 'left'   },
  ],
  7: [
    { type: 'bunker', lat: 33.6922, lng: -117.1891, label: 'Cross Bunker',   side: 'center' },
    { type: 'bunker', lat: 33.6920, lng: -117.1886, label: 'Right Bunker',   side: 'right'  },
  ],
  8: [
    { type: 'water',  lat: 33.6930, lng: -117.1905, label: 'Water Front',    side: 'center' },
    { type: 'bunker', lat: 33.6927, lng: -117.1898, label: 'Greenside',      side: 'center' },
  ],
  9: [
    { type: 'water',  lat: 33.6940, lng: -117.1918, label: 'Water Left',     side: 'left'   },
    { type: 'ob',     lat: 33.6935, lng: -117.1910, label: 'OB Right',       side: 'right'  },
  ],
  10: [
    { type: 'bunker', lat: 33.6948, lng: -117.1927, label: 'Fairway Bunker', side: 'left'   },
  ],
  11: [
    { type: 'water',  lat: 33.6955, lng: -117.1938, label: 'Pond Right',     side: 'right'  },
    { type: 'bunker', lat: 33.6950, lng: -117.1934, label: 'Greenside',      side: 'center' },
  ],
  12: [
    { type: 'water',  lat: 33.6966, lng: -117.1957, label: 'Water Front',    side: 'center' },
  ],
  13: [
    { type: 'bunker', lat: 33.6972, lng: -117.1967, label: 'Left Bunker',    side: 'left'   },
    { type: 'bunker', lat: 33.6970, lng: -117.1962, label: 'Right Bunker',   side: 'right'  },
  ],
  14: [
    { type: 'ob',     lat: 33.6980, lng: -117.1982, label: 'OB Left',        side: 'left'   },
    { type: 'bunker', lat: 33.6974, lng: -117.1975, label: 'Greenside',      side: 'center' },
  ],
  15: [
    { type: 'water',  lat: 33.6988, lng: -117.1994, label: 'Pond Left',      side: 'left'   },
  ],
  16: [
    { type: 'bunker', lat: 33.6999, lng: -117.2008, label: 'Fairway Bunker', side: 'right'  },
    { type: 'water',  lat: 33.6997, lng: -117.2006, label: 'Water Right',    side: 'right'  },
  ],
  17: [
    { type: 'water',  lat: 33.7004, lng: -117.2020, label: 'Lake Right',     side: 'right'  },
    { type: 'bunker', lat: 33.7002, lng: -117.2016, label: 'Front Bunker',   side: 'center' },
  ],
  18: [
    { type: 'water',  lat: 33.7010, lng: -117.2030, label: 'Water Left',     side: 'left'   },
    { type: 'bunker', lat: 33.7008, lng: -117.2025, label: 'Greenside L',    side: 'left'   },
    { type: 'bunker', lat: 33.7006, lng: -117.2023, label: 'Greenside R',    side: 'right'  },
  ],
};
