import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'functions/node_modules', '.superpowers', 'coverage']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^[A-Z_]' }],
    },
  },
  {
    // Build-time constants injected by vite.config.js `define`.
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      globals: {
        __APP_VERSION__: 'readonly',
        __BUILD_DATE__: 'readonly',
      },
    },
  },
  {
    // Node runtime: Cloud Functions, scripts, tests, and tool configs.
    files: [
      'functions/**/*.js',
      'scripts/**/*.{js,mjs}',
      'tests/**/*.{js,mjs}',
      '*.config.js',
      'vitest.config.js',
    ],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // Service workers run in a worker scope, not the window.
    files: ['public/*.js'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.serviceworker },
    },
  },
])
