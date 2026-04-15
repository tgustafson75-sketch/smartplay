export const getHandicapMode = ({ roundStatus }) => {
  if (roundStatus === 'over') return { mode: 'protect' };
  if (roundStatus === 'under') return { mode: 'attack' };
  return { mode: 'neutral' };
};