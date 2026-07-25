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
import type { ClassGenerationState } from './batchClassGeneration';

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

/**
 * CLS-6 — derive a Class Library entry's generation state ON DEMAND (not mid-batch), so both editions
 * share one rule instead of each porting their own. A persisted `generationError` (set by a failed
 * generate, cleared on success — CLS-2) wins as `error` even if a stale class file still exists; else
 * `generated` when code has been produced (the caller supplies `hasCode` — e.g. a local class file
 * exists), else `pending`.
 *
 * Vocabulary is reconciled onto the batch {@link ClassGenerationState} (`generated|pending|error|empty`):
 * the clients' `failed` folds into `error`, and `empty` (no body to serialise) is a batch-time
 * distinction only — never derivable from `(entry, hasCode)`, so this never returns it. Clients map the
 * state → colour (error/red, generated/green, pending/amber).
 */
export function deriveClassState(entry: { generationError?: string }, hasCode: boolean): ClassGenerationState {
  if (entry.generationError) return 'error';
  return hasCode ? 'generated' : 'pending';
}
