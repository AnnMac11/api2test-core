/**
 * Execution result shapes (EXEC-1: "result types only").
 *
 * The SHARED result record of running a suite of E2E test cases — so every edition agrees on the shape a
 * run produces and the branded report (EXEC-2) can render from it. Only the *shapes* live in core; the run
 * **orchestration** is edition-specific and deliberately stays out (VS Code uses the user's project + Test
 * Explorer, Desktop a managed sandbox + `dotnet test`, Jira does not execute) — see `docs/TASKS.md` EXEC-1.
 *
 * `ApiCall` is the single source of truth for a captured request/response; `TestRunnerService` imports it
 * here rather than declaring its own, so the runner and the report never drift.
 */

/** One API call a test made — request + response — captured by the generated Reporter. */
export interface ApiCall {
  method?: string;
  url?: string;
  requestBody?: string;
  status?: number;
  responseBody?: string;
}

/** A single test's outcome within an execution run. */
export type ExecResultStatus = 'pass' | 'fail' | 'skip';

/** One test case's result within a run. */
export interface ExecResult {
  testCaseId: string;
  name: string;
  status: ExecResultStatus;
  durationMs: number;
  message?: string;
  /** API calls the test made, in order (only present for real runs with the Reporter). */
  calls?: ApiCall[];
}

/** The result record of running an Execution Suite at a point in time. */
export interface Execution {
  id: string;
  suiteId: string;
  suiteName: string;
  /** Sprint tag (per run) — the dashboard filters by this. */
  sprint?: string;
  /** Release tag — a release spans multiple sprints. */
  release?: string;
  /** Environment the run targeted (Dev/Test/E2E/Pre-Prod). */
  environment?: string;
  /** Application the suite belongs to. */
  application?: string;
  /** How results were produced: a real `dotnet test` run, or the Phase-1 simulation. */
  mode?: 'real' | 'simulated';
  /** Which lane produced this run: author-time **sandbox**, or an ingested **ci** regression run. */
  source?: 'sandbox' | 'ci';
  /** CI provenance (ingested runs only): the pipeline build number and the commit under test. */
  build?: string;
  commit?: string;
  startedAt?: string;
  finishedAt?: string;
  totals: { passed: number; failed: number; skipped: number; durationMs: number };
  results: ExecResult[];
}
