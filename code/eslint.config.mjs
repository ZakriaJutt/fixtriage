// Import boundaries (TRD 5, R-04) and the purity rule for packages/core (AGENTS.md 5).
import tseslint from 'typescript-eslint';

const deep = { group: ['@fixtriage/*/src', '@fixtriage/*/src/**', '**/packages/**', '**/apps/**', '**/tools/**'], message: 'Import package entry points only (R-04).' };
const framework = { group: ['next', 'next/**', 'react', 'react/**', 'react-dom', 'react-dom/**'], message: 'No web-framework import outside apps/web (T-2.1.5).' };
const cross = (allowed) => ({
  group: ['@fixtriage/*', ...allowed.map((a) => `!@fixtriage/${a}`)],
  message: `This block may import only: ${allowed.join(', ') || 'nothing from @fixtriage'} (TRD 5).`,
});
const restrict = (...patterns) => ['error', { patterns }];

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/.next/**', '**/next-env.d.ts', 'packages/db/migrations/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-imports': restrict(deep, framework, cross([]), { group: ['pg', 'drizzle-orm', 'drizzle-orm/**', 'node:*', 'fs', 'net', 'http', 'https', 'child_process'], message: 'packages/core is pure: no I/O (AGENTS.md 5).' }),
      'no-restricted-properties': ['error', { object: 'process', property: 'env', message: 'core reads no environment.' }, { object: 'Date', property: 'now', message: 'core takes time as a parameter.' }, { object: 'Math', property: 'random', message: 'core is deterministic.' }],
      'no-restricted-syntax': ['error', { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: 'core takes time as a parameter.' }],
    },
  },
  { files: ['packages/platform/src/**/*.ts', 'packages/platform/scripts/**/*.ts'], rules: { 'no-restricted-imports': restrict(deep, framework, cross([])) } },
  { files: ['packages/db/src/**/*.ts', 'packages/db/scripts/**/*.ts'], rules: { 'no-restricted-imports': restrict(deep, framework, cross(['platform'])) } },
  { files: ['packages/services/src/**/*.ts', 'packages/services/scripts/**/*.ts'], rules: { 'no-restricted-imports': restrict(deep, framework, cross(['core', 'db', 'platform'])) } },
  { files: ['apps/worker/src/**/*.ts'], rules: { 'no-restricted-imports': restrict(deep, framework, cross(['core', 'db', 'platform', 'services'])) } },
  { files: ['apps/web/src/**/*.ts', 'apps/web/app/**/*.ts', 'apps/web/app/**/*.tsx'], rules: { 'no-restricted-imports': restrict(deep, cross(['core', 'db', 'platform', 'services'])) } },
  { files: ['tools/monitor-fake/src/**/*.ts'], rules: { 'no-restricted-imports': restrict(deep, framework, cross([])) } },
);
