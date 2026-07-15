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
  // The variable-based overload: the request body is passed in (captured at the call site), not scraped
  // back off the response — so it survives the request being disposed after the send.
  assert.match(code, /HttpResponseMessage Record\(string method, string url, string requestBody, HttpResponseMessage response\)/);
});

test('built-in C# HTTP helpers report every call via the variable-based Reporter', () => {
  const code = generateApiMethodsCSharp([], { includeApiClient: true });
  const helpers: Array<[string, string]> = [
    ['PostAsync', 'Reporter.Record("POST"'],
    ['GetAsync', 'Reporter.Record("GET"'],
    ['PutAsync', 'Reporter.Record("PUT"'],
    ['DeleteAsync', 'Reporter.Record("DELETE"'],
  ];
  for (const [verb, rec] of helpers) {
    assert.ok(code.includes(`httpClient.${verb}`), `base ${verb} still called`);
    assert.ok(code.includes(rec), `base ${verb} reports via ${rec}`);
  }
});

function libMethods(rel: string): any[] {
  const raw = JSON.parse(fs.readFileSync(new URL(rel, import.meta.url), 'utf8'));
  return raw.apiMethods || raw.ApiMethods || raw.methods || (Array.isArray(raw) ? raw : []);
}

test('curated C# method library: every HTTP method reports via the variable-based Reporter', () => {
  const http = libMethods('../src/data/libraries/csharp/api-method-library.json')
    .filter((m) => /SendAsync|\.(Post|Get|Put|Delete|Patch)Async/.test(m.code || ''));
  assert.ok(http.length >= 6, `expected several HTTP methods, found ${http.length}`);
  for (const m of http) {
    // Must use the 4-arg form Reporter.Record("VERB", url, <body>, response) — NOT the fragile single-arg,
    // which loses the request body once the request is disposed.
    assert.match(m.code || '', /Reporter\.Record\("(POST|GET|PUT|DELETE|PATCH)", url, [^,]+, response\)/,
      `${m.methodName} reports via the variable-based Reporter.Record`);
  }
});

test('curated Python method library: every HTTP method reports by default', () => {
  const http = libMethods('../src/data/libraries/python/api-method-library.json')
    .filter((m) => /requests\.(get|post|put|delete|patch)/.test(m.code || ''));
  assert.ok(http.length >= 6, `expected several HTTP methods, found ${http.length}`);
  for (const m of http) assert.ok((m.code || '').includes('reporter.record'), `${m.methodName} reports`);
});
