// T-2.1.1: the import-boundary lint fails on a cross-app import, a deep import and I/O in packages/core (R-04).
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const lint = async (filePath: string, code: string) => {
  const [r] = await new ESLint({ cwd }).lintText(code, { filePath });
  return r!.messages.map((m) => m.ruleId);
};

describe('import-boundary lint', () => {
  it('rejects the worker importing the web app', async () => {
    expect(await lint('apps/worker/src/x.ts', "import { createHandlers } from '@fixtriage/web';\nexport const x = createHandlers;\n")).toContain('no-restricted-imports');
  });
  it('rejects a deep import into a package', async () => {
    expect(await lint('apps/web/src/x.ts', "import { x } from '@fixtriage/services/src/intake';\nexport const y = x;\n")).toContain('no-restricted-imports');
  });
  it('rejects next in the worker and I/O or clock reads in core', async () => {
    expect(await lint('apps/worker/src/x.ts', "import next from 'next';\nexport const y = next;\n")).toContain('no-restricted-imports');
    expect(await lint('packages/core/src/x.ts', "import { readFileSync } from 'node:fs';\nexport const y = readFileSync;\n")).toContain('no-restricted-imports');
    expect(await lint('packages/core/src/x.ts', 'export const y = () => Date.now();\n')).toContain('no-restricted-properties');
    expect(await lint('packages/core/src/x.ts', 'export const y = () => new Date();\n')).toContain('no-restricted-syntax');
  });
  it('accepts an allowed entry-point import', async () => {
    expect(await lint('apps/worker/src/x.ts', "import { EP } from '@fixtriage/core';\nexport const y = EP;\n")).toEqual([]);
  });
});
