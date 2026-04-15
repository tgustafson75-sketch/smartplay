let roundState = {
  score: 0,
  holesPlayed: 0,
};

export const updateScore = (par, strokes) => {
  roundState.score += (Number(strokes) - Number(par));
  roundState.holesPlayed += 1;
};

export const getRoundStatus = () => {
  if (roundState.score > 3) return 'over';
  if (roundState.score < 0) return 'under';
  return 'even';
};

export const resetRoundState = () => {
  roundState = { score: 0, holesPlayed: 0 };
};

export const getRoundState = () => roundState;