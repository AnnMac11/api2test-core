import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { FileStorageService } from '../src/services/FileStorageService';
import { CSharpEmitter } from '../src/adapters/CSharpEmitter';
import { ClassGenerationRequest } from '../src/models/ClassGenerationDto';
import { PARAMETER } from '../src/services/DataDictionaryService';

function emitter(): CSharpEmitter {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2t-emit-'));
    return new CSharpEmitter(new FileStorageService(dir));
}

test('reports language and file extension', () => {
    const e = emitter();
    assert.equal(e.language, 'csharp');
    assert.equal(e.fileExtension, 'cs');
});

test('emits a request class with a data-method default', () => {
    const req: ClassGenerationRequest = {
        endpoint: '/customers', method: 'POST', application: 'Stripe',
        fieldConfigurations: [
            { name: 'email', type: 'string', required: true, dataMethod: 'Email', location: 'body' },
        ],
    };
    const code = emitter().emitRequestClass(req);
    assert.ok(code, 'code produced');
    assert.match(code!, /class/);
    assert.match(code!, /Email/);
    assert.match(code!, /\[JsonPropertyName\("email"\)\]/);
});

test('returns null when there are no body fields', () => {
    const req: ClassGenerationRequest = {
        endpoint: '/customers/{id}', method: 'GET', application: 'Stripe',
        fieldConfigurations: [
            { name: 'id', type: 'string', required: true, location: 'path' },
        ],
    };
    assert.equal(emitter().emitRequestClass(req), null);
});

test('PARAMETER field emits a settable placeholder, not a DataGenerator call', () => {
    // A field whose value is supplied at runtime (e.g. another API's output) must NOT generate a
    // `new DataGenerator().Parameter()` call (that method does not exist and would not compile). It
    // gets a plain settable property with a safe default so the class compiles and the test can assign it.
    const req: ClassGenerationRequest = {
        endpoint: '/order', method: 'POST', application: 'Pet Store',
        fieldConfigurations: [
            { name: 'orderId', type: 'number', required: true, dataMethod: PARAMETER, location: 'body' },
            { name: 'quantity', type: 'number', required: true, dataMethod: 'RandomId', location: 'body' },
        ],
    };
    const code = emitter().emitRequestClass(req)!;
    assert.doesNotMatch(code, /DataGenerator\(\)\.Parameter/, 'must not call a Parameter generator method');
    assert.match(code, /public decimal OrderId \{ get; set; \} = 0m; \/\/ parameter/, 'placeholder property emitted');
    assert.match(code, /new DataGenerator\(\)\.RandomId\(\)/, 'other fields still use their data method');
});

test('form content-type adds ToFormBody()', () => {
    const req: ClassGenerationRequest = {
        endpoint: '/customers', method: 'POST', application: 'Stripe',
        contentType: 'application/x-www-form-urlencoded',
        fieldConfigurations: [
            { name: 'name', type: 'string', required: true, dataMethod: 'BusinessName', location: 'body' },
        ],
    };
    const code = emitter().emitRequestClass(req)!;
    assert.match(code, /ToFormBody/);
});
