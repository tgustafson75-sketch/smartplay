// Menifee Lakes — Palms Course hazard data (all 18 holes)
// danger: primary obstacle to avoid | bias: recommended aim direction
// Coordinates are calibrated in-app via the green calibration system
export const menifeeLakes = {
  1:  { danger: 'none',                 bias: 'center',       note: 'Wide landing area, open tee shot' },
  2:  { danger: 'water short-left',     bias: 'center-right', note: 'Par 4 — water short-left, aim center' },
  3:  { danger: 'trees right corner',   bias: 'left center',  note: 'Dogleg right, trees on corner' },
  4:  { danger: 'bunkers right',        bias: 'left center',  note: 'Reachable par 5, bunkers right' },
  5:  { danger: 'none',                 bias: 'center',       note: 'Long par 4, slight dogleg left' },
  6:  { danger: 'bunker front',         bias: 'center',       note: 'Bunker guards green, aim center' },
  7:  { danger: 'water right of green', bias: 'left center',  note: 'Water right of green, lay up left' },
  8:  { danger: 'bunker short-left',    bias: 'right center', note: 'Tight fairway, bunker short-left' },
  9:  { danger: 'none',                 bias: 'center',       note: 'Finishing front nine, birdie chance' },
  10: { danger: 'none',                 bias: 'center',       note: 'Slight dogleg right, open approach' },
  11: { danger: 'none',                 bias: 'center',       note: 'Long par 4, elevated green' },
  12: { danger: 'none',                 bias: 'center',       note: 'Short iron to elevated green' },
  13: { danger: 'bunkers both sides',   bias: 'center',       note: 'Long par 5, bunkers both sides' },
  14: { danger: 'none',                 bias: 'center',       note: 'Straight hole, tight landing zone' },
  15: { danger: 'water short',          bias: 'center-right', note: 'Subtle dogleg left, water short' },
  16: { danger: 'all carry required',   bias: 'center',       note: 'Island green, all carry required' },
  17: { danger: 'water left off tee',   bias: 'right center', note: 'Water left off tee, bail right' },
  18: { danger: 'none',                 bias: 'center',       note: 'Finishing hole, risk-reward approach' },
};

// Menifee Lakes — Lakes Course hazard data (all 18 holes)
export const menifeeLakesLakes = {
  1:  { danger: 'lake left',            bias: 'right center', note: 'Lake left, wide tee' },
  2:  { danger: 'water hazard',         bias: 'center',       note: 'Over water hazard' },
  3:  { danger: 'creek crosses fairway',bias: 'lay up',       note: 'Creek crosses fairway' },
  4:  { danger: 'water carry',          bias: 'center',       note: 'Carry over water' },
  5:  { danger: 'bunker right',         bias: 'left center',  note: 'Dogleg right, bunker' },
  6:  { danger: 'water right of green', bias: 'left center',  note: 'Water right of green' },
  7:  { danger: 'island green',         bias: 'center',       note: 'Island green, par 3' },
  8:  { danger: 'two lakes',            bias: 'center',       note: 'Two lakes in play' },
  9:  { danger: 'none',                 bias: 'center',       note: 'Finishing nine, uphill' },
  10: { danger: 'lake right',           bias: 'left center',  note: 'Lake along right side' },
  11: { danger: 'creek short',          bias: 'center',       note: 'Short iron over creek' },
  12: { danger: 'none',                 bias: 'center',       note: 'Reachable eagle hole' },
  13: { danger: 'water left',           bias: 'right center', note: 'Tight tee, water left' },
  14: { danger: 'bunkers front',        bias: 'center',       note: 'Bunkers guard green' },
  15: { danger: 'wind off lake',        bias: 'club up',      note: 'Wind off the lake' },
  16: { danger: 'lake on corner',       bias: 'lay up',       note: 'Dogleg around lake' },
  17: { danger: 'none',                 bias: 'center',       note: 'Eagle opportunity' },
  18: { danger: 'lake behind green',    bias: 'center-front', note: 'Lake behind green' },
};