/**
 * PY-GEN-1 — Python counterpart to {@link generateTestTypeScript}. Emits a **pytest** test file (the
 * C# MSTest/NUnit/xUnit split collapses to one framework in Python, same as TS→Vitest).
 *
 * It ties the other emitters together: it imports `api_methods`, `DataGenerator` and the request-body
 * class from the deploy layout, builds the URL + body, calls the wrapper, and asserts the response.
 *
 * Import strategy: tests live in `Tests/<App>/`, two levels below the deploy root, so the file first
 * bootstraps `sys.path` with the root and then imports `Libraries`/`Classes` as namespace packages
 * (Python 3.3+ — no __init__.py needed). Wrapper-call convention: `api_methods.method(token, url,
 * request_body)` — token first — mirroring the C#/TS emitters; names go through {@link pySymbol}.
 */
import { TestGenerationRequest } from './TestGenerationService';
import { NOT_ASSIGNED, PARAMETER } from './DataDictionaryService';
import { classesDir } from './generatedNamespaces';
import { pySymbol } from './pyNaming';

const hasBody = (method: string) => ['POST', 'PUT', 'PATCH'].includes((method || '').toUpperCase());
const isFormEncoded = (ct?: string) => (ct || '').toLowerCase().includes('x-www-form-urlencoded');
const paramVar = (name: string) => name.replace(/[{}]/g, '').replace(/[^A-Za-z0-9]/g, '');

function paramDefault(type?: string): string {
  switch ((type || 'string').toLowerCase()) {
    case 'int': case 'integer': case 'decimal': case 'number': return '0';
    case 'bool': case 'boolean': return 'False';
    default: return '""';
  }
}

export function generateTestPython(request: TestGenerationRequest): string {
  const bodied = hasBody(request.method) && !!request.bodyClassName;
  const queryParams = request.queryParams || [];

  // ── imports (sys.path bootstrap + deploy-layout packages) ──
  const imports: string[] = ['import os', 'import sys'];
  if (queryParams.length) { imports.push('import urllib.parse'); }
  imports.push('');
  imports.push('sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))');
  imports.push('');
  imports.push('from Libraries import api_methods  # noqa: E402');
  imports.push('from Libraries.data_generator import DataGenerator  # noqa: E402');
  if (bodied) {
    const pkg = classesDir(request.application).split('/').filter(Boolean).join('.');
    imports.push(`from ${pkg}.${request.bodyClassName} import ${request.bodyClassName}  # noqa: E402`);
  }

  // ── get_token ──
  const tokenMethod = (request.tokenMethod || '').trim();
  const getToken = tokenMethod
    ? `def get_token():
    """Returns a bearer token via the selected API Method Library provider."""
    return api_methods.${pySymbol(tokenMethod)}()`
    : `def get_token():
    # TODO: replace the placeholder with a real token call, e.g.
    # return api_methods.get_token(client_id, client_secret, token_url)
    return ""`;

  // ── Arrange/Act ──
  const arrange: string[] = [];
  arrange.push('    # Arrange');
  arrange.push('    token = get_token()');

  // One variable per DISTINCT parameter name. A path {id} and a query `id` sanitise to the same name
  // and refer to the same value, so they share a single assignment.
  const declared = new Set<string>();
  for (const p of [...(request.pathParams || []), ...queryParams]) {
    const v = paramVar(p.name);
    if (declared.has(v)) { continue; }
    declared.add(v);
    if (p.dataMethod && p.dataMethod !== NOT_ASSIGNED && p.dataMethod !== PARAMETER) {
      const args = (p.dataMethodArgs || '').trim();
      arrange.push(`    ${v} = DataGenerator().${pySymbol(p.dataMethod)}(${args})`);
    } else {
      const note = p.dataMethod === PARAMETER ? 'parameter — value supplied at runtime' : 'TODO: set value';
      arrange.push(`    ${v} = ${paramDefault(p.type)}  # ${note}`);
    }
  }

  const endpointInterp = (request.endpoint || '').replace(/\{([^}]+)\}/g, (_m, p) => `{${paramVar(p)}}`);
  // Query VALUES are URL-encoded so a value with a space, & or = doesn't corrupt the query string.
  const query = queryParams
    .map((p, i) => `${i === 0 ? '?' : '&'}${p.name}={urllib.parse.quote(str(${paramVar(p.name)}))}`)
    .join('');
  arrange.push(`    url = f"{base_url()}${endpointInterp}${query}"`);

  if (bodied) {
    const serializer = isFormEncoded(request.contentType) ? 'to_form_body' : 'to_json';
    arrange.push(`    request_body = ${request.bodyClassName}().${serializer}()`);
    arrange.push('');
    arrange.push('    # Act');
    arrange.push(`    response = api_methods.${pySymbol(request.wrapperMethod)}(token, url, request_body)`);
  } else {
    arrange.push('');
    arrange.push('    # Act');
    arrange.push(`    response = api_methods.${pySymbol(request.wrapperMethod)}(token, url)`);
  }

  // ── Assert ──
  const asserts: string[] = [];
  asserts.push('    # Assert');
  asserts.push('    content = response.text');
  asserts.push('    print(f"[{response.status_code}] {content}")');
  const handler = (request.responseHandler || '').trim();
  if (handler) {
    asserts.push(`    assert api_methods.${pySymbol(handler)}(response), f"Response check ${handler} failed ({response.status_code}). Body: {content}"`);
  } else {
    asserts.push('    assert response.ok, f"Expected success but got {response.status_code}. Body: {content}"');
    asserts.push('    assert content');
  }

  return `# Auto-generated by API2Test. Do not edit by hand.
${imports.join('\n')}


def base_url():
    # Base URL comes from a Data Library method — change it once there to retarget environments.
    return DataGenerator().${pySymbol(request.basePathMethod || 'baseUrlMethod')}()


${getToken}


def test_${(request.method || 'call').toLowerCase()}_returns_success():
${arrange.join('\n')}

${asserts.join('\n')}
`;
}
