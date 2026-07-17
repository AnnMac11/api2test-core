import { parseTrx, parseVitestJson, methodNameOf, outcomeToStatus, RawTestResult, ApiCall } from './TestRunnerService';

/**
 * CI results ingestion (REG-3) — the "in" half of the regression loop, lifted from Desktop
 * `ciResults.ts`. A pipeline runs the deployed tests, then POSTs its report back; we parse it,
 * match each row to a test case by generated method name, attribute a release, and build an
 * Execution record with `source: 'ci'` so it lands beside local runs on the dashboard.
 *
 * Pure functions over passed-in data — the client keeps its stores (test cases, releases,
 * ingestion tokens) and does the HTTP + persistence. Both pipeline formats are accepted: a C#
 * TRX and a Vitest JSON report parse into the same result shape.
 */

/** A named ingestion credential (the pipeline sends `key` as X-Api-Key). */
export interface IngestionTokenLike { name?: string; key?: string }

/** A release with its Admin-set date window. */
export interface ReleaseWindow { name?: string; startDate?: string; endDate?: string }

/** The minimum a test case needs for matching. */
export interface CiCaseRef { id: string; name: string }

export interface CiResultsMeta {
  /** Pipeline name — labels the run on the dashboard (e.g. "petstore-E2E"). */
  name?: string;
  /** Explicit release/sprint tag if the pipeline knows it (else release is date-windowed). */
  release?: string;
  sprint?: string;
  environment?: string;
  build?: string;
  commit?: string;
  /** Run timestamp (ISO). Defaults to now when the pipeline doesn't send one. */
  timestamp?: string;
}

export interface CiExecResult {
  testCaseId: string;
  name: string;
  status: 'pass' | 'fail' | 'skip';
  durationMs: number;
  message?: string;
  calls?: ApiCall[];
}

export interface CiExecution {
  id: string;
  suiteId: string;
  suiteName: string;
  sprint: string;
  release: string;
  environment: string;
  application: string;
  mode: 'real';
  source: 'ci';
  build?: string;
  commit?: string;
  startedAt: string;
  finishedAt: string;
  totals: { passed: number; failed: number; skipped: number; durationMs: number };
  results: CiExecResult[];
}

/** True when the presented key matches a configured ingestion token (or the legacy single key). No key
 *  configured ⇒ nothing validates (secure by default — add an ingestion token first). */
export function isValidIngestionKey(key: string | null | undefined, tokens: IngestionTokenLike[], legacyKey?: string): boolean {
  if (!key) return false;
  if ((tokens || []).some(t => t.key && t.key === key)) return true;
  return !!legacyKey && legacyKey === key;
}

/**
 * Which release a CI run belongs to. An explicit `tag` wins (the pipeline knew it); otherwise the
 * release whose `[startDate, endDate]` window contains the run's date. `''` if neither resolves —
 * the run still stores, just un-bucketed.
 */
export function attributeRelease(tag: string | undefined, timestampIso: string, releases: ReleaseWindow[]): string {
  if (tag) return tag;
  const day = (timestampIso || '').slice(0, 10);
  if (!day) return '';
  for (const r of releases || []) {
    const s = (r.startDate || '').slice(0, 10);
    const e = (r.endDate || '').slice(0, 10);
    if (s && e && s <= day && day <= e) return r.name || '';
  }
  return '';
}

/** Parse a posted CI report — TRX XML (C# pipeline) or Vitest JSON (TS pipeline) — into one shape. */
export function parseCiReport(payload: string): RawTestResult[] {
  return (payload || '').trimStart().startsWith('<') ? parseTrx(payload) : parseVitestJson(payload);
}

/**
 * Build (without storing) the Execution record for an ingested CI report. Rows match a test case by
 * generated method name (the same `methodNameOf` the local runner matches on); an **unmatched** row
 * is kept verbatim (name = method) so a result is never silently dropped. Throws on an empty report.
 */
export function buildCiExecution(
  raw: RawTestResult[],
  meta: CiResultsMeta,
  ctx: { testCases: CiCaseRef[]; releases: ReleaseWindow[] },
): CiExecution {
  if (!raw.length) throw new Error('No test results found in the posted report.');
  const byMethod = new Map<string, CiCaseRef>();
  for (const c of ctx.testCases || []) byMethod.set(methodNameOf(c.name).toLowerCase(), c);

  const results = raw.map((r): CiExecResult => {
    const tc = byMethod.get((r.method || '').toLowerCase());
    const status = outcomeToStatus(r.outcome);
    return {
      testCaseId: tc?.id || r.method,
      name: tc?.name || r.method,
      status,
      durationMs: r.durationMs || 0,
      message: status === 'fail' ? r.message : undefined,
      calls: r.calls,
    };
  });

  const timestamp = meta.timestamp || new Date().toISOString();
  const totals = results.reduce(
    (a, r) => {
      a.durationMs += r.durationMs;
      if (r.status === 'pass') a.passed++; else if (r.status === 'fail') a.failed++; else a.skipped++;
      return a;
    },
    { passed: 0, failed: 0, skipped: 0, durationMs: 0 },
  );

  return {
    id: `exec-ci-${Date.now()}`,
    suiteId: '',
    suiteName: meta.name || 'CI regression',
    sprint: meta.sprint || '',
    release: attributeRelease(meta.release, timestamp, ctx.releases),
    environment: meta.environment || '',
    application: '',
    mode: 'real',
    source: 'ci',
    build: meta.build || undefined,
    commit: meta.commit || undefined,
    startedAt: timestamp,
    finishedAt: timestamp,
    totals,
    results,
  };
}
