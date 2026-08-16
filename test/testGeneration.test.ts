import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TestGenerationService } from '../src/services/TestGenerationService';
import { FileStorageService } from '../src/services/FileStorageService';
import { librariesNs, classesNs, testsNs } from '../src/services/generatedNamespaces';
import { tmpDir } from './tmp';

function svc(): TestGenerationService {
  const dir = tmpDir('a2t-gen-');
  return new TestGenerationService(new FileStorageService(dir));
}

const base: any = {
  className: 'Pet', endpoint: '/pets/{pet_id}', method: 'GET', application: 'PetStore',
  wrapperClass: 'ApiMethods', wrapperMethod: 'GetAsync', testFramework: 'MSTest',
  pathParams: [{ name: 'pet_id', type: 'string' }],
};

test('path placeholder is rewritten to the sanitised var name (snake_case)', () => {
  const code = svc().generateCode(base);
  assert.match(code, /var petid = /, 'declares the sanitised var');
  assert.match(code, /\{BaseUrl\}\/pets\/\{petid\}/, 'URL interpolates {petid}');
  assert.ok(!code.includes('{pet_id}'), 'the raw {pet_id} placeholder must be gone (would be CS0103)');
});

test('usings + namespace use the shared generatedNamespaces, not the old library names', () => {
  const code = svc().generateCode({ ...base, method: 'POST', bodyClassName: 'PetStorePostPet' });
  assert.ok(code.includes(`using ${librariesNs()};`), 'ApiMethods/DataGenerator namespace');
  assert.ok(code.includes(`using ${classesNs('PetStore')};`), 'request-class namespace');
  assert.ok(code.includes(`namespace ${testsNs('PetStore')};`), 'file-scoped test namespace');
  for (const bad of ['using DataLibrary;', 'using ApiMethodLibrary;', 'using GeneratedClasses;']) {
    assert.ok(!code.includes(bad), `must not emit the broken '${bad}'`);
  }
});

test('POST body pins the wrapper call (class.method + arg order) and request-body construction', () => {
  // The namespace test above never touches the call site; a wrong wrapper, swapped args, or a missing
  // .ToJson() would stay green. Pin the concrete Act lines (the C# analogue of the TS twin's coverage).
  const code = svc().generateCode({ ...base, method: 'POST', bodyClassName: 'PetStorePostPet' });
  assert.match(code, /var requestBody = new PetStorePostPet\(\)\.ToJson\(\);/,
    'request body is built from the body class and serialised');
  assert.match(code, /var response = await ApiMethods\.GetAsync\(token, url, requestBody\);/,
    'wrapper class.method and (token, url, requestBody) arg order are pinned');
});
