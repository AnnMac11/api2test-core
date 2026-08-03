import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Local test runner — shells `dotnet test`, emits a TRX, parses it. Pure Node, so every
 * Node-hosted edition (enterprise web server, VS extension) can use it; the cloud/Forge edition
 * keeps it gated off (no local filesystem). See the edition-gating notes.
 */

// `ApiCall` is single-sourced in `models/execution` (captured Reporter request/response) so the runner and
// the branded report never drift; re-exported here for back-compat with existing `TestRunnerService` imports.
import type { ApiCall } from '../models/execution';
export type { ApiCall };

export interface RawTestResult {
  /** Bare method name (last segment of the fully-qualified test name). */
  method: string;
  /** Fully-qualified test name, e.g. `Sample.Tests.StripeCustomer`. */
  fullName: string;
  /** TRX outcome: Passed | Failed | Error | NotExecuted | … */
  outcome: string;
  durationMs: number;
  message?: string;
  /** API calls the test made, in order (from the Reporter markers in the test's console output). */
  calls?: ApiCall[];
}

/** Pull the Reporter markers (`##A2T_CALL## {json}`) out of a test's captured console output. */
export function parseApiCalls(stdout: string): ApiCall[] {
  const calls: ApiCall[] = [];
  for (const line of decode(stdout).split(/\r?\n/)) {
    const i = line.indexOf('##A2T_CALL##');
    if (i < 0) continue;
    try { calls.push(JSON.parse(line.slice(i + 12).trim())); } catch { /* skip malformed */ }
  }
  return calls;
}

const decode = (x: string) =>
  x.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** "00:00:00.3370330" → milliseconds. */
function parseDuration(d: string): number {
  const m = d.match(/(\d+):(\d+):(\d+)(?:\.(\d+))?/);
  if (!m) return 0;
  const [, h, mi, s, frac = ''] = m;
  return (parseInt(h) * 3600 + parseInt(mi) * 60 + parseInt(s)) * 1000 + (frac ? Math.round(parseFloat('0.' + frac) * 1000) : 0);
}

/**
 * Pull the real **compile errors** out of a `dotnet build`/`test` log — the `error CSxxxx` lines — and
 * present them compactly as `File.cs(line): CSxxxx — message`, deduped. Far more useful than a blind tail of
 * the output (which often shows only warnings or an unrelated last line). Returns [] when there are none.
 */
export function extractBuildErrors(output: string): string[] {
  const out: string[] = [];
  for (const raw of (output || '').split(/\r?\n/)) {
    const m = raw.match(/([^\\/]+\.[A-Za-z0-9]+)\((\d+),\d+\):\s*error\s+([A-Za-z]{1,3}\d+):\s*(.+?)(?:\s*\[[^\]]*\])?\s*$/);
    if (m) out.push(`${m[1]}(${m[2]}): ${m[3]} — ${m[4].trim()}`);
    else if (/:\s*error\s+[A-Za-z]{1,3}\d+:/.test(raw)) out.push(raw.trim());
  }
  return [...new Set(out)];
}

/** Parse a VSTest TRX file into per-test results (self-closing and child-bearing elements). */
export function parseTrx(xml: string): RawTestResult[] {
  const out: RawTestResult[] = [];
  const re = /<UnitTestResult\b([^>]*?)(?:\/>|>([\s\S]*?)<\/UnitTestResult>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const attrs = m[1];
    const body = m[2] || '';
    const get = (k: string) => attrs.match(new RegExp(`${k}="([^"]*)"`))?.[1] ?? '';
    const fullName = get('testName');
    if (!fullName) continue;
    const msg = body.match(/<Message>([\s\S]*?)<\/Message>/);
    const stdout = body.match(/<StdOut>([\s\S]*?)<\/StdOut>/);
    const calls = stdout ? parseApiCalls(stdout[1]) : [];
    out.push({
      method: fullName.split('.').pop() || fullName,
      fullName,
      outcome: get('outcome'),
      durationMs: parseDuration(get('duration')),
      message: msg ? decode(msg[1]).trim() : undefined,
      calls: calls.length ? calls : undefined,
    });
  }
  return out;
}

/**
 * True when the project runs on **Microsoft.Testing.Platform** rather than VSTest — that is, when
 * `dotnet test` hands the arguments to the test executable instead of to the VSTest host.
 *
 * It matters because the two platforms share no command line. MTP has no `--logger trx;…`; it silently
 * ignores it and writes no TRX, which is exactly how a run that passed still reported
 * "dotnet test produced no TRX" (RUN-TRX). Its TRX has to be asked for by name, after a `--`.
 *
 * `MSTest.Sdk` enables the MSTest runner by default, so the SDK attribute is the signal — unless the
 * project turns it off explicitly, in which case the property wins. Anything we cannot read is treated as
 * VSTest, which is what every caller assumed before this existed.
 */
