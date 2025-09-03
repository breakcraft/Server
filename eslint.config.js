import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  js.configs.recommended,
  // Browser JS under client: expose DOM globals
  {
    files: ['client/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        AudioContext: 'readonly',
        webkitAudioContext: 'readonly',
      },
    },
  },
  // Third-party client sources: relax unused-vars checks
  {
    files: ['client/src/3rdparty/**/*.js'],
    rules: {
      'no-unused-vars': 'off',
    },
  },
  {
    files: ['tools/**/*.js', 'tools/**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'script',
      // Declare Node/CommonJS globals so ESLint doesn't flag them as undefined
      globals: {
        console: 'readonly',
        process: 'readonly',
        require: 'readonly',
        module: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
      },
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2020,
      sourceType: 'module',
      // Provide Node globals for TS files to avoid no-undef false positives
      globals: {
        console: 'readonly',
        process: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      // TypeScript already checks for undefined vars; avoid false positives
      'no-undef': 'off',
      // Use TS-aware unused-vars and ignore leading underscore
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none'
      }],
      // Allow intentionally empty catch blocks used to probe git/status
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
