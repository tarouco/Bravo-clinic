import { builtinModules } from 'node:module';
import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Bare Node built-ins ("fs") are as impure as "node:fs".
const nodeBuiltins = builtinModules.filter((name) => !name.startsWith('_'));

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'apps/api/drizzle/**',
      '.netlify/**',
      '.neon/**',
      '.claude/**',
      // Vendored brand kit (AD-038): reference files, not app code.
      'docs/design/v3/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['apps/api/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // @bravo/core is pure: no I/O, no framework, no Node (docs/architecture.md section 2.1).
    files: ['packages/core/src/**/*.ts'],
    ignores: ['packages/core/src/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...['pg', 'drizzle-orm', 'hono', 'react', 'react-dom'].map((name) => ({
              name,
              message: '@bravo/core must stay pure: no database, HTTP or UI imports.',
            })),
            ...nodeBuiltins.map((name) => ({
              name,
              message: '@bravo/core must stay pure: no Node built-ins.',
            })),
          ],
          patterns: [
            {
              group: [
                'pg/*',
                'drizzle-orm/*',
                'hono/*',
                '@hono/*',
                'react/*',
                'react-dom/*',
                'react-router*',
                'node:*',
              ],
              message: '@bravo/core must stay pure: no database, HTTP, UI or Node imports.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: '@bravo/core must not perform I/O.' },
      ],
    },
  },
  eslintConfigPrettier,
);
