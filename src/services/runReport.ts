import type { Execution, ExecResult, ApiCall } from '../models/execution';

/**
 * EXEC-2 — the branded, self-contained **run report** (HTML → print to PDF). Turns one Execution record
 * into a standalone HTML document an enterprise would accept: a header (application, environment,
 * release/sprint, build/commit, timestamp, source), a summary band (totals, pass-rate, duration), and a
 * per-test breakdown with the full **API call chain** — every request/response, not just pass/fail.
 *
 * Pure and inline-styled, so it opens/prints anywhere with no assets and is unit-testable. Lifted from
 * Desktop `execution-suites/logic/runReport.ts` so both editions render the identical report from a shared
 * `Execution`; colours are inlined here (a minimal result/method/status map) rather than pulled from a
 * theme, keeping the document self-contained.
 */

const esc = (s: unknown): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const pretty = (body?: string): string => {
  if (!body) return '';
  try { return JSON.stringify(JSON.parse(body), null, 2); } catch { return body; }
};

const methodColor = (m?: string): string => {
  switch ((m || '').toUpperCase()) {
    case 'GET': return '#0f6e56'; case 'POST': return '#185fa5';
    case 'PUT': case 'PATCH': return '#854f0b'; case 'DELETE': return '#a32d2d';
    default: return '#5f5e5a';
  }
};
const statusColor = (code?: number): string =>
  !code ? '#5f5e5a' : code >= 200 && code < 300 ? '#0f6e56' : code >= 400 ? '#a32d2d' : '#444441';
const resultColor = (s: string): string => (s === 'pass' ? '#0f6e56' : s === 'fail' ? '#a32d2d' : '#854f0b');

function callHtml(call: ApiCall, i: number): string {
  const body = (label: string, b?: string) => b
    ? `<div class="bl"><div class="blh">${label}</div><pre>${esc(pretty(b))}</pre></div>` : '';
  return `<li class="call">
    <div class="callh">
      <span class="n">${i + 1}</span>
      <span class="verb" style="color:${methodColor(call.method)}">${esc((call.method || '?').toUpperCase())}</span>
      <span class="url">${esc(call.url)}</span>
      ${call.status != null ? `<span class="code" style="color:${statusColor(call.status)}">${esc(call.status)}</span>` : ''}
    </div>
    ${body('Request', call.requestBody)}${body('Response', call.responseBody)}
  </li>`;
}

function resultHtml(r: ExecResult): string {
  const calls = (r.calls || []).map(callHtml).join('');
  return `<section class="test">
    <div class="testh">
      <span class="pill" style="background:${resultColor(r.status)}">${esc(r.status)}</span>
      <span class="tname">${esc(r.name)}</span>
      <span class="dur">${Math.round(r.durationMs)} ms</span>
    </div>
    ${r.message ? `<pre class="msg">${esc(r.message)}</pre>` : ''}
    ${calls ? `<div class="chl">API calls</div><ol class="calls">${calls}</ol>`
      : `<div class="nocall">No API calls were captured for this test.</div>`}
  </section>`;
}

/** Build the full self-contained HTML report document for one run. */
export function buildExecutionReportHtml(ex: Execution): string {
  const t = ex.totals || { passed: 0, failed: 0, skipped: 0, durationMs: 0 };
  const total = t.passed + t.failed + t.skipped;
  const rate = total ? Math.round((t.passed / total) * 100) : 0;
  const when = ex.startedAt ? new Date(ex.startedAt).toLocaleString() : '';
  const meta = [
    ['Application', ex.application], ['Environment', ex.environment], ['Release', ex.release],
    ['Sprint', ex.sprint], ['Build', ex.build], ['Commit', ex.commit],
    ['Source', ex.source], ['Run', when],
  ].filter(([, v]) => v).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');

  const card = (label: string, value: string | number, color?: string) =>
    `<div class="card"><div class="cl">${esc(label)}</div><div class="cv"${color ? ` style="color:${color}"` : ''}>${esc(value)}</div></div>`;

  return `<!doctype html><html><head><meta charset="utf-8"><title>Run report — ${esc(ex.suiteName)}</title>
<style>
  :root{--ink:#1a1a19;--mut:#5f5e5a;--line:#e7e5df;--bg:#faf9f5}
  *{box-sizing:border-box}body{font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:var(--ink);margin:0;background:#fff}
  .wrap{max-width:900px;margin:0 auto;padding:32px}
  h1{font-size:20px;font-weight:600;margin:0 0 4px}.sub{color:var(--mut);margin:0 0 20px}
  dl.meta{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px 20px;margin:0 0 24px}
  dl.meta dt{color:var(--mut);font-size:12px}dl.meta dd{margin:0;font-weight:500}
  .cards{display:flex;gap:12px;margin:0 0 28px;flex-wrap:wrap}
  .card{background:var(--bg);border-radius:8px;padding:12px 16px;min-width:110px}
  .cl{font-size:12px;color:var(--mut)}.cv{font-size:24px;font-weight:600;margin-top:2px}
  .test{border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:0 0 14px}
  .testh{display:flex;align-items:center;gap:10px}
  .pill{color:#fff;font-size:12px;font-weight:600;padding:2px 10px;border-radius:6px;text-transform:uppercase}
  .tname{font-weight:600;flex:1}.dur{color:var(--mut);font-size:12px}
  .msg{background:#fceaea;color:#791f1f;border-radius:6px;padding:8px 10px;font-size:12px;white-space:pre-wrap;margin:10px 0 0;overflow-x:auto}
  .chl{font-size:12px;color:var(--mut);margin:14px 0 6px;font-weight:500}
  ol.calls{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
  .call{border:1px solid var(--line);border-radius:8px;padding:8px 10px}
  .callh{display:flex;align-items:center;gap:8px;font-size:13px}
  .callh .n{color:var(--mut);font-variant-numeric:tabular-nums}
  .callh .verb{font-weight:700}.callh .url{font-family:ui-monospace,monospace;color:#444;word-break:break-all;flex:1}
  .callh .code{font-weight:600}
  .bl{margin-top:6px}.blh{font-size:11px;color:var(--mut);font-weight:600}
  .bl pre{background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:8px;font-size:12px;white-space:pre-wrap;word-break:break-all;margin:2px 0 0;overflow-x:auto}
  .nocall{color:var(--mut);font-size:12px;margin-top:10px}
  @media print{.wrap{padding:0}.test{break-inside:avoid}}
</style></head><body><div class="wrap">
  <h1>Run report — ${esc(ex.suiteName)}</h1>
  <p class="sub">${esc(ex.mode === 'real' ? 'Executed in sandbox (dotnet test)' : 'Run')} · ${esc(when)}</p>
  <dl class="meta">${meta}</dl>
  <div class="cards">
    ${card('Total', total)}${card('Passed', t.passed, '#0f6e56')}${card('Failed', t.failed, '#a32d2d')}
    ${card('Skipped', t.skipped, '#854f0b')}${card('Pass rate', rate + '%')}${card('Duration', Math.round(t.durationMs) + ' ms')}
  </div>
  ${(ex.results || []).map(resultHtml).join('')}
</div></body></html>`;
}
