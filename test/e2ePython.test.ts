/**
 * PY-GEN-1 — the Python (pytest) E2E emitter. Mirrors e2eTypeScript.test.ts: a class-first chain
 * becomes a runnable pytest test — the send verb derives from each class's HTTP method, captured
 * fields flow into later steps (wrapped in str() for URL concatenation), and validators assert.
 * Beyond the TS compile guard, the generated chain is RUN against a stub api_methods module and the
 * captured value is asserted to land in the second step's URL.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { generateE2ETestPython } from '../src/services/generateE2ETestPython';
import { E2EPage, E2ETestCaseRow, E2EGenContext } from '../src/models/E2EDto';
import { tmpDir } from './tmp';

function hasPython(): boolean {
  try { execFileSync('python', ['--version'], { stdio: 'pipe' }); return true; } catch { return false; }
}

const PAGE: E2EPage = {
  id: 'p1', name: 'Petstore E2E', application: 'Petstore',
  basePath: 'PetStoreBaseUrl', token: 'PetStoreApiKey', framework: 'pytest',
  createdDate: '', modifiedDate: '',
};

const PY_POST_CLASS = 'class PetstorePostPet:\n    def __init__(self):\n        self.name = ""\n\n    def to_json(self):\n        return "{}"\n';
const PY_GET_CLASS = 'class PetstoreGetPet:\n    pass\n';

const CTX: E2EGenContext = {
  methods: [
    { methodName: 'PetStoreBaseUrl', returnType: 'str', parameters: '' },
    { methodName: 'PetStoreApiKey', returnType: 'str', parameters: '' },
    { methodName: 'ValidateSuccess_200_201Async', returnType: 'bool', parameters: 'response' },
  ],
  classes: [
    { className: 'PetstorePostPet', endpoint: '/pet', method: 'POST', contentType: 'application/json', classCode: PY_POST_CLASS },
    { className: 'PetstoreGetPet', endpoint: '/pet/{petId}', method: 'GET', classCode: PY_GET_CLASS },
  ],
} as any;

const ROW: E2ETestCaseRow = {
  id: 'r1', name: 'Create then fetch a pet',
  items: [
    { type: 'Class', ref: 'PetstorePostPet', capture: { fieldPath: 'id', variable: 'petId' } },
    { type: 'Class', ref: 'PetstoreGetPet', args: { petId: { value: 'petId', isVariable: true } } },
    { type: 'Method', ref: 'ValidateSuccess_200_201Async' },
  ],
};

test('class-first chain: derived sends, captured field, path binding, validator', () => {
  const code = generateE2ETestPython(ROW, PAGE, CTX);
  assert.match(code, /sys\.path\.insert\(0, os\.path\.abspath\(os\.path\.join\(os\.path\.dirname\(__file__\), "\.\.", "\.\."\)\)\)/);
  assert.match(code, /from Libraries import api_methods/);
  assert.match(code, /from Classes\.Petstore\.PetstorePostPet import PetstorePostPet/);
  assert.match(code, /def test_create_then_fetch_a_pet\(\):/);
  assert.match(code, /base_url = api_methods\.pet_store_base_url\(\)/);
  assert.match(code, /token = api_methods\.pet_store_api_key\(\)/);
  // POST class → post_json_async with the class body
  assert.match(code, /response1 = api_methods\.post_json_async\(token, url1, request1\.to_json\(\)\)/);
  // captured field from step 1's response
  assert.match(code, /petId = api_methods\.extract_field_async\(response1, "id"\)/);
  // GET class → get_async, with the captured var bound into the path (str() for concatenation)
  assert.match(code, /url2 = base_url \+ "\/pet\/" \+ str\(petId\)/);
  assert.match(code, /response2 = api_methods\.get_async\(token, url2\)/);
  // validator asserts
  assert.match(code, /assert api_methods\.validate_success_200_201_async\(response2\)/);
});

test('E2E-CAP-1 (Py): typed OUT capture rows each generate an extract_field_async(resp, field, type) line', () => {
  // Same model as C#/TS: OUT rows carry a store-as type; in Python it rides as a runtime token —
  // extract_field_async converts to it (number → float, Guid → str since Python has no Guid type).
  const row: E2ETestCaseRow = {
    id: 'r3', name: 'Typed captures',
    items: [{ type: 'Class', ref: 'PetstorePostPet', captures: [
      { fieldPath: 'id', variable: 'petId', type: 'number' },
      { fieldPath: 'status', variable: 'petStatus', type: 'string' },
      { fieldPath: 'uuid', variable: 'petUuid', type: 'Guid' },
    ] }],
  };
  const code = generateE2ETestPython(row, PAGE, CTX);
  assert.match(code, /petId = api_methods\.extract_field_async\(response1, "id", "float"\)/, 'number → float');
  assert.match(code, /petStatus = api_methods\.extract_field_async\(response1, "status", "str"\)/, 'string → str');
  assert.match(code, /petUuid = api_methods\.extract_field_async\(response1, "uuid", "str"\)/, 'Guid → str (Py)');
});

test('a POST class override becomes an attribute assignment with a type-aware value', () => {
  const row: E2ETestCaseRow = {
    id: 'r2', name: 'Create a named pet',
    items: [{ type: 'Class', ref: 'PetstorePostPet', overrides: { name: { value: 'Rex' } } }],
  };
  const code = generateE2ETestPython(row, PAGE, CTX);
  assert.match(code, /request1 = PetstorePostPet\(\)/);
  assert.match(code, /request1\.name = "Rex"/, 'string-defaulted field → quoted value');
});

// OVR-CASE (Py half): the request-class emitter keeps the raw JSON key and uses setattr when it is not
// a valid Python identifier; the E2E override must go through the same rule or `request1.pet-id = 7`
// (a syntax error) is emitted.
test('a pinned field whose name is not a valid identifier is set via setattr', () => {
  const ctx = {
    ...CTX,
    classes: [{
      className: 'PetstorePostPet', endpoint: '/pet', method: 'POST', contentType: 'application/json',
      classCode: 'class PetstorePostPet:\n    def __init__(self):\n        setattr(self, "pet-id", 0)\n        self.name = ""\n\n    def to_json(self):\n        return "{}"\n',
    }],
  } as any;
  const row: E2ETestCaseRow = {
    id: 'r3', name: 'Create a pet with a hyphenated field',
    items: [{ type: 'Class', ref: 'PetstorePostPet', overrides: { 'pet-id': { value: '7' }, name: { value: 'Rex' } } }],
  };
  const code = generateE2ETestPython(row, PAGE, ctx);
  assert.match(code, /setattr\(request1, "pet-id", 7\)/, 'number-defaulted hyphenated field → setattr with bare value');
  assert.match(code, /request1\.name = "Rex"/);
});

test('runtime: the generated chain runs against a stub library and the captured value reaches step 2', { skip: !hasPython() }, () => {
  const code = generateE2ETestPython(ROW, PAGE, CTX);
  const root = tmpDir('a2t-pye-');
  const mk = (rel: string, contents: string) => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  };
  mk('Tests/Petstore/test_generated_e2e.py', code);
  mk('Classes/Petstore/PetstorePostPet.py', PY_POST_CLASS);
  mk('Classes/Petstore/PetstoreGetPet.py', PY_GET_CLASS);
  mk('Libraries/api_methods.py', `
calls = []


class _Resp:
    def __init__(self, data, status=200):
        self._data = data
        self.status_code = status

    def json(self):
        return self._data


def pet_store_base_url():
    return "http://example.test"


def pet_store_api_key():
    return "key"


def post_json_async(token, url, body):
    calls.append(("POST", url))
    return _Resp({"id": 42})


def get_async(token, url):
    calls.append(("GET", url))
    return _Resp({})


def extract_field_async(response, field_path, as_type="str"):
    value = response.json().get(field_path)
    return int(value) if as_type == "int" else ("" if value is None else str(value))


def validate_success_200_201_async(response):
    return response.status_code in (200, 201)
`);
  mk('probe.py', `
import sys

sys.path.insert(0, r"${root.replace(/\\/g, '\\\\')}")
from Tests.Petstore.test_generated_e2e import test_create_then_fetch_a_pet

test_create_then_fetch_a_pet()
from Libraries import api_methods

assert ("POST", "http://example.test/pet") in api_methods.calls, api_methods.calls
assert ("GET", "http://example.test/pet/42") in api_methods.calls, api_methods.calls
print("PY_PROBE_OK")
`);
  let stdout = '';
  try {
    stdout = execFileSync('python', ['probe.py'], { cwd: root, stdio: 'pipe' }).toString();
  } catch (e: any) {
    assert.fail('runtime probe failed:\n' + (e.stderr?.toString() || e.stdout?.toString() || e.message));
  }
  assert.match(stdout, /PY_PROBE_OK/);
});

// A case saved before NAME-1 stores the retired names in its HEADER as well as its steps. The token was
// translated and the base path was not, so the emitted module called a method the library no longer has.
test('a pre-NAME-1 header is translated too — the same case, saved twice, emits the same file', () => {
  const legacy: E2EPage = { ...PAGE, basePath: 'petstoreTestBasePath', token: 'petstoreTestToken' };
  const code = generateE2ETestPython(ROW, legacy, CTX);
  assert.equal(code, generateE2ETestPython(ROW, PAGE, CTX));
  assert.equal(/petstore_test|petstoreTest/i.test(code), false, 'no retired header method reaches the generated file');
});
