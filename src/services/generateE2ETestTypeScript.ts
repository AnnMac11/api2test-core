/**
 * TS-C7 — TypeScript counterpart to {@link generateTestForRow}. Turns one ordered E2E chain
 * (`E2ECaseItem[]`) into a runnable **Vitest** test.
 *
 * Class-first model (mirrors Desktop DEVELOPER_MANUAL §3.1a): a Class step IS the call and the send verb
 * is derived from the class's own HTTP method + content-type — `postJson`/`putJson`/`get`/`delete`/`postForm`
 * (the TS-C8 send-helper vocabulary). Following Method steps attach as extract/validate/curated calls.
 *
 * Helpers are called `ApiMethods.<idiomatic>(…)` (no C# `using static`); names go through {@link tsSymbol}.
 * Imports are relative paths from `Tests/<App>/` (same strategy as TS-C6).
 *
 * Deferred (follow-up): the C# typed native-type extract (`ExtractField<T>` look-ahead) — TS emits the
 * plain `extractFieldFromResponse` (string). See TASKS.md TS-C7.
 */
import { E2EPage, E2ETestCaseRow, E2ECaseItem, E2EGenContext } from '../models/E2EDto';
import { librariesDir, classesDir, testsDir } from './generatedNamespaces';
import { tsSymbol } from './tsNaming';

interface GenState { lastResponse: string | null }

/** camelCase, identifier-safe test function name from a free-text case name. */
export function e2eMethodNameTs(name: string): string {
  const cleaned = (name || 'testCase').replace(/[^a-zA-Z0-9]+/g, ' ').trim()
    .split(/\s+/).map((w, i) => i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w.charAt(0).toUpperCase() + w.slice(1)).join('');
  return /^[a-zA-Z]/.test(cleaned) ? cleaned : `test${cleaned}`;
}

const isAsync = (returnType: string) => /promise|task/i.test((returnType || '').trim());
const returnsResponse = (rt: string) => /response|httpresponsemessage/i.test(rt || '');
const returnsBool = (rt: string) => /\bbool(ean)?\b/i.test(rt || '');
const cleanEndpoint = (e: string) => (e || '').replace(/\s*\([A-Za-z]+\)\s*$/, '').trim();
const placeholdersIn = (endpoint: string) => [...endpoint.matchAll(/\{([^}]+)\}/g)].map(m => m[1]);

const producedVar = (item: E2ECaseItem, n: number) =>
  item.assignTo?.trim() || (item.type === 'Class' ? `response${n}` : `result${n}`);

/** URL as string concatenation: `baseUrl + "/before" + bindVar + "/after"`. */
function urlExpr(endpoint: string, bindVar?: string): string {
  if (bindVar && /\{[^}]+\}/.test(endpoint)) {
    const [before, after = ''] = endpoint.split(/\{[^}]+\}/);
    let expr = `baseUrl + ${JSON.stringify(before)} + ${bindVar}`;
    if (after) { expr += ` + ${JSON.stringify(after)}`; }
    return expr;
  }
  return `baseUrl + ${JSON.stringify(endpoint)}`;
}

function argExpr(a?: { value: string; isVariable?: boolean }): string | null {
  if (!a || !a.value) { return null; }
  return a.isVariable ? a.value : JSON.stringify(a.value);
}

function buildUrlWithPathArgs(endpoint: string, item?: E2ECaseItem): string {
  const parts = endpoint.split(/(\{[^}]+\})/).filter(p => p.length > 0);
  let expr = 'baseUrl';
  for (const part of parts) {
    const m = part.match(/^\{([^}]+)\}$/);
    expr += m ? ` + ${argExpr(item?.args?.[m[1]]) || `/* ${m[1]} */`}` : ` + ${JSON.stringify(part)}`;
  }
  return expr;
}

/** Find a property's declared TS type in the generated class code (defaults to string). */
function tsTypeOf(classCode: string, prop: string): string {
  const m = (classCode || '').match(new RegExp(`\\b${prop}\\s*[?!]?\\s*:\\s*([A-Za-z]+)`));
  return m ? m[1] : 'string';
}

function overrideValue(v: { value: string; isVariable?: boolean }, type: string): string {
  if (v.isVariable) { return v.value; }
  const t = (type || '').toLowerCase();
  if (t === 'boolean') { return /^true$/i.test(v.value.trim()) ? 'true' : 'false'; }
  if (t === 'number') { return v.value.trim(); }
  return JSON.stringify(v.value);
}

/** `Object.assign(new Ref(), { prop: value, … })` from a Class step's overrides — else `new Ref()`. */
function classConstruct(ref: string, item: E2ECaseItem | undefined, ctx: E2EGenContext): string {
  const ov = item?.overrides;
  const code = (ctx.classes.find((c: any) => c.className === ref)?.classCode) || '';
  const parts = Object.entries(ov || {})
    .filter(([, v]) => v && v.value !== '' && v.value != null)
    .map(([prop, v]) => `${prop}: ${overrideValue(v as any, tsTypeOf(code, prop))}`);
  return parts.length ? `Object.assign(new ${ref}(), { ${parts.join(', ')} })` : `new ${ref}()`;
}