export function usesTestingPlatform(projectPath: string): boolean {
  let file = projectPath;
  try {
    if (fs.statSync(projectPath).isDirectory()) {
      const proj = fs.readdirSync(projectPath).find(f => /\.(cs|fs|vb)proj$/i.test(f));
      if (!proj) return false;
      file = path.join(projectPath, proj);
    }
    const xml = fs.readFileSync(file, 'utf8');
    const explicit = xml.match(/<EnableMSTestRunner>\s*(true|false)\s*<\/EnableMSTestRunner>/i);
    if (explicit) return explicit[1].toLowerCase() === 'true';
    return /Sdk\s*=\s*"MSTest\.Sdk/i.test(xml);
  } catch {
    return false;
  }
}

/**
 * The `dotnet test` command line for a project, in the shape its test platform understands.
 * Split out from {@link runDotnetTest} so the arguments can be asserted without a .NET SDK present.
 */
export function dotnetTestArgs(
  projectPath: string,
  resultsDir: string,
  opts: { filter?: string } = {},
  mtp = false,
): string[] {
  if (mtp) {
    // Everything after `--` goes to the test app itself — that is where MTP reads its options.
    const args = ['test', projectPath, '--', '--report-trx', '--report-trx-filename', 'results.trx',
      '--results-directory', resultsDir];
    if (opts.filter) args.push('--filter', opts.filter);
    return args;
  }
  const args = ['test', projectPath, '--logger', 'trx;LogFileName=results.trx', '--results-directory', resultsDir];
  if (opts.filter) args.push('--filter', opts.filter);
  return args;
}

/**
 * Run `dotnet test` on a project (.csproj or folder), emit a TRX, and parse it.
 * Non-zero exit on test failures is expected — the TRX is still produced and parsed.
 */
export function runDotnetTest(projectPath: string, opts: { timeoutMs?: number; filter?: string } = {}): Promise<RawTestResult[]> {
  return new Promise((resolve, reject) => {
    const resultsDir = path.join(path.dirname(projectPath), '.api2test-results');
    try { fs.rmSync(resultsDir, { recursive: true, force: true }); } catch { /* ignore */ }

    const args = dotnetTestArgs(projectPath, resultsDir, opts, usesTestingPlatform(projectPath));

    execFile('dotnet', args, { timeout: opts.timeoutMs ?? 300_000, maxBuffer: 32 * 1024 * 1024, env: process.env }, (_err, stdout, stderr) => {
      const trxPath = path.join(resultsDir, 'results.trx');
      if (!fs.existsSync(trxPath)) {
        // No TRX means the build (or run) failed before any test executed. Surface the actual compile
        // errors — not a blind tail of the log (which is often just a warning or an unrelated last line).
        const errs = extractBuildErrors(`${stdout || ''}\n${stderr || ''}`);
        const detail = errs.length
          ? `Build failed (${errs.length} error${errs.length === 1 ? '' : 's'}):\n${errs.slice(0, 20).join('\n')}`
          : (stderr || stdout || '').toString().slice(-800);
        return reject(new Error(`dotnet test produced no TRX. ${detail}`));
      }
      try { resolve(parseTrx(fs.readFileSync(trxPath, 'utf8'))); }
      catch (e) { reject(e); }
    });
  });
}

export interface BuildResult {
  /** True when the project compiled with no errors. */
  ok: boolean;
  /** Distinct compiler/MSBuild error lines, e.g. `ApiMethods.cs(454,82): error CS1009: ...`. */
  errors: string[];
  /** Tail of the build output, for context when there are no parsable error lines. */
  raw: string;
}

/**
 * Run `dotnet build` on a project (.csproj or folder) and collect compiler errors.
 * Used to validate generated artifacts at deploy time — the deploy still happens, but the caller
 * can surface "deployed, but does not compile yet" with the first error.
 */
export function runDotnetBuild(projectPath: string, opts: { timeoutMs?: number } = {}): Promise<BuildResult> {
  return new Promise((resolve) => {
    execFile('dotnet', ['build', projectPath, '--nologo'], { timeout: opts.timeoutMs ?? 240_000, maxBuffer: 32 * 1024 * 1024, env: process.env }, (err, stdout, stderr) => {
      const out = `${stdout || ''}\n${stderr || ''}`;
      const errors = Array.from(new Set(
        out.split(/\r?\n/).map(l => l.trim()).filter(l => /:\s*error\s/i.test(l)),
      ));
      if (err && errors.length === 0) errors.push((stderr || stdout || 'dotnet build failed').toString().trim().slice(-400));
      resolve({ ok: !err && errors.length === 0, errors, raw: out.slice(-2000) });
    });
  });
}

