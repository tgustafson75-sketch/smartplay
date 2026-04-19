const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'app', '(tabs)', 'caddie.tsx');
let c = fs.readFileSync(filePath, 'utf8');

// ── 1. Insert strategy+aim row before stepper row ─────────────────────────
// Anchor: the line "        <View style={s.stepperRow}>"
const STEPPER_ANCHOR = '        <View style={s.stepperRow}>';
const stepperIdx = c.indexOf(STEPPER_ANCHOR);
if (stepperIdx === -1) { console.error('STEPPER_ANCHOR not found'); process.exit(1); }

const STRATEGY_ROW = `        {/* \u2500\u2500 Strategy + Aim Row \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */}
        <View style={s.strategyRow}>
          <Text style={s.strategyLine}>
            {strategyMode === 'attack' ? 'Attack' : strategyMode === 'safe' ? 'Play safe' : 'Balanced'}
            {' \u00b7 '}
            {goalMode === 'break90' ? 'Break 90' : goalMode === 'break80' ? 'Break 80' : 'Enjoy'}
          </Text>
          <View style={s.aimRow}>
            {(['left', 'center', 'right'] as const).map((a) => (
              <Pressable
                key={a}
                style={[s.aimBtn, aimTarget === a && s.aimBtnActive]}
                onPress={() => setAimTarget(a)}
              >
                <Text style={[s.aimBtnText, aimTarget === a && s.aimBtnTextActive]}>
                  {a === 'left' ? 'L' : a === 'center' ? 'CTR' : 'R'}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

`;

c = c.slice(0, stepperIdx) + STRATEGY_ROW + c.slice(stepperIdx);

// ── 2. Insert shot buttons + pattern preview before ShotCorrectionPrompt ──
// Anchor: "        {showCorrection && ("
const CORRECTION_ANCHOR = '        {showCorrection && (';
const corrIdx = c.indexOf(CORRECTION_ANCHOR);
if (corrIdx === -1) { console.error('CORRECTION_ANCHOR not found'); process.exit(1); }

const SHOT_BUTTONS = `        {\u007b/* \u2500\u2500 Shot Buttons [LEFT / STRAIGHT / RIGHT] \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */}
        <View style={s.shotRow}>
          {([
            { r: 'left',     l: 'Left',     style: s.shotBtnLeft     },
            { r: 'straight', l: 'Straight', style: s.shotBtnStraight },
            { r: 'right',    l: 'Right',    style: s.shotBtnRight    },
          ] as const).map(({ r, l, style }) => (
            <Pressable
              key={r}
              style={[s.shotBtn, style]}
              onPress={() => void recordShot(r)}
            >
              <Text style={s.shotBtnText}>{l}</Text>
            </Pressable>
          ))}
        </View>

        {/* Pattern preview */}
        {pattern.currentPattern !== 'neutral' && pattern.patternConfidence > 30 && (
          <View style={s.patternRow}>
            <MCIcon
              name={pattern.currentPattern.includes('right') ? 'trending-up' : 'trending-down'}
              size={13}
              color={Palette.warn}
            />
            <Text style={s.patternText} numberOfLines={1}>
              {pattern.patternInsight.split('.')[0]} \u00b7 {pattern.patternConfidence}%
            </Text>
          </View>
        )}

`;

c = c.slice(0, corrIdx) + SHOT_BUTTONS + c.slice(corrIdx);

fs.writeFileSync(filePath, c, 'utf8');
console.log('Strategy+aim row and shot buttons injected. File length:', c.length);
