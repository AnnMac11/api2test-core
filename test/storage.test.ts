import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { FileStorageService } from '../src/services/FileStorageService';

function tempStore(): FileStorageService {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2t-store-'));
    return new FileStorageService(dir);
}

test('honours a custom data path', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2t-path-'));
    const store = new FileStorageService(dir);
    assert.equal(store.getDataPath(), dir);
});

test('add / read round-trips and assigns an id', async () => {
    const store = tempStore();
    await store.writeJsonFile('api-tests.json', []);
    await store.addItem('api-tests.json', { name: 'first' } as any);
    const rows = await store.readJsonFile<any>('api-tests.json');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'first');
    assert.ok(rows[0].id, 'id was assigned');
});

test('update preserves id; getItemById finds it', async () => {
    const store = tempStore();
    await store.writeJsonFile('api-tests.json', []);
    await store.addItem('api-tests.json', { id: 'x1', name: 'a' } as any);
    await store.updateItem('api-tests.json', 'x1', { id: 'x1', name: 'b' } as any);
    const found = await store.getItemById<any>('api-tests.json', 'x1');
    assert.equal(found?.name, 'b');
});

test('delete removes the item; missing id throws', async () => {
    const store = tempStore();
    await store.writeJsonFile('api-tests.json', []);
    await store.addItem('api-tests.json', { id: 'y1' } as any);
    await store.deleteItem('api-tests.json', 'y1');
    assert.equal((await store.readJsonFile('api-tests.json')).length, 0);
    await assert.rejects(() => store.deleteItem('api-tests.json', 'nope'));
});

test('seeds the default Data Library on first init', async () => {
    const store = tempStore();
    const methods = await store.readJsonFile<any>('data-library.json');
    assert.ok(methods.length > 0, 'data library seeded from resources');
});
