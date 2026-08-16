import { test } from 'node:test';
import assert from 'node:assert';
import { DeployDestinationService } from '../src/services/DeployDestinationService';
import { FileStorageService } from '../src/services/FileStorageService';
import { tmpDir } from './tmp';

function svc(): DeployDestinationService {
  const dir = tmpDir('a2t-dest-');
  return new DeployDestinationService(new FileStorageService(dir));
}

const E2E = { name: 'E2E', repoUrl: 'https://github.com/acme/e2e-tests.git', branch: 'main', path: 'suites/e2e' };

test('add + list round-trips a destination (id assigned, path stored for use at deploy time)', async () => {
  const s = svc();
  const added = await s.add(E2E);
  assert.ok(added.id, 'id must be assigned');
  const all = await s.list();
  assert.equal(all.length, 1);
  assert.equal(all[0].name, 'E2E');
  assert.equal(all[0].path, 'suites/e2e', 'the stored path is what deploy uses');
});

test('name must be unique (case-insensitive) — the deploy picker keys off it', async () => {
  const s = svc();
  await s.add(E2E);
  await assert.rejects(() => s.add({ ...E2E, name: 'e2e' }), /already exists/i);
});

test('repo URL and name are required; branch defaults to main; path defaults to repo root', async () => {
  const s = svc();
  await assert.rejects(() => s.add({ ...E2E, name: '  ' }), /name/i);
  await assert.rejects(() => s.add({ ...E2E, repoUrl: '' }), /repo/i);
  const d = await s.add({ name: 'Preprod', repoUrl: 'https://x/y.git' });
  assert.equal(d.branch, 'main');
  assert.equal(d.path, '', 'empty path = repo root');
});

test('update edits in place; rename cannot collide with another destination', async () => {
  const s = svc();
  const a = await s.add(E2E);
  await s.add({ name: 'Preprod', repoUrl: 'https://x/y.git' });
  const updated = await s.update(a.id, { branch: 'release' });
  assert.equal(updated.branch, 'release');
  assert.equal(updated.name, 'E2E', 'unpatched fields survive');
  await assert.rejects(() => s.update(a.id, { name: 'preprod' }), /already exists/i);
});

test('remove deletes; getByName finds case-insensitively (one-click deploy path)', async () => {
  const s = svc();
  const a = await s.add(E2E);
  assert.equal((await s.getByName('e2e'))?.id, a.id);
  await s.remove(a.id);
  assert.equal(await s.getByName('E2E'), undefined);
  assert.deepEqual(await s.list(), []);
});

test('getOrCreate: create-on-first-use for the first-deploy flow, then reused', async () => {
  const s = svc();
  const first = await s.getOrCreate(E2E);
  const second = await s.getOrCreate({ ...E2E, branch: 'other' });
  assert.equal(second.id, first.id, 'same name reuses the existing destination');
  assert.equal(second.branch, 'main', 'existing definition wins — no silent redefinition');
  assert.equal((await s.list()).length, 1);
});

test('environment link is optional and persisted', async () => {
  const s = svc();
  const d = await s.add({ ...E2E, environmentId: 'env-test' });
  assert.equal((await s.list())[0].environmentId, 'env-test');
  assert.equal(d.environmentId, 'env-test');
});
