export const getClubRecommendation = ({
  distanceToPin,
  wind,
  riskLevel,
}) => {
  const yardage = Number(distanceToPin) || 0;
  let club = '7 iron';

  if (yardage > 200) club = '3 wood';
  else if (yardage > 170) club = '5 iron';
  else if (yardage > 140) club = '7 iron';
  else if (yardage > 110) club = '9 iron';
  else club = 'wedge';

  let adjustment = '';
  if (wind === 'head') adjustment = 'Take one extra club';
  if (riskLevel === 'low') adjustment = 'Favor control over distance';

  return { club, adjustment };
};