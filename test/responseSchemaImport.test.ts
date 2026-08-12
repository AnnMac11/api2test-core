/**
 * RESP-SCHEMA — an endpoint's response shape must survive import.
 *
 * Drives the REAL import sequence (detect → adaptToUnified → toApiMethodDto → store) against an
 * in-memory StorageProvider, then reads the stored row through the REAL consumer
 * ({@link describeFieldStructure}). Nothing is seeded past the step under test.
 *
 * The bug: only the REQUEST body schema was resolved and stored. For a response the adapter kept a
 * flattened example instead — and `getExampleValue` returns `[]` for every array — so
 * `{"data": [{...}]}` was written to disk as `{"data": []}` and the element shape was gone. Every GET
 * has no request body, so for those endpoints NOTHING on disk said what their fields hold: the Data
 * Dictionary's Structure block had nothing to show, and re-import was the only way to recover it.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { ApiLibraryService } from '../src/services/ApiLibraryService';
import { describeFieldStructure } from '../src/services/fieldStructure';

/** Minimal in-memory StorageProvider (Map of collection → rows). */
function memStore() {
  const db = new Map<string, any[]>();
  const rows = (f: string) => { if (!db.has(f)) db.set(f, []); return db.get(f)!; };
  let n = 0;
  return {
    db,
    async readJsonFile(f: string) { return [...rows(f)]; },
    async writeJsonFile(f: string, data: any[]) { db.set(f, [...data]); },
    async addItem(f: string, item: any) { if (!item.id) { item.id = `gen-${++n}`; } rows(f).push(item); },
    async updateItem(f: string, id: string, item: any) {
      const arr = rows(f); const i = arr.findIndex(r => r.id === id);
      if (i < 0) { throw new Error(`not found: ${id}`); }
      arr[i] = { ...item, id };
    },
    async deleteItem(f: string, id: string) { const arr = rows(f); const i = arr.findIndex(r => r.id === id); if (i >= 0) arr.splice(i, 1); },
    async getItemById(f: string, id: string) { return rows(f).find(r => r.id === id); },
    getDataPath() { return ':memory:'; },
  };
}

/**
 * A Stripe-shaped list endpoint: GET has no request body, and its 200 wraps the real payload in a
 * `data` array of `$ref: Customer`. This is the exact shape the user hit.
 */
const SPEC = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'Stripe', version: '1' },
  paths: {
    '/v1/customers': {
      get: {
        operationId: 'GetCustomers',
        responses: {
          '200': {
            description: 'ok',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: { type: 'array', items: { $ref: '#/components/schemas/Customer' } },
                    has_more: { type: 'boolean' },
                    url: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Customer: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          object: { type: 'string' },
          amount: { type: 'integer' },
          currency: { type: 'string' },
          created: { type: 'integer' },
        },
      },
    },
  },
});

async function importSpec() {
  const store = memStore();
  const lib = new ApiLibraryService(store as any);
  await lib.importFromAny(SPEC, 'stripe.openapi.json', 'Stripe', 'app-stripe');
  return (await lib.getApiMethods())[0];
}

test('import stores the resolved response schema for an endpoint with no request body', async () => {
  const endpoint = await importSpec();

  assert.equal(endpoint.method, 'GET', 'precondition: the endpoint under test is a GET');
  assert.ok(
    !endpoint.requestBodySchema || !JSON.parse(endpoint.requestBodySchema).properties?.data,
    'precondition: a GET has no request body, so nothing about `data` can come from there');

  assert.ok(endpoint.responseBodySchema, 'the response schema must be stored, not just an example');
  const schema = JSON.parse(endpoint.responseBodySchema!);
  assert.equal(schema.properties.data.type, 'array');
  assert.deepEqual(
    Object.keys(schema.properties.data.items.properties),
    ['id', 'object', 'amount', 'currency', 'created'],
    'the $ref element is inlined, so the element fields survive on disk');
});

test('the stored response schema answers what an array element holds', async () => {
  const endpoint = await importSpec();

  const shape = describeFieldStructure(endpoint.responseBodySchema, 'data');
  assert.ok(shape, 'the Structure block has something to render for a response-sourced array field');
  assert.equal(shape!.kind, 'array');
  assert.deepEqual(shape!.members, [
    { name: 'id', type: 'string' },
    { name: 'object', type: 'string' },
    { name: 'amount', type: 'integer' },
    { name: 'currency', type: 'string' },
    { name: 'created', type: 'integer' },
  ]);
});

test('the flattened response example is still stored, and is still lossy — it is not the fix', async () => {
  const endpoint = await importSpec();

  const example = JSON.parse(endpoint.responseExamples || '{}');
  assert.deepEqual(example.data, [], 'the example keeps its skeleton behaviour: arrays are empty');
  assert.equal(describeFieldStructure(endpoint.responseExamples, 'data'), undefined,
    'which is exactly why the example cannot be the source of the structure');
});
