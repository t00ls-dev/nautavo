import js from '@eslint/js';
import ts from 'typescript-eslint';
export default ts.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      '**/*.local/**',
      'blob-report/**',
      'all-blob-reports/**',
      'coverage/**',
      '.wrangler/**',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ['**/*.ts'],
    extends: [...ts.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/use-unknown-in-catch-callback-variable': 'error',
      // Mocks of asynchronous APIs are async functions without an await.
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        Buffer: 'readonly',
        Image: 'readonly',
        console: 'readonly',
        document: 'readonly',
        window: 'readonly',
        getComputedStyle: 'readonly',
      },
    },
  },
);
