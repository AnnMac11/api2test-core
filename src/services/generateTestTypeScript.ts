/**
 * TS-C6 — TypeScript counterpart to {@link TestGenerationService.generateCode}. Emits a **Vitest** test
 * file (the C# MSTest/NUnit/xUnit split collapses to one framework in TS).
 *
 * It ties the other emitters together: it imports `ApiMethods` (TS-C3), `DataGenerator` (TS-C5) and the
 * request-body class (TS-C4), builds the URL + body, calls the wrapper, and asserts the response.
 *
 * Import strategy (the piece TS-C1 left open): tests live in `Tests/<App>/`, libraries in `Libraries/`,
 * request classes in `Classes/<App>/` — the same folder==namespace layout C# uses. Imports are RELATIVE
 * paths computed from those dirs (extensionless — Vitest's resolver handles it), so a deployed test
 * resolves its siblings with no tsconfig `paths` needed.
 *
 * Wrapper-call convention: `ApiMethods.method(token, url, requestBody)` — token first — mirroring the C#
 * emitter. The curated TS wrapper methods (TS-C8) MUST take that argument order.
 */
import { TestGenerationRequest } from './TestGenerationService';
import { NOT_ASSIGNED, PARAMETER } from './DataDictionaryService';
import { librariesDir, classesDir, testsDir } from './generatedNamespaces';
import { tsSymbol } from './tsNaming';

const hasBody = (method: string) => ['POST', 'PUT', 'PATCH'].includes((method || '').toUpperCase());
const isFormEncoded = (ct?: string) => (ct || '').toLowerCase().includes('x-www-form-urlencoded');
const paramVar = (name: string) => name.replace(/[{}]/g, '').replace(/[^A-Za-z0-9]/g, '');

/** Relative import specifier from `fromDir` (e.g. `Tests/PetStore`) to `toPath` (e.g. `Libraries/apiMethods`). */
function relImport(fromDir: string, toPath: string): string {
  const fromDepth = fromDir.split('/').filter(Boolean).length;
  return '../'.repeat(fromDepth) + toPath;
}

function resolveTestClassName(request: TestGenerationRequest): string {
  const raw = (request.testClassName || '').trim();
  if (raw) {
    const cleaned = raw.replace(/[^A-Za-z0-9]/g, '');
    if (cleaned) { return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned; }
  }
  return `${request.className}Tests`;
}

function paramDefault(type?: string): string {
  switch ((type || 'string').toLowerCase()) {
    case 'int': case 'integer': case 'decimal': case 'number': return '0';
    case 'bool': case 'boolean': return 'false';
    default: return "''";
  }
}

export function generateTestTypeScript(request: TestGenerationRequest): string {
  const cls = resolveTestClassName(request);
  const wrapper = request.wrapperClass || 'ApiMethods';
  const bodied = hasBody(request.method) && !!request.bodyClassName;

  // ── imports (relative to Tests/<App>/) ──
  const fromDir = testsDir(request.application);
  const imports: string[] = [
    `import { describe, it, expect } from 'vitest';`,
    `import { ${wrapper} } from '${relImport(fromDir, `${librariesDir()}/apiMethods`)}';`,
    `import { DataGenerator } from '${relImport(fromDir, `${librariesDir()}/dataGenerator`)}';`,
  ];
  if (bodied) {
    imports.push(`import { ${request.bodyClassName} } from '${relImport(fromDir, `${classesDir(request.application)}/${request.bodyClassName}`)}';`);
  }

  // ── getToken ──
  const tokenMethod = (request.tokenMethod || '').trim();
  const getToken = tokenMethod
    ? `  /** Returns a bearer token via the selected API Method Library provider. */
  async function getToken(): Promise<string> { return await ${wrapper}.${tsSymbol(tokenMethod)}(); }`
    : `  /**
   * Returns a bearer token for API authentication.
   * TODO: replace the placeholder with a real token call, e.g. return await ${wrapper}.getToken(clientId, clientSecret, tokenUrl);
   */
  async function getToken(): Promise<string> { return ''; }`;

  // ── Arrange/Act ──
  const arrange: string[] = [];
  arrange.push('    // Arrange');
  arrange.push('    const token = await getToken();');

  for (const p of [...(request.pathParams || []), ...(request.queryParams || [])]) {
    const v = paramVar(p.name);
    if (p.dataMethod && p.dataMethod !== NOT_ASSIGNED && p.dataMethod !== PARAMETER) {
      const args = (p.dataMethodArgs || '').trim();
      arrange.push(`    const ${v} = new DataGenerator().${tsSymbol(p.dataMethod)}(${args});`);
    } else {
      const note = p.dataMethod === PARAMETER ? 'parameter — value supplied at runtime' : 'TODO: set value';
      arrange.push(`    const ${v} = ${paramDefault(p.type)}; // ${note}`);
    }
  }

  const endpointInterp = (request.endpoint || '').replace(/\{([^}]+)\}/g, (_m, p) => `\${${paramVar(p)}}`);
  const query = (request.queryParams || [])
    .map((p, i) => `${i === 0 ? '?' : '&'}${p.name}=\${${paramVar(p.name)}}`)
    .join('');
  arrange.push(`    const url = \`\${baseUrl()}${endpointInterp}${query}\`;`);

  if (bodied) {
    const serializer = isFormEncoded(request.contentType) ? 'toFormBody' : 'toJson';
    arrange.push(`    const requestBody = new ${request.bodyClassName}().${serializer}();`);
    arrange.push('');
    arrange.push('    // Act');
    arrange.push(`    const response = await ${wrapper}.${tsSymbol(request.wrapperMethod)}(token, url, requestBody);`);
  } else {
    arrange.push('');
    arrange.push('    // Act');
    arrange.push(`    const response = await ${wrapper}.${tsSymbol(request.wrapperMethod)}(token, url);`);
  }

  // ── Assert ──
  const assert: string[] = [];
  assert.push('    // Assert');
  assert.push('    const content = await response.clone().text();');
  assert.push('    console.log(`[${response.status} ${response.statusText}] ${content}`);');
  const handler = (request.responseHandler || '').trim();
  if (handler) {
    const call = request.responseHandlerAsync ? `await ${wrapper}.${tsSymbol(handler)}(response)` : `${wrapper}.${tsSymbol(handler)}(response)`;
    assert.push(`    expect(${call}, \`Response check ${handler} failed (\${response.status}). Body: \${content}\`).toBe(true);`);
  } else {
    assert.push('    expect(response.ok, `Expected success but got ${response.status}. Body: ${content}`).toBe(true);');
    assert.push('    expect(content).toBeTruthy();');
  }

  return `// Auto-generated by API2Test. Do not edit by hand.
${imports.join('\n')}

describe('${cls}', () => {
  // Base URL comes from a Data Library method — change it once there to retarget environments.
  const baseUrl = (): string => new DataGenerator().${tsSymbol(request.basePathMethod || 'baseUrlMethod')}();

${getToken}

  it('${request.method} returns success', async () => {
${arrange.join('\n')}

${assert.join('\n')}
  });
});
`;
}
