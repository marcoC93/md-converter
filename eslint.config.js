import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import vue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser, extraFileExtensions: ['.vue'] },
    },
  },
  {
    files: [
      'apps/frontend/src/**/*.{ts,vue}',
      'apps/frontend/public/**/*.js',
      'apps/frontend/test/**/*.ts',
    ],
    languageOptions: { globals: globals.browser },
  },
  {
    files: [
      'apps/backend/**/*.ts',
      'packages/**/*.ts',
      'tests/**/*.mjs',
      'docker/**/*.mjs',
      '**/*.config.{js,ts}',
      'apps/frontend/e2e/**/*.ts',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['info', 'warn', 'error'] }],
    },
  },
  {
    // Gli script a riga di comando comunicano con l'utente tramite console.log.
    files: ['apps/backend/src/cli/**/*.ts', 'tests/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },
  prettier,
);