// ── TypeScript / Vitest runner (parallel to the dotnet path above) ──────────────────────────────────

const npx = () => (process.platform === 'win32' ? 'npx.cmd' : 'npx');

/**
 * Parse Vitest's `--reporter=json` output into per-test results (parallel to {@link parseTrx}). Vitest's
 * `status` strings ('passed'|'failed'|'skipped'|'todo') are already understood by {@link outcomeToStatus}.
 *
 * NOTE: the `##A2T_CALL##` markers are NOT in this JSON — Vitest drops test console output from the JSON
 * reporter. They come from the run's **stdout** via {@link parseApiCalls} (the sandbox must set
 * `disableConsoleIntercept: true`). Those stdout markers are flat (not per-test); per-test attribution
 * needs a custom Vitest reporter — see TASKS.md TS-C2.
 */
export function parseVitestJson(json: string): RawTestResult[] {
  const out: RawTestResult[] = [];
  let d: any;
  try { d = JSON.parse(json); } catch { return out; }
  for (const file of d?.testResults ?? []) {
    for (const a of file?.assertionResults ?? []) {
      const fullName = a.fullName
        || [...(a.ancestorTitles || []), a.title].filter(Boolean).join(' > ')
        || a.title || '';
      out.push({
        method: (a.title || fullName || '').trim(),
        fullName,
        outcome: a.status || '',
        durationMs: Math.round(a.duration || 0),
        message: Array.isArray(a.failureMessages) && a.failureMessages.length
          ? a.failureMessages.join('\n').trim() : undefined,
      });
    }
  }
  return out;
}

/** Parse `tsc --noEmit` output into a {@link BuildResult} (parallel to {@link runDotnetBuild}'s error grep). */
export function parseTscErrors(output: string): BuildResult {
  const errors = Array.from(new Set(
    (output || '').split(/\r?\n/).map(l => l.trim()).filter(l => /:\s*error\s+TS\d+/i.test(l)),
  ));
  return { ok: errors.length === 0, errors, raw: (output || '').slice(-2000) };
}

/** Type-check a TS sandbox with `tsc --noEmit` and collect errors (parallel to {@link runDotnetBuild}). */
export function runTsc(projectDir: string, opts: { timeoutMs?: number } = {}): Promise<BuildResult> {
  return new Promise((resolve) => {
    execFile(npx(), ['tsc', '--noEmit'], { cwd: projectDir, timeout: opts.timeoutMs ?? 240_000, maxBuffer: 32 * 1024 * 1024, env: process.env, shell: process.platform === 'win32' }, (err, stdout, stderr) => {
      const res = parseTscErrors(`${stdout || ''}\n${stderr || ''}`);
      if (err && res.ok) { res.ok = false; res.errors.push((stderr || stdout || 'tsc failed').toString().trim().slice(-400)); }
      resolve(res);
    });
  });
}

export interface VitestRun {
  /** Per-test results from the JSON reporter — with per-test `calls` attached (see TS-C2). */
  results: RawTestResult[];
  /** All `##A2T_CALL##` markers from the run, flattened across tests. */
  calls: ApiCall[];
}

// ── TS-C2: per-test API-call attribution ────────────────────────────────────────────────────────────
//
// Vitest's JSON reporter drops per-test console output, so the flat stdout approach can't say WHICH test
// made a call. A custom reporter instead reads each finished test's captured `logs` (Vitest keeps them per
// task by default), pulls that test's `##A2T_CALL##` markers, and writes a { fullName: ApiCall[] } map that
// runVitest merges onto the results. The reporter is pure Node (fs only) so it loads in the sandbox with no
// dependency on core, and can be exercised directly in a test.

