const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, '..', 'app', '(tabs)', 'caddie.tsx');
let c = fs.readFileSync(filePath, 'utf8');

// Fix the broken JSX comment
c = c.replace(
  '{/* \u2500\u2500 Shot Buttons [LEFT / STRAIGHT / RIGHT] \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */',
  '{/* \u2500\u2500 Shot Buttons [LEFT / STRAIGHT / RIGHT] \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */}'
);

fs.writeFileSync(filePath, c, 'utf8');
console.log('Fixed comment. Matches remaining:', (c.match(/Shot Buttons/g)||[]).length);
