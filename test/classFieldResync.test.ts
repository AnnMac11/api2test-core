/**
 * RB-4 / CLS-7 — ApiClassLibraryService.resyncClassFields. A class stores its OWN snapshot of fields,
 * copied when the class is added; the snapshot goes stale once the user assigns a data method in the
 * Data Dictionary or re-imports the spec. "Update & Generate" rebuilds it before generating.
 *
 * The rebuild takes its SHAPE from the endpoint and its VALUES from the dictionary by name — it must
 * never filter the dictionary by `sourceEndpointId`. That link is one-to-one over a many-to-many
 * relationship: the dictionary de-duplicates by field name across all endpoints, so a field an earlier
 * endpoint imported first is owned by that endpoint and invisible to this one. Filtering by it emptied
 * PetStore `placeOrder` completely (CLS-7). These tests drive the real path against an in-memory store.
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

/** The endpoint as it stands today: `firstName` has appeared, `legacy` is long gone. */
const ENDPOINT = {
  id: 'ep1', name: 'Create Customer', application: 'Stripe', endpoint: '/customers', path: '/customers',
  method: 'POST', contentType: 'application/json',
  requestBodySchema: '{"type":"object","properties":{"email":{"type":"string"},"firstName":{"type":"string"}},"required":["email"]}',
};

// A class whose stored snapshot is STALE: `email` unassigned, and a `legacy` field the endpoint no
// longer has. Its own `requestBodySchema` is stale too — the endpoint is the source when one is given.
const STALE_CLASS = {
  id: 'cls1', endpointId: 'ep1', className: 'StripeCreateCustomer', application: 'Stripe',
  method: 'POST', endpoint: '/customers', requestBodySchema: '', contentType: 'application/json',
  createdDate: '2026-01-01T00:00:00.000Z',
  fields: [
    { fieldName: 'email', fieldType: 'string', mandatory: true, dataMethod: NOT_ASSIGNED, dataMethodArgs: '', location: 'body' },
    { fieldName: 'legacy', fieldType: 'string', mandatory: false, dataMethod: 'OldMethod', dataMethodArgs: '', location: 'body' },
  ],
};

// The CURRENT dictionary. `email` is now assigned — and deliberately owned by a DIFFERENT endpoint, as
// it would be if another API had imported it first. Under the old sourceEndpointId filter that row was
// invisible here and the class came back empty; the assignment must still be copied across by name.
const DICTIONARY = [
  { fieldName: 'email', fieldType: 'string', mandatory: true, dataMethod: 'RandomEmail', dataMethodArgs: '', sourceEndpointId: 'ep-other' },
  { fieldName: 'firstName', fieldType: 'string', mandatory: false, dataMethod: 'FirstName', dataMethodArgs: '', sourceEndpointId: 'ep-other' },
  { fieldName: 'unrelated', fieldType: 'string', mandatory: false, dataMethod: 'Nope', sourceEndpointId: 'ep2' },
];

function svcWith(classes: any[] = [STALE_CLASS]) {
  const store = memStore({ 'api-class-library.json': classes, 'data-dictionary.json': DICTIONARY });
  return { store, svc: new ApiClassLibraryService(store as any) };
}

test('resyncClassFields: full refresh — assignment copied by name, field added, removed field dropped, other fields ignored', async () => {
  const { svc } = svcWith();

  const updated = await svc.resyncClassFields('cls1', ENDPOINT as any);
  assert.ok(updated, 'returns the updated entry');

  // Field NAMES come from the ENDPOINT: firstName added, legacy dropped, `unrelated` never pulled in.
  assert.deepEqual(updated!.fields.map(f => f.fieldName), ['email', 'firstName']);

  // CLS-7: the assignment is copied even though the dictionary row belongs to another endpoint.
  assert.equal(updated!.fields.find(f => f.fieldName === 'email')!.dataMethod, 'RandomEmail');

  // Persisted, not just returned — a fresh read reflects the refresh.
  const persisted = await svc.getClassById('cls1');
  assert.deepEqual(persisted!.fields.map(f => f.fieldName), ['email', 'firstName']);
  assert.equal(persisted!.fields.find(f => f.fieldName === 'firstName')!.dataMethod, 'FirstName');

  // The endpoint's own spec wins for shape: `email` is required there.
  assert.equal(persisted!.fields.find(f => f.fieldName === 'email')!.mandatory, true);

  // Identity is untouched by a field refresh; the spec-derived metadata is re-taken.
  assert.equal(persisted!.className, 'StripeCreateCustomer');
  assert.equal(persisted!.endpointId, 'ep1');
  assert.equal(persisted!.requestBodySchema, ENDPOINT.requestBodySchema, 'a re-imported spec is picked up too');
});

test('resyncClassFields: a field with no dictionary row stays Not Assigned rather than being dropped', async () => {
  const { svc } = svcWith();
  const withExtra = {
    ...ENDPOINT,
    requestBodySchema: '{"type":"object","properties":{"email":{"type":"string"},"nickname":{"type":"string"}},"required":[]}',
  };

  const updated = await svc.resyncClassFields('cls1', withExtra as any);

  assert.deepEqual(updated!.fields.map(f => f.fieldName), ['email', 'nickname']);
  assert.equal(updated!.fields.find(f => f.fieldName === 'nickname')!.dataMethod, NOT_ASSIGNED);
});

test('resyncClassFields: with no endpoint (source deleted) it refreshes from the class\'s own stored schema', async () => {
  // A class outlives its endpoint by design, so the refresh must still run — from what the entry itself
  // recorded at add time.
  const orphan = { ...STALE_CLASS, requestBodySchema: ENDPOINT.requestBodySchema };
  const { svc } = svcWith([orphan]);

  const updated = await svc.resyncClassFields('cls1');

  assert.deepEqual(updated!.fields.map(f => f.fieldName), ['email', 'firstName']);
  assert.equal(updated!.fields.find(f => f.fieldName === 'email')!.dataMethod, 'RandomEmail');
});

test('resyncClassFields: unknown id returns undefined and writes nothing', async () => {
  const { svc } = svcWith();
  const result = await svc.resyncClassFields('nope', ENDPOINT as any);
  assert.equal(result, undefined);
  // The existing class is untouched.
  const untouched = await svc.getClassById('cls1');
  assert.equal(untouched!.fields.length, 2);
});