/** Source of the custom Vitest reporter (CommonJS). Writes a `{ fullName: ApiCall[] }` map to `A2T_CALLS_FILE`. */
export function emitVitestReporter(): string {
  return `// Auto-generated by API2Test. Custom Vitest reporter — attributes ##A2T_CALL## markers per test.
const fs = require('fs');

function extractCalls(logs) {
  const calls = [];
  for (const log of logs || []) {
    for (const line of String(log.content || '').split(/\\r?\\n/)) {
      const i = line.indexOf('##A2T_CALL##');
      if (i < 0) continue;
      try { calls.push(JSON.parse(line.slice(i + 12).trim())); } catch (e) { /* skip malformed */ }
    }
  }
  return calls;
}

class A2TReporter {
  onFinished(files) {
    const out = {};
    const walk = (tasks, prefix) => {
      for (const t of tasks || []) {
        if (t.type === 'suite') {
          walk(t.tasks, prefix ? prefix + ' > ' + t.name : t.name);
        } else if (t.type === 'test') {
          const name = prefix ? prefix + ' > ' + t.name : t.name;
          const calls = extractCalls(t.logs);
          if (calls.length) out[name] = calls;
        }
      }
    };
    for (const f of files || []) walk(f.tasks, '');
    fs.writeFileSync(process.env.A2T_CALLS_FILE || '.api2test-calls.json', JSON.stringify(out));
  }
}

module.exports = A2TReporter;
module.exports.default = A2TReporter;
`;
}

/** Parse the reporter's `{ fullName: ApiCall[] }` map (parallel to parseVitestJson). Returns {} on bad input. */
export function parseVitestCallsMap(json: string): Record<string, ApiCall[]> {
  let d: any;
  try { d = JSON.parse(json); } catch { return {}; }
  if (!d || typeof d !== 'object') return {};
  const out: Record<string, ApiCall[]> = {};
  for (const [name, calls] of Object.entries(d)) {
    if (Array.isArray(calls)) out[name] = calls as ApiCall[];
  }
  return out;
}

/** Attach each test's calls (from the reporter map, keyed by fullName) onto its result. */
export function mergeVitestCalls(results: RawTestResult[], callsMap: Record<string, ApiCall[]>): RawTestResult[] {
  return results.map(r => {
    const calls = callsMap[r.fullName];
    return calls && calls.length ? { ...r, calls } : r;
  });
}

/**
 * Run Vitest in a TS sandbox, parse the JSON reporter → results, and attribute `##A2T_CALL##` markers
 * per test via the custom reporter (TS-C2). `calls` is the flattened union across tests.
 */
export function runVitest(projectDir: string, opts: { timeoutMs?: number; filter?: string } = {}): Promise<VitestRun> {
  return new Promise((resolve, reject) => {
    const outFile = path.join(projectDir, '.api2test-results.json');
    const callsFile = path.join(projectDir, '.api2test-calls.json');
    const reporterFile = path.join(projectDir, '.api2test-reporter.cjs');
    try { fs.rmSync(outFile, { force: true }); } catch { /* ignore */ }
    try { fs.rmSync(callsFile, { force: true }); } catch { /* ignore */ }
    try { fs.writeFileSync(reporterFile, emitVitestReporter()); } catch { /* ignore */ }
    const args = ['vitest', 'run', '--reporter=json', `--outputFile=${outFile}`, '--reporter', reporterFile];
    if (opts.filter) args.push('-t', opts.filter);
    execFile(npx(), args, { cwd: projectDir, timeout: opts.timeoutMs ?? 300_000, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, A2T_CALLS_FILE: callsFile }, shell: process.platform === 'win32' }, (_err, stdout, stderr) => {
      if (!fs.existsSync(outFile)) {
        return reject(new Error(`vitest produced no JSON report. ${(stderr || stdout || '').toString().slice(-600)}`));
      }
      try {
        let results = parseVitestJson(fs.readFileSync(outFile, 'utf8'));
        let calls: ApiCall[];
        if (fs.existsSync(callsFile)) {
          const map = parseVitestCallsMap(fs.readFileSync(callsFile, 'utf8'));
          results = mergeVitestCalls(results, map);
          calls = Object.values(map).flat();
        } else {
          // Fallback: no per-test map (e.g. console intercept disabled) → flat markers from stdout.
          calls = parseApiCalls(`${stdout || ''}\n${stderr || ''}`);
        }
        resolve({ results, calls });
      } catch (e) { reject(e); }
    });
  });
}

/** A test case's generated C# method name (mirrors the E2E generator's methodName()). */
export function methodNameOf(caseName: string): string {
  const cleaned = (caseName || 'TestCase').replace(/[^a-zA-Z0-9]+/g, ' ').trim()
    .split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
  return /^[a-zA-Z]/.test(cleaned) ? cleaned : `Test${cleaned}`;
}

/** Map TRX outcome → pass/fail/skip. */
export function outcomeToStatus(outcome: string): 'pass' | 'fail' | 'skip' {
  const o = (outcome || '').toLowerCase();
  if (o === 'passed') return 'pass';
  if (o === 'failed' || o === 'error' || o === 'timeout') return 'fail';
  return 'skip';
}
