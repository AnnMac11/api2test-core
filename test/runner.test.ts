import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseTrx, methodNameOf, outcomeToStatus, parseVitestJson, parseTscErrors, parseApiCalls, extractBuildErrors } from '../src/services/TestRunnerService';

test('extractBuildErrors pulls compile errors (File(line): CODE — message), deduped, ignoring warnings', () => {
  const log = [
    'PetStorePostStoreOrder.cs(18,115): warning CS8632: nullable annotation… [C:\\x\\sandbox.csproj]',
    'C:\\x\\Tests\\PetStore\\petstoredeleteTests.cs(32,67): error CS0029: Cannot implicitly convert type \'string\' to \'decimal?\' [C:\\x\\sandbox.csproj]',
    'C:\\x\\Tests\\PetStore\\petstoredeleteTests.cs(32,67): error CS0029: Cannot implicitly convert type \'string\' to \'decimal?\' [C:\\x\\sandbox.csproj]',
    'Build succeeded with warnings',
  ].join('\n');
  const errs = extractBuildErrors(log);
  assert.deepEqual(errs, ["petstoredeleteTests.cs(32): CS0029 — Cannot implicitly convert type 'string' to 'decimal?'"]);
});

const SAMPLE_TRX = `<?xml version="1.0" encoding="UTF-8"?>
<TestRun>
  <Results>
    <UnitTestResult testName="Sample.Tests.StripeCustomer" duration="00:00:00.0001062" outcome="Passed" />
    <UnitTestResult testName="Sample.Tests.StripeAddDeleteCustomer" duration="00:00:00.3370330" outcome="Failed">
      <Output><ErrorInfo><Message>Assert.Equal() Failure: Values differ</Message></ErrorInfo></Output>
    </UnitTestResult>
    <UnitTestResult testName="Sample.Tests.Skipped" duration="00:00:00" outcome="NotExecuted" />
  </Results>
</TestRun>`;

// A trimmed Vitest `--reporter=json` payload (same shape the TS-0 spike produced).
const SAMPLE_VITEST = JSON.stringify({
  numTotalTests: 2, numPassedTests: 1, numFailedTests: 1, success: false,
  testResults: [{
    name: '/sandbox/Tests/Pet/PetTests.test.ts', status: 'failed',
    assertionResults: [
      { ancestorTitles: ['PetTests'], title: 'creates a pet', fullName: 'PetTests > creates a pet', status: 'passed', duration: 17.6, failureMessages: [] },
      { ancestorTitles: ['PetTests'], title: 'rejects a bad pet', fullName: 'PetTests > rejects a bad pet', status: 'failed', duration: 3.14, failureMessages: ['AssertionError: expected 201 to be 200'] },
    ],
  }],
});

test('parseVitestJson maps assertionResults → results (name, outcome, duration, message)', () => {
  const r = parseVitestJson(SAMPLE_VITEST);
  assert.equal(r.length, 2);
  const pass = r.find(x => x.method === 'creates a pet')!;
  assert.equal(pass.outcome, 'passed');
  assert.equal(outcomeToStatus(pass.outcome), 'pass');   // Vitest statuses reuse outcomeToStatus
  const fail = r.find(x => x.method === 'rejects a bad pet')!;
  assert.equal(outcomeToStatus(fail.outcome), 'fail');
  assert.equal(fail.durationMs, 3);
  assert.match(fail.message!, /expected 201 to be 200/);
  assert.equal(parseVitestJson('not json').length, 0);
});

test('parseTscErrors collects TS error lines (parallel to the dotnet build grep)', () => {
  const out = `sandbox/Classes/Pet/PetStorePostPet.ts(5,3): error TS2322: Type 'string' is not assignable to type 'number'.\nFound 1 error.`;
  const b = parseTscErrors(out);
  assert.equal(b.ok, false);
  assert.equal(b.errors.length, 1);
  assert.match(b.errors[0], /TS2322/);
  assert.equal(parseTscErrors('no errors here').ok, true);
});

test('parseApiCalls pulls the ##A2T_CALL## markers out of Vitest stdout (same protocol as C#)', () => {
  const stdout = `RUN v2\n##A2T_CALL## {"method":"POST","url":"http://127.0.0.1:52916/pet","status":201,"responseBody":"{\\"id\\":123}"}\n✓ ok`;
  const calls = parseApiCalls(stdout);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].status, 201);
});

test('parseTrx extracts name, outcome, duration, and failure message', () => {
  const r = parseTrx(SAMPLE_TRX);
  assert.equal(r.length, 3);

  const pass = r.find(x => x.method === 'StripeCustomer')!;
  assert.equal(pass.outcome, 'Passed');
  assert.equal(pass.fullName, 'Sample.Tests.StripeCustomer');

  const fail = r.find(x => x.method === 'StripeAddDeleteCustomer')!;
  assert.equal(fail.outcome, 'Failed');
  assert.equal(fail.durationMs, 337); // 0.337s
  assert.match(fail.message ?? '', /Values differ/);
});

test('outcomeToStatus maps TRX outcomes to pass/fail/skip', () => {
  assert.equal(outcomeToStatus('Passed'), 'pass');
  assert.equal(outcomeToStatus('Failed'), 'fail');
  assert.equal(outcomeToStatus('Error'), 'fail');
  assert.equal(outcomeToStatus('NotExecuted'), 'skip');
});

test('methodNameOf matches the generator method naming', () => {
  assert.equal(methodNameOf('Stripe Customer'), 'StripeCustomer');
  assert.equal(methodNameOf('stripeAddDeleteCustomer'), 'StripeAddDeleteCustomer');
  assert.equal(methodNameOf('123 weird'), 'Test123Weird');
});
