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
