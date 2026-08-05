/**
 * Pure composition rules for the E2E test-case builder.
 *
 * These functions decide how the ordered steps of a test case relate to one another — which
 * method consumes which class, what {placeholders} an endpoint needs, which variables are in
 * scope at a given step, and whether the whole composition is valid to save. They depend only
 * on plain data (the step list, the method-parameter map, the class picker items), never on the
 * DOM or React state, so they are unit-tested directly (see e2eCaseLogic.test.ts).
 *
 * E2ETestCaseDialog holds thin wrappers that bind these to its current props/state; keeping the
 * rules here means the builder's behaviour is covered by fast tests and can change safely.
 */
import type { E2ECaseItem } from '../models/E2EDto';

/** Minimal shape of a library picker item these rules read (className/method entry). */
export interface PickerLike {
  value: string;
  /** Sub-label: for a class, its endpoint "/path (METHOD)"; carries {placeholders}. */
  sub?: string;
  /** Meta: a class's request content-type. */
  meta?: string;
}

/** methodName -> its "name:type, name:type" parameter string. */
export type MethodParamMap = Record<string, string>;

/** Parameter names of a method (e.g. "token:string, url:string" -> ["token","url"]). */
export function paramsOf(methodParams: MethodParamMap, ref: string): string[] {
  return (methodParams[ref] || '').split(',').map(p => p.split(':')[0].trim()).filter(Boolean);
}

/** {placeholder} names in a class's endpoint — each needs a value (set on the class step). */
export function placeholdersOf(classItems: PickerLike[], classRef: string): string[] {
  const sub = classItems.find(c => c.value === classRef)?.sub || '';
  return [...sub.matchAll(/\{([^}]+)\}/g)].map(m => m[1]);
}

/** Does a method take a urlTemplate? Its `value` is the placeholder, sourced from the class step. */
export function takesUrlTemplate(methodParams: MethodParamMap, ref: string): boolean {
  return paramsOf(methodParams, ref).some(p => {
    const lp = p.toLowerCase();
    return lp.includes('url') && lp.includes('template');
  });
}

/** Does this method take a field/path parameter (i.e. it extracts from a response)? */
export function takesFieldPath(methodParams: MethodParamMap, ref: string): boolean {
  return paramsOf(methodParams, ref).some(p => {
    const lp = p.toLowerCase();
    return lp.includes('field') || lp.includes('path');
  });
}

/** A class step is "consumed" when a send method (one taking a url) sits directly above it. */
export function isConsumedClass(items: E2ECaseItem[], methodParams: MethodParamMap, idx: number): boolean {
  return idx > 0 && items[idx - 1]?.type === 'Method'
    && paramsOf(methodParams, items[idx - 1].ref).some(p => p.toLowerCase().includes('url'));
}

/** The endpoint key ("METHOD /path") of the response a step at idx reads — the nearest class above it. */
export function sourceEndpointKey(
  items: E2ECaseItem[],
  classItems: PickerLike[],
  idx: number,
): { key: string; endpoint: string; method?: string } | null {
  for (let j = idx - 1; j >= 0; j--) {
    if (items[j].type !== 'Class') continue;
    const sub = classItems.find(c => c.value === items[j].ref)?.sub || '';
    const m = sub.match(/^(.+?)\s*\(([A-Za-z]+)\)\s*$/);
    const endpoint = (m ? m[1] : sub).trim();
    const method = m ? m[2] : undefined;
    if (!endpoint) return null;
    return { key: `${method || ''} ${endpoint}`, endpoint, method };
  }
  return null;
}

/** Variables produced by earlier steps (each step's result + any capture variable). */
export function availableVarsBefore(items: E2ECaseItem[], idx: number): string[] {
  const vars: string[] = [];
  items.slice(0, idx).forEach((s, i) => {
    vars.push(s.assignTo?.trim() || (s.type === 'Class' ? `response${i + 1}` : `result${i + 1}`));
    if (s.capture?.variable) vars.push(s.capture.variable);            // legacy singular capture
    (s.captures || []).forEach(c => { if (c.variable?.trim()) vars.push(c.variable.trim()); }); // typed captures[] (E2E-CAP-1)
  });
  return [...new Set(vars.filter(Boolean))];
}

