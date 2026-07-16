/**
 * ORCH-1 — DictionaryImportService.importApi. Drives the REAL sequence (extract → dedup → auto-match →
 * addField → addClass → mark imported) against an in-memory StorageProvider, so the orchestration is
 * proven end-to-end, not mocked past. Covers: fields persisted + tally, the endpoint marked imported,
 * dedup on a re-import, and the policy that a class-library failure must not block the import.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { DictionaryImportService } from '../src/services/DictionaryImportService';

/** Minimal in-memory StorageProvider (Map of collection → rows). `failOn` makes writes to a file throw. */
function memStore(seed: Record<string, any[]> = {}, failOn?: string) {
  const db = new Map<string, any[]>(Object.entries(seed).map(([k, v]) => [k, [...v]]));
  const rows = (f: string) => { if (!db.has(f)) db.set(f, []); return db.get(f)!; };
  let n = 0;
  return {
    db,
    async readJsonFile(f: string) { return [...rows(f)]; },
    async writeJsonFile(f: string, data: any[]) { db.set(f, [...data]); },
    async addItem(f: string, item: any) {
      if (failOn && f === failOn) { throw new Error(`storage failure on ${f}`); }
      if (!item.id) { item.id = `gen-${++n}`; }
      rows(f).push(item);
    },
    async updateItem(f: string, id: string, item: any) {
      const arr = rows(f); const i = arr.findIndex(r => r.id === id);
      if (i < 0) { throw new Error(`not found: ${id} in ${f}`); }
      arr[i] = { ...item, id };
    },
    async deleteItem(f: string, id: string) { const arr = rows(f); const i = arr.findIndex(r => r.id === id); if (i >= 0) arr.splice(i, 1); },
    async getItemById(f: string, id: string) { return rows(f).find(r => r.id === id); },
    getDataPath() { return ':memory:'; },
  };
}

const ENDPOINT = {
  id: 'ep1', name: 'Create Customer', application: 'Stripe', endpoint: '/customers', path: '/customers', method: 'POST',
  requestBodySchema: { type: 'object', properties: { firstName: { type: 'string' }, email: { type: 'string' } } },
};

function seed(failOn?: string) {
  const store = memStore({
    'api-methods.json': [{ ...ENDPOINT }],
    'data-library.json': [
      { id: '1', methodName: 'FirstName', returnType: 'string', parameters: '', description: '', code: 'x' },
      { id: '2', methodName: 'Email', returnType: 'string', parameters: '', description: '', code: 'x' },
    ],
  }, failOn);
  return store;
}

test('importApi extracts, persists fields, adds a class and marks the endpoint imported', async () => {
  const store = seed();
  const svc = new DictionaryImportService(store as any);

  const result = await svc.importApi({ ...ENDPOINT } as any);

  assert.ok(result.addedFields >= 2, `expected the body fields added, got ${result.addedFields}`);
  assert.equal(result.skipped, 0, 'nothing in the dictionary yet → nothing skipped');
  // Fields persisted to the dictionary.
  assert.equal((store.db.get('data-dictionary.json') || []).length, result.addedFields);
  // Class added.
  assert.equal((store.db.get('api-class-library.json') || []).length, 1, 'one request class added');
  // Endpoint marked imported.
  const ep = (store.db.get('api-methods.json') || []).find(e => e.id === 'ep1');
  assert.equal(ep.importedToDataDictionary, true, 'endpoint flagged imported');
});

test('re-importing the same endpoint skips every field (dedup persists)', async () => {
  const store = seed();
  const svc = new DictionaryImportService(store as any);

  const first = await svc.importApi({ ...ENDPOINT } as any);
  const second = await svc.importApi({ ...ENDPOINT } as any);

  assert.equal(second.addedFields, 0, 'all fields already in the dictionary → none added');
  assert.equal(second.skipped, first.addedFields, 'all now skipped as duplicates');
  // The dictionary did not grow on the second import.
  assert.equal((store.db.get('data-dictionary.json') || []).length, first.addedFields);
});

test('importApis imports a selection independently — one bad endpoint does not abort the batch', async () => {
  // Two good endpoints + one that will fail (updateApiMethod throws — it is not seeded in api-methods).
  const store = memStore({
    'api-methods.json': [{ ...ENDPOINT, id: 'ep1' }, { ...ENDPOINT, id: 'ep2' }],
    'data-library.json': [
      { id: '1', methodName: 'FirstName', returnType: 'string', code: 'x' },
      { id: '2', methodName: 'Email', returnType: 'string', code: 'x' },
    ],
  });
  const svc = new DictionaryImportService(store as any);

  const batch = await svc.importApis([
    { ...ENDPOINT, id: 'ep1' } as any,
    { ...ENDPOINT, id: 'missing' } as any, // not in api-methods → updateApiMethod throws
    { ...ENDPOINT, id: 'ep2' } as any,
  ]);

  assert.equal(batch.imported, 2, 'the two valid endpoints imported');
  assert.equal(batch.failed, 1, 'the missing one failed but did not abort the batch');
  const bad = batch.perEndpoint.find(i => i.endpointId === 'missing')!;
  assert.ok(bad.error, 'failed row carries an error');
  // ep1 adds its fields; ep2 shares the same schema so it dedups to 0 — the batch still counts a total.
  assert.ok(batch.totalAddedFields >= 2, 'fields from the first valid endpoint counted');
});

test('a class-library failure does NOT block the import (fields saved, endpoint marked)', async () => {
  const store = seed('api-class-library.json'); // addClass will throw
  const svc = new DictionaryImportService(store as any);

  const result = await svc.importApi({ ...ENDPOINT } as any);

  assert.ok(result.addedFields >= 2, 'fields were still added despite the class failure');
  assert.equal((store.db.get('data-dictionary.json') || []).length, result.addedFields, 'fields persisted');
  assert.equal((store.db.get('api-class-library.json') || []).length, 0, 'no class saved (it failed)');
  const ep = (store.db.get('api-methods.json') || []).find(e => e.id === 'ep1');
  assert.equal(ep.importedToDataDictionary, true, 'endpoint still marked imported');
});
