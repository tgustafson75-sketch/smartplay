/**
 * i18n-shared — ONE definition of "this string is user-facing".
 *
 * 2026-09-11 (release 1.5) — the ESLint rule and the codemod must agree EXACTLY. If the gate flags
 * a string the codemod does not rewrite, the build stays red and someone disables the rule; if the
 * codemod rewrites a string the gate does not flag, it invents keys nobody asked for. Two copies of
 * a predicate is the same shape of defect this codebase has hit repeatedly — a fact with two owners
 * drifts the moment one side is edited. So the lists and the prose test live here, once, and both
 * consumers require them. [[two-owners-is-the-root-cause]]
 */
'use strict';

/** Components whose *children* are rendered to the player. */
const TEXT_COMPONENTS = [
  'Text', 'RNText', 'ThemedText', 'AppText', 'Heading', 'Title', 'Subtitle',
  'Label', 'Paragraph', 'Caption', 'Chip', 'Badge', 'Button', 'Pressable.Text',
];

/** Props whose string value is rendered or spoken to the player. */
const USER_FACING_PROPS = [
  'title', 'label', 'placeholder', 'message', 'subtitle', 'heading', 'caption',
  'accessibilityLabel', 'accessibilityHint', 'accessibilityValue',
  'header', 'footer', 'emptyText', 'errorText', 'helperText', 'text',
  'confirmLabel', 'cancelLabel', 'buttonText', 'ctaLabel', 'alt',
];

/**
 * Props that carry identifiers, not prose — the ONLY escape hatch, named here rather than via
 * per-file disable comments. `name` covers icon names, `source`/`href`/`uri` are locations,
 * `testID`/`nativeID` are test hooks, `key`/`id` are React identity.
 */
const IGNORED_PROPS = [
  'testID', 'nativeID', 'key', 'id', 'name', 'icon', 'iconName', 'family',
  'style', 'className', 'variant', 'size', 'color', 'backgroundColor', 'tintColor',
  'href', 'uri', 'source', 'src', 'to', 'route', 'pathname', 'screen',
  'type', 'mode', 'kind', 'role', 'keyboardType', 'autoComplete', 'textContentType',
  'resizeMode', 'entering', 'exiting', 'sharedTransitionTag', 'collapsable',
  'accessibilityRole', 'importantForAccessibility', 'dataSet', 'format',
];

/** Call expressions whose string arguments are shown to the player. */
const ALERT_CALLEES = ['Alert.alert', 'Toast.show', 'ToastAndroid.show', 'Alert.prompt', 'showToast', 'toast'];

/**
 * OWNER / DEBUG SCREENS — excluded from the 1.5 codemod by Tim's decision.
 *
 * Only the owner ever opens these (Settings -> Owner Tools, gated by OWNER_EMAILS). Translating
 * them would add ~174 keys to EVERY locale file, including ja and ko where a human has to review
 * values for text no player will ever read. They keep their English literals and are excluded from
 * the lint rule by path, not by disable comments.
 */
const OWNER_SCREEN_PATTERNS = [
  /(^|\/)app\/gps-test\.tsx$/,
  /(^|\/)app\/owner-logs\.tsx$/,
  /(^|\/)app\/voice-misses\.tsx$/,
  /(^|\/)app\/api-debug\.tsx$/,
  /-debug\.tsx$/,
  /(^|\/)app\/author\//,
  /(^|\/)app\/swing-sessions-debug\.tsx$/,
  /(^|\/)app\/simround-auto\.tsx$/,
  /**
   * 2026-09-11 — added after the first write run translated app/owner-checklist.tsx, which is
   * owner-only end to end (`isOwnerEmail` gates the whole render). These five gate their ENTIRE
   * screen on owner status, so every string in them is text only Tim will ever read.
   *
   * NOT excluded, deliberately, even though they contain owner-gated SECTIONS: app/settings.tsx
   * (239 player-facing strings), app/paywall.tsx (the purchase screen), app/(tabs)/dashboard.tsx
   * and app/_layout.tsx. A screen that merely contains an owner block is still a player screen —
   * excluding those would have silently left the two most-read screens in the app in English.
   */
  /(^|\/)app\/owner-[\w-]+\.tsx$/,
  /(^|\/)app\/harness\.tsx$/,
  /(^|\/)app\/coach-knowledge\.tsx$/,
  /(^|\/)app\/mark-green\.tsx$/,
];

function isOwnerScreen(relPath) {
  const p = String(relPath).replace(/\\/g, '/');
  return OWNER_SCREEN_PATTERNS.some((re) => re.test(p));
}

/**
 * A literal worth translating contains at least two consecutive letters. Identifiers — camelCase,
 * snake_case, kebab-case, dotted paths, URLs, colors, handles — are excluded by shape, which is why
 * icon names like "golf-outline" and testIDs like "hole_card" never reach the report.
 */
function looksLikeProse(raw) {
  const s = String(raw).trim();
  if (s.length < 2) return false;
  if (!/[A-Za-z]{2}/.test(s)) return false;
  if (/^[a-z0-9]+([A-Z][a-z0-9]*)*$/.test(s)) return false;      // camelCase / single lowercase word
  if (/^[a-z0-9_]+$/i.test(s) && s.includes('_')) return false;   // snake_case
  if (/^[a-z0-9-]+$/i.test(s) && s.includes('-')) return false;   // kebab-case
  if (/^[\w.]+$/.test(s) && s.includes('.')) return false;        // dotted.path
  if (/^https?:\/\//.test(s)) return false;
  if (/^[#@/]/.test(s)) return false;                             // colors, handles, paths
  return true;
}

/** `Text`, `MyText`, `Text.Bold` — anything whose final segment renders text. */
function isTextComponentName(name) {
  const tail = String(name).split('.').pop() ?? name;
  return TEXT_COMPONENTS.includes(tail) || /Text$/.test(tail);
}

/**
 * The same owner-screen set expressed as ESLint flat-config globs. Derived from ONE list with
 * OWNER_SCREEN_PATTERNS above so the rule and the codemod can never disagree about what counts as
 * an owner screen — the regexes drive the codemod, these globs drive the lint config, and both are
 * edited here together.
 */
const OWNER_SCREEN_GLOBS = [
  'app/gps-test.tsx',
  'app/owner-logs.tsx',
  'app/voice-misses.tsx',
  'app/api-debug.tsx',
  'app/**/*-debug.tsx',
  'app/*-debug.tsx',
  'app/author/**',
  'app/swing-sessions-debug.tsx',
  'app/simround-auto.tsx',
  'app/owner-*.tsx',
  'app/harness.tsx',
  'app/coach-knowledge.tsx',
  'app/mark-green.tsx',
];

module.exports = {
  TEXT_COMPONENTS, USER_FACING_PROPS, IGNORED_PROPS, ALERT_CALLEES,
  OWNER_SCREEN_PATTERNS, OWNER_SCREEN_GLOBS, isOwnerScreen, looksLikeProse, isTextComponentName,
};
