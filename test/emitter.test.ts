import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { FileStorageService } from '../src/services/FileStorageService';
import { CSharpEmitter } from '../src/adapters/CSharpEmitter';
import { ClassGenerationRequest } from '../src/models/ClassGenerationDto';

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
