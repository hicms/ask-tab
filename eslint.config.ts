import { fixupConfigRules } from '@eslint/compat';
import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import eslintConfigPrettier from 'eslint-config-prettier';
import { flatConfigs as importXFlatConfig } from 'eslint-plugin-import-x';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactPlugin from 'eslint-plugin-react';
import { browser, es2020, node } from 'globals';
import { configs as tsConfigs, parser as tsParser } from 'typescript-eslint';
import type { FixupConfigArray } from '@eslint/compat';

export default defineConfig(
  // Shared configs
  js.configs.recommended,
  ...tsConfigs.recommended,
  jsxA11y.flatConfigs.recommended,
  importXFlatConfig.recommended,
  importXFlatConfig.typescript,
  // Formatting runs once in `format:check`, including in the quality gate.
  eslintConfigPrettier,
  ...fixupConfigRules(
    new FlatCompat().extends('plugin:react-hooks/recommended') as FixupConfigArray,
  ),
  {
    files: ['**/*.{ts,tsx}'],
    ...reactPlugin.configs.flat.recommended,
    ...reactPlugin.configs.flat['jsx-runtime'],
  },
  // Custom config
  {
    ignores: [
      '**/build/**',
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/.turbo/**',
      'test-results/**',
      'playwright-report/**',
      '.plan/**',
      'chrome-extension/manifest.js',
      // Vendored third-party code (~8 MB); linting it dominates run time.
      'packages/baileys/**',
      '**/vendor/**',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...browser,
        ...es2020,
        ...node,
        chrome: 'readonly',
      },
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'no-console': 'warn',
      'prefer-const': 'error',
      'no-var': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'func-style': ['error', 'expression', { allowArrowFunctions: true }],
      'no-restricted-imports': [
        'error',
        {
          name: 'type-fest',
          message: 'Please import from `@extension/shared` instead of `type-fest`.',
        },
      ],
      'arrow-body-style': ['error', 'as-needed'],
      '@typescript-eslint/consistent-type-imports': 'error',
      // TypeScript's isolatedModules checks type-only exports in `type-check`.
      // Avoid loading every package's type graph for this stylistic rule alone.
      'import-x/order': [
        'error',
        {
          'newlines-between': 'never',
          alphabetize: { order: 'asc', caseInsensitive: true },
          groups: [
            'index',
            'sibling',
            'parent',
            'internal',
            'external',
            'builtin',
            'object',
            'type',
          ],
          pathGroups: [
            {
              pattern: '@*/**',
              group: 'internal',
              position: 'before',
            },
          ],
          pathGroupsExcludedImportTypes: ['type'],
        },
      ],
      'import-x/no-unresolved': 'off',
      'import-x/no-named-as-default': 'error',
      'import-x/no-named-as-default-member': 'error',
      'import-x/newline-after-import': 'error',
      'import-x/no-deprecated': 'warn',
      'import-x/no-duplicates': ['error', { considerQueryString: true, 'prefer-inline': false }],
      'import-x/consistent-type-specifier-style': 'error',
      'import-x/exports-last': 'error',
      'import-x/first': 'error',
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },
  // Overrides Rules
  {
    files: ['**/*.test.{ts,tsx}', 'tests/**/*.ts', 'packages/storage/lib/test-setup.ts'],
    rules: {
      // `vi.importActual<typeof import('./mod')>()` is the documented vitest pattern.
      '@typescript-eslint/consistent-type-imports': ['error', { disallowTypeAnnotations: false }],
    },
  },
  {
    files: ['chrome-extension/public/**/*.js'],
    languageOptions: {
      globals: { ...browser, chrome: 'readonly' },
    },
  },
  {
    files: ['**/packages/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  {
    files: ['**/packages/ui/**/*.{ts,tsx}'],
    rules: {
      'import-x/exports-last': 'off',
      'func-style': 'off',
    },
  },
);
