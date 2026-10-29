/**
 * 2026-10-28 (Brain review r9) — A LEFTY IN THE GROUP IS NOT HIS HANDEDNESS.
 *
 * The handedness pattern matched lefty/righty/left-handed ANYWHERE: "We got paired with a lefty",
 * "I'm playing with a lefty today", "Phil Mickelson is a lefty" and "I putt left handed" each set
 * handedness=left — the field resolveSwingerHandedness reads, so every later swing read was mirrored —
 * and "This hole is tough for a righty" set right. The theme pattern's verbs were all optional, so
 * "Dark mode is hurting my eyes" turned dark mode ON. A setting changes on a self-declaration or an
 * order; a sentence that merely mentions the word is the caddie's.
 *
 * BEHAVIOURAL: the real precheck, which runs before /api/kevin on every voice and typed route.
 */
import { precheckLocalIntent } from '../../services/localIntentPrecheck';

const kind = (u: string) => {
  const hit = precheckLocalIntent(u);
  return hit ? `${hit.intent_type}${hit.parameters?.new_value ? `:${String(hit.parameters.new_value)}` : ''}` : null;
};

describe('a mention of handedness or a theme goes to the caddie', () => {
  it.each([
    'We got paired with a lefty',
    "I'm playing with a lefty today",
    'Phil Mickelson is a lefty',
    'I putt left handed',
    'This hole is tough for a righty',
    "I'm not left handed",
    'Dark mode is hurting my eyes',
    'I hate light mode',
  ])('"%s"', (u) => {
    expect(kind(u)).toBe('conversational');
  });
});

describe('a self-declaration or an order still sets it', () => {
  it.each([
    ["I'm left-handed", 'change_setting:left'],
    ["Kevin, I'm a lefty", 'change_setting:left'],
    ['I play southpaw', 'change_setting:left'],
    ['set me to left-handed', 'change_setting:left'],
    ['switch to right handed', 'change_setting:right'],
    ["I'm a righty", 'change_setting:right'],
    ['lefty', 'change_setting:left'],
    ['dark mode', 'change_setting:dark'],
    ['switch to light mode', 'change_setting:light'],
    ['turn on dark mode please', 'change_setting:dark'],
    ['can you switch to dark mode', 'change_setting:dark'],
    ['turn off dark mode', 'change_setting:light'],
    // 2026-10-28 (Brain recheck r10) — addressed to him, softened, or with the comma speech drops.
    ['Switch to dark mode, Kevin', 'change_setting:dark'],
    ['Turn on dark mode for me', 'change_setting:dark'],
    ['Make it dark mode', 'change_setting:dark'],
    ["I'm a lefty, Kevin", 'change_setting:left'],
    ["actually I'm a lefty", 'change_setting:left'],
    ["Kevin I'm left handed", 'change_setting:left'],
  ])('"%s" → %s', (u, want) => {
    expect(kind(u)).toBe(want);
  });
});
