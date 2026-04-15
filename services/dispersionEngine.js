export const getDispersion = ({
  playerModel,
  recentShots,
}) => {
  if (!recentShots || recentShots.length < 3) {
    return { expectedMiss: playerModel?.missBias || 'center' };
  }

  let right = 0;
  let left = 0;

  recentShots.slice(-3).forEach((shot) => {
    if (shot.result === 'right') right++;
    if (shot.result === 'left') left++;
  });

  if (right >= 2) return { expectedMiss: 'right' };
  if (left >= 2) return { expectedMiss: 'left' };

  return { expectedMiss: 'center' };
};