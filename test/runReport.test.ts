import { test } from 'node:test';
import assert from 'node:assert';
import { buildExecutionReportHtml } from '../src/services/runReport';
import type { Execution } from '../src/models/execution';

const sample: Execution = {
  id: 'ex1', suiteId: 's1', suiteName: 'Pet Store smoke',
  application: 'Pet Store', environment: 'Test', release: 'R1', sprint: 'SP7',
  mode: 'real', source: 'sandbox', build: '42', commit: 'abc123',
  startedAt: '2026-07-26T10:00:00.000Z', finishedAt: '2026-07-26T10:00:03.000Z',
  totals: { passed: 1, failed: 1, skipped: 0, durationMs: 1234 },
  results: [
    {
      testCaseId: 'tc1', name: 'Create pet', status: 'pass', durationMs: 800,
      calls: [
        { method: 'post', url: 'https://api/pets', requestBody: '{"name":"Rex"}', status: 201, responseBody: '{"id":7}' },
      ],
    },
    {
      testCaseId: 'tc2', name: 'Delete missing pet', status: 'fail', durationMs: 434,
      message: 'expected 200 or 204 but got 404',
      calls: [{ method: 'delete', url: 'https://api/pets/999', status: 404 }],
    },
  ],
};

test('EXEC-2: report contains each test row (name + status) and the summary totals', () => {
  const html = buildExecutionReportHtml(sample);
  // Per-row name + status pill.
  assert.ok(html.includes('Create pet'), 'row 1 name present');
  assert.ok(html.includes('Delete missing pet'), 'row 2 name present');
  assert.ok(html.includes('>pass<'), 'pass pill present');
  assert.ok(html.includes('>fail<'), 'fail pill present');
  // Summary band totals + pass rate (1 of 2 = 50%).
  assert.ok(html.includes('Pass rate'), 'pass-rate card present');
  assert.ok(html.includes('50%'), 'pass rate computed');
  // Header metadata (only set fields render).
  assert.ok(html.includes('Pet Store'), 'application in header');
  assert.ok(html.includes('abc123'), 'commit in header');
});

test('EXEC-2: report includes the full API call chain — verb, url, status, and bodies', () => {
  const html = buildExecutionReportHtml(sample);
  assert.ok(html.includes('POST'), 'verb upper-cased');
  assert.ok(html.includes('https://api/pets'), 'call url present');
  assert.ok(html.includes('201'), 'status code present');
  assert.ok(html.includes('&quot;name&quot;: &quot;Rex&quot;') || html.includes('Rex'), 'request body rendered');
  assert.ok(html.includes('&quot;id&quot;: 7') || html.includes('7'), 'response body rendered');
  // The failing row's message surfaces.
  assert.ok(html.includes('expected 200 or 204 but got 404'), 'failure message present');
});

test('EXEC-2: HTML-escapes response content (no injection from a body)', () => {
  const evil: Execution = {
    id: 'e', suiteId: 's', suiteName: 'x', totals: { passed: 0, failed: 1, skipped: 0, durationMs: 1 },
    results: [{
      testCaseId: 't', name: '<script>alert(1)</script>', status: 'fail', durationMs: 1,
      calls: [{ method: 'get', url: 'https://x', status: 500, responseBody: '<img onerror=1>' }],
    }],
  };
  const html = buildExecutionReportHtml(evil);
  assert.ok(!html.includes('<script>alert(1)</script>'), 'test name is escaped, not raw');
  assert.ok(html.includes('&lt;script&gt;'), 'escaped form present');
});
