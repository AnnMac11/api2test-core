/**
 * PY-GEN-1 — the curated Python seed libraries + module emitters. Mirrors seedTypeScript.test.ts:
 *  - each seed method's code defines the snake_case symbol pySymbol(methodName) maps to — so a
 *    generated call resolves to its definition (PostJsonAsync → api_methods.py defines post_json_async);
 *  - the emitted data_generator.py and api_methods.py are valid Python (stdlib py_compile);
 *  - the seed provides the class-first send vocabulary + a store-as-typed extract (E2E-CAP-1), proven
 *    at RUNTIME: extract_field_async converts to int/bool and walks array paths, and the Reporter
 *    prints a `##A2T_CALL##` marker that core's parseApiCalls understands (cross-language parity).
 * Python checks are skipped (not failed) when no python interpreter is installed.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { getDefaultDataLibrary, getDefaultApiMethodLibrary } from '../src/data/defaultLibraries';
import { generateDataLibraryPython } from '../src/services/generateDataLibraryPython';
import { generateApiMethodsPython } from '../src/services/generateApiMethodsPython';
import { pySymbol } from '../src/services/pyNaming';
import { parseApiCalls } from '../src/services/TestRunnerService';

function hasPython(): boolean {
  try {
    execFileSync('python', ['--version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/** Byte-compile one Python source with the stdlib (syntax check, imports not executed). */
function assertPyCompiles(code: string, fileName: string): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2t-py-'));
  const file = path.join(dir, fileName);
  fs.writeFileSync(file, code);
  try {
    execFileSync('python', ['-m', 'py_compile', file], { stdio: 'pipe' });
  } catch (e: any) {
    assert.fail(`${fileName} is not valid Python:\n` + (e.stderr?.toString() || e.message));
  }
}

test('pySymbol: PascalCase registry names map to the snake_case symbols the seed defines', () => {
  assert.equal(pySymbol('GetAsync'), 'get_async');
  assert.equal(pySymbol('PostJsonAsync'), 'post_json_async');
  assert.equal(pySymbol('ValidateSuccess_200_201Async'), 'validate_success_200_201_async');
  assert.equal(pySymbol('ExtractFieldAsync'), 'extract_field_async');
  assert.equal(pySymbol('PetStoreBaseUrl'), 'pet_store_base_url');
  assert.equal(pySymbol('AddressLine1'), 'address_line1');
  assert.equal(pySymbol('FormUrlEncode'), 'form_url_encode');
  assert.equal(pySymbol('FirstName'), 'first_name');
});

test('every Python seed method defines the snake_case symbol the emitters call (pySymbol)', () => {
  for (const m of [...getDefaultDataLibrary('python'), ...getDefaultApiMethodLibrary('python')]) {
    const sym = pySymbol((m as any).methodName);
    const code = ((m as any).code || '') as string;
    assert.ok(new RegExp(`\\bdef ${sym}\\s*\\(`).test(code),
      `${(m as any).methodName}: code must define 'def ${sym}(' (got: ${code.slice(0, 60)}…)`);
  }
});

test('the seed provides the class-first send helpers + typed extract (the E2E vocabulary)', () => {
  const names = getDefaultApiMethodLibrary('python').map((m: any) => pySymbol(m.methodName));
  for (const helper of ['post_json_async', 'put_json_async', 'get_async', 'delete_async', 'post_form_async', 'extract_field_async']) {
    assert.ok(names.includes(helper), `seed must define send helper '${helper}'`);
  }
});

test('the Python Data Library seed emits a data_generator.py that is valid Python', () => {
  const methods = getDefaultDataLibrary('python').map((m: any) => ({ methodName: m.methodName, description: m.description, code: m.code }));
  const code = generateDataLibraryPython(methods);
  assert.match(code, /class DataGenerator:/);
  assert.match(code, /from faker import Faker/);
  if (!hasPython()) { return; }
  assertPyCompiles(code, 'data_generator.py');
});

test('the Python API Method Library seed emits an api_methods.py that is valid Python', () => {
  const methods = getDefaultApiMethodLibrary('python').filter((m: any) => m.code && m.code.trim());
  const code = generateApiMethodsPython(methods as any);
  assert.match(code, /##A2T_CALL##/, 'Reporter prints the marker the runner parses');
  assert.match(code, /16384/, 'bodies are capped like the C#/TS Reporters');
  if (!hasPython()) { return; }
  assertPyCompiles(code, 'api_methods.py');
});

test('E2E-CAP-1 (Python, runtime): extract_field_async converts store-as types and walks array paths; Reporter marker parses', { skip: !hasPython() }, () => {
  const methods = getDefaultApiMethodLibrary('python').filter((m: any) => m.code && m.code.trim());
  const code = generateApiMethodsPython(methods as any);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2t-py-'));
  fs.writeFileSync(path.join(dir, 'api_methods.py'), code);
  // Stub `requests` so the module imports without pip dependencies, then exercise the real seed code.
  fs.writeFileSync(path.join(dir, 'probe.py'), `
import sys, types
sys.modules.setdefault("requests", types.ModuleType("requests"))
import api_methods


class Resp:
    status_code = 200

    def json(self):
        return {"id": 7, "items": [{"sku": "A1"}, {"sku": "B2"}], "done": True}


v = api_methods.extract_field_async(Resp(), "id", "int")
assert v == 7 and isinstance(v, int), f"store-as int failed: {v!r}"
s = api_methods.extract_field_async(Resp(), "items[1].sku")
assert s == "B2", f"array path failed: {s!r}"
b = api_methods.extract_field_async(Resp(), "done", "bool")
assert b is True, f"store-as bool failed: {b!r}"


class Req:
    method = "POST"
    url = "http://example.test/pet"
    body = b"{}"


class RecResp:
    request = Req()
    status_code = 201
    text = "{\\"ok\\": true}"


out = api_methods.reporter.record(RecResp())
assert out is not None, "record must return the response"
print("PY_PROBE_OK")
`);
  let stdout = '';
  try {
    stdout = execFileSync('python', ['probe.py'], { cwd: dir, stdio: 'pipe' }).toString();
  } catch (e: any) {
    assert.fail('runtime probe failed:\n' + (e.stderr?.toString() || e.stdout?.toString() || e.message));
  }
  assert.match(stdout, /PY_PROBE_OK/);
  // The marker printed by the Python Reporter must round-trip through core's parser (parity with C#/TS).
  const calls = parseApiCalls(stdout);
  assert.equal(calls.length, 1, 'exactly one ##A2T_CALL## marker');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, 'http://example.test/pet');
  assert.equal(calls[0].status, 201);
});
