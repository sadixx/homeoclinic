/* ESLint config (eslint 8, classic). Enforces:
 * - TypeScript strictness, no `any` / ts-ignore (R-UI-001).
 * - no raw `invoke` from @tauri-apps/api; UI must call @/bindings (R-UI-002).
 * Tests are linted too but may use the testing globals.
 */
module.exports = {
  root: true,
  env: { browser: true, es2021: true, node: true },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  settings: { react: { version: '18' } },
  plugins: ['@typescript-eslint', 'react-hooks', 'react-refresh'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/ban-ts-comment': 'error',
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
    'no-restricted-imports': [
      'error',
      {
        paths: [
          {
            name: '@tauri-apps/api/core',
            importNames: ['invoke'],
            message:
              'Raw invoke is forbidden (R-UI-002). Call the generated wrappers in @/bindings.',
          },
        ],
      },
    ],
  },
  ignorePatterns: ['dist', 'bindings.ts', 'vite.config.ts', 'vitest.config.ts'],
  overrides: [
    {
      files: ['**/*.test.ts', '**/*.test.tsx', 'src/test/**'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
  ],
};
