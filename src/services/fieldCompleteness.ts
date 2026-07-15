import { NOT_ASSIGNED } from './DataDictionaryService';

/**
 * Field-completeness rules — the single source of truth (shared across editions) for deciding whether a
 * class can be generated cleanly: every mandatory field must have a data method assigned. A class with an
 * unassigned mandatory field is incomplete, and this is what drives the amber ("pending") vs green
 * ("generated") state and the Class-Generation dialog's landing tab.
 */

/** A field with enough shape to judge mandatory-ness and whether a data method is assigned. Tolerates the
 *  several field shapes across the codebase (`isRequired`/`required`/`mandatory`). */
export interface CompletableField {
  isRequired?: boolean;
  required?: boolean;
  mandatory?: boolean;
  dataMethod?: string;
  [k: string]: any;
}

/** Values that mean "no data method assigned": blank, or a Not-Assigned sentinel (either casing). */
const UNASSIGNED = new Set<string>(['', NOT_ASSIGNED, 'NOT_ASSIGNED']);

/** True when the field is required/mandatory. */
export function isMandatoryField(f: CompletableField): boolean {
  return !!(f.isRequired ?? f.required ?? f.mandatory ?? false);
}

/** True when the field has no data method assigned (blank or a Not-Assigned sentinel). */
export function isDataMethodUnassigned(f: CompletableField): boolean {
  const m = f.dataMethod;
  return !m || UNASSIGNED.has(m);
}

/** True when any mandatory field has no data method — the signal that the class is not generatable yet
 *  (open the dialog on Field Configuration instead of generating straight away). */
export function hasUnassignedMandatory(fields: CompletableField[]): boolean {
  return (fields || []).some(f => isMandatoryField(f) && isDataMethodUnassigned(f));
}
