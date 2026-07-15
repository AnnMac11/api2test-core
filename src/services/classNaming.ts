/**
 * Builds a C# class name from an application, HTTP method, and endpoint path.
 *
 * Name = Application + Verb + path segments, where each `{param}` segment is rendered as
 * `By<Param>` so path parameters are obvious and names stay unique per endpoint:
 *   POST /v1/customers                       -> StripePostCustomers
 *   POST /v1/customers/{customer}            -> StripePostCustomersByCustomer
 *   DELETE /v1/customers/{customer}          -> StripeDeleteCustomersByCustomer
 *   POST /v1/customers/{customer}/cards/{id} -> StripePostCustomersByCustomerCardsById
 *
 * `endpoint` may include a trailing "(POST)" suffix (from the UI's "path (METHOD)" format).
 *
 * @remarks
 * Single source of truth for class naming across editions (VS Code + Desktop). Uniqueness comes from
 * the verb + full path (incl. `By<Param>`), so two methods on the same path never collide — the reason
 * this replaced the older application+apiName style deriver.
 */
const VERBS: Record<string, string> = { POST: 'Post', GET: 'Get', PUT: 'Put', DELETE: 'Delete', PATCH: 'Patch' };

/** PascalCase a single path segment, splitting snake_case / kebab-case words (balance_transactions -> BalanceTransactions). */
function pascalSegment(seg: string): string {
  return seg
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .split(/[-_]/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

export function buildClassName(application: string, method: string, endpoint: string): string {
  const app = (application || '').replace(/[^a-zA-Z0-9]/g, '').replace(/^[a-z]/, c => c.toUpperCase());
  const verb = VERBS[(method || '').toUpperCase()]
    || ((method || 'Process').charAt(0).toUpperCase() + (method || 'Process').slice(1).toLowerCase());

  const path = (endpoint || '').replace(/\s*\([A-Za-z]+\)\s*$/, ''); // strip a "(POST)" suffix if present
  const segments = path
    .split('/')
    .filter(s => s && !/^(v\d+|api)$/i.test(s)) // drop version / api segments
    .map(s => {
      const param = s.match(/^\{(.+)\}$/);
      return param ? `By${pascalSegment(param[1])}` : pascalSegment(s);
    })
    .filter(Boolean);

  const name = `${app}${verb}${segments.join('')}`;
  return name.replace(/^[^a-zA-Z]/, 'Class$&') || 'GeneratedClass';
}
