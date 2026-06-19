import { E2EPage, E2ETestCaseRow, E2ECaseItem, TestFramework, E2EGenContext } from '../models/E2EDto';

/**
 * E2E test generation — turns an explicit, user-authored chain (E2ECaseItem[]) into a
 * framework-correct, compilable C# test file. Send methods pair with the Class row directly below
 * them (the class supplies URL + body / {placeholder} values). Shared across editions.
 */

interface GenState { lastResponse: string | null }

/** PascalCase, identifier-safe test method name from a free-text case name. */
export function methodName(name: string): string {
  const cleaned = (name || 'TestCase').replace(/[^a-zA-Z0-9]+/g, ' ').trim()
    .split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
  return /^[a-zA-Z]/.test(cleaned) ? cleaned : `Test${cleaned}`;
}

const attrFor = (f: TestFramework) => (f === 'NUnit' ? '[Test]' : f === 'xUnit' ? '[Fact]' : '[TestMethod]');
const assertTrue = (f: TestFramework, expr: string) => (f === 'xUnit' ? `Assert.True(${expr});` : `Assert.IsTrue(${expr});`);
const isAsync = (returnType: string) => /^task\b|^task</i.test((returnType || '').trim());
const returnsResponse = (returnType: string) => /httpresponsemessage/i.test(returnType || '');
const returnsBool = (returnType: string) => /\bbool\b/i.test(returnType || '');
const cleanEndpoint = (e: string) => (e || '').replace(/\s*\([A-Za-z]+\)\s*$/, '').trim();

const producedVar = (item: E2ECaseItem, n: number) =>
  item.assignTo?.trim() || (item.type === 'Class' ? `response${n}` : `result${n}`);

function urlExpr(endpoint: string, n: number, bindVar?: string): string {
  if (bindVar && /\{[^}]+\}/.test(endpoint)) {
    const [before, after = ''] = endpoint.split(/\{[^}]+\}/);
    let expr = `baseUrl + "${before}" + ${bindVar}`;
    if (after) expr += ` + "${after}"`;
    return expr;
  }
  return `baseUrl + "${endpoint}"`;
}

function classStep(item: E2ECaseItem, n: number, ctx: E2EGenContext, state: GenState, lines: string[]): void {
  const cls = ctx.classes.find((c: any) => c.className === item.ref);
  const endpoint = cleanEndpoint(cls?.endpoint || '/');
  const httpMethod = (cls?.method || 'POST').toUpperCase();
  const isForm = /x-www-form-urlencoded/i.test(cls?.contentType || '');
  const respVar = producedVar(item, n);

  lines.push(`        // Step ${n}: ${item.ref} (${httpMethod} ${endpoint})`);
  lines.push(`        var url${n} = ${urlExpr(endpoint, n, item.pathBindVariable)};`);

  if (httpMethod === 'GET') {
    lines.push(`        var ${respVar} = await GetAsync<object>(token, url${n});`);
  } else if (httpMethod === 'DELETE') {
    lines.push(`        var ${respVar} = await DeleteAsync(token, url${n});`);
    state.lastResponse = respVar;
  } else {
    lines.push(`        var request${n} = new ${item.ref}();`);
    const call =
      httpMethod === 'PUT' ? `await PutJsonAsync(token, url${n}, request${n}.ToJson())`
      : isForm ? `await PostFormAsync(token, url${n}, request${n}.ToFormBody())`
      : `await PostJsonAsync(token, url${n}, request${n}.ToJson())`;
    lines.push(`        var ${respVar} = ${call};`);
    state.lastResponse = respVar;
  }
}

function argExpr(a?: { value: string; isVariable?: boolean }): string | null {
  if (!a || !a.value) return null;
  return a.isVariable ? a.value : JSON.stringify(a.value);
}

function placeholdersIn(endpoint: string): string[] {
  return [...endpoint.matchAll(/\{([^}]+)\}/g)].map(m => m[1]);
}

function buildUrlWithPathArgs(endpoint: string, classItem?: E2ECaseItem): string {
  const parts = endpoint.split(/(\{[^}]+\})/).filter(p => p.length > 0);
  let expr = 'baseUrl';
  for (const part of parts) {
    const m = part.match(/^\{([^}]+)\}$/);
    expr += m ? ` + ${argExpr(classItem?.args?.[m[1]]) || `/* ${m[1]} */`}` : ` + "${part}"`;
  }
  return expr;
}

function classPlaceholderExpr(classItem: E2ECaseItem | undefined, ctx: E2EGenContext): string | null {
  if (!classItem) return null;
  const ep = cleanEndpoint(ctx.classes.find((x: any) => x.className === classItem.ref)?.endpoint || '');
  const names = placeholdersIn(ep);
  if (!names.length) return null;
  return argExpr(classItem.args?.[names[0]]) || `/* ${names[0]} */`;
}

function methodTakesUrl(ref: string, ctx: E2EGenContext): boolean {
  const m = ctx.methods.find((x: any) => x.methodName === ref);
  return (m?.parameters || '').toLowerCase().includes('url');
}

