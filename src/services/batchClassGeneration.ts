import { CodeEmitter } from '../adapters/CodeEmitter';
import { ApiClassLibraryDto } from '../models/ApiClassLibraryDto';
import { ClassGenerationRequest } from '../models/ClassGenerationDto';
import { hasUnassignedMandatory } from './fieldCompleteness';

/**
 * ORCH-2 — batch class generation over the Class Library. This is the *driver* only; it reuses what
 * already exists — the green/amber decision is {@link hasUnassignedMandatory} (core `fieldCompleteness`),
 * and the render is the language {@link CodeEmitter} (`emitRequestClass`). Nothing here re-implements
 * generation or the status rule; it sequences them so both editions share one loop.
 */

/**
 * How the *tool* generated the class — a transient, machine-derived state (NOT the user's RAG
 * {@link RagStatus}). Renamed from `ClassStatus` (CLS-1) to free that name for the persisted user
 * field; the two used to collide across editions. `generated`=code produced, `pending`=a mandatory
 * field is unassigned, `error`=render threw, `empty`=nothing to serialise (no body fields).
 */
export type ClassGenerationState = 'generated' | 'pending' | 'error' | 'empty';

/** Outcome for one class in a batch generate. */
export interface ClassGenerationOutcome {
  endpointId: string;
  className: string;
  /** The transient generation state (see {@link ClassGenerationState}). Not the user RAG `status`. */
  state: ClassGenerationState;
  /** The rendered class source — present only when `status === 'generated'`. Persistence is the client's job. */
  code?: string;
  /** Present only when `status === 'error'`. */
  error?: string;
}

/** Summary of a batch generate. */
export interface BatchGenerateResult {
  perClass: ClassGenerationOutcome[];
  generated: number;
  pending: number;
  errored: number;
}

/** Map a stored Class Library entry to the generator's request shape. */
export function toClassGenerationRequest(entry: ApiClassLibraryDto): ClassGenerationRequest {
  return {
    endpoint: entry.endpoint,
    method: entry.method,
    application: entry.application,
    className: entry.className,
    contentType: entry.contentType,
    bodySchema: entry.requestBodySchema,
    fieldConfigurations: (entry.fields || []).map(f => ({
      name: f.fieldName,
      type: f.fieldType,
      required: f.mandatory,
      dataMethod: f.dataMethod,
      dataMethodArgs: f.dataMethodArgs,
      location: f.location,
    })),
  };
}

/**
 * Generate every class in `entries`. A class with an unassigned mandatory field is left **pending**
 * (amber) — not generated; the rest are rendered via `emitter`. A render error is captured on that class
 * (red) and never aborts the batch. The language is whatever `emitter` targets (C# or TypeScript).
 */
export function generateClassLibrary(entries: ApiClassLibraryDto[], emitter: CodeEmitter): BatchGenerateResult {
  const perClass: ClassGenerationOutcome[] = (entries || []).map(entry => {
    const base = { endpointId: entry.endpointId, className: entry.className };
    if (hasUnassignedMandatory(entry.fields)) {
      return { ...base, state: 'pending' as const };
    }
    try {
      const code = emitter.emitRequestClass(toClassGenerationRequest(entry));
      return code == null
        ? { ...base, state: 'empty' as const }
        : { ...base, state: 'generated' as const, code };
    } catch (e) {
      return { ...base, state: 'error' as const, error: e instanceof Error ? e.message : String(e) };
    }
  });
  return {
    perClass,
    generated: perClass.filter(c => c.state === 'generated').length,
    pending: perClass.filter(c => c.state === 'pending').length,
    errored: perClass.filter(c => c.state === 'error').length,
  };
}
