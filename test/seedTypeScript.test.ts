/**
 * TS-C8 — the curated TypeScript seed libraries. Proves the real seed is coherent with the emitters:
 *  - each seed method's code symbol equals tsSymbol(methodName) — so a generated call resolves to the
 *    definition (PostJsonAsync → the emitted apiMethods.ts defines `postJson`);
 *  - the Data Library emitted via TS-C5 and the API Method Library emitted via TS-C3 both type-check.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { getDefaultDataLibrary, getDefaultApiMethodLibrary } from '../src/data/defaultLibraries';
import { generateDataLibraryTypeScript } from '../src/services/generateDataLibraryTypeScript';
import { generateApiMethodsTypeScript } from '../src/services/generateApiMethodsTypeScript';
import { tsSymbol } from '../src/services/tsNaming';
import { tmpDir } from './tmp';

function compile(dir: string): void {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  try {
    execFileSync(npx, ['tsc', '--noEmit', '-p', path.join(dir, 'tsconfig.json')], { stdio: 'pipe', shell: process.platform === 'win32' });
  } catch (e: any) {
    assert.fail('seed-emitted source did not compile:\n' + (e.stdout?.toString() || e.message));
  }
}

test('every seed method defines the camelCase symbol the emitters call (tsSymbol)', () => {
  for (const m of [...getDefaultDataLibrary('typescript'), ...getDefaultApiMethodLibrary('typescript')]) {
    const sym = tsSymbol((m as any).methodName);
    const code = (m as any).code as string;
    assert.ok(new RegExp(`\\b${sym}\\s*\\(`).test(code),
      `${(m as any).methodName}: code must define '${sym}(' (got: ${code.slice(0, 60)}…)`);
  }
});

test('the TS Data Library seed emits a dataGenerator.ts that type-checks', () => {
  const methods = getDefaultDataLibrary('typescript').map((m: any) => ({ methodName: m.methodName, description: m.description, code: m.code }));
  const code = generateDataLibraryTypeScript(methods);
  const dir = tmpDir('a2t-seed-');
  fs.writeFileSync(path.join(dir, 'dataGenerator.ts'), code);
  fs.writeFileSync(path.join(dir, 'faker.d.ts'), "declare module '@faker-js/faker' { export const faker: any; }\n");
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { strict: true, target: 'ES2022', lib: ['ES2022', 'DOM'], types: [], moduleDetection: 'force', noEmit: true },
    include: ['dataGenerator.ts', 'faker.d.ts'],
  }));
  compile(dir);
});

test('the TS API Method Library seed emits an apiMethods.ts that type-checks', () => {
  const methods = getDefaultApiMethodLibrary('typescript').filter((m: any) => m.code && m.code.trim());
  const code = generateApiMethodsTypeScript(methods as any, { includeApiClient: true });
  const dir = tmpDir('a2t-seed-');
  fs.writeFileSync(path.join(dir, 'apiMethods.ts'), code);
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { strict: true, target: 'ES2022', lib: ['ES2022', 'DOM'], types: [], moduleDetection: 'force', noEmit: true },
    include: ['apiMethods.ts'],
  }));
  compile(dir);
});

test('the seed provides the five class-first send helpers + extract (the E2E / TS-C7 vocabulary)', () => {
  const names = getDefaultApiMethodLibrary('typescript').map((m: any) => tsSymbol(m.methodName));
  for (const helper of ['postJson', 'putJson', 'get', 'delete', 'postForm', 'extractField']) {
    assert.ok(names.includes(helper), `seed must define send helper '${helper}'`);
  }
});
