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
