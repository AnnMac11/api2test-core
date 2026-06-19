import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Local test runner — shells `dotnet test`, emits a TRX, parses it. Pure Node, so every
 * Node-hosted edition (enterprise web server, VS extension) can use it; the cloud/Forge edition
 * keeps it gated off (no local filesystem). See the edition-gating notes.
 */

export interface RawTestResult {
  /** Bare method name (last segment of the fully-qualified test name). */
  method: string;
  /** Fully-qualified test name, e.g. `Sample.Tests.StripeCustomer`. */
  fullName: string;
  /** TRX outcome: Passed | Failed | Error | NotExecuted | … */
  outcome: string;
  durationMs: number;
  message?: string;
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
    out.push({
      method: fullName.split('.').pop() || fullName,
      fullName,
      outcome: get('outcome'),
      durationMs: parseDuration(get('duration')),
      message: msg ? decode(msg[1]).trim() : undefined,
    });
  }
  return out;
}

/**
 * Run `dotnet test` on a project (.csproj or folder), emit a TRX, and parse it.
 * Non-zero exit on test failures is expected — the TRX is still produced and parsed.
 */
export function runDotnetTest(projectPath: string, opts: { timeoutMs?: number; filter?: string } = {}): Promise<RawTestResult[]> {
  return new Promise((resolve, reject) => {
    const resultsDir = path.join(path.dirname(projectPath), '.api2test-results');
    try { fs.rmSync(resultsDir, { recursive: true, force: true }); } catch { /* ignore */ }

    const args = ['test', projectPath, '--logger', 'trx;LogFileName=results.trx', '--results-directory', resultsDir];
    if (opts.filter) args.push('--filter', opts.filter);

    execFile('dotnet', args, { timeout: opts.timeoutMs ?? 300_000, maxBuffer: 32 * 1024 * 1024, env: process.env }, (_err, stdout, stderr) => {
      const trxPath = path.join(resultsDir, 'results.trx');
      if (!fs.existsSync(trxPath)) {
        return reject(new Error(`dotnet test produced no TRX. ${(stderr || stdout || '').toString().slice(-600)}`));
      }
      try { resolve(parseTrx(fs.readFileSync(trxPath, 'utf8'))); }
      catch (e) { reject(e); }
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
