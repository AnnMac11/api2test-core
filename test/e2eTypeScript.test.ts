/**
 * TS-C7 — the TypeScript (Vitest) E2E emitter. Mirrors e2eGenerator.test.ts (the C# guard): a class-first
 * chain becomes a runnable Vitest test — the send verb is derived from each class's HTTP method, captured
 * fields flow into later steps, and validators assert. Imports resolve by relative path. The generated
 * file is strict-compiled inside the real Tests/Libraries/Classes layout with stub siblings.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { generateE2ETestTypeScript } from '../src/services/generateE2ETestTypeScript';
import { E2EPage, E2ETestCaseRow, E2EGenContext } from '../src/models/E2EDto';

const PAGE: E2EPage = {
  id: 'p1', name: 'Petstore E2E', application: 'Petstore',
  basePath: 'petstoreTestBasePath', token: 'petstoreTestToken', framework: 'MSTest',
  createdDate: '', modifiedDate: '',
};

const CTX: E2EGenContext = {
  methods: [
    { methodName: 'petstoreTestBasePath', returnType: 'string', parameters: '' },
    { methodName: 'petstoreTestToken', returnType: 'Promise<string>', parameters: '' },
    { methodName: 'ValidateResponseAsync', returnType: 'Promise<boolean>', parameters: 'response: Response' },
  ],
  classes: [
    { className: 'PetstorePostPet', endpoint: '/pet', method: 'POST', contentType: 'application/json', classCode: 'export class PetstorePostPet { name: string = ""; toJson(): string { return ""; } }' },
    { className: 'PetstoreGetPet', endpoint: '/pet/{petId}', method: 'GET', classCode: 'export class PetstoreGetPet {}' },
  ],
};

const ROW: E2ETestCaseRow = {
  id: 'r1', name: 'Create then fetch a pet',
  items: [
    { type: 'Class', ref: 'PetstorePostPet', capture: { fieldPath: 'id', variable: 'petId' } },
    { type: 'Class', ref: 'PetstoreGetPet', args: { petId: { value: 'petId', isVariable: true } } },
    { type: 'Method', ref: 'ValidateResponseAsync' },
  ],
};

function assertCompiles(code: string, app: string, classes: Record<string, string>): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2t-tsc-'));
  const seg = app.replace(/[^A-Za-z0-9]/g, '');
  const mk = (rel: string, contents: string) => {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  };
  mk(`Tests/${seg}/generated.e2e.test.ts`, code);
  mk('Libraries/apiMethods.ts', 'export const ApiMethods: any = {};\n');
  for (const [name, body] of Object.entries(classes)) { mk(`Classes/${seg}/${name}.ts`, body); }
  mk('vitest.d.ts', "declare module 'vitest' { export const describe: any; export const it: any; export const expect: any; }\n");
  mk('tsconfig.json', JSON.stringify({
    compilerOptions: { strict: true, target: 'ES2022', lib: ['ES2022', 'DOM'], module: 'ESNext', moduleResolution: 'bundler', types: [], noEmit: true },
    include: ['**/*.ts'],
  }));
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  try {
    execFileSync(npx, ['tsc', '--noEmit', '-p', path.join(dir, 'tsconfig.json')], { stdio: 'pipe', shell: process.platform === 'win32' });
  } catch (e: any) {
    assert.fail('generated E2E test did not compile:\n' + (e.stdout?.toString() || e.message));
  }
}

test('class-first chain: derived sends, captured field, path binding, validator', () => {
  const code = generateE2ETestTypeScript(ROW, PAGE, CTX);
  assert.match(code, /import \{ ApiMethods \} from '\.\.\/\.\.\/Libraries\/apiMethods';/);
  assert.match(code, /import \{ PetstorePostPet \} from '\.\.\/\.\.\/Classes\/Petstore\/PetstorePostPet';/);
  assert.match(code, /const baseUrl = ApiMethods\.petstoreTestBasePath\(\);/);
  assert.match(code, /const token = await ApiMethods\.petstoreTestToken\(\);/);
  // POST class → postJson with the class body
  assert.match(code, /const response1 = await ApiMethods\.postJson\(token, url1, request1\.toJson\(\)\);/);
  // captured field from step 1's response
  assert.match(code, /const petId = await ApiMethods\.extractFieldFromResponse\(response1, "id"\);/);
  // GET class → get, with the captured var bound into the path
  assert.match(code, /const url2 = baseUrl \+ "\/pet\/" \+ petId;/);
  assert.match(code, /const response2 = await ApiMethods\.get\(token, url2\);/);
  // validator asserts
  assert.match(code, /expect\(await ApiMethods\.validateResponse\(response2\)\)\.toBe\(true\);/);
  assertCompiles(code, 'Petstore', {
    PetstorePostPet: 'export class PetstorePostPet { name: string = ""; toJson(): string { return ""; } }\n',
    PetstoreGetPet: 'export class PetstoreGetPet {}\n',
  });
});

test('E2E-CAP-1 (TS): typed OUT capture rows each generate an extractFields(resp, field, type) line', () => {
  // Same model as C#: the user picks OUT rows (field · variable · store-as type). TS erases generics, so
  // the store-as type rides as a runtime token — extractFields converts to it, honouring the user's choice
  // even when it differs from the JSON's native type (a number stored as a string, etc.).
  const row: E2ETestCaseRow = {
    id: 'r3', name: 'Typed captures',
    items: [{ type: 'Class', ref: 'PetstorePostPet', captures: [
      { fieldPath: 'id', variable: 'petId', type: 'number' },
      { fieldPath: 'status', variable: 'petStatus', type: 'string' },
      { fieldPath: 'uuid', variable: 'petUuid', type: 'Guid' },
    ] }],
  };
  const code = generateE2ETestTypeScript(row, PAGE, CTX);
  assert.match(code, /const petId = await ApiMethods\.extractFields\(response1, "id", "number"\);/, 'number → number');
  assert.match(code, /const petStatus = await ApiMethods\.extractFields\(response1, "status", "string"\);/, 'string → string');
  // TS has no Guid type — the store-as token maps to `string` so extractFields keeps it as a string.
  assert.match(code, /const petUuid = await ApiMethods\.extractFields\(response1, "uuid", "string"\);/, 'Guid → string (TS)');
});

test('a POST class override becomes Object.assign with a type-aware value', () => {
  const row: E2ETestCaseRow = {
    id: 'r2', name: 'Create a named pet',
    items: [{ type: 'Class', ref: 'PetstorePostPet', overrides: { name: { value: 'Rex' } } }],
  };
  const code = generateE2ETestTypeScript(row, PAGE, CTX);
  assert.match(code, /const request1 = Object\.assign\(new PetstorePostPet\(\), \{ name: "Rex" \}\);/);
  assertCompiles(code, 'Petstore', { PetstorePostPet: 'export class PetstorePostPet { name: string = ""; toJson(): string { return ""; } }\n' });
});
