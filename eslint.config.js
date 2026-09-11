// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const noHardcodedJsxText = require('./eslint-rules/no-hardcoded-jsx-text');

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
    plugins: { i18n: i18nPlugin },
    rules: {
      'i18n/no-hardcoded-jsx-text': 'error',
    },
  },
]);
