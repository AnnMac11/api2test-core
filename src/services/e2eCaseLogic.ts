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
    if (s.capture?.variable) vars.push(s.capture.variable);
  });
  return [...new Set(vars.filter(Boolean))];
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
      // A consumed class with {placeholders} must map each one to a captured variable.
      if (isConsumedClass(items, methodParams, i)) {
        for (const name of placeholdersOf(classItems, it.ref)) {
          if (!it.args?.[name]?.value?.trim()) {
            return `Step ${i + 1} (${it.ref}) needs a variable for the URL placeholder {${name}}.`;
          }
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
