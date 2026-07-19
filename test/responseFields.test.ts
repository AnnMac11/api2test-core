/**
 * E2E-RESP (core half): responseFields flattens a response example into dotted field paths so the
 * E2E builder can OFFER response fields in a dropdown (id, address.city) instead of a raw text box.
 * Ported from Desktop's Next route `api/e2e/response-fields` (the pure `flatten`), edition-neutral.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { responseFields } from '../src/services/responseFields';

test('responseFields: flattens nested objects to dotted paths', () => {
  const example = { id: 'cus_1', email: 'a@b.com', address: { city: 'Dublin', line1: '1 Main St' } };
  assert.deepEqual(responseFields(example), ['id', 'email', 'address', 'address.city', 'address.line1']);
});

test('responseFields: descends objects up to 2 levels deep, no deeper', () => {
  const example = { a: { b: { c: { d: 1 } } } };
  // depth cap: a, a.b, a.b.c are emitted; a.b.c.d is NOT (object beyond 2 levels not descended).
  assert.deepEqual(responseFields(example), ['a', 'a.b', 'a.b.c']);
});

test('responseFields: does not descend into arrays', () => {
  const example = { id: 1, items: [{ sku: 'x' }], tags: ['a', 'b'] };
  assert.deepEqual(responseFields(example), ['id', 'items', 'tags']);
});

test('responseFields: a top-level array or primitive yields no fields', () => {
  assert.deepEqual(responseFields([{ id: 1 }]), []);
  assert.deepEqual(responseFields('cus_1'), []); // a bare string is not a JSON object
  assert.deepEqual(responseFields(null), []);
});

test('responseFields: accepts a JSON string, tolerant of invalid JSON', () => {
  assert.deepEqual(responseFields('{"id":1,"address":{"city":"Dublin"}}'), ['id', 'address', 'address.city']);
  assert.deepEqual(responseFields('{not json'), []);
});

test('responseFields: de-duplicates repeated paths', () => {
  // Two sibling objects with the same inner key must not produce a duplicate path.
  const example = { a: { city: 1 }, b: { city: 2 } };
  assert.deepEqual(responseFields(example), ['a', 'a.city', 'b', 'b.city']);
});
