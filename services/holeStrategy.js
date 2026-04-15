export const getHoleStrategy = ({
  par,
  distanceToPin,
  hazards = [],
  playerMissPattern,
}) => {
  let targetBias = 'center';
  let strategy = 'neutral';

  if (hazards.includes('water-left')) targetBias = 'right';
  if (hazards.includes('water-right')) targetBias = 'left';

  if (playerMissPattern === 'right') targetBias = 'left';
  if (playerMissPattern === 'left') targetBias = 'right';

  if (par === 5) strategy = 'aggressive';
  if (Number(distanceToPin) > 180) strategy = 'safe';

  return {
    targetBias,
    strategy,
    notes: 'Play smart based on current tendencies',
  };
};