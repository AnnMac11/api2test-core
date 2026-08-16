/**
 * PY-GEN-1 — Python counterpart to {@link generateE2ETestTypeScript}. Turns one ordered E2E chain
 * (`E2ECaseItem[]`) into a runnable **pytest** test.
 *
 * Class-first model (same as C#/TS): a Class step IS the call and the send verb is derived from the
 * class's own HTTP method + content-type — `post_json_async`/`put_json_async`/`get_async`/
 * `delete_async`/`post_form_async` (the curated Python send vocabulary). Following Method steps
 * attach as extract/validate/curated calls. Helpers are called `api_methods.<snake_case>(…)`; names
 * go through {@link pySymbol}. The file bootstraps sys.path like the single-test emitter.
 *
 * Python-specific: URL concatenation wraps bound variables in `str()` (Python does not coerce), and
 * a class override becomes attribute-assignment statements after construction (`request1.name = …`,
 * or `setattr(request1, "pet-id", …)` for a non-identifier key — the OVR-CASE rule the class emitter
 * uses).
 */
import { E2EPage, E2ETestCaseRow, E2ECaseItem, E2EGenContext } from '../models/E2EDto';
import { classesDir } from './generatedNamespaces';
import { pySymbol, isPyIdentifier } from './pyNaming';
import { mapCaptureType } from './e2eCaseLogic';
import { canonicalMethodName } from './e2eMethodSelection';

interface GenState { lastResponse: string | null }

/** snake_case, pytest-discoverable test function name from a free-text case name. */
export function e2eMethodNamePy(name: string): string {
  const cleaned = (name || 'test case').replace(/[^a-zA-Z0-9]+/g, ' ').trim()
    .split(/\s+/).map((w) => w.toLowerCase()).join('_');
  return `test_${cleaned || 'case'}`;
}

const returnsResponse = (rt?: string) => /response|httpresponsemessage/i.test(rt || '');
const returnsBool = (rt?: string) => /\bbool(ean)?\b/i.test(rt || '');
const cleanEndpoint = (e: string) => (e || '').replace(/\s*\([A-Za-z]+\)\s*$/, '').trim();
const placeholdersIn = (endpoint: string) => [...endpoint.matchAll(/\{([^}]+)\}/g)].map(m => m[1]);

const producedVar = (item: E2ECaseItem, n: number) =>
  item.assignTo?.trim() || (item.type === 'Class' ? `response${n}` : `result${n}`);

/** URL as string concatenation: `base_url + "/before" + str(bindVar) + "/after"`. */
function urlExpr(endpoint: string, bindVar?: string): string {
  if (bindVar && /\{[^}]+\}/.test(endpoint)) {
    const [before, after = ''] = endpoint.split(/\{[^}]+\}/);
    let expr = `base_url + ${JSON.stringify(before)} + str(${bindVar})`;
    if (after) { expr += ` + ${JSON.stringify(after)}`; }
    return expr;
  }
  return `base_url + ${JSON.stringify(endpoint)}`;
}

/** A path-arg expression: variables go through str() for concatenation, literals are already strings. */
function argExpr(a?: { value: string; isVariable?: boolean }): string | null {
  if (!a || !a.value) { return null; }
  return a.isVariable ? `str(${a.value})` : JSON.stringify(a.value);
}

function buildUrlWithPathArgs(endpoint: string, item?: E2ECaseItem): string {
  const parts = endpoint.split(/(\{[^}]+\})/).filter(p => p.length > 0);
  let expr = 'base_url';
  for (const part of parts) {
    const m = part.match(/^\{([^}]+)\}$/);
    expr += m ? ` + ${argExpr(item?.args?.[m[1]]) || `""  # ${m[1]}`}` : ` + ${JSON.stringify(part)}`;
  }
  return expr;
}

/**
 * Infer an attribute's value kind from the generated Python class code (the __init__ default).
 * Defaults to string — same fallback the TS emitter uses when the class declares nothing.
 */
function pyTypeOf(classCode: string, prop: string): string {
  const escaped = prop.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
  const m = (classCode || '').match(new RegExp(`(?:self\\.${escaped}\\s*=|setattr\\(self,\\s*"${escaped}",)\\s*([^\\n)]+)`));
  if (!m) { return 'string'; }
  const expr = m[1].trim();
  if (/^(True|False)\b/.test(expr)) { return 'boolean'; }
  if (/^-?\d+(\.\d+)?\b/.test(expr)) { return 'number'; }
  return 'string';
}

function overrideValue(v: { value: string; isVariable?: boolean }, type: string): string {
  if (v.isVariable) { return v.value; }
  const t = (type || '').toLowerCase();
  if (t === 'boolean') { return /^true$/i.test(v.value.trim()) ? 'True' : 'False'; }
  if (t === 'number') { return v.value.trim(); }
  return JSON.stringify(v.value);
}

