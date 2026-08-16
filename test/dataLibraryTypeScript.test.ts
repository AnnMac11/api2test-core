/**
 * TS-C5 — the TypeScript Data Library emitter. Mirrors dataLibrary.test.ts (the C# guard): a single
 * `DataGenerator` class the request classes call as `new DataGenerator().method()`, backed by faker.
 * Each method's `code` is pasted verbatim; missing code → a throwing placeholder. The emitted source is
 * compiled under strict TS (with an ambient faker stub, since faker is the generated project's dep).
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { generateDataLibraryTypeScript } from '../src/services/generateDataLibraryTypeScript';
import { DataMethodCode } from '../src/services/generateDataLibrary';
import { tmpDir } from './tmp';

/** Compile the emitted dataGenerator.ts under strict TS with an ambient `@faker-js/faker` declaration. */
function assertCompiles(code: string): void {
  const dir = tmpDir('a2t-tsc-');
  fs.writeFileSync(path.join(dir, 'dataGenerator.ts'), code);
  // faker is a dependency of the generated PROJECT, not present in this sandbox — declare it ambiently
  // so the import resolves and `faker.*` type-checks as any.
  fs.writeFileSync(path.join(dir, 'faker.d.ts'), "declare module '@faker-js/faker' { export const faker: any; }\n");
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { strict: true, target: 'ES2022', lib: ['ES2022', 'DOM'], types: [], moduleDetection: 'force', noEmit: true },
    include: ['dataGenerator.ts', 'faker.d.ts'],
  }));
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  try {
    execFileSync(npx, ['tsc', '--noEmit', '-p', path.join(dir, 'tsconfig.json')], { stdio: 'pipe', shell: process.platform === 'win32' });
  } catch (e: any) {
    assert.fail('generated dataGenerator.ts did not compile:\n' + (e.stdout?.toString() || e.message));
  }
}

test('emits the DataGenerator class + faker import and pastes methods verbatim', () => {
  const methods: DataMethodCode[] = [
    { methodName: 'firstName', description: 'A first name', code: 'firstName(): string { return faker.person.firstName(); }' },
  ];
  const code = generateDataLibraryTypeScript(methods);
  assert.match(code, /import \{ faker \} from '@faker-js\/faker';/);
  assert.match(code, /export class DataGenerator \{/);
  assert.match(code, /firstName\(\): string \{ return faker\.person\.firstName\(\); \}/, 'method pasted verbatim');
  assert.match(code, /\/\*\* A first name \*\//, 'description becomes a doc comment');
  assertCompiles(code);
});

test('a method with no code becomes a throwing placeholder (still compiles)', () => {
  const code = generateDataLibraryTypeScript([{ methodName: 'mystery' }]);
  assert.match(code, /mystery\(\): unknown \{ throw new Error\('Not implemented: mystery'\); \}/);
  assertCompiles(code);
});

test('an empty library emits a valid empty class', () => {
  const code = generateDataLibraryTypeScript([]);
  assert.match(code, /export class DataGenerator \{\s*\}/);
  assertCompiles(code);
});
