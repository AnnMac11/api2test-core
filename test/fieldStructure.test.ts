import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { describeFieldStructure } from '../src/services/fieldStructure';

/**
 * DD-STRUCT — reading one field's shape back out of the endpoint's stored schema.
 *
 * The dictionary keeps an `object`/`array` field as ONE row (the row mirrors the body's top level),
 * so the user assigning a data method to `data: array` had nothing telling them what an element is.
 * The shape was never lost — it sits in `requestBodySchema` — and this is what gets it back.
 *
 * Description only: no row is created, no type is changed.
 */

const SCHEMA = JSON.stringify({
    type: 'object',
    required: ['data'],
    properties: {
        data: {
            type: 'array',
            items: {
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
        tags: { type: 'array', items: { type: 'string' } },
        address: {
            type: 'object',
            properties: {
                city: { type: 'string' },
                postcode: { type: 'string' },
                geo: { type: 'object', properties: { lat: { type: 'number' } } },
            },
        },
        name: { type: 'string' },
    },
});

test('DD-STRUCT: an array of objects reports its element members, in spec order', () => {
    const shape = describeFieldStructure(SCHEMA, 'data');

    assert.ok(shape, 'the shape is readable from the stored schema');
    assert.equal(shape!.kind, 'array');
    assert.equal(shape!.elementType, 'object', 'one element of `data` is an object');
    assert.deepEqual(
        shape!.members,
        [
            { name: 'id', type: 'string' },
            { name: 'object', type: 'string' },
            { name: 'amount', type: 'integer' },
            { name: 'currency', type: 'string' },
            { name: 'created', type: 'integer' },
        ],
        'the members are the element\'s own, in the order the spec declares them');
});

test('DD-STRUCT: an array of scalars is one line — the element type, no members', () => {
    const shape = describeFieldStructure(SCHEMA, 'tags');

    assert.equal(shape!.kind, 'array');
    assert.equal(shape!.elementType, 'string');
    assert.deepEqual(shape!.members, []);
});

test('DD-STRUCT: an object reports its immediate members; a nested one is named, not expanded', () => {
    const shape = describeFieldStructure(SCHEMA, 'address');

    assert.equal(shape!.kind, 'object');
    assert.equal(shape!.elementType, undefined, 'an object has no element type');
    assert.deepEqual(shape!.members, [
        { name: 'city', type: 'string' },
        { name: 'postcode', type: 'string' },
        { name: 'geo', type: 'object' },
    ], 'one level deep — enough to say what a data method must return');
});

test('DD-STRUCT: a scalar field has no structure to show', () => {
    const shape = describeFieldStructure(SCHEMA, 'name');
    assert.equal(shape!.kind, 'scalar');
    assert.deepEqual(shape!.members, []);
});

test('DD-STRUCT: a dotted field name is walked, through an array wrapper if there is one', () => {
    assert.deepEqual(describeFieldStructure(SCHEMA, 'address.geo')!.members,
        [{ name: 'lat', type: 'number' }]);
    assert.deepEqual(describeFieldStructure(SCHEMA, 'data.amount')!.kind, 'scalar',
        'stepping into `data` uses its element, as the dictionary extraction does');
});

test('DD-STRUCT: nothing to show is undefined, never a throw — the caller just omits the display', () => {
    assert.equal(describeFieldStructure(undefined, 'data'), undefined, 'no schema stored');
    assert.equal(describeFieldStructure('not json {{', 'data'), undefined, 'unparseable schema');
    assert.equal(describeFieldStructure(SCHEMA, 'nosuchfield'), undefined, 'field not in the schema');
    assert.equal(describeFieldStructure(SCHEMA, ''), undefined, 'no field name');
});

test('DD-STRUCT: an array-rooted body is addressed by its element properties', () => {
    const arrayRoot = JSON.stringify({
        type: 'array',
        items: { type: 'object', properties: { photoUrls: { type: 'array', items: { type: 'string' } } } },
    });

    const shape = describeFieldStructure(arrayRoot, 'photoUrls');
    assert.equal(shape!.kind, 'array');
    assert.equal(shape!.elementType, 'string');
});
