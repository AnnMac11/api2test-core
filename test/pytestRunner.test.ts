/**
 * PY-1 — the Python runner half. Mirrors runner.test.ts / vitestReporter.test.ts:
 *  - parseJUnitXml turns pytest's --junit-xml report into RawTestResults, with per-test ##A2T_CALL##
 *    markers pulled from each testcase's <system-out> (JUnit XML keeps stdout per test — the
 *    attribution Vitest needed a custom reporter for comes free here);
 *  - runPyCompile validates a deployed Python unit with the stdlib (parallel to runDotnetBuild/runTsc);
 *  - runPytest executes the sandbox live (skipped when pytest is not installed).
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parseJUnitXml, runPyCompile, runPytest, outcomeToStatus } from '../src/services/TestRunnerService';

function hasPython(): boolean {
  try { execFileSync('python', ['--version'], { stdio: 'pipe' }); return true; } catch { return false; }
}

function hasPytest(): boolean {
  try { execFileSync('python', ['-m', 'pytest', '--version'], { stdio: 'pipe' }); return true; } catch { return false; }
}

const SAMPLE_XML = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
  <testsuite name="pytest" errors="0" failures="1" skipped="1" tests="3" time="0.123">
    <testcase classname="Tests.Petstore.test_generated" name="test_create_then_fetch_a_pet" time="0.045">
      <system-out>setup output
##A2T_CALL## {"method":"POST","url":"http://example.test/pet","status":200,"requestBody":"{}","responseBody":"{\\"id\\":42}"}
more output</system-out>
    </testcase>
    <testcase classname="Tests.Petstore.test_generated" name="test_delete_pet" time="0.01">
      <failure message="AssertionError: expected 200 but got 404">traceback here</failure>
    </testcase>
    <testcase classname="Tests.Petstore.test_generated" name="test_env_gated" time="0">
      <skipped message="no environment"/>
    </testcase>
  </testsuite>
</testsuites>
`;

test('parseJUnitXml: passes, failures and skips map to RawTestResults with per-test calls', () => {
  const results = parseJUnitXml(SAMPLE_XML);
  assert.equal(results.length, 3);

  const [pass, fail, skip] = results;
  assert.equal(pass.method, 'test_create_then_fetch_a_pet');
  assert.equal(pass.fullName, 'Tests.Petstore.test_generated.test_create_then_fetch_a_pet');
  assert.equal(outcomeToStatus(pass.outcome), 'pass');
  assert.equal(pass.durationMs, 45);
  // The whole point of JUnit XML over Vitest JSON: stdout is already per-test — calls attribute directly.
  assert.equal(pass.calls?.length, 1);
  assert.equal(pass.calls?.[0].method, 'POST');
  assert.equal(pass.calls?.[0].url, 'http://example.test/pet');

  assert.equal(outcomeToStatus(fail.outcome), 'fail');
  assert.match(fail.message || '', /AssertionError: expected 200 but got 404/);

  assert.equal(outcomeToStatus(skip.outcome), 'skip');
});

test('parseJUnitXml: entities in system-out are decoded before marker parsing', () => {
  const xml = `<testsuite><testcase classname="t" name="test_x" time="0.5"><system-out>##A2T_CALL## {&quot;method&quot;:&quot;GET&quot;,&quot;url&quot;:&quot;http://x?a=1&amp;b=2&quot;,&quot;status&quot;:200}</system-out></testcase></testsuite>`;
  const [r] = parseJUnitXml(xml);
  assert.equal(r.calls?.[0].url, 'http://x?a=1&b=2');
});

test('parseJUnitXml: malformed input yields no results, not a throw', () => {
  assert.deepEqual(parseJUnitXml(''), []);
  assert.deepEqual(parseJUnitXml('<not-junit/>'), []);
});

test('runPyCompile: a valid unit passes, a syntax error fails with the error surfaced', { skip: !hasPython() }, async () => {
  const good = fs.mkdtempSync(path.join(os.tmpdir(), 'a2t-pyb-'));
  fs.mkdirSync(path.join(good, 'Libraries'));
  fs.writeFileSync(path.join(good, 'Libraries', 'api_methods.py'), 'def get_async(token, url):\n    return None\n');
  const ok = await runPyCompile(good);
  assert.equal(ok.ok, true, `expected clean compile, got: ${ok.errors.join('; ')}`);

  const bad = fs.mkdtempSync(path.join(os.tmpdir(), 'a2t-pyb-'));
  fs.writeFileSync(path.join(bad, 'broken.py'), 'def broken(:\n    pass\n');
  const res = await runPyCompile(bad);
  assert.equal(res.ok, false);
  assert.ok(res.errors.length > 0, 'compiler errors surfaced');
  assert.match(res.errors.join('\n') + res.raw, /SyntaxError|broken\.py/);
});

test('runPytest: live run parses results and attributes calls per test', { skip: !hasPytest() && 'pytest not installed on this machine' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2t-pyr-'));
  fs.writeFileSync(path.join(dir, 'test_sample.py'), `
def test_passes():
    print('##A2T_CALL## {"method":"GET","url":"http://x","status":200}')
    assert True


def test_fails():
    assert False, "deliberate"
`);
  const run = await runPytest(dir);
  assert.equal(run.results.length, 2);
  const pass = run.results.find(r => r.method === 'test_passes')!;
  const fail = run.results.find(r => r.method === 'test_fails')!;
  assert.equal(outcomeToStatus(pass.outcome), 'pass');
  assert.equal(pass.calls?.length, 1, 'marker attributed to the passing test');
  assert.equal(outcomeToStatus(fail.outcome), 'fail');
  assert.match(fail.message || '', /deliberate/);
  assert.equal(run.calls.length, 1, 'flattened calls across the run');
});