function resolveArg(param: string, item: E2ECaseItem, state: GenState, ctx: E2EGenContext, pairedClass?: E2ECaseItem): string {
  const lp = param.toLowerCase();
  if (lp.includes('token')) return 'token';
  if (lp === 'response') return item.responseVar || state.lastResponse || `/* ${param} */`;
  if (lp.includes('url')) {
    const cn = pairedClass?.ref || item.classRef;
    const ep = cn
      ? cleanEndpoint(ctx.classes.find((x: any) => x.className === cn)?.endpoint || '')
      : (item.endpoint || '');
    if (!lp.includes('template') && /\{[^}]+\}/.test(ep)) return buildUrlWithPathArgs(ep, pairedClass);
    return `baseUrl + "${ep}"`;
  }
  if (lp.includes('body')) {
    const cn = pairedClass?.ref || item.classRef || item.bodyClass;
    if (!cn) return `/* ${param} */`;
    const c = ctx.classes.find((x: any) => x.className === cn);
    const isForm = lp.includes('formbody') || /x-www-form-urlencoded/i.test(c?.contentType || '');
    return `new ${cn}().${isForm ? 'ToFormBody' : 'ToJson'}()`;
  }
  const a = item.args?.[param];
  if (a && a.value) return a.isVariable ? a.value : JSON.stringify(a.value);
  return `/* ${param} */`;
}

function methodStep(item: E2ECaseItem, n: number, f: TestFramework, ctx: E2EGenContext, state: GenState, lines: string[], pairedClass?: E2ECaseItem): void {
  const m = ctx.methods.find((x: any) => x.methodName === item.ref);
  const params: string[] = (m?.parameters || '')
    .split(',').map((p: string) => p.trim()).filter(Boolean).map((p: string) => p.split(':')[0].trim());
  const hasUrlTemplate = params.some((p: string) => { const lp = p.toLowerCase(); return lp.includes('url') && lp.includes('template'); });
  const phExpr = classPlaceholderExpr(pairedClass, ctx);
  const args = params.map((p: string) =>
    (p.toLowerCase() === 'value' && hasUrlTemplate && phExpr) ? phExpr : resolveArg(p, item, state, ctx, pairedClass));
  const call = `${item.ref}(${args.join(', ')})`;
  const awaited = isAsync(m?.returnType) ? 'await ' : '';

  lines.push(`        // Step ${n}: ${item.ref}`);
  if (/^validate/i.test(item.ref) && returnsBool(m?.returnType)) {
    lines.push(`        ${assertTrue(f, `${awaited}${call}`)}`);
  } else {
    const resultVar = producedVar(item, n);
    lines.push(`        var ${resultVar} = ${awaited}${call};`);
    if (returnsResponse(m?.returnType)) state.lastResponse = resultVar;
  }
}

/** Generate a framework-correct, compilable C# test file from one ordered E2E chain. */
export function generateTestForRow(row: E2ETestCaseRow, page: E2EPage, ctx: E2EGenContext): string {
  const f = page.framework;
  const tokenObj = ctx.methods.find((m: any) => m.methodName === page.token);
  const tokenLine = isAsync(tokenObj?.returnType)
    ? `        var token = await ${page.token}();`
    : `        var token = ${page.token}();`;

  const state: GenState = { lastResponse: null };
  const steps: string[] = [];
  const items = row.items || [];

  const consumed = new Set<number>();
  items.forEach((item, i) => {
    if (item.type === 'Method' && methodTakesUrl(item.ref, ctx) && items[i + 1]?.type === 'Class') {
      consumed.add(i + 1);
    }
  });

  let n = 0;
  items.forEach((item, i) => {
    if (item.type === 'Class') {
      if (consumed.has(i)) return;
      n += 1;
      classStep(item, n, ctx, state, steps);
    } else {
      n += 1;
      const next = items[i + 1];
      const pairedClass = methodTakesUrl(item.ref, ctx) && next?.type === 'Class' ? next : undefined;
      methodStep(item, n, f, ctx, state, steps, pairedClass);
    }
    steps.push('');
  });

  while (steps.length && steps[steps.length - 1] === '') steps.pop();

  const fwUsing = f === 'NUnit' ? 'using NUnit.Framework;'
    : f === 'xUnit' ? 'using Xunit;'
    : 'using Microsoft.VisualStudio.TestTools.UnitTesting;';
  const classAttr = f === 'NUnit' ? '[TestFixture]' : f === 'xUnit' ? '' : '[TestClass]';

  const methodBlock = [
    `    ${attrFor(f)}`,
    `    public async Task ${methodName(row.name)}()`,
    `    {`,
    `        var baseUrl = ${page.basePath}();`,
    tokenLine,
    ``,
    ...steps,
    `    }`,
  ];
  const nested = methodBlock.map(l => (l ? '    ' + l : l));

  return [
    'using System;',
    'using System.Net.Http;',
    'using System.Threading.Tasks;',
    fwUsing,
    '',
    'namespace ApiTests',
    '{',
    ...(classAttr ? [`    ${classAttr}`] : []),
    `    public class ${methodName(row.name)}Tests`,
    '    {',
    ...nested,
    '    }',
    '}',
  ].join('\n');
}
