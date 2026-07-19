/**
 * CLS-3 — the RAG roll-up / result-mapping RULE, shared by both editions.
 *
 * Lifted from Desktop `shared/utils/statusColours.ts` (the pure logic only). The COLOURS stay in the
 * clients (theme tokens — `--app-color-*` in Desktop, VS Code theme vars), because they're presentation;
 * only the rule comes here so the API Class Library status, the E2E/test-case roll-up, and execution
 * readiness all agree on one truth table.
 *
 * `RagStatus` (the user-set class status) lives in `models/classStatus.ts` and is re-exported here.
 */
import { RagStatus } from '../models/classStatus';

export type { RagStatus };

/**
 * Roll up a set of RAG statuses into one: any red → red; else all green → green; else all grey →
 * grey; else amber. Empty → grey. Shared by the E2E/test-case table and execution-suite readiness —
 * the two readings are "which tests can execute" (all-green = runnable) and "impact of an API change"
 * (flip a class to red/amber → every test case using it cascades).
 */
export function rollupRag(statuses: string[]): RagStatus {
  if (!statuses.length) return 'grey';
  if (statuses.includes('red')) return 'red';
  if (statuses.every(s => s === 'green')) return 'green';
  if (statuses.every(s => s === 'grey')) return 'grey';
  return 'amber';
}

/** An execution RESULT mapped onto the RAG palette: pass→green, fail→red, skip→amber, else grey. */
export function resultToRag(result: string): RagStatus {
  return result === 'pass' ? 'green' : result === 'fail' ? 'red' : result === 'skip' ? 'amber' : 'grey';
}
