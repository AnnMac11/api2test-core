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

// ── CLS-7 ────────────────────────────────────────────────────────────────────────────────────────
// The defect the user hit in VS Code 2026-08-08: PetStore `placeOrder` produced a class with ZERO
// fields, so the Test Case builder said "No request fields on this class" and re-generating wrote
// nothing. Cause: the dictionary de-duplicates by field NAME across the whole dictionary, and
// `importApi` handed `addClass` only the newly-added (de-duplicated) fields — every placeOrder field
// had already been claimed by an earlier PetStore endpoint, so the set was empty. A class copies
// values from the dictionary; it must NOT depend on owning the dictionary row.
//
// The guard that should have caught this is the dedup test above: it asserts the TALLY on a
// re-import but never looks at the class that was written. Schemas below are the real ones from the
// user's store.
const ADD_PET = {
  id: 'ep-pet', name: 'addPet', application: 'PetStore', endpoint: '/pet', path: '/pet', method: 'POST',
  requestBodySchema: '{"type":"object","properties":{"id":{"type":"integer"},"name":{"type":"string"},"status":{"type":"string"}},"required":["name"]}',
};
const PLACE_ORDER = {
  id: 'ep-order', name: 'placeOrder', application: 'PetStore', endpoint: '/store/order', path: '/store/order', method: 'POST',
  requestBodySchema: '{"type":"object","properties":{"id":{"type":"integer"},"petId":{"type":"integer"},"quantity":{"type":"integer"},"shipDate":{"type":"string"},"status":{"type":"string"},"complete":{"type":"boolean"}},"required":[]}',
};

test('CLS-7: a class carries its OWN body fields even when every name was claimed by an earlier import', async () => {
  const store = memStore({
    'api-methods.json': [{ ...ADD_PET }, { ...PLACE_ORDER }],
    'data-library.json': [
      { id: '1', methodName: 'RandomInt', returnType: 'int', code: 'x' },
      { id: '2', methodName: 'RandomString', returnType: 'string', code: 'x' },
    ],
  });
  const svc = new DictionaryImportService(store as any);

  await svc.importApi({ ...ADD_PET } as any);     // claims id, name, status
  const second = await svc.importApi({ ...PLACE_ORDER } as any);

  // The dictionary genuinely de-duplicates — that part is correct and stays.
  assert.equal(second.addedFields, 4, 'only petId, quantity, shipDate and complete are new — id and status were claimed by addPet');

  const order = (store.db.get('api-class-library.json') || []).find(c => c.endpointId === 'ep-order');
  assert.ok(order, 'placeOrder got a class entry');
  assert.deepEqual(
    order.fields.map((f: any) => f.fieldName).sort(),
    ['complete', 'id', 'petId', 'quantity', 'shipDate', 'status'],
    'the class holds all six body fields of ITS OWN endpoint, not just the ones it happened to add',
  );

  // A field owned by the earlier endpoint still brings its assigned data method across — the class
  // copies the dictionary's VALUES by name; it does not link to the row.
  const dictStatus = (store.db.get('data-dictionary.json') || []).find((f: any) => f.fieldName === 'status');
  assert.equal(
    order.fields.find((f: any) => f.fieldName === 'status').dataMethod,
    dictStatus.dataMethod,
    'shared field takes the dictionary assignment',
  );
});
