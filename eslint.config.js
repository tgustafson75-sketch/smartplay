// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const noHardcodedJsxText = require('./eslint-rules/no-hardcoded-jsx-text');
const { OWNER_SCREEN_GLOBS } = require('./eslint-rules/i18n-shared');

/**
 * 2026-09-11 (release 1.5) — the i18n guard is registered as a LOCAL PLUGIN, not a separate lint
 * pass, so `npm run lint` and every editor integration see it without extra wiring.
 *
 * It is scoped to app/ and components/ — the screens a player actually reads. services/ and api/
 * hold prose too (caddie lines, TTS text), but those go through their own locale-aware paths and
 * flagging them here would bury the screens under noise the codemod cannot fix.
 */
const i18nPlugin = { rules: { 'no-hardcoded-jsx-text': noHardcodedJsxText } };

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'ios/*', 'android/*', 'eslint-rules/*'],
    rules: {
      /**
       * 2026-09-11 — OFF, DELIBERATELY, AND THE 553 SUPPRESSIONS IT REQUIRED ARE DELETED WITH IT.
       *
       * A lazy `require()` is this codebase's documented way of breaking an import cycle and of
       * loading a native module that may not exist in a given build:
       *
       *   services/handicapCalculator  "Lazy-required so no import cycle."
       *   services/shotLocationService "Lazy require avoids any import cycle with smartFinderService."
       *   services/voiceErrorLog       "static imports here would risk a cycle."
       *   services/batteryMonitor      require('expo-battery') — absent on builds without it
       *
       * Every `require` under app/ services/ hooks/ store/ is one of those two shapes; the four that
       * are not relative-local are the defensive native loads. The rule therefore fires only on the
       * pattern the architecture is built on, and the codebase had answered it with FIVE HUNDRED AND
       * FIFTY-THREE inline `eslint-disable-next-line` comments — one rule's suppressions outnumbering
       * every other lint problem in the repo combined.
       *
       * Suppressing a rule 553 times is not a lint configuration, it is a decision nobody wrote down.
       * It is written down here instead, once, and the 553 comments are removed — which also means a
       * genuinely unused disable directive is visible again rather than lost in that crowd.
       *
       * Converting those requires to static imports is NOT the alternative: it would risk
       * reintroducing the cycles they were added to break, and there is no launch-week reason to
       * find out which ones crash.
       */
      '@typescript-eslint/no-require-imports': 'off',

      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    files: ['app/**/*.tsx', 'components/**/*.tsx'],
    /**
     * 2026-09-11 — OWNER/DEBUG SCREENS ARE EXCLUDED BY THE SAME PREDICATE THE CODEMOD USES.
     *
     * Only the owner opens these (Settings -> Owner Tools, gated on OWNER_EMAILS), so translating
     * them would add ~390 keys to EVERY locale — including ja and ko, where a human has to review
     * values for text no player will ever read. The codemod skips them via
     * eslint-rules/i18n-shared.isOwnerScreen; the rule now skips exactly the same set, from the same
     * list, so the gate cannot flag what the tool refuses to fix. Two lists would drift on the first
     * new debug screen. [[two-owners-is-the-root-cause]]
     */
    ignores: OWNER_SCREEN_GLOBS,
    plugins: { i18n: i18nPlugin },
    rules: {
      'i18n/no-hardcoded-jsx-text': 'error',
    },
  },
]);
