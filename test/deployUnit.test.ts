import { test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { deployUnit, safeArtifactName, safeFileName, projectDirOf, cleanGeneratedArtifacts, BUILD_VALIDATORS } from '../src/services/deployUnit';
import type { DeployCase, DeployUnitOptions } from '../src/services/deployUnit';
import { CSharpEmitter } from '../src/adapters/CSharpEmitter';
import { TypeScriptEmitter } from '../src/adapters/TypeScriptEmitter';
import type { CodeEmitter } from '../src/adapters/CodeEmitter';
import type { StorageProvider } from '../src/adapters/StorageProvider';

// deployUnit only uses the emitters' library-emission + naming surface; the storage-backed
// class/test generation paths are never touched here, so a null storage is safe.
const nullStorage = null as unknown as StorageProvider;
const csharp = new CSharpEmitter(nullStorage);
const typescript = new TypeScriptEmitter(nullStorage);

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'a2t-deploy-'));
}

function baseOpts(root: string, emitter: CodeEmitter, extra: Partial<DeployUnitOptions> = {}): DeployUnitOptions {
  return { root, emitter, apiMethods: [], dataMethods: [], ...extra };
}

const A_METHOD = [{ id: '1', methodName: 'GetToken', parameters: '', returnType: 'string', code: 'return "t";' }];
const A_DATA = [{ methodName: 'FirstName', code: 'return "x";' }];

// ── The language-symmetric naming contract (the DEP-1 seam) ───────────────────────────────────

test('C# naming: XTests.cs / X.cs / ApiMethods.cs + DataGenerator.cs', () => {
  assert.equal(csharp.testFileName('CreatePet'), 'CreatePetTests.cs');
  assert.equal(csharp.classFileName('CreatePetBody'), 'CreatePetBody.cs');
  assert.deepEqual(csharp.libraryFileNames, { apiMethods: 'ApiMethods.cs', dataLibrary: 'DataGenerator.cs' });
});

test('TS naming: Vitest-discoverable tests + the exact library names the emitted imports resolve', () => {
  // Vitest's default include is **/*.{test,spec}.?(c|m)[jt]s — a TS test file MUST match it.
  assert.match(typescript.testFileName('CreatePet'), /\.(test|spec)\.ts$/);
  assert.equal(typescript.classFileName('CreatePetBody'), 'CreatePetBody.ts');
  // TS-C6 emits `../../Libraries/apiMethods` / `../../Libraries/dataGenerator` — names must match.
  assert.deepEqual(typescript.libraryFileNames, { apiMethods: 'apiMethods.ts', dataLibrary: 'dataGenerator.ts' });
});

// ── The deploy sequence ───────────────────────────────────────────────────────────────────────

test('deploys libraries + test + referenced classes into the shared layout', () => {
  const root = tmpRoot();
  const cases: DeployCase[] = [{
    id: 't1', name: 'Create Pet', application: 'Pet Store', code: '// test code',
    classRefs: ['CreatePetBody'],
  }];
  const result = deployUnit(cases, baseOpts(root, csharp, {
    apiMethods: A_METHOD, dataMethods: A_DATA,
    resolveClass: (name) => name === 'CreatePetBody' ? { code: '// class code', application: 'Pet Store' } : undefined,
  }));

  assert.ok(fs.existsSync(path.join(root, 'Libraries', 'ApiMethods.cs')), 'ApiMethods.cs missing');
  assert.ok(fs.existsSync(path.join(root, 'Libraries', 'DataGenerator.cs')), 'DataGenerator.cs missing');
  assert.ok(fs.existsSync(path.join(root, 'Tests', 'PetStore', 'CreatePetTests.cs')), 'test file missing');
  assert.ok(fs.existsSync(path.join(root, 'Classes', 'PetStore', 'CreatePetBody.cs')), 'class file missing');
  assert.deepEqual(result.notGenerated, []);
  assert.deepEqual(result.deployedClasses, ['CreatePetBody']);
  assert.equal(result.files.length, 4);
});

test('TS deploy: the emitted test’s relative library imports resolve to files that exist', () => {
  const root = tmpRoot();
  deployUnit([{ id: 't1', name: 'Create Pet', application: 'PetStore', code: '// ts test' }],
    baseOpts(root, typescript, { apiMethods: A_METHOD, dataMethods: A_DATA }));

  const testFile = fs.readdirSync(path.join(root, 'Tests', 'PetStore'))[0];
  assert.match(testFile, /\.(test|spec)\.ts$/, `Vitest will not discover ${testFile}`);
  // The import specifiers TS-C6 emits from Tests/<App>/ — each must resolve against what we deployed.
  const testDir = path.join(root, 'Tests', 'PetStore');
  for (const spec of ['../../Libraries/apiMethods', '../../Libraries/dataGenerator']) {
    assert.ok(fs.existsSync(path.resolve(testDir, `${spec}.ts`)), `import '${spec}' does not resolve`);
  }
});

