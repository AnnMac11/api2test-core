import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { FileStorageService } from '../src/services/FileStorageService';
import { CSharpEmitter } from '../src/adapters/CSharpEmitter';
import { TypeScriptEmitter, emitterFor } from '../src/adapters/TypeScriptEmitter';
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
    // Pin the CONCRETE field: the data method must emit its DataGenerator initializer, not merely
    // mention "Email" somewhere — a dropped/malformed initializer would still contain the token.
    assert.match(code!, /public string Email \{ get; set; \} = new DataGenerator\(\)\.Email\(\);/,
        'data-method field emits its DataGenerator initializer');
    assert.match(code!, /\[JsonPropertyName\("email"\)\]/);
});

test('emits a URL-param class for a body-less endpoint (params become plain properties)', () => {
    // A body-less endpoint (only {} path/query/header params) still gets a class so it reaches the Class
    // Library and can be added to a test. The generated test supplies + interpolates the values, so the
    // class carries PLAIN properties — no [JsonPropertyName], no ToJson (URL params are never a JSON body).
    const req: ClassGenerationRequest = {
        endpoint: '/customers/{id}', method: 'GET', application: 'Stripe',
        fieldConfigurations: [
            { name: 'id', type: 'string', required: true, location: 'path' },
        ],
    };
    const code = emitter().emitRequestClass(req);
    assert.ok(code, 'a class is produced for a body-less endpoint');
    assert.match(code!, /public string Id \{ get; set; \}/, 'the URL param becomes a plain property');
    assert.doesNotMatch(code!, /JsonPropertyName/, 'URL params are not a JSON body — no JsonPropertyName');
    assert.doesNotMatch(code!, /ToJson/, 'URL params are not serialised — no ToJson');
});

test('returns null when the endpoint has no fields at all (no body, no params)', () => {
    const req: ClassGenerationRequest = {
        endpoint: '/health', method: 'GET', application: 'Stripe',
        fieldConfigurations: [],
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

// ── TS-C1: language seam ──────────────────────────────────────────────────────────────────────

function storageDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'a2t-emit-'));
}

test('emitterFor selects the emitter by language', () => {
    const storage = new FileStorageService(storageDir());
    assert.equal(emitterFor('csharp', storage).language, 'csharp');
    assert.equal(emitterFor('typescript', storage).language, 'typescript');
});

test('emitterFor throws for an unknown language', () => {
    const storage = new FileStorageService(storageDir());
    assert.throws(() => emitterFor('ruby' as any, storage), /No CodeEmitter/);
});

test('TypeScriptEmitter reports ts language and extension', () => {
    const e = new TypeScriptEmitter(new FileStorageService(storageDir()));
    assert.equal(e.language, 'typescript');
    assert.equal(e.fileExtension, 'ts');
});

test('every TypeScriptEmitter method is implemented (none throws a not-implemented stub)', () => {
    const e = new TypeScriptEmitter(new FileStorageService(storageDir()));
    // The request-class + data-library emitters are covered in depth in their own test files; here we just
    // assert the emitter surface is fully wired (no remaining TS-C stub throwing "not implemented yet").
    // Not just "doesn't throw" — pin that each adapter delegates to the right TS generator (a wrong
    // delegation or an empty return would pass a doesNotThrow but fail these).
    assert.match(e.emitApiMethods([]), /export class ApiMethods/, 'emitApiMethods delegates to the ApiMethods TS generator');
    assert.match(e.emitDataLibrary([]), /export class DataGenerator/, 'emitDataLibrary delegates to the DataGenerator TS generator');
});

test('#52: an integer field generates `public int`, a fractional number `public decimal`', () => {
    // The whole point of #52: an integer id must not widen to `decimal`. The extraction side is pinned
    // in extract.test.ts (fieldType stays `integer`); this pins the CONCRETE generated property type.
    const req: ClassGenerationRequest = {
        endpoint: '/store/order', method: 'POST', application: 'Pet Store',
        fieldConfigurations: [
            { name: 'id', type: 'integer', required: true, location: 'body' },
            { name: 'price', type: 'number', required: true, location: 'body' },
        ],
    };
    const code = emitter().emitRequestClass(req)!;
    assert.match(code, /public int Id \{ get; set; \}/, 'integer → C# int, not decimal');
    assert.match(code, /public decimal Price \{ get; set; \}/, 'fractional number → decimal');
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
