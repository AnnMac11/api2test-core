/**
 * TS-C4 — the TypeScript request-class emitter. Mirrors the C# emitter.test.ts cases: property name is
 * the JSON key, data-method defaults, PARAMETER placeholder, optional fields omitted, URL-param classes.
 * The emitted source is compiled under strict TS (with a stub DataGenerator, since TS-C5 isn't built yet)
 * so a generated class is proven to type-check.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { generateRequestClassTypeScript } from '../src/services/generateRequestClassTypeScript';
import { ClassGenerationRequest } from '../src/models/ClassGenerationDto';
import { PARAMETER } from '../src/services/DataDictionaryService';

/** Compile the emitted class under strict TS in an isolated sandbox with a generic DataGenerator stub. */
function assertCompiles(code: string): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2t-tsc-'));
  fs.writeFileSync(path.join(dir, 'requestClass.ts'), code);
  // Universal stub: an index signature makes `new DataGenerator().anyMethod()` type-check as `any`.
  fs.writeFileSync(path.join(dir, 'dataGenerator.ts'), 'export class DataGenerator { [k: string]: (...args: any[]) => any; }\n');
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { strict: true, target: 'ES2022', lib: ['ES2022', 'DOM'], types: [], moduleDetection: 'force', noEmit: true },
    include: ['requestClass.ts', 'dataGenerator.ts'],
  }));
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  try {
    execFileSync(npx, ['tsc', '--noEmit', '-p', path.join(dir, 'tsconfig.json')], { stdio: 'pipe', shell: process.platform === 'win32' });
  } catch (e: any) {
    assert.fail('generated request class did not compile:\n' + (e.stdout?.toString() || e.message));
  }
}

test('emits a body class: JSON-key property, data-method default, toJson()', () => {
  const req: ClassGenerationRequest = {
    endpoint: '/customers', method: 'POST', application: 'Stripe',
    fieldConfigurations: [
      { name: 'email', type: 'string', required: true, dataMethod: 'email', location: 'body' },
    ],
  };
  const code = generateRequestClassTypeScript(req)!;
  assert.ok(code, 'code produced');
  assert.match(code, /export class StripeCustomers/);
  assert.match(code, /email: string = new DataGenerator\(\)\.email\(\);/, 'property key is the JSON field name + data default');
  assert.match(code, /toJson\(\): string \{ return JSON\.stringify\(this\); \}/);
  assert.doesNotMatch(code, /JsonPropertyName/, 'TS uses the property name as the JSON key — no attribute');
  assertCompiles(code);
});

test('a PascalCase registry data method is emitted as a camelCase TS call', () => {
  const req: ClassGenerationRequest = {
    endpoint: '/customers', method: 'POST', application: 'Stripe',
    fieldConfigurations: [
      { name: 'firstName', type: 'string', required: true, dataMethod: 'FirstName', location: 'body' },
    ],
  };
  const code = generateRequestClassTypeScript(req)!;
  assert.match(code, /firstName: string = new DataGenerator\(\)\.firstName\(\);/, 'FirstName → firstName');
  assert.doesNotMatch(code, /\.FirstName\(\)/, 'no PascalCase call in generated TS');
  assertCompiles(code);
});

test('optional unassigned field is left undefined (omitted by JSON.stringify), not initialised', () => {
  const req: ClassGenerationRequest = {
    endpoint: '/customers', method: 'POST', application: 'Stripe',
    fieldConfigurations: [
      { name: 'nickname', type: 'string', required: false, location: 'body' },
    ],
  };
  const code = generateRequestClassTypeScript(req)!;
  assert.match(code, /nickname\?: string;/, 'optional property, no initializer');
  assert.doesNotMatch(code, /nickname\?: string = /, 'must NOT be initialised (would emit an explicit null/empty key)');
  assertCompiles(code);
});

test('PARAMETER field emits a settable default, not a DataGenerator call', () => {
  const req: ClassGenerationRequest = {
    endpoint: '/order', method: 'POST', application: 'Pet Store',
    fieldConfigurations: [
      { name: 'orderId', type: 'number', required: true, dataMethod: PARAMETER, location: 'body' },
      { name: 'quantity', type: 'number', required: true, dataMethod: 'randomId', location: 'body' },
    ],
  };
  const code = generateRequestClassTypeScript(req)!;
  assert.doesNotMatch(code, /DataGenerator\(\)\.Parameter/i, 'no Parameter generator method');
  assert.match(code, /orderId: number = 0; \/\/ parameter/, 'PARAMETER → plain default');
  assert.match(code, /quantity: number = new DataGenerator\(\)\.randomId\(\);/, 'real method still used');
  assertCompiles(code);
});

test('body-less endpoint → URL-param class with plain props, no toJson()', () => {
  const req: ClassGenerationRequest = {
    endpoint: '/customers/{id}', method: 'GET', application: 'Stripe',
    fieldConfigurations: [
      { name: 'id', type: 'string', required: true, location: 'path' },
    ],
  };
  const code = generateRequestClassTypeScript(req)!;
  assert.match(code, /id!: string;/, 'URL param is a definite-assignment property');
  assert.doesNotMatch(code, /toJson/, 'URL params are not a JSON body — no toJson');
  assertCompiles(code);
});

test('returns null when the endpoint has no fields at all', () => {
  const req: ClassGenerationRequest = {
    endpoint: '/health', method: 'GET', application: 'Stripe', fieldConfigurations: [],
  };
  assert.equal(generateRequestClassTypeScript(req), null);
});
