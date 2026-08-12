/**
 * IMPORT-FIDELITY — everything the spec says about an endpoint must survive import.
 *
 * Written after RESP-SCHEMA, where a whole class of the spec (every response shape) was found to be
 * silently dropped at import and stayed dropped for weeks because nothing asserted otherwise. These
 * tests are the general guard: import ONE realistic spec through the REAL sequence
 * (detect → adaptToUnified → toApiMethodDto → store) and then check the stored row against the spec,
 * piece by piece — identity, parameters, headers, request shape, response shape.
 *
 * They assert against the SPEC, not against the adapter's current output, so a future change that
 * quietly stops carrying something fails here rather than surfacing months later as "the API data was
 * not completely saved".
 *
 * Deliberately NOT asserted: sample values. `generateExampleFromSchema` emits a typed skeleton on
 * purpose (no invented data) — the *shape* lives in the schemas, which is what these check.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { ApiLibraryService } from '../src/services/ApiLibraryService';
import { ApiMethodDto } from '../src/models/ApiMethodDto';

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
 * One spec, three endpoints, chosen to cover what real imports actually carry:
 *  - `POST /v1/customers` — a Stripe-shaped **form-urlencoded** body (never JSON), nested object,
 *    array of objects, array of scalars, a `$ref`, and `required`.
 *  - `GET /v1/customers/{customer}` — path + query + header parameters, no request body, and a
 *    response that wraps its payload in an array (the RESP-SCHEMA case).
 *  - `DELETE /v1/customers/{customer}` — the minimum: an endpoint with nothing but a path param.
 */
const SPEC = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'Stripe', version: '1' },
  // Verbatim from Stripe's spec, trailing slash and all — every path starts with one too.
  servers: [{ url: 'https://api.stripe.com/' }],
  paths: {
    '/v1/customers': {
      post: {
        operationId: 'CreateCustomer',
        summary: 'Create a customer',
        requestBody: {
          required: true,
          content: {
            'application/x-www-form-urlencoded': {
              schema: {
                type: 'object',
                required: ['email'],
                properties: {
                  email: { type: 'string' },
                  balance: { type: 'integer' },
                  livemode: { type: 'boolean' },
                  address: { $ref: '#/components/schemas/Address' },
                  expand: { type: 'array', items: { type: 'string' } },
                  tax_id_data: {
                    type: 'array',
                    items: { type: 'object', properties: { type: { type: 'string' }, value: { type: 'string' } } },
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'ok',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Customer' } } },
          },
        },
      },
    },
    '/v1/customers/{customer}': {
      get: {
        operationId: 'GetCustomer',
        description: 'Retrieve a customer',
        parameters: [
          { name: 'customer', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer' } },
          { name: 'Stripe-Version', in: 'header', required: false, schema: { type: 'string' } },
        ],
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
                  },
                },
              },
            },
          },
        },
      },
      delete: {
        operationId: 'DeleteCustomer',
        parameters: [{ name: 'customer', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'ok' } },
      },
    },
  },
  components: {
    schemas: {
      Address: {
        type: 'object',
        properties: { city: { type: 'string' }, country: { type: 'string' } },
      },
      Customer: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          object: { type: 'string' },
          balance: { type: 'integer' },
          address: { $ref: '#/components/schemas/Address' },
        },
      },
    },
  },
});

async function importSpec(): Promise<ApiMethodDto[]> {
  const store = memStore();
  const lib = new ApiLibraryService(store as any);
  await lib.importFromAny(SPEC, 'stripe.openapi.json', 'Stripe', 'app-stripe');
  return lib.getApiMethods();
}

const byMethod = (rows: ApiMethodDto[], method: string, endpoint: string) =>
  rows.find(r => r.method === method && r.endpoint === endpoint)!;

test('every operation in the spec becomes an endpoint, with its identity intact', async () => {
  const rows = await importSpec();
  assert.equal(rows.length, 3, 'all three operations imported — two of them share a path');

  const post = byMethod(rows, 'POST', '/v1/customers');
  assert.equal(post.name, 'CreateCustomer', 'the operationId is the name');
  assert.equal(post.description, 'Create a customer', 'summary/description is carried');
  assert.equal(post.url, 'https://api.stripe.com/v1/customers',
    'the server URL is joined to the path — one slash between them, and the host is the declared server ' +
    '(an OpenAPI v3 spec has `servers` and no `host`, so reading `host` gives "https://undefined/…")');
  assert.equal(post.application, 'Stripe');
  assert.equal(post.applicationId, 'app-stripe', 'the rename-proof link (APP-ID-IMPORT)');
  assert.equal(post.source, 'openapi');
  assert.ok(post.id, 'stored with an id');

  assert.equal(byMethod(rows, 'GET', '/v1/customers/{customer}').description, 'Retrieve a customer');
  assert.ok(byMethod(rows, 'DELETE', '/v1/customers/{customer}'), 'an operation with no body still imports');
});

