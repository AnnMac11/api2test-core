import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { DataDictionaryService, NOT_ASSIGNED } from '../src/services/DataDictionaryService';
import { FileStorageService } from '../src/services/FileStorageService';
import { DataDictionaryField } from '../src/models/DataDictionaryDto';
import { DataMethodDto } from '../src/models/DataMethodDto';

function svc(): DataDictionaryService {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2t-match-'));
    return new DataDictionaryService(new FileStorageService(dir));
}

function field(fieldName: string, fieldType: string): DataDictionaryField {
    return { id: '1', fieldName, fieldType, mandatory: false, dataMethod: NOT_ASSIGNED } as DataDictionaryField;
}
function urlField(fieldName: string, fieldType: string, location: 'path' | 'query'): DataDictionaryField {
    return { id: '1', fieldName, fieldType, mandatory: true, dataMethod: NOT_ASSIGNED, location } as DataDictionaryField;
}
function method(methodName: string, returnType: string): DataMethodDto {
    return { id: methodName, methodName, returnType } as DataMethodDto;
}

test('matches a scalar field by name', () => {
    const out = svc().autoMatchDataMethods(
        [field('email', 'string')],
        [method('Email', 'string'), method('FirstName', 'string')],
    );
    assert.equal(out[0].dataMethod, 'Email');
});

test('type-first: an object field does NOT match a same-named scalar method', () => {
    // The classic bug: object `address` must not bind to a scalar Address() method.
    const out = svc().autoMatchDataMethods(
        [field('address', 'object')],
        [method('Address', 'string'), method('StripeAddress', 'object')],
    );
    assert.equal(out[0].dataMethod, 'StripeAddress');
});

test('array field binds only to an array-returning method', () => {
    const out = svc().autoMatchDataMethods(
        [field('tax_id_data', 'array')],
        [method('StripeTaxIds', 'array'), method('TaxId', 'string')],
    );
    assert.equal(out[0].dataMethod, 'StripeTaxIds');
});

test('no compatible method leaves the field Not Assigned', () => {
    const out = svc().autoMatchDataMethods(
        [field('mysteryField', 'object')],
        [method('Email', 'string')],
    );
    assert.equal(out[0].dataMethod, NOT_ASSIGNED);
});

test('does not mutate the input array', () => {
    const input = [field('email', 'string')];
    svc().autoMatchDataMethods(input, [method('Email', 'string')]);
    assert.equal(input[0].dataMethod, NOT_ASSIGNED);
});

test('return-type-first: a number field does NOT match a same-worded string method', () => {
    // The bug this fix addresses: number `id` must not bind the string `TaxId()` — its CamelCase
    // "Id" word name-matches, and the old coarse object/array/scalar bucket let it through.
    const out = svc().autoMatchDataMethods(
        [field('id', 'number')],
        [method('TaxId', 'string'), method('FirstName', 'string')],
    );
    assert.equal(out[0].dataMethod, NOT_ASSIGNED);
});

test('return-type-first: a number field binds a number-returning method', () => {
    const out = svc().autoMatchDataMethods(
        [field('id', 'number')],
        [method('TaxId', 'string'), method('RecordId', 'long')],
    );
    assert.equal(out[0].dataMethod, 'RecordId');
});

test('return-type-first: a boolean field does NOT match a string method by name', () => {
    const out = svc().autoMatchDataMethods(
        [field('active', 'boolean')],
        [method('ActiveStatus', 'string')],
    );
    assert.equal(out[0].dataMethod, NOT_ASSIGNED);
});

// ── URL parameter fields (path/query) — value is always runtime-supplied, so the field is bound to the
//    type-matched Parameter* placeholder instead of a data generator, regardless of its name. This is what
//    lets a bodyless endpoint's class generate (an unmatched mandatory field would block generation). ──

test('a path param binds the type-matched Parameter method, not by its own name', () => {
    // `petId` name-matches nothing here; as a path param it must still resolve to ParameterInt (int class).
    const out = svc().autoMatchDataMethods(
        [urlField('petId', 'number', 'path')],
        [method('ParameterInt', 'int'), method('ParameterString', 'string'), method('Age', 'int')],
    );
    assert.equal(out[0].dataMethod, 'ParameterInt');
});

test('a string query param binds ParameterString (not another string generator)', () => {
    // FirstName is a decoy: with two string candidates the tier-4 single-match fallback can't fire, so
    // binding ParameterString proves the url-param path, not luck.
    const out = svc().autoMatchDataMethods(
        [urlField('status', 'string', 'query')],
        [method('ParameterString', 'string'), method('FirstName', 'string')],
    );
    assert.equal(out[0].dataMethod, 'ParameterString');
});

test('a boolean path param binds ParameterBool (not a name-matching bool method)', () => {
    // IsActive would name-match `active` via CamelCase; the url-param path must beat it with ParameterBool.
    const out = svc().autoMatchDataMethods(
        [urlField('active', 'boolean', 'path')],
        [method('ParameterBool', 'bool'), method('IsActive', 'bool')],
    );
    assert.equal(out[0].dataMethod, 'ParameterBool');
});

test('a body field still matches by name (url-param handling does not touch body)', () => {
    const out = svc().autoMatchDataMethods(
        [field('email', 'string')],
        [method('Email', 'string'), method('ParameterString', 'string')],
    );
    assert.equal(out[0].dataMethod, 'Email');
});
