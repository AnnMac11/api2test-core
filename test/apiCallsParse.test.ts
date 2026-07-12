/**
 * Guards the report parse (#39, increment 2): parseTrx pulls the Reporter's `##A2T_CALL##` markers out
 * of each test's TRX <StdOut> into calls[] — request + response per API call, in order. Covers both the
 * C# (") and Python (\") ways of escaping quotes inside the marker JSON.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseTrx, parseApiCalls } from '../src/services/TestRunnerService';

test('parseApiCalls decodes a C#-escaped marker (\\u0022)', () => {
  const stdout = '##A2T_CALL## {"method":"POST","url":"https://x/pet","requestBody":"{\\u0022name\\u0022:\\u0022rex\\u0022}","status":201,"responseBody":"{\\u0022id\\u0022:1}"}';
  const calls = parseApiCalls(stdout);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].status, 201);
  assert.equal(calls[0].requestBody, '{"name":"rex"}');
  assert.equal(calls[0].responseBody, '{"id":1}');
});

test('parseTrx attaches calls[] per test, in order (E2E chain)', () => {
  const trx = `<UnitTestResult testName="Sample.Tests.AddThenDeletePet" outcome="Passed" duration="00:00:00.1710000">
    <Output><StdOut>##A2T_CALL## {"method":"POST","url":"https://x/pet","status":201,"responseBody":"ok"}
##A2T_CALL## {"method":"DELETE","url":"https://x/pet/1","status":200}
</StdOut></Output>
  </UnitTestResult>`;
  const [r] = parseTrx(trx);
  assert.equal(r.method, 'AddThenDeletePet');
  assert.equal(r.outcome, 'Passed');
  assert.equal(r.calls?.length, 2);
  assert.equal(r.calls?.[0].method, 'POST');
  assert.equal(r.calls?.[0].status, 201);
  assert.equal(r.calls?.[1].method, 'DELETE');
});

test('parseTrx: a result with no markers has undefined calls', () => {
  const [r] = parseTrx('<UnitTestResult testName="S.NoCalls" outcome="Passed" duration="00:00:00.1"/>');
  assert.equal(r.calls, undefined);
});

test('parseTrx: XML-encoded ampersand in a response body is decoded before JSON.parse', () => {
  const trx = `<UnitTestResult testName="S.Amp" outcome="Passed" duration="00:00:00.1">
    <Output><StdOut>##A2T_CALL## {"method":"GET","url":"https://x?a=1&amp;b=2","status":200,"responseBody":"a &amp; b"}
</StdOut></Output></UnitTestResult>`;
  const [r] = parseTrx(trx);
  assert.equal(r.calls?.[0].url, 'https://x?a=1&b=2');
  assert.equal(r.calls?.[0].responseBody, 'a & b');
});
