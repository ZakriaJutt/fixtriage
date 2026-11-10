// T-2.1.5: the worker's import graph contains no web-framework module (Next.js, React).
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

describe('worker starts without web-framework modules', () => {
  it('bundling apps/worker/src/main.ts pulls in no next/react files', async () => {
    const entry = fileURLToPath(new URL('../src/main.ts', import.meta.url));
    const r = await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false, metafile: true, packages: 'bundle', logLevel: 'silent', external: ['pg-native'] });
    const inputs = Object.keys(r.metafile.inputs);
    expect(inputs.some((p) => p.includes('packages/services/src'))).toBe(true);
    expect(inputs.filter((p) => /node_modules\/(next|react|react-dom)\//.test(p))).toEqual([]);
  });
});
