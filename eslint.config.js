// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
    rules: {
      'unicode-bom': 'off',
      'import/first': 'off',
      'import/no-duplicates': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/array-type': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'react-hooks/exhaustive-deps': 'off',
      'no-unused-expressions': 'off',
    },
  },
]);
