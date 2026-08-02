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

// OVR-CASE: clients key overrides by the SPEC field name (`email`, `pet_id`), which is correct at rest —
// the mapping to the generated C# property belongs here, at emit. These cases therefore pin lower-camel
// and snake_case keys, the shape a real builder actually sends; PascalCase keys never exercised the map.
test('per-test field overrides emit a type-aware object initializer on the request class', () => {
  const row: any = { id: 'r', name: 'Override Test', items: [
    { type: 'Method', ref: 'PostFormAsync' },
    { type: 'Class', ref: 'StripePostCustomers', overrides: { email: { value: 'a@b.com' }, age: { value: '21' } } },
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
    { type: 'Class', ref: 'StripePostCustomers', overrides: { email: { value: 'capturedEmail', isVariable: true } } },
  ] };
  const code = generateTestForRow(row, page, { methods, classes } as any);
  assert.match(code, /\{ Email = capturedEmail \}/);
});

test('OVR-CASE: a snake_case pinned field addresses the PascalCase property, and its type is found', () => {
  // The PetStore chain that surfaced this: `pet_id` / `petId` pinned on a class declaring `PetId`.
  // Two failures in one: the initializer named a property that does not exist (C# is case-sensitive),
  // and csTypeOf missed for the same reason, so the numeric literal came out quoted (`PetId = "5"`).
  const orderClasses = [{
    className: 'PetStorePostStoreOrder', endpoint: '/store/order (POST)', method: 'POST',
    contentType: 'application/json',
    classCode: 'public decimal PetId { get; set; } public string Status { get; set; } public bool Complete { get; set; }',
  }];
  const row: any = { id: 'r4', name: 'Create Order', items: [
    { type: 'Class', ref: 'PetStorePostStoreOrder', overrides: {
      pet_id: { value: '5' }, status: { value: 'placed' }, complete: { value: 'true' },
    } },
  ] };
  const code = generateTestForRow(row, page, { methods, classes: orderClasses } as any);
  assert.match(code, /new PetStorePostStoreOrder\(\) \{ PetId = 5, Status = "placed", Complete = true \}/);
  // the pinned-fields note names what the generated code names
  assert.match(code, /Fields pinned for this test: PetId, Status, Complete\./);
});

test('no overrides → plain instantiation (unchanged behaviour)', () => {
  const row: any = { id: 'r3', name: 'Plain', items: [
    { type: 'Method', ref: 'PostFormAsync' },
    { type: 'Class', ref: 'StripePostCustomers' },
  ] };
  const code = generateTestForRow(row, page, { methods, classes } as any);
  assert.match(code, /new StripePostCustomers\(\)\.ToFormBody\(\)/);
});
