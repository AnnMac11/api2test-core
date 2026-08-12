/**
 * PY-GEN-1 — the Python (pytest) single-test emitter. Mirrors testTypeScript.test.ts: the generated
 * test imports api_methods/DataGenerator/the body class from the deploy layout (sys.path bootstrap +
 * package imports), builds URL + body, calls the wrapper with the (token, url, body) convention, and
 * asserts. Beyond the TS compile guard, the generated test is RUN against stub libraries + the REAL
 * generated request class, proving the whole file executes.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { generateTestPython } from '../src/services/generateTestPython';
import { generateRequestClassPython } from '../src/services/generateRequestClassPython';
import { TestGenerationRequest } from '../src/services/TestGenerationService';

function hasPython(): boolean {
  try { execFileSync('python', ['--version'], { stdio: 'pipe' }); return true; } catch { return false; }
}

function assertPyCompiles(code: string): void {
  if (!hasPython()) { return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2t-pyt-'));
  const file = path.join(dir, 'test_generated.py');
  fs.writeFileSync(file, code);
  try {
    execFileSync('python', ['-m', 'py_compile', file], { stdio: 'pipe' });
  } catch (e: any) {
    assert.fail('generated test is not valid Python:\n' + (e.stderr?.toString() || e.message));
  }
}

const POST_REQ: TestGenerationRequest = {
  className: 'PetStorePets', endpoint: '/pets/{petId}', method: 'POST', application: 'PetStore',
  wrapperClass: 'ApiMethods', wrapperMethod: 'PostWithToken', bodyClassName: 'PetStorePets',
  testFramework: 'pytest', basePathMethod: 'PetStoreBaseUrl', tokenMethod: 'GetPetToken',
  pathParams: [{ name: 'petId', dataMethod: 'RandomId' }],
};

test('emits a pytest test that imports siblings from the deploy layout and calls the wrapper (token, url, body)', () => {
  const code = generateTestPython(POST_REQ);
  // Deploy-layout imports: tests live in Tests/<App>/, two levels below the root.
  assert.match(code, /sys\.path\.insert\(0, os\.path\.abspath\(os\.path\.join\(os\.path\.dirname\(__file__\), "\.\.", "\.\."\)\)\)/);
  assert.match(code, /from Libraries import api_methods/);
  assert.match(code, /from Libraries\.data_generator import DataGenerator/);
  assert.match(code, /from Classes\.PetStore\.PetStorePets import PetStorePets/);
  assert.match(code, /return DataGenerator\(\)\.pet_store_base_url\(\)/, 'base URL from the Data Library');
  assert.match(code, /return api_methods\.get_pet_token\(\)/, 'token provider delegated');
  assert.match(code, /petId = DataGenerator\(\)\.random_id\(\)/, 'path param sourced from data method');
  assert.match(code, /url = f"\{base_url\(\)\}\/pets\/\{petId\}"/, 'path placeholder interpolated');
  assert.match(code, /request_body = PetStorePets\(\)\.to_json\(\)/);
  assert.match(code, /response = api_methods\.post_with_token\(token, url, request_body\)/, 'wrapper call is (token, url, body)');
  assert.match(code, /assert response\.ok/, 'built-in success assert');
  assertPyCompiles(code);
});

test('GET (no body) → 2-arg wrapper call, no body import', () => {
  const req: TestGenerationRequest = {
    className: 'PetStorePet', endpoint: '/pets/{petId}', method: 'GET', application: 'PetStore',
    wrapperClass: 'ApiMethods', wrapperMethod: 'GetWithToken', testFramework: 'pytest',
    basePathMethod: 'PetStoreBaseUrl', pathParams: [{ name: 'petId', dataMethod: 'RandomId' }],
  };
  const code = generateTestPython(req);
  assert.doesNotMatch(code, /from Classes\./, 'no body class import for GET');
  assert.doesNotMatch(code, /request_body/, 'no body built for GET');
  assert.match(code, /response = api_methods\.get_with_token\(token, url\)/);
  assertPyCompiles(code);
});

test('form content-type serialises with to_form_body()', () => {
  const code = generateTestPython({ ...POST_REQ, contentType: 'application/x-www-form-urlencoded' });
  assert.match(code, /PetStorePets\(\)\.to_form_body\(\)/);
  assertPyCompiles(code);
});

test('query values are URL-encoded', () => {
  const req: TestGenerationRequest = {
    className: 'PetStoreFind', endpoint: '/pets', method: 'GET', application: 'PetStore',
    wrapperClass: 'ApiMethods', wrapperMethod: 'GetWithToken', testFramework: 'pytest',
    basePathMethod: 'PetStoreBaseUrl', queryParams: [{ name: 'status', dataMethod: 'RandomStr' }],
  };
  const code = generateTestPython(req);
  assert.match(code, /\?status=\{urllib\.parse\.quote\(str\(status\)\)\}/, 'query value is URL-encoded');
  assert.match(code, /import urllib\.parse/);
  assertPyCompiles(code);
});

test('a path param and a same-named query param share ONE variable (no duplicate assignment)', () => {
  const req: TestGenerationRequest = {
    className: 'PetStorePet', endpoint: '/pets/{id}', method: 'GET', application: 'PetStore',
    wrapperClass: 'ApiMethods', wrapperMethod: 'GetWithToken', testFramework: 'pytest',
    basePathMethod: 'PetStoreBaseUrl',
    pathParams: [{ name: 'id', dataMethod: 'RandomId' }],
    queryParams: [{ name: 'id', dataMethod: 'RandomId' }],
  };
  const code = generateTestPython(req);
  assert.equal((code.match(/    id = DataGenerator/g) || []).length, 1, 'exactly one assignment of `id`');
  assertPyCompiles(code);
});

test('a selected response handler defines pass/fail', () => {
  const code = generateTestPython({ ...POST_REQ, responseHandler: 'ValidateSuccess_200_201Async' });
  assert.match(code, /assert api_methods\.validate_success_200_201_async\(response\)/);
  assert.doesNotMatch(code, /assert response\.ok/, 'handler replaces the built-in success assert');
  assertPyCompiles(code);
});

test('runtime: the generated test runs end-to-end against stub libraries + the REAL request class', { skip: !hasPython() }, () => {
  const code = generateTestPython(POST_REQ);
  const cls = generateRequestClassPython({
    className: 'PetStorePets', endpoint: '/x', method: 'POST', application: 'PetStore',
    fieldConfigurations: [{ name: 'name', type: 'string', required: true, dataMethod: 'CompanyName', location: 'body' }],
  })!;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'a2t-pyt-'));
  const mk = (rel: string, contents: string) => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  };
  mk('Tests/PetStore/test_generated.py', code);
  mk('Classes/PetStore/PetStorePets.py', cls);
  mk('Libraries/api_methods.py', `
calls = []


class _Resp:
    ok = True
    status_code = 200
    text = '{"ok": true}'


def get_pet_token():
    return "tok"


def post_with_token(token, url, body):
    calls.append((token, url, body))
    return _Resp()
`);
  mk('Libraries/data_generator.py', `
class DataGenerator:
    def __getattr__(self, name):
        return lambda *args, **kwargs: "stub-" + name
`);
  mk('probe.py', `
import sys

sys.path.insert(0, r"${root.replace(/\\/g, '\\\\')}")
from Tests.PetStore.test_generated import test_post_returns_success

test_post_returns_success()
from Libraries import api_methods

token, url, body = api_methods.calls[0]
assert token == "tok", token
assert url == "stub-pet_store_base_url/pets/stub-random_id", url
assert "stub-company_name" in body, body
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
