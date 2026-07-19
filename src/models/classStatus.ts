/**
 * The user-set, real-world status of an endpoint/class — a RAG value the USER owns, distinct from how
 * the *tool* generated the class (that transient machine state is `ClassGenerationState` in
 * `services/batchClassGeneration.ts`). The two collided under the name "status" across the editions;
 * this type is the untangled user half (CLS series — see docs/HANDOVER.md "Two class statuses").
 *
 *   grey  = not automated
 *   amber = in progress / under maintenance
 *   green = automated & working
 *   red   = the API has a defect / not working
 *
 * The generator must NEVER write this — a generation failure sets `generationError`, not `status: 'red'`.
 */
export type RagStatus = 'grey' | 'amber' | 'green' | 'red';
