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

test('extractFieldsFromEndpoint: derives path params from {placeholders}', async () => {
  const dd = new DataDictionaryService(noop);
  const fields = await dd.extractFieldsFromEndpoint({ path: '/v1/customers/{customer}', method: 'GET' } as any, false);
  assert.ok(fields.some(f => f.fieldName === 'customer' && f.location === 'path'));
});
