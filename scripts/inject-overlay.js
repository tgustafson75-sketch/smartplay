const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'app', '(tabs)', 'caddie.tsx');
let c = fs.readFileSync(filePath, 'utf8');

// Find the anchor right before the body View
const ANCHOR = '      <View style={s.body}>';
const idx = c.indexOf(ANCHOR);
if (idx === -1) { console.error('ANCHOR not found'); process.exit(1); }

const OVERLAY = `
      {/* Shot feedback overlay — auto hides after 1.75 s */}
      {shotFeedback.visible && (
        <View style={s.feedbackOverlay} pointerEvents="none">
          <View style={[
            s.feedbackBadge,
            shotFeedback.result === 'left'     && { borderColor: '#60a5fa' },
            shotFeedback.result === 'right'    && { borderColor: Palette.miss },
            shotFeedback.result === 'straight' && { borderColor: Palette.positive },
          ]}>
            <Text style={[
              s.feedbackDir,
              shotFeedback.result === 'left'     && { color: '#60a5fa' },
              shotFeedback.result === 'right'    && { color: Palette.miss },
              shotFeedback.result === 'straight' && { color: Palette.positive },
            ]}>
              {shotFeedback.result === 'left' ? '\u2190 Left' : shotFeedback.result === 'right' ? 'Right \u2192' : 'Straight'}
            </Text>
            {!!shotFeedback.insight && (
              <Text style={s.feedbackInsight} numberOfLines={2}>{shotFeedback.insight}</Text>
            )}
          </View>
        </View>
      )}

`;

c = c.slice(0, idx) + OVERLAY + c.slice(idx);
fs.writeFileSync(filePath, c, 'utf8');
console.log('Overlay injected at index', idx, '— file length:', c.length);
