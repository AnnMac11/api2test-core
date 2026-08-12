/**
 * APP-ID-IMPORT — the application link must survive a rename.
 *
 * Drives the REAL import sequence (detect → adaptToUnified → toApiMethodDto → store) and then the
 * REAL class-creation sequence (DictionaryImportService.importApi → ApiClassLibraryService.addClass)
 * against an in-memory StorageProvider. Nothing is seeded past the step under test: the endpoints and
 * the class row are the ones import actually produced.
 *
 * The bug: import stored the application NAME only, so renaming the application orphaned every
 * imported endpoint and every class made from it. `applicationId` is the authoritative link
 * (ApiMethodDto.ts:37) and import is where it has to be stamped.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { ApiLibraryService } from '../src/services/ApiLibraryService';
import { DictionaryImportService } from '../src/services/DictionaryImportService';

/** Minimal in-memory StorageProvider (Map of collection → rows). */
function memStore(seed: Record<string, any[]> = {}) {
  const db = new Map<string, any[]>(Object.entries(seed).map(([k, v]) => [k, [...v]]));
  const rows = (f: string) => { if (!db.has(f)) db.set(f, []); return db.get(f)!; };
  let n = 0;
  return {
    db,
    async readJsonFile(f: string) { return [...rows(f)]; },
    async writeJsonFile(f: string, data: any[]) { db.set(f, [...data]); },
    async addItem(f: string, item: any) {
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

/** A two-request Postman collection — one of them carries a body, so a class can be made from it. */
const COLLECTION = JSON.stringify({
  info: { name: 'Stripe', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  item: [
    {
      name: 'Create Customer',
      request: {
        method: 'POST',
        url: { raw: 'https://api.stripe.com/v1/customers', path: ['v1', 'customers'] },
        body: { mode: 'raw', raw: JSON.stringify({ firstName: 'Ada', email: 'ada@example.com' }) },
      },
    },
    {
      name: 'List Customers',
      request: { method: 'GET', url: { raw: 'https://api.stripe.com/v1/customers', path: ['v1', 'customers'] } },
    },
  ],
});

function seed() {
  return memStore({
    'applications.json': [{ id: 'app-stripe', name: 'Stripe' }],
    'data-library.json': [
      { id: '1', methodName: 'FirstName', returnType: 'string', parameters: '', description: '', code: 'x' },
      { id: '2', methodName: 'Email', returnType: 'string', parameters: '', description: '', code: 'x' },
    ],
  });
}

test('import stamps applicationId on every endpoint, and the class made from one carries it too', async () => {
  const store = seed();
  const lib = new ApiLibraryService(store as any);

  await lib.importFromAny(COLLECTION, 'stripe.postman_collection.json', 'Stripe', 'app-stripe');

  const methods = await lib.getApiMethods();
  assert.equal(methods.length, 2, 'both requests imported');
  for (const m of methods) {
    assert.equal(m.applicationId, 'app-stripe', `${m.name} must carry the stable app id, not the name alone`);
    assert.equal(m.application, 'Stripe', 'the display name is still stored');
  }

  const withBody = methods.find(m => m.method === 'POST')!;
  await new DictionaryImportService(store as any).importApi(withBody);

  const classes = await store.readJsonFile('api-class-library.json');
  assert.equal(classes.length, 1, 'the import created a class entry');
  assert.equal((classes[0] as any).applicationId, 'app-stripe',
    'addClass must copy the endpoint app id onto the class entry');
});

test('importing a bare URL as a single endpoint stamps applicationId too', async () => {
  // The other path into the library: a URL that turns out not to be a spec is registered as one GET.
  // APP-ID-IMPORT covered `importFromAny` and missed this one, so a URL import was still name-only —
  // and the VS Code client papered over it by keeping its own copy of the method.
  const store = seed();
  const lib = new ApiLibraryService(store as any);

  await lib.importSingleEndpoint('https://api.stripe.com/v1/customers', 'Stripe', 'app-stripe');

  const [stored] = await lib.getApiMethods();
  assert.equal(stored.applicationId, 'app-stripe',
    'a URL-imported endpoint must carry the stable app id, or a rename orphans it exactly as before');
  assert.equal(stored.application, 'Stripe', 'the display name is still stored');

  const apps = await store.readJsonFile('applications.json');
  await store.updateItem('applications.json', 'app-stripe', { ...apps[0], name: 'Stripe Payments' });
  const linkId = (await lib.getApiMethods())[0].applicationId;
  const resolved = (await store.readJsonFile('applications.json')).find((a: any) => a.id === linkId);
  assert.equal((resolved as any)?.name, 'Stripe Payments', 'and still resolves after the rename');
});

test('renaming the application leaves imported endpoints and classes resolvable', async () => {
  const store = seed();
  const lib = new ApiLibraryService(store as any);
  await lib.importFromAny(COLLECTION, 'stripe.postman_collection.json', 'Stripe', 'app-stripe');
  const endpoint = (await lib.getApiMethods()).find(m => m.method === 'POST')!;
  await new DictionaryImportService(store as any).importApi(endpoint);

  // The user renames the application in Admin. Rows keep the name they were imported with.
  const apps = await store.readJsonFile('applications.json');
  await store.updateItem('applications.json', 'app-stripe', { ...apps[0], name: 'Stripe Payments' });

  const appById = async (id?: string) =>
    id ? (await store.readJsonFile('applications.json')).find((a: any) => a.id === id) : undefined;
  const appByName = async (name: string) =>
    (await store.readJsonFile('applications.json')).find((a: any) => a.name === name);

  const storedEndpoint = (await lib.getApiMethods())[0];
  const storedClass = (await store.readJsonFile('api-class-library.json'))[0] as any;

  assert.equal((await appByName(storedEndpoint.application))?.id, undefined,
    'precondition: the name link is broken by the rename — the id is what has to carry it');
  assert.equal((await appById(storedEndpoint.applicationId))?.name, 'Stripe Payments',
    'the endpoint still resolves to the renamed application');
  assert.equal((await appById(storedClass.applicationId))?.name, 'Stripe Payments',
    'the class still resolves to the renamed application');
});
