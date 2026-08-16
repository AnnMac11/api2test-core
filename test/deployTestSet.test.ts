import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'child_process';
import { deployTestSet } from '../src/services/deployTestSet';
import type { DeployDestinationDto } from '../src/services/DeployDestinationService';
import { CSharpEmitter } from '../src/adapters/CSharpEmitter';
import type { StorageProvider } from '../src/adapters/StorageProvider';
import { tmpDir } from './tmp';

// Real end-to-end: a real local BARE git repo is the remote; deployTestSet clones it, writes the
// unit, commits and pushes with real git. No mocks past the step under test.

const emitter = new CSharpEmitter(null as unknown as StorageProvider);

function tmp(name: string): string {
  return tmpDir(`a2t-${name}-`);
}

function bareRemote(): string {
  const dir = tmp('remote');
  execFileSync('git', ['init', '--bare', '--initial-branch=main', dir], { stdio: 'pipe' });
  return dir;
}

/** List file paths present on `branch` of the bare remote. */
function remoteFiles(remote: string, branch: string): string[] {
  const out = execFileSync('git', ['--git-dir', remote, 'ls-tree', '-r', '--name-only', branch], { encoding: 'utf8' });
  return out.split(/\r?\n/).filter(Boolean);
}

function destFor(remote: string, over: Partial<DeployDestinationDto> = {}): DeployDestinationDto {
  return { id: 'dest-1', name: 'E2E', repoUrl: remote, branch: 'main', path: 'suites/e2e', ...over };
}

const CASES = [{ id: 't1', name: 'Create Pet', application: 'PetStore', code: '// test code', classRefs: ['CreatePetBody'] }];
const OPTS = {
  emitter,
  apiMethods: [{ id: '1', methodName: 'GetToken', parameters: '', returnType: 'string', code: 'return "t";' }],
  dataMethods: [{ methodName: 'FirstName', code: 'return "x";' }],
  resolveClass: (n: string) => (n === 'CreatePetBody' ? { code: '// class', application: 'PetStore' } : undefined),
};

test('deploys the unit under the destination PATH, commits and pushes to the remote branch', async () => {
  const remote = bareRemote();
  const res = await deployTestSet(CASES, destFor(remote), { ...OPTS, cloneBaseDir: tmp('clones') });

  assert.equal(res.pushed, true);
  assert.ok(res.commit, 'commit hash expected');
  assert.equal(res.deployed, 1);

  const files = remoteFiles(remote, 'main');
  assert.ok(files.includes('suites/e2e/Tests/PetStore/CreatePetTests.cs'), `test not under destination path: ${files.join(', ')}`);
  assert.ok(files.includes('suites/e2e/Classes/PetStore/CreatePetBody.cs'), 'referenced class missing');
  assert.ok(files.includes('suites/e2e/Libraries/ApiMethods.cs'), 'ApiMethods library missing');
  assert.ok(files.includes('suites/e2e/Libraries/DataGenerator.cs'), 'DataGenerator library missing');
});

test('an identical second deploy is a clean no-op (pushed:false, remote untouched)', async () => {
  const remote = bareRemote();
  const cloneBaseDir = tmp('clones');
  const first = await deployTestSet(CASES, destFor(remote), { ...OPTS, cloneBaseDir });
  const second = await deployTestSet(CASES, destFor(remote), { ...OPTS, cloneBaseDir });
  assert.equal(second.pushed, false);
  assert.match(second.message, /up to date/i);
  const log = execFileSync('git', ['--git-dir', remote, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();
  assert.equal(log, first.commit, 'remote must still be at the first commit');
});

test('empty destination path -> unit lands at the repo root', async () => {
  const remote = bareRemote();
  await deployTestSet(CASES, destFor(remote, { path: '' }), { ...OPTS, cloneBaseDir: tmp('clones') });
  assert.ok(remoteFiles(remote, 'main').includes('Tests/PetStore/CreatePetTests.cs'));
});

test('pushes to the destination BRANCH, creating it on an empty remote', async () => {
  const remote = bareRemote();
  await deployTestSet(CASES, destFor(remote, { branch: 'e2e-tests' }), { ...OPTS, cloneBaseDir: tmp('clones') });
  assert.ok(remoteFiles(remote, 'e2e-tests').includes('suites/e2e/Tests/PetStore/CreatePetTests.cs'));
});

test('cases without generated code are reported, not silently dropped', async () => {
  const remote = bareRemote();
  const res = await deployTestSet(
    [...CASES, { id: 't2', name: 'Empty', application: 'PetStore', code: '' }],
    destFor(remote), { ...OPTS, cloneBaseDir: tmp('clones') });
  assert.deepEqual(res.notGenerated, ['t2']);
  assert.equal(res.deployed, 1);
});

test('a destination traversal path cannot escape the clone', async () => {
  const remote = bareRemote();
  await assert.rejects(
    () => deployTestSet(CASES, destFor(remote, { path: '../outside' }), { ...OPTS, cloneBaseDir: tmp('clones') }),
    /path/i,
  );
});
