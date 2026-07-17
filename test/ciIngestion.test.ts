import { test } from 'node:test';
import assert from 'node:assert';
import { isValidIngestionKey, attributeRelease, parseCiReport, buildCiExecution } from '../src/services/ciIngestion';

// A minimal real TRX (the shape parseTrx reads) with one pass + one fail.
const TRX = `<?xml version="1.0" encoding="utf-8"?>
<TestRun xmlns="http://microsoft.com/schemas/VisualStudio/TeamTest/2010">
  <Results>
    <UnitTestResult testId="a" testName="Sample.Tests.CreatePet" outcome="Passed" duration="00:00:01.5000000" />
    <UnitTestResult testId="b" testName="Sample.Tests.DeletePet" outcome="Failed" duration="00:00:00.5000000">
      <Output><ErrorInfo><Message>expected 200 got 500</Message></ErrorInfo></Output>
    </UnitTestResult>
  </Results>
  <TestDefinitions>
    <UnitTest id="a" name="Sample.Tests.CreatePet"><TestMethod name="CreatePet" /></UnitTest>
    <UnitTest id="b" name="Sample.Tests.DeletePet"><TestMethod name="DeletePet" /></UnitTest>
  </TestDefinitions>
</TestRun>`;

// The same run as a Vitest JSON report (the TS pipeline's format).
const VITEST_JSON = JSON.stringify({
  testResults: [{
    assertionResults: [
      { title: 'CreatePet', fullName: 'PetStore > CreatePet', status: 'passed', duration: 1500 },
      { title: 'DeletePet', fullName: 'PetStore > DeletePet', status: 'failed', duration: 500, failureMessages: ['expected 200 got 500'] },
    ],
  }],
});

const TEST_CASES = [
  { id: 'tc-1', name: 'Create Pet' },   // methodNameOf('Create Pet') === 'CreatePet'
  { id: 'tc-2', name: 'Delete Pet' },
];
const RELEASES = [
  { name: 'R1', startDate: '2026-07-01', endDate: '2026-07-31' },
  { name: 'R2', startDate: '2026-08-01', endDate: '2026-08-31' },
];

// ── Ingestion key ─────────────────────────────────────────────────────────────────────────────

test('key validation: named token or legacy key matches; no keys configured -> nothing validates', () => {
  const tokens = [{ name: 'petstore-E2E', key: 'k-123' }];
  assert.equal(isValidIngestionKey('k-123', tokens), true);
  assert.equal(isValidIngestionKey('wrong', tokens), false);
  assert.equal(isValidIngestionKey('legacy', [], 'legacy'), true);
  assert.equal(isValidIngestionKey('anything', []), false, 'secure by default');
  assert.equal(isValidIngestionKey('', tokens), false);
});

// ── Release attribution ───────────────────────────────────────────────────────────────────────

test('explicit release tag wins; otherwise the date-windowed release; else un-bucketed', () => {
  assert.equal(attributeRelease('R9', '2026-07-17T10:00:00Z', RELEASES), 'R9');
  assert.equal(attributeRelease(undefined, '2026-07-17T10:00:00Z', RELEASES), 'R1');
  assert.equal(attributeRelease(undefined, '2026-09-01T10:00:00Z', RELEASES), '');
});

// ── Report parsing: both pipelines' formats land in ONE shape ─────────────────────────────────

test('parseCiReport reads a TRX and a Vitest JSON report into the same result shape', () => {
  for (const [label, payload] of [['trx', TRX], ['vitest', VITEST_JSON]] as const) {
    const raw = parseCiReport(payload);
    assert.equal(raw.length, 2, `${label}: 2 results expected`);
    assert.ok(raw.some(r => r.method === 'CreatePet'), `${label}: CreatePet missing`);
  }
});

// ── The execution record ──────────────────────────────────────────────────────────────────────

test('buildCiExecution matches rows to test cases by generated method name', () => {
  const exec = buildCiExecution(parseCiReport(TRX), { name: 'petstore-E2E', timestamp: '2026-07-17T10:00:00Z' },
    { testCases: TEST_CASES, releases: RELEASES });
  const create = exec.results.find(r => r.testCaseId === 'tc-1')!;
  assert.equal(create.name, 'Create Pet', 'matched row carries the test case name');
  assert.equal(create.status, 'pass');
  const del = exec.results.find(r => r.testCaseId === 'tc-2')!;
  assert.equal(del.status, 'fail');
  assert.match(del.message || '', /expected 200 got 500/);
});

test('an UNMATCHED row is kept verbatim — a result is never silently dropped', () => {
  const exec = buildCiExecution(parseCiReport(TRX), {}, { testCases: [TEST_CASES[0]], releases: [] });
  const unmatched = exec.results.find(r => r.testCaseId === 'DeletePet')!;
  assert.ok(unmatched, 'unmatched row must survive');
  assert.equal(unmatched.name, 'DeletePet');
});

test('totals + provenance: source ci, counts, release attributed from the timestamp', () => {
  const exec = buildCiExecution(parseCiReport(TRX),
    { name: 'petstore-E2E', build: '42', commit: 'abc123', timestamp: '2026-07-17T10:00:00Z' },
    { testCases: TEST_CASES, releases: RELEASES });
  assert.equal(exec.source, 'ci');
  assert.deepEqual(exec.totals, { passed: 1, failed: 1, skipped: 0, durationMs: 2000 });
  assert.equal(exec.release, 'R1');
  assert.equal(exec.build, '42');
  assert.equal(exec.suiteName, 'petstore-E2E');
});

test('an empty report throws (the pipeline posted nothing useful)', () => {
  assert.throws(() => buildCiExecution([], {}, { testCases: [], releases: [] }), /no test results/i);
});