test('path, query and header parameters are all kept, with their type and required flag', async () => {
  const get = byMethod(await importSpec(), 'GET', '/v1/customers/{customer}');
  const details = get.parameterDetails || [];

  const find = (name: string) => details.find(p => p.name === name);
  assert.deepEqual(find('customer'), { name: 'customer', type: 'string', location: 'path', required: true });
  assert.deepEqual(find('limit'), { name: 'limit', type: 'integer', location: 'query', required: false });
  assert.deepEqual(find('Stripe-Version'), { name: 'Stripe-Version', type: 'string', location: 'header', required: false });
  assert.equal(details.length, 3, 'nothing extra, nothing dropped');
});

test('the request body survives as a schema — nested objects, arrays and $refs alike', async () => {
  const post = byMethod(await importSpec(), 'POST', '/v1/customers');

  assert.ok(post.requestBodySchema, 'the resolved body schema is stored');
  const body = JSON.parse(post.requestBodySchema!);

  assert.deepEqual(Object.keys(body.properties), ['email', 'balance', 'livemode', 'address', 'expand', 'tax_id_data'],
    'every declared property, in spec order');
  assert.deepEqual(body.required, ['email'], 'required[] is what makes a field mandatory downstream');
  assert.equal(body.properties.balance.type, 'integer', 'integer stays integer (it becomes C# int, not decimal)');
  assert.equal(body.properties.livemode.type, 'boolean');

  assert.deepEqual(Object.keys(body.properties.address.properties), ['city', 'country'],
    'the $ref is inlined, not left as a dangling pointer');
  assert.equal(body.properties.expand.items.type, 'string', 'an array of scalars keeps its element type');
  assert.deepEqual(Object.keys(body.properties.tax_id_data.items.properties), ['type', 'value'],
    'an array of objects keeps its element shape — the thing that was lost on the response side');
});

test('the response shape survives too, for endpoints with a body and without', async () => {
  const rows = await importSpec();

  // A GET has no request body at all, so the response is the only record of its shape.
  const get = byMethod(rows, 'GET', '/v1/customers/{customer}');
  assert.ok(get.responseBodySchema, 'a GET must still say what it returns');
  const listed = JSON.parse(get.responseBodySchema!);
  assert.equal(listed.properties.data.type, 'array');
  assert.deepEqual(Object.keys(listed.properties.data.items.properties), ['id', 'object', 'balance', 'address'],
    'the array element is resolved through its $ref');
  assert.deepEqual(Object.keys(listed.properties.data.items.properties.address.properties), ['city', 'country'],
    'and so is the $ref nested inside it');

  // And an endpoint that has both keeps both.
  const post = byMethod(rows, 'POST', '/v1/customers');
  assert.ok(post.requestBodySchema && post.responseBodySchema, 'request and response are stored side by side');
  assert.notEqual(post.requestBodySchema, post.responseBodySchema, 'and they are not the same object');
});

test('the request media type is preserved — Stripe is form-urlencoded, never JSON', async () => {
  const rows = await importSpec();

  const post = byMethod(rows, 'POST', '/v1/customers');
  assert.equal(post.contentType, 'application/x-www-form-urlencoded',
    'generation encodes the body from this; defaulting it to JSON produces calls Stripe rejects');
  assert.match(post.requestHeaders || '', /Content-Type: application\/x-www-form-urlencoded/,
    'and it is on the stored headers too');

  assert.equal(byMethod(rows, 'DELETE', '/v1/customers/{customer}').contentType, 'application/json',
    'an endpoint with no body falls back to JSON rather than an empty string');
});

test('nothing declared in the spec goes missing from the stored row', async () => {
  // A property-level sweep: every field name the spec declares anywhere must be findable in what was
  // stored. Catches a whole class of loss at once — a new adapter path that forgets a branch shows up
  // here even if no test above names that field.
  const rows = await importSpec();
  // The schemas are stored as JSON *strings*, so a plain JSON.stringify(rows) would escape their
  // quotes and hide every name inside them — search the raw values alongside the row.
  const stored = rows.map(r => [JSON.stringify(r), r.requestBodySchema, r.responseBodySchema, r.requestBodyTemplate,
    r.responseExamples].join(' ')).join(' ');

  const declared = ['email', 'balance', 'livemode', 'address', 'city', 'country', 'expand',
    'tax_id_data', 'type', 'value', 'id', 'object', 'has_more', 'data',
    'customer', 'limit', 'Stripe-Version'];

  const missing = declared.filter(name => !stored.includes(`"${name}"`));
  assert.deepEqual(missing, [], `these were declared in the spec but are nowhere in the stored rows: ${missing.join(', ')}`);
});
