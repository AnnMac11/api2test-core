/**
 * TS-C2 — per-test API-call attribution for Vitest. The custom reporter reads each test's captured `logs`,
 * pulls that test's `##A2T_CALL##` markers, and writes a { fullName: ApiCall[] } map. Here we drive the
 * emitted reporter directly (it's pure Node — require it, feed a fake finished-task tree, read the file it
 * writes), then check the parse + merge onto results. No real Vitest run needed (mirrors runner.test.ts).
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import { emitVitestReporter, parseVitestCallsMap, mergeVitestCalls, RawTestResult } from '../src/services/TestRunnerService';

const mkLog = (s: string) => ({ content: s, type: 'stdout' });
const CALL = (o: object) => mkLog('##A2T_CALL## ' + JSON.stringify(o));

test('the emitted reporter attributes markers to the right test (nested suite → fullName)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2t-rep-'));
  const reporterPath = path.join(dir, 'reporter.cjs');
  const callsFile = path.join(dir, 'calls.json');
  fs.writeFileSync(reporterPath, emitVitestReporter());
  process.env.A2T_CALLS_FILE = callsFile;

  // A fake Vitest finished-task tree: one file → one suite → two tests, each with its own logged call.
  const files = [{
    tasks: [{
      type: 'suite', name: 'PetTests', tasks: [
        { type: 'test', name: 'creates a pet', logs: [CALL({ method: 'POST', url: '/pet', status: 201 })] },
        { type: 'test', name: 'fetches a pet', logs: [mkLog('noise'), CALL({ method: 'GET', url: '/pet/1', status: 200 })] },
      ],
    }],
  }];

  const Reporter = createRequire(import.meta.url)(reporterPath);
  new Reporter().onFinished(files);
  delete process.env.A2T_CALLS_FILE;

  const map = parseVitestCallsMap(fs.readFileSync(callsFile, 'utf8'));
  assert.deepEqual(Object.keys(map).sort(), ['PetTests > creates a pet', 'PetTests > fetches a pet']);
  assert.equal(map['PetTests > creates a pet'][0].status, 201);
  assert.equal(map['PetTests > fetches a pet'][0].method, 'GET');
  // The GET test must NOT inherit the POST call — attribution is per test, not flat across the run.
  assert.equal(map['PetTests > creates a pet'].length, 1);
});

test('parseVitestCallsMap ignores non-array / malformed entries', () => {
  assert.deepEqual(parseVitestCallsMap('not json'), {});
  assert.deepEqual(parseVitestCallsMap('{"a": 5, "b": [{"method":"GET"}]}'), { b: [{ method: 'GET' } as any] });
});

test('mergeVitestCalls attaches calls onto the matching result by fullName', () => {
  const results: RawTestResult[] = [
    { method: 'creates a pet', fullName: 'PetTests > creates a pet', outcome: 'passed', durationMs: 5 },
    { method: 'fetches a pet', fullName: 'PetTests > fetches a pet', outcome: 'passed', durationMs: 3 },
  ];
  const merged = mergeVitestCalls(results, { 'PetTests > creates a pet': [{ method: 'POST', status: 201 }] });
  assert.equal(merged[0].calls?.length, 1);
  assert.equal(merged[0].calls?.[0].status, 201);
  assert.equal(merged[1].calls, undefined, 'a test with no calls stays untouched');
});
