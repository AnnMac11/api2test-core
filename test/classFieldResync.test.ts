/**
 * RB-4 — ApiClassLibraryService.resyncClassFields. A class stores its OWN snapshot of fields, copied
 * once when the class is added; after the user assigns a newly-added data method in the Data Dictionary
 * the snapshot goes stale. "Update & Generate" re-pulls the class's fields from the current dictionary
 * (matched by sourceEndpointId) before generating. This drives that re-sync against an in-memory store
 * and pins a FULL re-sync: assignment updated, new field added, removed field dropped, other endpoints
 * left alone.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { ApiClassLibraryService } from '../src/services/ApiClassLibraryService';
import { NOT_ASSIGNED } from '../src/services/DataDictionaryService';

/** Minimal in-memory StorageProvider (Map of collection → rows). */
function memStore(seed: Record<string, any[]> = {}) {
  const db = new Map<string, any[]>(Object.entries(seed).map(([k, v]) => [k, [...v]]));
  const rows = (f: string) => { if (!db.has(f)) db.set(f, []); return db.get(f)!; };
  let n = 0;
  return {
    db,
    async readJsonFile(f: string) { return [...rows(f)]; },
    async writeJsonFile(f: string, data: any[]) { db.set(f, [...data]); },
    async addItem(f: string, item: any) { if (!item.id) { item.id = `gen-${++n}`; } rows(f).push(item); },
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

// A class whose stored snapshot is STALE: `email` unassigned, and a `legacy` field that has since been
// removed from the dictionary.
const STALE_CLASS = {
  id: 'cls1', endpointId: 'ep1', className: 'StripeCreateCustomer', application: 'Stripe',
  method: 'POST', endpoint: '/customers', requestBodySchema: '', contentType: 'application/json',
  createdDate: '2026-01-01T00:00:00.000Z',
  fields: [
    { fieldName: 'email', fieldType: 'string', mandatory: true, dataMethod: NOT_ASSIGNED, dataMethodArgs: '', location: 'body' },
    { fieldName: 'legacy', fieldType: 'string', mandatory: false, dataMethod: 'OldMethod', dataMethodArgs: '', location: 'body' },
  ],
};

// The CURRENT dictionary: email is now assigned RandomEmail, a new firstName field appeared, legacy is
// gone, and a field belonging to a DIFFERENT endpoint must be ignored.
const DICTIONARY = [
  { fieldName: 'email', fieldType: 'string', mandatory: true, dataMethod: 'RandomEmail', sourceEndpointId: 'ep1' },
  { fieldName: 'firstName', fieldType: 'string', mandatory: false, dataMethod: 'FirstName', sourceEndpointId: 'ep1' },
  { fieldName: 'unrelated', fieldType: 'string', mandatory: false, dataMethod: 'Nope', sourceEndpointId: 'ep2' },
];

test('resyncClassFields: full re-sync — assignment updated, field added, removed field dropped, other endpoints ignored', async () => {
  const store = memStore({ 'api-class-library.json': [STALE_CLASS] });
  const svc = new ApiClassLibraryService(store as any);

  const updated = await svc.resyncClassFields('cls1', DICTIONARY as any);
  assert.ok(updated, 'returns the updated entry');

  // Field NAMES: firstName added, legacy dropped, unrelated (ep2) never pulled in.
  assert.deepEqual(updated!.fields.map(f => f.fieldName), ['email', 'firstName']);

  // The stale `email` assignment is refreshed to the now-assigned method.
  assert.equal(updated!.fields.find(f => f.fieldName === 'email')!.dataMethod, 'RandomEmail');

  // Persisted, not just returned — a fresh read reflects the re-sync.
  const persisted = await svc.getClassById('cls1');
  assert.deepEqual(persisted!.fields.map(f => f.fieldName), ['email', 'firstName']);
  assert.equal(persisted!.fields.find(f => f.fieldName === 'firstName')!.dataMethod, 'FirstName');

  // Header metadata is untouched by the field re-sync.
  assert.equal(persisted!.className, 'StripeCreateCustomer');
  assert.equal(persisted!.endpointId, 'ep1');
});

test('resyncClassFields: unknown id returns undefined and writes nothing', async () => {
  const store = memStore({ 'api-class-library.json': [STALE_CLASS] });
  const svc = new ApiClassLibraryService(store as any);
  const result = await svc.resyncClassFields('nope', DICTIONARY as any);
  assert.equal(result, undefined);
  // The existing class is untouched.
  const untouched = await svc.getClassById('cls1');
  assert.equal(untouched!.fields.length, 2);
});
