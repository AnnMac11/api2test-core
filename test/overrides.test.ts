import { test } from 'node:test';
import assert from 'node:assert';
import { generateTestForRow } from '../src/services/E2ETestGenerationService';

const page: any = {
  id: 'p', name: 'Stripe', application: 'Stripe', basePath: 'StripeBaseUrl',
  token: 'GetStripeToken', framework: 'xUnit', createdDate: '', modifiedDate: '',
};
const classes = [{
  className: 'StripePostCustomers', endpoint: '/v1/customers (POST)', method: 'POST',
  contentType: 'application/x-www-form-urlencoded',
  classCode: '[JsonPropertyName("email")] public string Email { get; set; } = new DataGenerator().Email(); public int Age { get; set; }',
}];
const methods = [
  { methodName: 'GetStripeToken', returnType: 'Task<string>' },
  { methodName: 'StripeBaseUrl', returnType: 'string' },
  { methodName: 'PostFormAsync', parameters: 'token:string, url:string, formBody:string', returnType: 'Task<HttpResponseMessage>' },
];

test('per-test field overrides emit a type-aware object initializer on the request class', () => {
  const row: any = { id: 'r', name: 'Override Test', items: [
    { type: 'Method', ref: 'PostFormAsync' },
    { type: 'Class', ref: 'StripePostCustomers', overrides: { Email: { value: 'a@b.com' }, Age: { value: '21' } } },
  ] };
  const code = generateTestForRow(row, page, { methods, classes } as any);
  // string quoted, int raw, applied via object initializer, still form-encoded
  assert.match(code, /new StripePostCustomers\(\) \{ Email = "a@b\.com", Age = 21 \}\.ToFormBody\(\)/);
  // self-documenting comment: a one-time tip + the pinned-fields note
  assert.match(code, /Tip: pin field values for just this test/);
  assert.match(code, /Fields pinned for this test: Email, Age\./);
});

test('an override bound to a captured variable is emitted by name (no quotes)', () => {
  const row: any = { id: 'r2', name: 'Var Override', items: [
    { type: 'Method', ref: 'PostFormAsync' },
    { type: 'Class', ref: 'StripePostCustomers', overrides: { Email: { value: 'capturedEmail', isVariable: true } } },
  ] };
  const code = generateTestForRow(row, page, { methods, classes } as any);
  assert.match(code, /\{ Email = capturedEmail \}/);
});

test('no overrides → plain instantiation (unchanged behaviour)', () => {
  const row: any = { id: 'r3', name: 'Plain', items: [
    { type: 'Method', ref: 'PostFormAsync' },
    { type: 'Class', ref: 'StripePostCustomers' },
  ] };
  const code = generateTestForRow(row, page, { methods, classes } as any);
  assert.match(code, /new StripePostCustomers\(\)\.ToFormBody\(\)/);
});