/** Is this Method a "send" — an HTTP wrapper that takes a `url`/`urlTemplate` param (starts a call-row)? */
export function isSendMethod(methodParams: MethodParamMap, ref: string): boolean {
  return paramsOf(methodParams, ref).some(p => p.toLowerCase().includes('url'));
}

/** Friendly, plain display labels for the library methods (display ONLY — the underlying method name that
 *  drives code generation is unchanged). Keeps the builder readable: "ExtractField", "Validate 400", … */
const METHOD_LABELS: Record<string, string> = {
  ExtractFieldFromResponse: 'ExtractFields',
  ExtractTokenFromResponse: 'ExtractToken',
  ValidateResponseAsync: 'Validate 200/201',
  ValidateDeleteResponseAsync: 'Validate 200/204',
  ValidateBadRequestResponseAsync: 'Validate 400',
  ValidateUnauthorizedResponseAsync: 'Validate 401',
  ValidateForbiddenResponseAsync: 'Validate 403',
  ValidateNotFoundResponseAsync: 'Validate 404',
  ValidateConflictResponseAsync: 'Validate 409',
  ValidateValidationErrorResponseAsync: 'Validate 422',
};
export function friendlyMethodName(ref: string): string {
  if (METHOD_LABELS[ref]) return METHOD_LABELS[ref];
  // Fallback for un-mapped methods: drop the noisy suffixes (…FromResponse / …ResponseAsync / …Async).
  return (ref || '').replace(/FromResponse$/, '').replace(/ResponseAsync$/, '').replace(/Async$/, '') || ref;
}

/**
 * OUT-capture store-as types (E2E-CAP-1). The builder offers ONE edition-agnostic list — `string` (default),
 * `number`, `bool`/`boolean`, `Guid` (no `object`/`array`, since captures feed URL `{}` parts and scalars) —
 * and core maps each to the concrete language type the emitter needs.
 *
 * `number` → C# `decimal` (holds large integer ids exactly, unlike `double` past 2^53, and renders cleanly
 * into a URL: `123`, not `123.0`) and TypeScript `number`. `Guid` has no distinct TS type, so it rides as
 * `string`. Anything already concrete (e.g. `long`, `int`, `decimal` from the Option-1 look-ahead) passes
 * through unchanged, so a power user's explicit type still works.
 */
export type CaptureLang = 'csharp' | 'typescript';
export function mapCaptureType(type: string | undefined, lang: CaptureLang): string {
  const t = (type || 'string').trim() || 'string';
  switch (t.toLowerCase()) {
    case 'number': return lang === 'csharp' ? 'decimal' : 'number';
    case 'bool':
    case 'boolean': return lang === 'csharp' ? 'bool' : 'boolean';
    case 'guid': return lang === 'csharp' ? 'Guid' : 'string';
    case 'string': return 'string';
    default: return t; // already a concrete language type — pass through untouched
  }
}

/** One call-row (#58): a send method + the class it sends (directly below) + follow-up extract/validate
 *  methods. Indices point into the flat `items` list; the layout groups them, the data model is unchanged. */
export interface CallGroup {
  /** item index of the send method, or null for an orphan class/method with no send above it. */
  sendIdx: number | null;
  /** item index of the class the send method sends, or null. */
  classIdx: number | null;
  /** item indices of the follow-up (extract/validate) methods attached to this call. */
  followIdxs: number[];
  /** every item index in this row, in order (send, class, follow-ups) — for move/remove. */
  allIdxs: number[];
}

/**
 * Group the flat steps into call-rows: each **send** method starts a row; the class directly below it and
 * any following non-send (extract/validate) methods attach to that row, until the next send method. A class
 * or method with no send above it becomes its own (orphan) row. Pure — unit-tested.
 */
