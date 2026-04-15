let clubData = {};

export const recordClubDistance = (club, distance) => {
  if (!club || !distance) return;

  if (!clubData[club]) {
    clubData[club] = [];
  }

  clubData[club].push(Number(distance));
};

export const getClubDistance = (club) => {
  const data = clubData[club];
  if (!data || data.length === 0) return null;

  const avg = data.reduce((a, b) => a + b, 0) / data.length;
  return Math.round(avg);
};

export const resetClubData = () => {
  clubData = {};
};