/** The send helper for a class step's verb + content-type (the derived class-first send). */
function sendFor(httpMethod: string, isForm: boolean): { name: string; hasBody: boolean } {
  switch (httpMethod) {
    case 'GET': return { name: 'get', hasBody: false };
    case 'DELETE': return { name: 'delete', hasBody: false };
    case 'PUT': return { name: 'putJson', hasBody: true };
    case 'POST': default: return { name: isForm ? 'postForm' : 'postJson', hasBody: true };
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
  lines.push(`    // Step ${n}: ${item.ref} (${httpMethod} ${endpoint})`);
  lines.push(`    const url${n} = ${url};`);

  if (!send.hasBody) {
    lines.push(`    const ${respVar} = await ApiMethods.${send.name}(token, url${n});`);
  } else {
    const serializer = isForm ? 'toFormBody' : 'toJson';
    lines.push(`    const request${n} = ${classConstruct(item.ref, item, ctx)};`);
    lines.push(`    const ${respVar} = await ApiMethods.${send.name}(token, url${n}, request${n}.${serializer}());`);
  }
  state.lastResponse = respVar;

  if (item.capture?.fieldPath && item.capture.variable) {
    lines.push(`    const ${item.capture.variable} = await ApiMethods.extractFieldFromResponse(${respVar}, ${JSON.stringify(item.capture.fieldPath)});`);
  }
}

function resolveArg(param: string, item: E2ECaseItem, state: GenState, ctx: E2EGenContext, pairedClass?: E2ECaseItem): string {
  const lp = param.toLowerCase();
  if (lp.includes('token')) { return 'token'; }
  if (lp === 'response') { return item.responseVar || state.lastResponse || `/* ${param} */`; }
  if (lp.includes('url')) {
    const cn = pairedClass?.ref || item.classRef;
    const ep = cn ? cleanEndpoint(ctx.classes.find((x: any) => x.className === cn)?.endpoint || '') : (item.endpoint || '');
    if (!lp.includes('template') && /\{[^}]+\}/.test(ep)) { return buildUrlWithPathArgs(ep, pairedClass); }
    return `baseUrl + ${JSON.stringify(ep)}`;
  }
  if (lp.includes('body')) {
    const cn = pairedClass?.ref || item.classRef || item.bodyClass;
    if (!cn) { return `/* ${param} */`; }
    const c = ctx.classes.find((x: any) => x.className === cn);
    const isForm = lp.includes('formbody') || /x-www-form-urlencoded/i.test(c?.contentType || '');
    return `${classConstruct(cn, pairedClass, ctx)}.${isForm ? 'toFormBody' : 'toJson'}()`;
  }
  const a = item.args?.[param];
  if (a && a.value) { return a.isVariable ? a.value : JSON.stringify(a.value); }
  return `/* ${param} */`;
}

function methodStep(item: E2ECaseItem, n: number, ctx: E2EGenContext, state: GenState, lines: string[], pairedClass?: E2ECaseItem): void {
  const m = ctx.methods.find((x: any) => x.methodName === item.ref);
  const params: string[] = (m?.parameters || '')
    .split(',').map((p: string) => p.trim()).filter(Boolean).map((p: string) => p.split(':')[0].trim());
  const args = params.map((p: string) => resolveArg(p, item, state, ctx, pairedClass));
  const awaited = isAsync(m?.returnType) ? 'await ' : '';
  const resultVar = producedVar(item, n);
  const call = `ApiMethods.${tsSymbol(item.ref)}(${args.join(', ')})`;

  lines.push(`    // Step ${n}: ${item.ref}`);
  if (/^validate/i.test(item.ref) && returnsBool(m?.returnType)) {
    lines.push(`    expect(${awaited}${call}).toBe(true);`);
  } else {
    lines.push(`    const ${resultVar} = ${awaited}${call};`);
    if (returnsResponse(m?.returnType)) { state.lastResponse = resultVar; }
  }
}

function methodTakesUrl(ref: string, ctx: E2EGenContext): boolean {
  const m = ctx.methods.find((x: any) => x.methodName === ref);
  return (m?.parameters || '').toLowerCase().includes('url');
}

/** Generate a runnable Vitest test file from one ordered E2E chain. */
export function generateE2ETestTypeScript(row: E2ETestCaseRow, page: E2EPage, ctx: E2EGenContext): string {
  const state: GenState = { lastResponse: null };
  const items = row.items || [];

  // A Method step that takes a url consumes the Class step directly below it (paired) — the class supplies
  // url + body, so it isn't emitted as its own call.
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

  // Imports: ApiMethods + every referenced request class, by relative path from Tests/<App>/.
  const fromDir = testsDir(page.application);
  const classRefs = new Set<string>();
  for (const it of items) {
    if (it.type === 'Class') { classRefs.add(it.ref); }
    if (it.classRef) { classRefs.add(it.classRef); }
    if (it.bodyClass) { classRefs.add(it.bodyClass); }
  }
  const rel = (p: string) => '../'.repeat(fromDir.split('/').filter(Boolean).length) + p;
  const imports = [
    `import { describe, it, expect } from 'vitest';`,
    `import { ApiMethods } from '${rel(`${librariesDir()}/apiMethods`)}';`,
    ...[...classRefs].map(c => `import { ${c} } from '${rel(`${classesDir(page.application)}/${c}`)}';`),
  ];

  const tokenObj = ctx.methods.find((m: any) => m.methodName === page.token);
  const tokenCall = `ApiMethods.${tsSymbol(page.token)}()`;
  const tokenLine = isAsync(tokenObj?.returnType) ? `    const token = await ${tokenCall};` : `    const token = ${tokenCall};`;

  return `// Auto-generated by API2Test. Do not edit by hand.
${imports.join('\n')}

describe('${e2eMethodNameTs(row.name)}', () => {
  it('${(row.name || 'runs the chain').replace(/'/g, "\\'")}', async () => {
    const baseUrl = ApiMethods.${tsSymbol(page.basePath)}();
${tokenLine}

${steps.join('\n')}
  });
});
`;
}
