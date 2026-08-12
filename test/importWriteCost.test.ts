/**
 * IMPORT-WRITE-COST — importing N endpoints must not cost N whole-file rewrites.
 *
 * `addItem` reads the entire collection, appends one row, and writes the entire collection back. Used
 * in a loop, importing Stripe's 589 endpoints re-serialised a file that grows to megabytes, 589 times
 * over — gigabytes of I/O and JSON work for one import, which reads to the user as a hang with no
 * error. The endpoints are known up front, so the file should be written once.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { ApiLibraryService } from '../src/services/ApiLibraryService';

/** In-memory store that counts what the import actually does to the file. */
function countingStore() {
  const db = new Map<string, any[]>();
  const rows = (f: string) => { if (!db.has(f)) { db.set(f, []); } return db.get(f)!; };
  const writes: string[] = [];
  let n = 0;
  return {
    writes,
    async readJsonFile(f: string) { return [...rows(f)]; },
    async writeJsonFile(f: string, data: any[]) { writes.push(f); db.set(f, [...data]); },
    async addItem(f: string, item: any) { writes.push(f); if (!item.id) { item.id = `gen-${++n}`; } rows(f).push(item); },
    async updateItem() { /* unused */ },
    async deleteItem() { /* unused */ },
    async getItemById(f: string, id: string) { return rows(f).find(r => r.id === id); },
    getDataPath() { return ':memory:'; },
  };
}

/** A spec with `count` trivial endpoints — the shape of the loop is what is under test, not the schemas. */
function spec(count: number): string {
  const paths: Record<string, any> = {};
  for (let i = 0; i < count; i++) {
    paths[`/thing${i}`] = { get: { operationId: `GetThing${i}`, responses: { '200': { description: 'ok' } } } };
  }
  return JSON.stringify({ openapi: '3.0.0', info: { title: 'Many', version: '1' }, servers: [{ url: 'https://api.example.com' }], paths });
}

test('importing 200 endpoints writes the file once, not 200 times', async () => {
  const store = countingStore();
  const lib = new ApiLibraryService(store as any);

  await lib.importFromAny(spec(200), 'many.openapi.json', 'Many', 'app-many');

  const methodWrites = store.writes.filter(f => f === 'api-methods.json').length;
  assert.ok(methodWrites <= 2,
    `the import wrote api-methods.json ${methodWrites} times for 200 endpoints — each write re-serialises ` +
    `every row already stored, so the cost grows with the square of the import`);
  assert.equal((await lib.getApiMethods()).length, 200, 'and all of them are still stored');
});

test('the service has exactly two import paths, so neither can escape the write-cost tests above', () => {
  // IMPORT-DEAD. `importFromPostman`/`importFromOpenApi` survived here uncalled — by any client, in any
  // repo — still holding the per-endpoint `addItem` loop that the fix above removed. Deleting them is
  // most of the value; this assertion is the rest, because the failure mode is a *third* import path
  // being added later with its own loop and no test, which is exactly how the first one persisted.
  const importMethods = Object.getOwnPropertyNames(ApiLibraryService.prototype)
    .filter(n => n.startsWith('import')).sort();

  assert.deepEqual(importMethods, ['importFromAny', 'importSingleEndpoint'],
    'a new import path must either be covered by the write-cost test above or not exist — if you are ' +
    'adding one deliberately, add its cost assertion first, then this list');
});

test('an import appends to what is already there rather than replacing it', async () => {
  const store = countingStore();
  const lib = new ApiLibraryService(store as any);

  await lib.importFromAny(spec(3), 'first.openapi.json', 'First', 'app-1');
  await lib.importFromAny(spec(2), 'second.openapi.json', 'Second', 'app-2');

  const stored = await lib.getApiMethods();
  assert.equal(stored.length, 5, 'the second import must not overwrite the first');
  assert.deepEqual([...new Set(stored.map(r => r.application))], ['First', 'Second']);
  assert.equal(new Set(stored.map(r => r.id)).size, 5, 'every row keeps a distinct id');
});
