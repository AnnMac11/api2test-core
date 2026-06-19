import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseTrx, methodNameOf, outcomeToStatus } from '../src/services/TestRunnerService';

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
