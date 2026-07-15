import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { DataDictionaryService } from '../src/services/DataDictionaryService';

const noop: any = { readJsonFile: async () => [], writeJsonFile: async () => {}, addItem: async () => {}, updateItem: async () => {}, deleteItem: async () => {}, getItemById: async () => undefined, getDataPath: () => '' };

test('extractFieldsFromEndpoint: no path params + no parameterDetails does not crash (regression)', async () => {
  const dd = new DataDictionaryService(noop);
  const endpoint = {
    path: '/v1/customers',
    method: 'POST',
    requestBodySchema: JSON.stringify({ type: 'object', properties: { email: { type: 'string' }, tax_ids: { type: 'array' } } }),
  };
  // Previously crashed: the fallback read endpoint.endpoint (undefined) and called .match on it.
  const fields = await dd.extractFieldsFromEndpoint(endpoint as any, false);
  assert.ok(fields.some(f => f.fieldName === 'email'));
  assert.equal(fields.find(f => f.fieldName === 'tax_ids')?.fieldType, 'array');
});

test('#52: an integer schema field keeps type `integer` (→ C# int), not `number` (→ decimal)', async () => {
  const dd = new DataDictionaryService(noop);
  const endpoint = {
    path: '/store/order', method: 'POST',
    requestBodySchema: JSON.stringify({ type: 'object', properties: {
      petId: { type: 'integer' }, quantity: { type: 'integer' }, price: { type: 'number' }, note: { type: 'string' },
    } }),
  };
  const fields = await dd.extractFieldsFromEndpoint(endpoint as any, false);
  assert.equal(fields.find(f => f.fieldName === 'petId')?.fieldType, 'integer', 'integer stays integer');
  assert.equal(fields.find(f => f.fieldName === 'quantity')?.fieldType, 'integer');
  assert.equal(fields.find(f => f.fieldName === 'price')?.fieldType, 'number', 'fractional number stays number');
  assert.equal(fields.find(f => f.fieldName === 'note')?.fieldType, 'string');
});

test('array-root request body: extracts the element schema fields (e.g. POST /user/createWithList)', async () => {
  const dd = new DataDictionaryService(noop);
  const endpoint = {
    path: '/user/createWithList', method: 'POST',
    requestBodySchema: JSON.stringify({ type: 'array', items: {
      type: 'object', required: ['username'],
      properties: { username: { type: 'string' }, id: { type: 'integer' } },
    } }),
  };
  const fields = await dd.extractFieldsFromEndpoint(endpoint as any, false);
  assert.ok(fields.find(f => f.fieldName === 'username'), 'username extracted from the array element');
  assert.equal(fields.find(f => f.fieldName === 'id')?.fieldType, 'integer');
});

test('extractFieldsFromEndpoint: derives path params from {placeholders}', async () => {
  const dd = new DataDictionaryService(noop);
  const fields = await dd.extractFieldsFromEndpoint({ path: '/v1/customers/{customer}', method: 'GET' } as any, false);
  assert.ok(fields.some(f => f.fieldName === 'customer' && f.location === 'path'));
});
