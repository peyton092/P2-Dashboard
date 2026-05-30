import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.browser,
        // Compile-time constants injected by Vite's `define` (see vite.config.js)
        __APP_VERSION__: 'readonly',
        __BUILD_DATE__: 'readonly',
      },
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', {
        varsIgnorePattern: '^[A-Z_]',
        argsIgnorePattern: '^[A-Z_]',
        ignoreRestSiblings: true,
      }],
      // HMR-only hint: fires on intentional co-locations (shadcn UI primitives
      // exporting their variant maps, context modules exporting their hooks).
      // No production impact, so we don't treat it as an error.
      'react-refresh/only-export-components': 'off',
    },
  },
  // Cloud Functions run in Node — add the Node globals so process / Buffer
  // aren't flagged as undefined.
  {
    files: ['functions/**/*.js'],
    languageOptions: { globals: { ...globals.node } },
  },
])