export function groupIntoCalls(items: E2ECaseItem[], methodParams: MethodParamMap): CallGroup[] {
  const groups: CallGroup[] = [];
  let i = 0;
  while (i < items.length) {
    const it = items[i];
    if (it.type === 'Method' && isSendMethod(methodParams, it.ref)) {
      const g: CallGroup = { sendIdx: i, classIdx: null, followIdxs: [], allIdxs: [i] };
      let j = i + 1;
      if (items[j]?.type === 'Class') { g.classIdx = j; g.allIdxs.push(j); j++; }
      while (j < items.length && items[j].type === 'Method' && !isSendMethod(methodParams, items[j].ref)) {
        g.followIdxs.push(j); g.allIdxs.push(j); j++;
      }
      groups.push(g);
      i = j;
    } else if (it.type === 'Class') {
      // Class-led row (the In/Out model): the class IS the call; following non-send methods (extract /
      // validate = Out params) attach to it, until the next class or send.
      const g: CallGroup = { sendIdx: null, classIdx: i, followIdxs: [], allIdxs: [i] };
      let j = i + 1;
      while (j < items.length && items[j].type === 'Method' && !isSendMethod(methodParams, items[j].ref)) {
        g.followIdxs.push(j); g.allIdxs.push(j); j++;
      }
      groups.push(g);
      i = j;
    } else {
      // Orphan method with no class/send above it — its own row.
      groups.push({ sendIdx: null, classIdx: null, followIdxs: [i], allIdxs: [i] });
      i++;
    }
  }
  return groups;
}

/**
 * Does this step have an unset REQUIRED input? Drives auto-expanding a call-row and badging it "needs
 * input" so a required field (e.g. an extract's `fieldPath`, an unfilled class `{placeholder}`) is never
 * hidden behind the chevron. Mirrors the per-step checks in {@link validateSteps}.
 */
export function stepIncomplete(
  items: E2ECaseItem[],
  methodParams: MethodParamMap,
  classItems: PickerLike[],
  idx: number,
): boolean {
  const it = items[idx];
  if (!it) return false;
  if (it.type === 'Class') {
    // A class with URL {placeholders} always needs them bound — the class is the call (In/Out model),
    // whether or not a legacy send method sits above it.
    for (const name of placeholdersOf(classItems, it.ref)) {
      if (!it.args?.[name]?.value?.trim()) return true;
    }
    return false;
  }
  const params = paramsOf(methodParams, it.ref);
  const skipValue = takesUrlTemplate(methodParams, it.ref);
  for (const p of params) {
    const lp = p.toLowerCase();
    if (lp.includes('token') || lp.includes('url') || lp.includes('body') || lp === 'response') continue;
    if (skipValue && lp === 'value') continue;
    if (!it.args?.[p]?.value?.trim()) return true;
  }
  if (takesFieldPath(methodParams, it.ref) && !it.assignTo?.trim()) return true;
  return false;
}

/**
 * Validate the ordered steps of a test case. Returns the first error message (matching the
 * dialog's inline copy) or null when the steps are valid. Header/name checks stay in the dialog.
 */
export function validateSteps(
  items: E2ECaseItem[],
  methodParams: MethodParamMap,
  classItems: PickerLike[],
): string | null {
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.type === 'Class') {
      // A class with {placeholders} must bind each one (to a variable or literal) — the class is the
      // call (In/Out model), whether or not a legacy send method sits above it.
      for (const name of placeholdersOf(classItems, it.ref)) {
        if (!it.args?.[name]?.value?.trim()) {
          return `Step ${i + 1} (${it.ref}) needs a value for the URL placeholder {${name}}.`;
        }
      }
      continue;
    }
    const params = paramsOf(methodParams, it.ref);
    if (params.some(p => p.toLowerCase().includes('url')) && items[i + 1]?.type !== 'Class') {
      return `Step ${i + 1} (${it.ref}) needs a class step directly below it to supply its URL and body.`;
    }
    const skipValue = takesUrlTemplate(methodParams, it.ref); // value comes from the class placeholder
    for (const p of params) {
      const lp = p.toLowerCase();
      if (lp.includes('token') || lp.includes('url') || lp.includes('body') || lp === 'response') continue;
      if (skipValue && lp === 'value') continue;
      if (!it.args?.[p]?.value?.trim()) {
        return `Step ${i + 1} (${it.ref}) needs "${p}" set.`;
      }
    }
    // An extract step must name the variable it captures (so later steps can use it).
    if (takesFieldPath(methodParams, it.ref) && !it.assignTo?.trim()) {
      return `Step ${i + 1} (${it.ref}) needs a variable name (assign to).`;
    }
  }
  // Assigned variable names must be unique so chained steps reference the right value.
  const assigned = items.map(it => it.assignTo?.trim()).filter(Boolean) as string[];
  const dup = assigned.find((v, i) => assigned.indexOf(v) !== i);
  if (dup) return `Variable "${dup}" is assigned more than once — give each step a unique name.`;
  return null;
}
