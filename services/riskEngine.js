export const getRiskProfile = ({
  holeStrategy,
  shotHistory,
  pressurePattern,
}) => {
  let riskLevel = 'medium';

  if (holeStrategy?.strategy === 'safe') riskLevel = 'low';
  if (holeStrategy?.strategy === 'aggressive') riskLevel = 'high';
  if (pressurePattern === 'right' || pressurePattern === 'left') riskLevel = 'low';

  return {
    riskLevel,
    intent:
      riskLevel === 'low'
        ? 'Play for control'
        : riskLevel === 'high'
          ? 'Take the shot confidently'
          : 'Stay balanced',
  };
};