/**
 * Guards the execution-report capture (#39). Every generated API method must report each call by default
 * so the runner can extract request/response from test output. Covers the generator (Reporter class +
 * base helpers) and the curated method libraries for BOTH languages (C# and Python).
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import { generateApiMethodsCSharp } from '../src/services/generateApiMethodsCSharp';

test('generated ApiMethods.cs emits the Reporter class + the call marker', () => {
  const code = generateApiMethodsCSharp([], { includeApiClient: true, includeUsingStatements: true });
  assert.match(code, /public static class Reporter/);
  assert.match(code, /##A2T_CALL##/);
  assert.match(code, /HttpResponseMessage Record\(/);
});

test('built-in C# HTTP helpers report every call', () => {
  const code = generateApiMethodsCSharp([], { includeApiClient: true });
  for (const verb of ['PostAsync', 'GetAsync', 'PutAsync', 'DeleteAsync']) {
    assert.ok(code.includes(`Reporter.Record(await httpClient.${verb}`), `base ${verb} reports`);
  }
});

function libMethods(rel: string): any[] {
  const raw = JSON.parse(fs.readFileSync(new URL(rel, import.meta.url), 'utf8'));
  return raw.apiMethods || raw.ApiMethods || raw.methods || (Array.isArray(raw) ? raw : []);
}

test('curated C# method library: every HTTP method reports by default', () => {
  const http = libMethods('../src/data/libraries/csharp/api-method-library.json')
    .filter((m) => /SendAsync|\.(Post|Get|Put|Delete|Patch)Async/.test(m.code || ''));
  assert.ok(http.length >= 6, `expected several HTTP methods, found ${http.length}`);
  for (const m of http) assert.ok((m.code || '').includes('Reporter.Record'), `${m.methodName} reports`);
});

test('curated Python method library: every HTTP method reports by default', () => {
  const http = libMethods('../src/data/libraries/python/api-method-library.json')
    .filter((m) => /requests\.(get|post|put|delete|patch)/.test(m.code || ''));
  assert.ok(http.length >= 6, `expected several HTTP methods, found ${http.length}`);
  for (const m of http) assert.ok((m.code || '').includes('reporter.record'), `${m.methodName} reports`);
});