test('name collision fails loudly BEFORE anything is written', () => {
  const root = tmpRoot();
  const cases: DeployCase[] = [
    { id: 'a', name: 'My Test!', application: 'App', code: 'x' },
    { id: 'b', name: 'my test', application: 'App', code: 'y' },
  ];
  assert.throws(() => deployUnit(cases, baseOpts(root, csharp)), /collision/i);
  assert.deepEqual(fs.readdirSync(root), [], 'collision must abort before any write');
});

test('a case with no generated code is skipped into notGenerated', () => {
  const root = tmpRoot();
  const result = deployUnit([
    { id: 'a', name: 'Ready', application: 'App', code: '// code' },
    { id: 'b', name: 'Empty', application: 'App', code: '   ' },
  ], baseOpts(root, csharp));
  assert.deepEqual(result.notGenerated, ['b']);
  assert.ok(!fs.existsSync(path.join(root, 'Tests', 'App', 'EmptyTests.cs')));
});

test('a shared class deploys ONCE; an unresolvable class does not fail the deploy', () => {
  const root = tmpRoot();
  const resolve = (name: string) => name === 'Shared' ? { code: '// c', application: 'App' } : undefined;
  const result = deployUnit([
    { id: 'a', name: 'One', application: 'App', code: 'x', classRefs: ['Shared', 'Missing'] },
    { id: 'b', name: 'Two', application: 'App', code: 'y', classRefs: ['Shared'] },
  ], baseOpts(root, csharp, { resolveClass: resolve }));
  assert.deepEqual(result.deployedClasses, ['Shared']);
});

test('clean=true removes stale Classes/ + Tests/ but keeps Libraries/; clean=false accumulates', () => {
  const root = tmpRoot();
  for (const stale of ['Tests/Old/StaleTests.cs', 'Classes/Old/Stale.cs', 'Libraries/Keep.cs']) {
    const p = path.join(root, stale);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '// stale');
  }
  deployUnit([{ id: 'a', name: 'New', application: 'App', code: 'x' }],
    baseOpts(root, csharp, { clean: true }));
  assert.ok(!fs.existsSync(path.join(root, 'Tests', 'Old')), 'stale test survived clean');
  assert.ok(!fs.existsSync(path.join(root, 'Classes', 'Old')), 'stale class survived clean');
  assert.ok(fs.existsSync(path.join(root, 'Libraries', 'Keep.cs')), 'Libraries must be kept');

  // Regression semantics: no clean — the promoted project accumulates.
  const root2 = tmpRoot();
  fs.mkdirSync(path.join(root2, 'Tests', 'Old'), { recursive: true });
  fs.writeFileSync(path.join(root2, 'Tests', 'Old', 'PromotedTests.cs'), '// promoted');
  deployUnit([{ id: 'a', name: 'New', application: 'App', code: 'x' }], baseOpts(root2, csharp));
  assert.ok(fs.existsSync(path.join(root2, 'Tests', 'Old', 'PromotedTests.cs')), 'regression deploy must not clean');
});

test('empty library method lists -> no library file written (nothing to compile against changes)', () => {
  const root = tmpRoot();
  deployUnit([{ id: 'a', name: 'T', application: 'App', code: 'x' }], baseOpts(root, csharp));
  assert.ok(!fs.existsSync(path.join(root, 'Libraries', 'ApiMethods.cs')));
  assert.ok(!fs.existsSync(path.join(root, 'Libraries', 'DataGenerator.cs')));
});

// ── Helpers lifted with the controller ────────────────────────────────────────────────────────

test('safeFileName strips traversal — a crafted name cannot escape the target folder', () => {
  assert.equal(safeFileName('..\\..\\Startup\\x.bat'), 'x.bat');
  assert.equal(safeFileName('../../etc/passwd'), 'passwd');
  assert.throws(() => safeFileName('..'));
  assert.throws(() => safeFileName(''));
});

test('safeArtifactName sanitises to a code-safe identifier', () => {
  assert.equal(safeArtifactName('Create Pet!'), 'CreatePet');
  assert.equal(safeArtifactName(''), 'TestCase');
});

test('projectDirOf: a .csproj path resolves to its folder; a folder passes through', () => {
  assert.equal(projectDirOf(path.join('C:', 'proj', 'My.csproj')), path.join('C:', 'proj'));
  assert.equal(projectDirOf(path.join('C:', 'proj')), path.join('C:', 'proj'));
});

test('build validators exist for the languages with a runner (csharp, typescript)', () => {
  assert.equal(typeof BUILD_VALIDATORS.csharp, 'function');
  assert.equal(typeof BUILD_VALIDATORS.typescript, 'function');
});

test('cleanGeneratedArtifacts is safe when the folders do not exist', () => {
  assert.doesNotThrow(() => cleanGeneratedArtifacts(tmpRoot()));
});