/**
 * Construction + override statements for a Class step: `request1 = Ref()` followed by one attribute
 * assignment per pinned field (OVR-CASE: setattr for a non-identifier key, matching the class emitter).
 */
function classConstruct(varName: string, ref: string, item: E2ECaseItem | undefined, ctx: E2EGenContext): string[] {
  const code = (ctx.classes.find((c: any) => c.className === ref)?.classCode) || '';
  const lines = [`    ${varName} = ${ref}()`];
  for (const [field, v] of Object.entries(item?.overrides || {})) {
    if (!v || v.value === '' || v.value == null) { continue; }
    const value = overrideValue(v as any, pyTypeOf(code, field));
    lines.push(isPyIdentifier(field)
      ? `    ${varName}.${field} = ${value}`
      : `    setattr(${varName}, ${JSON.stringify(field)}, ${value})`);
  }
  return lines;
}

/** The send helper for a class step's verb + content-type (the derived class-first send). */
function sendFor(httpMethod: string, isForm: boolean): { name: string; hasBody: boolean } {
  switch (httpMethod) {
    case 'GET': return { name: 'get_async', hasBody: false };
    case 'DELETE': return { name: 'delete_async', hasBody: false };
    case 'PUT': return { name: isForm ? 'put_form_async' : 'put_json_async', hasBody: true };
    case 'POST': default: return { name: isForm ? 'post_form_async' : 'post_json_async', hasBody: true };
  }
}

function classStep(item: E2ECaseItem, n: number, ctx: E2EGenContext, state: GenState, lines: string[]): void {
  const cls = ctx.classes.find((c: any) => c.className === item.ref);
  const endpoint = cleanEndpoint(cls?.endpoint || '/');
  const httpMethod = (cls?.method || 'POST').toUpperCase();
  const isForm = /x-www-form-urlencoded/i.test(cls?.contentType || '');
  const respVar = producedVar(item, n);

  const hasPlaceholders = /\{[^}]+\}/.test(endpoint);
  const url = hasPlaceholders && placeholdersIn(endpoint).some(name => item.args?.[name]?.value)
    ? buildUrlWithPathArgs(endpoint, item)
    : urlExpr(endpoint, item.pathBindVariable);

  const send = sendFor(httpMethod, isForm);
  lines.push(`    # Step ${n}: ${item.ref} (${httpMethod} ${endpoint})`);
  lines.push(`    url${n} = ${url}`);

  if (!send.hasBody) {
    lines.push(`    ${respVar} = api_methods.${send.name}(token, url${n})`);
  } else {
    const serializer = isForm ? 'to_form_body' : 'to_json';
    lines.push(...classConstruct(`request${n}`, item.ref, item, ctx));
    lines.push(`    ${respVar} = api_methods.${send.name}(token, url${n}, request${n}.${serializer}())`);
  }
  state.lastResponse = respVar;

  emitCaptures(item, respVar, lines);
}

/**
 * OUT captures (E2E-CAP-1): one `extract_field_async(resp, field, type)` line per typed row,
 * converting to the user's chosen store-as type ({@link mapCaptureType} with the 'python' column).
 * Falls back to the legacy single untyped `capture` (str) when no typed rows are present.
 */
function emitCaptures(item: E2ECaseItem, respVar: string, lines: string[]): void {
  const rows = item.captures || [];
  if (rows.length) {
    for (const c of rows) {
      const variable = c?.variable?.trim();
      if (!variable || !c.fieldPath?.trim()) { continue; }
      const type = mapCaptureType(c.type, 'python');
      lines.push(`    ${variable} = api_methods.extract_field_async(${respVar}, ${JSON.stringify(c.fieldPath.trim())}, ${JSON.stringify(type)})`);
    }
    return;
  }
  if (item.capture?.fieldPath && item.capture.variable) {
    lines.push(`    ${item.capture.variable} = api_methods.extract_field_async(${respVar}, ${JSON.stringify(item.capture.fieldPath)})`);
  }
}

