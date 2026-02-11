import tseslint from 'typescript-eslint'
import customRules from './scripts/eslint-rules/index.js'

export default tseslint.config(
  {
    ignores: [
      '.git-repos/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'dist/**',
      'node_modules/**',
      'scripts/eslint-rules/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    plugins: {
      custom: customRules,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      'custom/no-unused-exports': [
        'error',
        {
          src: ['src/**/*.ts', 'test/**/*.ts', 'e2e/**/*.ts'],
          entryPoints: [
            'src/cli/index.ts',
            'src/cli/commands/*.ts',
            'src/cli/program.ts',
            'src/server/index.ts',
            'src/editor/*.ts',
            'src/html/*.ts',
            'test/**/*.test.ts',
            'e2e/**/*.ts',
          ],
        },
      ],
    },
  },
  {
    files: ['test/render/tracker.test.ts'],
    rules: {
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  },
  {
    files: ['test/**/*.ts', 'integration/**/*.ts', 'e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },
)
