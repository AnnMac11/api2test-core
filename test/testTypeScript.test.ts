/**
 * TS-C6 — the TypeScript (Vitest) test emitter. Mirrors testGeneration.test.ts (the C# guard): the
 * generated test imports ApiMethods/DataGenerator/the body class, builds URL + body, calls the wrapper
 * with the (token, url, body) convention, and asserts. Imports are relative paths from Tests/<App>/.
 * The generated file is compiled under strict TS inside the real deploy folder layout (with stubs for
 * the sibling libraries), proving a deployed test resolves its imports and type-checks.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { generateTestTypeScript } from '../src/services/generateTestTypeScript';
import { TestGenerationRequest } from '../src/services/TestGenerationService';

/** Lay the generated test into Tests/<App>/ alongside stub Libraries/ + Classes/<App>/, then strict-compile. */
function assertCompiles(code: string, app: string, bodyClass?: string): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2t-tsc-'));
  const seg = app.replace(/[^A-Za-z0-9]/g, '');
  const mk = (rel: string, contents: string) => {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  };
  mk(`Tests/${seg}/generated.test.ts`, code);
  // Universal stubs for the sibling artifacts (real ones come from TS-C3/C4/C5).
  mk('Libraries/apiMethods.ts', 'export const ApiMethods: any = {};\n');
  mk('Libraries/dataGenerator.ts', 'export class DataGenerator { [k: string]: (...a: any[]) => any; }\n');
  if (bodyClass) { mk(`Classes/${seg}/${bodyClass}.ts`, `export class ${bodyClass} { toJson(): string { return ''; } toFormBody(): string { return ''; } }\n`); }
  mk('vitest.d.ts', "declare module 'vitest' { export const describe: any; export const it: any; export const expect: any; }\n");
  mk('tsconfig.json', JSON.stringify({
    compilerOptions: { strict: true, target: 'ES2022', lib: ['ES2022', 'DOM'], module: 'ESNext', moduleResolution: 'bundler', types: [], noEmit: true },
    include: ['**/*.ts'],
  }));
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  try {
    execFileSync(npx, ['tsc', '--noEmit', '-p', path.join(dir, 'tsconfig.json')], { stdio: 'pipe', shell: process.platform === 'win32' });
  } catch (e: any) {
    assert.fail('generated test did not compile:\n' + (e.stdout?.toString() || e.message));
  }
}

const POST_REQ: TestGenerationRequest = {
  className: 'PetStorePets', endpoint: '/pets/{petId}', method: 'POST', application: 'PetStore',
  wrapperClass: 'ApiMethods', wrapperMethod: 'postWithToken', bodyClassName: 'PetStorePets',
  testFramework: 'Vitest', basePathMethod: 'petStoreBaseUrl', tokenMethod: 'getPetToken',
  pathParams: [{ name: 'petId', dataMethod: 'randomId' }],
};

test('emits a Vitest test that imports siblings by relative path and calls the wrapper (token, url, body)', () => {
  const code = generateTestTypeScript(POST_REQ);
  assert.match(code, /import \{ describe, it, expect \} from 'vitest';/);
  assert.match(code, /import \{ ApiMethods \} from '\.\.\/\.\.\/Libraries\/apiMethods';/);
  assert.match(code, /import \{ DataGenerator \} from '\.\.\/\.\.\/Libraries\/dataGenerator';/);
  assert.match(code, /import \{ PetStorePets \} from '\.\.\/\.\.\/Classes\/PetStore\/PetStorePets';/);
  assert.match(code, /const baseUrl = \(\): string => new DataGenerator\(\)\.petStoreBaseUrl\(\);/);
  assert.match(code, /return await ApiMethods\.getPetToken\(\);/, 'token provider delegated');
  assert.match(code, /const petId = new DataGenerator\(\)\.randomId\(\);/, 'path param sourced from data method');
  assert.match(code, /const url = `\$\{baseUrl\(\)\}\/pets\/\$\{petId\}`;/, 'path placeholder interpolated');
  assert.match(code, /const requestBody = new PetStorePets\(\)\.toJson\(\);/);
  assert.match(code, /const response = await ApiMethods\.postWithToken\(token, url, requestBody\);/, 'wrapper call is (token, url, body)');
  assert.match(code, /expect\(response\.ok,.*\)\.toBe\(true\);/);
  assertCompiles(code, 'PetStore', 'PetStorePets');
});

test('GET (no body) → 2-arg wrapper call, no body import', () => {
  const req: TestGenerationRequest = {
    className: 'PetStorePet', endpoint: '/pets/{petId}', method: 'GET', application: 'PetStore',
    wrapperClass: 'ApiMethods', wrapperMethod: 'getWithToken', testFramework: 'Vitest',
    basePathMethod: 'petStoreBaseUrl', pathParams: [{ name: 'petId', dataMethod: 'randomId' }],
  };
  const code = generateTestTypeScript(req);
  assert.doesNotMatch(code, /Classes\//, 'no body class import for GET');
  assert.doesNotMatch(code, /requestBody/, 'no body built for GET');
  assert.match(code, /const response = await ApiMethods\.getWithToken\(token, url\);/);
  assertCompiles(code, 'PetStore');
});

test('form content-type serialises with toFormBody()', () => {
  const code = generateTestTypeScript({ ...POST_REQ, contentType: 'application/x-www-form-urlencoded' });
  assert.match(code, /new PetStorePets\(\)\.toFormBody\(\);/);
  assertCompiles(code, 'PetStore', 'PetStorePets');
});

test('a selected async response handler defines pass/fail', () => {
  const code = generateTestTypeScript({ ...POST_REQ, responseHandler: 'expect400', responseHandlerAsync: true });
  assert.match(code, /expect\(await ApiMethods\.expect400\(response\),.*\)\.toBe\(true\);/);
  assert.doesNotMatch(code, /expect\(response\.ok/, 'handler replaces the built-in success assert');
  assertCompiles(code, 'PetStore', 'PetStorePets');
});