function resolveArg(param: string, item: E2ECaseItem, state: GenState, ctx: E2EGenContext, lines: string[], n: number, pairedClass?: E2ECaseItem): string {
  const lp = param.toLowerCase();
  if (lp.includes('token')) { return 'token'; }
  if (lp === 'response') { return item.responseVar || state.lastResponse || `None  # ${param}`; }
  if (lp.includes('url')) {
    const cn = pairedClass?.ref || item.classRef;
    const ep = cn ? cleanEndpoint(ctx.classes.find((x: any) => x.className === cn)?.endpoint || '') : (item.endpoint || '');
    if (!lp.includes('template') && /\{[^}]+\}/.test(ep)) { return buildUrlWithPathArgs(ep, pairedClass); }
    return `base_url + ${JSON.stringify(ep)}`;
  }
  if (lp.includes('body')) {
    const cn = pairedClass?.ref || item.classRef || item.bodyClass;
    if (!cn) { return `None  # ${param}`; }
    const c = ctx.classes.find((x: any) => x.className === cn);
    const isForm = lp.includes('formbody') || /x-www-form-urlencoded/i.test(c?.contentType || '');
    // The paired class's construction (+ overrides) is emitted as statements before the call.
    lines.push(...classConstruct(`request${n}`, cn, pairedClass, ctx));
    return `request${n}.${isForm ? 'to_form_body' : 'to_json'}()`;
  }
  const a = item.args?.[param];
  if (a && a.value) { return a.isVariable ? a.value : JSON.stringify(a.value); }
  return `None  # ${param}`;
}

function methodStep(item: E2ECaseItem, n: number, ctx: E2EGenContext, state: GenState, lines: string[], pairedClass?: E2ECaseItem): void {
  // A case saved before the NAME-1 rename stores the old method name; core translates it so the step
  // still resolves to a library method and the generated call uses the name that exists today.
  const ref = canonicalMethodName(item.ref);
  const m = ctx.methods.find((x: any) => x.methodName === ref);
  const params: string[] = (m?.parameters || '')
    .split(',').map((p: string) => p.trim()).filter(Boolean).map((p: string) => p.split(':')[0].trim());
  lines.push(`    # Step ${n}: ${ref}`);
  const args = params.map((p: string) => resolveArg(p, item, state, ctx, lines, n, pairedClass));
  const resultVar = producedVar(item, n);
  const call = `api_methods.${pySymbol(ref)}(${args.join(', ')})`;

  if (/^validate/i.test(ref) && returnsBool(m?.returnType)) {
    lines.push(`    assert ${call}`);
  } else {
    lines.push(`    ${resultVar} = ${call}`);
    if (returnsResponse(m?.returnType)) { state.lastResponse = resultVar; }
  }
}

function methodTakesUrl(ref: string, ctx: E2EGenContext): boolean {
  const m = ctx.methods.find((x: any) => x.methodName === ref);
  return (m?.parameters || '').toLowerCase().includes('url');
}

/** Generate a runnable pytest test file from one ordered E2E chain. */
export function generateE2ETestPython(row: E2ETestCaseRow, page: E2EPage, ctx: E2EGenContext): string {
  const state: GenState = { lastResponse: null };
  const items = row.items || [];

  // A Method step that takes a url consumes the Class step directly below it (paired) — the class
  // supplies url + body, so it isn't emitted as its own call.
  const consumed = new Set<number>();
  items.forEach((item, i) => {
    if (item.type === 'Method' && methodTakesUrl(item.ref, ctx) && items[i + 1]?.type === 'Class') { consumed.add(i + 1); }
  });

  const steps: string[] = [];
  let n = 0;
  items.forEach((item, i) => {
    if (item.type === 'Class') {
      if (consumed.has(i)) { return; }
      n += 1;
      classStep(item, n, ctx, state, steps);
    } else {
      n += 1;
      const next = items[i + 1];
      const pairedClass = methodTakesUrl(item.ref, ctx) && next?.type === 'Class' ? next : undefined;
      methodStep(item, n, ctx, state, steps, pairedClass);
    }
    steps.push('');
  });
  while (steps.length && steps[steps.length - 1] === '') { steps.pop(); }

  // Imports: api_methods + every referenced request class, from the deploy layout.
  const classRefs = new Set<string>();
  for (const it of items) {
    if (it.type === 'Class') { classRefs.add(it.ref); }
    if (it.classRef) { classRefs.add(it.classRef); }
    if (it.bodyClass) { classRefs.add(it.bodyClass); }
  }
  const pkg = classesDir(page.application).split('/').filter(Boolean).join('.');
  const imports = [
    'import os',
    'import sys',
    '',
    'sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))',
    '',
    'from Libraries import api_methods  # noqa: E402',
    ...[...classRefs].map(c => `from ${pkg}.${c} import ${c}  # noqa: E402`),
  ];

  // Both header methods are library refs, so both take the pre-rename translation (see the C# emitter).
  const baseRef = canonicalMethodName(page.basePath);
  const tokenRef = canonicalMethodName(page.token);

  return `# Auto-generated by API2Test. Do not edit by hand.
${imports.join('\n')}


def ${e2eMethodNamePy(row.name)}():
    """${(row.name || 'runs the chain').replace(/"/g, "'")}"""
    base_url = api_methods.${pySymbol(baseRef)}()
    token = api_methods.${pySymbol(tokenRef)}()

${steps.join('\n')}
`;
}
