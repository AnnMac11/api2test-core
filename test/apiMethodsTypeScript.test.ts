/**
 * TS-C3 — the TypeScript API Methods emitter. Mirrors apiMethodsReporter.test.ts (the C# guard): every
 * generated helper must report its call via the Reporter's `##A2T_CALL##` marker, and the emitted source
 * must actually type-check under strict TS. The marker shape is proven to round-trip through the runner's
 * own parser (parseApiCalls), so a generated test's output is extractable end-to-end.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { generateApiMethodsTypeScript } from '../src/services/generateApiMethodsTypeScript';
import { parseApiCalls } from '../src/services/TestRunnerService';
import { tmpDir } from './tmp';

test('emits the ApiMethods class, fetch helpers and the Reporter marker', () => {
  const code = generateApiMethodsTypeScript([], { includeApiClient: true });
  assert.match(code, /export class ApiMethods/);
  assert.match(code, /export class Reporter/);
  assert.match(code, /##A2T_CALL##/);
  for (const [verb, wrapper] of [['POST', 'postWithToken'], ['GET', 'getWithToken'], ['PUT', 'putWithToken'], ['DELETE', 'deleteWithToken']] as const) {
    assert.ok(code.includes(`static async ${wrapper}`), `${wrapper} present`);
    assert.match(code, new RegExp(`Reporter\\.record\\('${verb}'`), `${wrapper} reports via Reporter.record`);
  }
});

test('the Reporter marker round-trips through the runner parser (parseApiCalls)', () => {
  // A generated test prints this line at runtime; the runner must be able to read it back.
  const marker = '##A2T_CALL## ' + JSON.stringify({ method: 'POST', url: 'https://x/y', requestBody: '{"a":1}', status: 201, responseBody: '{"id":7}' });
  const calls = parseApiCalls(`some log\n${marker}\nmore log`);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { method: 'POST', url: 'https://x/y', requestBody: '{"a":1}', status: 201, responseBody: '{"id":7}' });
});

test('the emitted apiMethods.ts type-checks under strict TypeScript', () => {
  const code = generateApiMethodsTypeScript([], { includeApiClient: true });
  const dir = tmpDir('a2t-tsc-');
  fs.writeFileSync(path.join(dir, 'apiMethods.ts'), code);
  // Isolated tsconfig: DOM lib supplies fetch/Response; `types: []` keeps the repo's @types/node out
  // (it pulls an unrelated undici-types resolution error under these flags). Mirrors runTsc's per-dir run.
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { strict: true, target: 'ES2022', lib: ['ES2022', 'DOM'], types: [], moduleDetection: 'force', noEmit: true },
    include: ['apiMethods.ts'],
  }));
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  try {
    execFileSync(npx, ['tsc', '--noEmit', '-p', path.join(dir, 'tsconfig.json')], { stdio: 'pipe', shell: process.platform === 'win32' });
  } catch (e: any) {
    assert.fail('generated apiMethods.ts did not compile:\n' + (e.stdout?.toString() || e.message));
  }
});
