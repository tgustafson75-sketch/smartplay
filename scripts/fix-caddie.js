// Temporary script to insert getContextualAdvice into caddie.tsx
const fs = require('fs');
const path = 'C:\\Users\\tgust\\SmartPlayCaddieV2\\app\\(tabs)\\caddie.tsx';
let c = fs.readFileSync(path, 'utf8');

const getContextualAdviceFn = `
  const getContextualAdvice = useCallback((): string => {
    const miss = getMissPattern();
    const dist = displayDistance;
    const fav  = getFavoriteClub();
    let advice = '';
    if      (dist <= 100) advice = \`Inside 100 yards. \${club} \u2014 focus on landing zone.\`;
    else if (dist <= 150) advice = \`\${dist} yards. \${club} \u2014 commit and stay smooth.\`;
    else if (dist <= 200) advice = \`\${dist} yards. Smooth tempo carries you there.\`;
    else                  advice = \`\${dist} yards \u2014 full swing. \${fav} has been reliable.\`;
    if (miss === 'right') advice += ' Aim left center.';
    else if (miss === 'left') advice += ' Release the club, avoid the pull.';
    if (goalMode === 'break90')    advice += ' Par saves the round.';
    if (strategyMode === 'attack') advice += ' Play to the flag.';
    else if (strategyMode === 'safe') advice += ' Play center green.';
    // Subtle AI-learned adjustment \u2014 only appears when confidence is medium/high
    const aiHint = buildAiHint(aiProfile, club);
    if (aiHint) advice += \` \${aiHint}.\`;
    return advice;
  }, [getMissPattern, getFavoriteClub, displayDistance, club, goalMode, strategyMode, aiProfile]);

`;

// Find anchor: "const aiProfile = useAiProfileStore();" followed by blank line then "  const voiceStyle"
const anchor = '  const aiProfile = useAiProfileStore();\r\n\r\n  const voiceStyle';
const anchorLF = '  const aiProfile = useAiProfileStore();\n\n  const voiceStyle';

if (c.includes(anchor)) {
  c = c.replace(anchor, '  const aiProfile = useAiProfileStore();\r\n' + getContextualAdviceFn.replace(/\n/g, '\r\n') + '  const voiceStyle');
  fs.writeFileSync(path, c, 'utf8');
  console.log('SUCCESS (CRLF)');
} else if (c.includes(anchorLF)) {
  c = c.replace(anchorLF, '  const aiProfile = useAiProfileStore();\n' + getContextualAdviceFn + '  const voiceStyle');
  fs.writeFileSync(path, c, 'utf8');
  console.log('SUCCESS (LF)');
} else {
  console.log('NOT FOUND');
  // Print first occurrence context
  const idx = c.indexOf('const aiProfile');
  console.log('Context:', JSON.stringify(c.substring(idx, idx + 100)));
}
