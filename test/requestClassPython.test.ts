/**
 * PY-GEN-1 — the Python request-class emitter. Mirrors requestClassTypeScript.test.ts: a body class
 * carries data-method defaults in __init__ and serialises with to_json(); form content adds
 * to_form_body(); PARAMETER fields get a settable placeholder; URL-param-only endpoints get a plain
 * attribute class; no fields → null. Beyond the TS guard, the generated class is RUN with a stub
 * DataGenerator to prove the JSON body really contains the defaults and omits optional fields.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { generateRequestClassPython } from '../src/services/generateRequestClassPython';
import { ClassGenerationRequest } from '../src/models/ClassGenerationDto';
import { PARAMETER } from '../src/services/DataDictionaryService';
import { tmpDir } from './tmp';

function hasPython(): boolean {
  try { execFileSync('python', ['--version'], { stdio: 'pipe' }); return true; } catch { return false; }
}

/** Byte-compile the class inside the real Classes/<App>/ layout. */
function assertPyCompiles(code: string, app: string, className: string): string {
  const dir = tmpDir('a2t-pyc-');
  const seg = app.replace(/[^A-Za-z0-9]/g, '');
  const file = path.join(dir, 'Classes', seg, `${className}.py`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, code);
  try {
    execFileSync('python', ['-m', 'py_compile', file], { stdio: 'pipe' });
  } catch (e: any) {
    assert.fail('generated Python class did not compile:\n' + (e.stderr?.toString() || e.message));
  }
  return dir;
}

test('body class: data-method default in __init__, to_json, DataGenerator import', () => {
  const req: ClassGenerationRequest = {
    endpoint: '/customers', method: 'POST', application: 'Stripe',
    fieldConfigurations: [
      { name: 'email', type: 'string', required: true, dataMethod: 'Email', location: 'body' },
      { name: 'nickname', type: 'string', required: false, location: 'body' },
    ],
  };
  const code = generateRequestClassPython(req)!;
  assert.ok(code, 'code produced');
  assert.match(code, /from Libraries\.data_generator import DataGenerator/);
  assert.match(code, /class StripeCustomers:/);
  // PascalCase registry name → snake_case call, raw JSON key kept as the attribute name.
  assert.match(code, /self\.email = DataGenerator\(\)\.email\(\)/);
  assert.match(code, /def to_json\(self\)/);
  // Optional field with no data method is omitted from the body — no assignment.
  assert.doesNotMatch(code, /self\.nickname\s*=/);
  if (hasPython()) { assertPyCompiles(code, 'Stripe', 'StripeCustomers'); }
});

test('form content-type adds to_form_body() delegating to the library form_url_encode', () => {
  const req: ClassGenerationRequest = {
    endpoint: '/customers', method: 'POST', application: 'Stripe',
    contentType: 'application/x-www-form-urlencoded',
    fieldConfigurations: [
      { name: 'name', type: 'string', required: true, dataMethod: 'BusinessName', location: 'body' },
    ],
  };
  const code = generateRequestClassPython(req)!;
  assert.match(code, /def to_form_body\(self\)/);
  assert.match(code, /form_url_encode/);
  assert.match(code, /self\.name = DataGenerator\(\)\.business_name\(\)/, 'PascalCase → snake_case call');
});

test('PARAMETER field emits a settable placeholder, not a DataGenerator call', () => {
  const req: ClassGenerationRequest = {
    endpoint: '/order', method: 'POST', application: 'Pet Store',
    fieldConfigurations: [
      { name: 'orderId', type: 'number', required: true, dataMethod: PARAMETER, location: 'body' },
      { name: 'quantity', type: 'number', required: true, dataMethod: 'RandomId', location: 'body' },
    ],
  };
  const code = generateRequestClassPython(req)!;
  assert.doesNotMatch(code, /DataGenerator\(\)\.parameter/i, 'must not call a Parameter generator method');
  assert.match(code, /self\.orderId = 0\s*#\s*parameter/, 'placeholder attribute with a safe default');
  assert.match(code, /DataGenerator\(\)\.random_id\(\)/, 'other fields still use their data method');
});

test('URL-param-only endpoint gets a plain attribute class — no to_json', () => {
  const req: ClassGenerationRequest = {
    endpoint: '/customers/{id}', method: 'GET', application: 'Stripe',
    fieldConfigurations: [
      { name: 'id', type: 'string', required: true, location: 'path' },
    ],
  };
  const code = generateRequestClassPython(req)!;
  assert.ok(code, 'a class is produced for a body-less endpoint');
  assert.match(code, /self\.id = None/, 'URL param becomes a plain attribute the test assigns');
  assert.doesNotMatch(code, /to_json/, 'URL params are never a JSON body');
});

test('returns null when the endpoint has no fields at all', () => {
  const req: ClassGenerationRequest = {
    endpoint: '/health', method: 'GET', application: 'Stripe', fieldConfigurations: [],
  };
  assert.equal(generateRequestClassPython(req), null);
});

test('OVR-CASE (Py): a field name that is not a valid identifier is set via setattr', () => {
  const req: ClassGenerationRequest = {
    endpoint: '/pet', method: 'POST', application: 'Petstore',
    fieldConfigurations: [
      { name: 'pet-id', type: 'number', required: true, dataMethod: 'RandomId', location: 'body' },
    ],
  };
  const code = generateRequestClassPython(req)!;
  assert.match(code, /setattr\(self, "pet-id", DataGenerator\(\)\.random_id\(\)\)/,
    'hyphenated JSON key survives as the attribute name via setattr');
});

test('runtime: to_json() carries the defaults and omits the optional field', { skip: !hasPython() }, () => {
  const req: ClassGenerationRequest = {
    endpoint: '/customers', method: 'POST', application: 'Stripe',
    fieldConfigurations: [
      { name: 'email', type: 'string', required: true, dataMethod: 'Email', location: 'body' },
      { name: 'nickname', type: 'string', required: false, location: 'body' },
    ],
  };
  const code = generateRequestClassPython(req)!;
  const root = assertPyCompiles(code, 'Stripe', 'StripeCustomers');
  // Stub Data Library: any method returns a recognisable string.
  fs.mkdirSync(path.join(root, 'Libraries'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Libraries', 'data_generator.py'), `
class DataGenerator:
    def __getattr__(self, name):
        return lambda *args, **kwargs: "stub-" + name
`);
  fs.writeFileSync(path.join(root, 'probe.py'), `
import json
import sys

sys.path.insert(0, r"${root.replace(/\\/g, '\\\\')}")
from Classes.Stripe.StripeCustomers import StripeCustomers

body = json.loads(StripeCustomers().to_json())
assert body["email"] == "stub-email", body
assert "nickname" not in body, body
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
