let player = {
  missBias: null,
  tendencies: {
    left: 0,
    right: 0,
    straight: 0,
  },
};

export const updatePlayerModel = (shot) => {
  if (!shot || !shot.result) return;

  if (typeof player.tendencies[shot.result] !== 'number') {
    player.tendencies[shot.result] = 0;
  }

  player.tendencies[shot.result]++;

  const { left, right } = player.tendencies;

  if (right >= left + 3) player.missBias = 'right';
  else if (left >= right + 3) player.missBias = 'left';
  else player.missBias = null;
};

export const getPlayerModel = () => player;

export const resetPlayerModel = () => {
  player = {
    missBias: null,
    tendencies: { left: 0, right: 0, straight: 0 },
  };
};