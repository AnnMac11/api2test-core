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

// TYPE-1: the exact chain a user ran on 2026-08-03, which failed to build with
//   error CS0266: Cannot implicitly convert type 'decimal' to 'int?'
// The OUT row stored the pet id as `number` (→ `decimal`, chosen to hold large ids exactly) and the next
// step pinned it onto `PetId`, declared `int?` by the spec. The capture must take the type of the field it
// is going to feed — that is what the Option-1 look-ahead is for, but it never reached the capture rows.
test('TYPE-1: a captured value pinned onto a typed field is captured in THAT type', () => {
  const chain = [
    {
      className: 'PetStoreAddPet', endpoint: '/pet (POST)', method: 'POST', contentType: 'application/json',
      classCode: 'public string Name { get; set; }',
    },
    {
      className: 'PetStorePlaceOrder', endpoint: '/store/order (POST)', method: 'POST', contentType: 'application/json',
      classCode: 'public int? PetId { get; set; } public string Status { get; set; }',
    },
  ];
  // Class-only rows: core derives the send method from the verb + content-type, so this is the shape the
  // builder actually saves (and the shape that produced the failing file).
  const row: any = { id: 'r5', name: 'Add pet then order', items: [
    { type: 'Class', ref: 'PetStoreAddPet', captures: [{ fieldPath: 'id', variable: 'petid', type: 'number' }] },
    { type: 'Class', ref: 'PetStorePlaceOrder', overrides: { petId: { value: 'petid', isVariable: true } } },
  ] };

  const code = generateTestForRow(row, page, { methods, classes: chain } as any);

  assert.match(code, /var petid = await ExtractFieldAsync<int\?>\(/,
    'the capture must take the destination field\'s type, or the assignment below cannot compile');
  assert.match(code, /\{ PetId = petid \}/);
});

test('TYPE-1: a capture with no typed destination keeps the type the user picked', () => {
  // The store-as pick still governs when nothing constrains it — a value that only ever goes into a URL
  // or is never re-used must not be silently retyped.
  const row: any = { id: 'r6', name: 'Capture only', items: [
    { type: 'Class', ref: 'StripePostCustomers', captures: [{ fieldPath: 'id', variable: 'custid', type: 'number' }] },
  ] };
  const code = generateTestForRow(row, page, { methods, classes } as any);
  assert.match(code, /var custid = await ExtractFieldAsync<decimal>\(/);
});

test('no overrides → plain instantiation (unchanged behaviour)', () => {
  const row: any = { id: 'r3', name: 'Plain', items: [
    { type: 'Method', ref: 'PostFormAsync' },
    { type: 'Class', ref: 'StripePostCustomers' },
  ] };
  const code = generateTestForRow(row, page, { methods, classes } as any);
  assert.match(code, /new StripePostCustomers\(\)\.ToFormBody\(\)/);
});
