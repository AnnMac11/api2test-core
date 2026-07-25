import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { generateTestForRow } from '../src/services/E2ETestGenerationService';
import { E2EPage, E2ETestCaseRow, E2EGenContext } from '../src/models/E2EDto';

const methods = [
  { methodName: 'GetStripeToken', parameters: '', returnType: 'Task<string>' },
  { methodName: 'StripeBaseUrl', parameters: '', returnType: 'string' },
  { methodName: 'PostFormAsync', parameters: 'token:string, url:string, formBody:string', returnType: 'Task<HttpResponseMessage>' },
  { methodName: 'ExtractFieldFromResponse', parameters: 'response:HttpResponseMessage, fieldPath:string', returnType: 'Task<string>' },
  { methodName: 'DeleteByParamAsync', parameters: 'token:string, urlTemplate:string, value:string', returnType: 'Task<HttpResponseMessage>' },
  { methodName: 'ValidateDeleteResponseAsync', parameters: 'response:HttpResponseMessage', returnType: 'Task<bool>' },
];
const classes = [
  { className: 'StripePostCustomers', endpoint: '/v1/customers (POST)', method: 'POST', contentType: 'application/x-www-form-urlencoded' },
  { className: 'StripeDeleteCustomersByCustomer', endpoint: '/v1/customers/{customer} (DELETE)', method: 'DELETE', contentType: 'application/x-www-form-urlencoded' },
];
const ctx: E2EGenContext = { methods, classes };
const page: E2EPage = {
  id: 'p', name: 'Stripe', application: 'Stripe', basePath: 'StripeBaseUrl', token: 'GetStripeToken',
  framework: 'MSTest', createdDate: '', modifiedDate: '',
};

test('create→delete chain generates a complete, correctly-wired MSTest file', () => {
  const row: E2ETestCaseRow = {
    id: 'r', name: 'Stripe Customer', items: [
      { type: 'Method', ref: 'PostFormAsync' },
      { type: 'Class', ref: 'StripePostCustomers' },
      { type: 'Method', ref: 'ExtractFieldFromResponse', args: { fieldPath: { value: 'id' } }, assignTo: 'customerId' },
      { type: 'Method', ref: 'DeleteByParamAsync' },
      { type: 'Class', ref: 'StripeDeleteCustomersByCustomer', args: { customer: { value: 'customerId', isVariable: true } } },
      { type: 'Method', ref: 'ValidateDeleteResponseAsync' },
    ],
  };
  const code = generateTestForRow(row, page, ctx);

  assert.match(code, /using Microsoft\.VisualStudio\.TestTools\.UnitTesting;/);
  assert.match(code, /using static Api2Test\.Generated\.Libraries\.ApiMethods;/);
  assert.match(code, /using Api2Test\.Generated\.Classes\.Stripe;/);
  assert.match(code, /namespace Api2Test\.Generated\.Tests\.Stripe/);
  assert.match(code, /\[TestClass\]/);
  assert.match(code, /public class StripeCustomerTests/);
  assert.match(code, /var result1 = await PostFormAsync\(token, baseUrl \+ "\/v1\/customers", new StripePostCustomers\(\)\.ToFormBody\(\)\);/);
  assert.match(code, /var customerId = await ExtractFieldFromResponse\(result1, "id"\);/);
  assert.match(code, /await DeleteByParamAsync\(token, baseUrl \+ "\/v1\/customers\/\{customer\}", customerId\);/);
  assert.match(code, /Assert\.IsTrue\(await ValidateDeleteResponseAsync\(result3\)\);/);
  // No double-send: the consumed class rows must not emit their own request.
  assert.equal(/new StripeDeleteCustomersByCustomer\(\)/.test(code), false);
});

test('class-first row (no send-method) emits each class call and binds URL placeholders from args', () => {
  // The In/Out redesign: a row is just a Class (the call) + follow-up extract methods — no leading send
  // method. classStep must emit the call itself AND fill {placeholder} paths from the class's own args.
  const petClasses = [
    { className: 'PetStorePostPet', endpoint: '/pet (POST)', method: 'POST', contentType: 'application/json' },
    { className: 'PetStoreDeletePetByPetId', endpoint: '/pet/{petId} (DELETE)', method: 'DELETE' },
  ];
  const petCtx: E2EGenContext = { methods, classes: petClasses };
  const row: E2ETestCaseRow = {
    id: 'r', name: 'Create then delete pet', items: [
      { type: 'Class', ref: 'PetStorePostPet' },
      { type: 'Method', ref: 'ExtractFieldFromResponse', args: { fieldPath: { value: 'id' } }, assignTo: 'petId' },
      { type: 'Class', ref: 'PetStoreDeletePetByPetId', args: { petId: { value: 'petId', isVariable: true } } },
    ],
  };
  const code = generateTestForRow(row, { ...page, application: 'Pet Store' }, petCtx);

  // Row 1: the POST class emits its own request + call (no separate send method needed).
  assert.match(code, /var response1 = await PostJsonAsync\(token, url1, request1\.ToJson\(\)\);/);
  // Extract reads the POST response into the named variable.
  assert.match(code, /var petId = await ExtractFieldFromResponse\(response1, "id"\);/);
  // Row 2: the DELETE class binds {petId} from its args — the whole point of the fix.
  assert.match(code, /var url3 = baseUrl \+ "\/pet\/" \+ petId;/);
  assert.match(code, /var response3 = await DeleteAsync\(token, url3\);/);
  // The placeholder must NOT survive unbound in any URL assignment (the step comment may still echo it).
  assert.equal(/var url\d+ = [^;]*\{/.test(code), false, 'no URL line leaves a placeholder unbound');
});

test('a capture after a GET reads the GET response (E2E-CAP-GET)', () => {
  // "GET a resource, capture a field from it, use that in the next call" is an ordinary chain. The
  // GET branch of classStep used to leave `state.lastResponse` unset, so the extract step emitted
  // `ExtractFieldFromResponse(/* response */, "id")` — code that doesn't compile.
  const getClasses = [
    { className: 'PetStoreGetPetByPetId', endpoint: '/pet/{petId} (GET)', method: 'GET' },
    { className: 'PetStoreDeletePetByPetId', endpoint: '/pet/{petId} (DELETE)', method: 'DELETE' },
  ];
  const row: E2ETestCaseRow = {
    id: 'r', name: 'Read then delete pet', items: [
      { type: 'Class', ref: 'PetStoreGetPetByPetId', args: { petId: { value: '1' } } },
      { type: 'Method', ref: 'ExtractFieldFromResponse', args: { fieldPath: { value: 'id' } }, assignTo: 'capturedId' },
      { type: 'Class', ref: 'PetStoreDeletePetByPetId', args: { petId: { value: 'capturedId', isVariable: true } } },
    ],
  };
  const code = generateTestForRow(row, { ...page, application: 'Pet Store' }, { methods, classes: getClasses });

  assert.match(code, /var response1 = await GetAsync<object>\(token, url1\);/);
  assert.match(code, /var capturedId = await ExtractFieldFromResponse\(response1, "id"\);/,
    'the extract must read the GET response');
  assert.equal(/\/\* response \*\//.test(code), false, 'no unwired response placeholder anywhere');
});

test('Option 1: a captured value feeding a TYPED field is extracted in that native type (no conversion)', () => {
  // POST pet → extract id → POST order with { PetId = <captured id> }. The order's PetId is a decimal, so the
  // capture must be `ExtractField<decimal>` (native), NOT the string extractor + a string→number cast.
  const petClasses = [
    { className: 'PetStorePostPet', endpoint: '/pet (POST)', method: 'POST', contentType: 'application/json',
      classCode: 'public class PetStorePostPet { public string Name { get; set; } }' },
    { className: 'PetStorePostStoreOrder', endpoint: '/store/order (POST)', method: 'POST', contentType: 'application/json',
      classCode: 'public class PetStorePostStoreOrder { public decimal PetId { get; set; } }' },
  ];
  const petCtx: E2EGenContext = { methods, classes: petClasses };
  const row: E2ETestCaseRow = {
    id: 'r', name: 'Order chain', items: [
      { type: 'Class', ref: 'PetStorePostPet' },
      { type: 'Method', ref: 'ExtractFieldFromResponse', args: { fieldPath: { value: 'id' } }, assignTo: 'petId' },
      { type: 'Class', ref: 'PetStorePostStoreOrder', overrides: { PetId: { value: 'petId', isVariable: true } } },
    ],
  };
  const code = generateTestForRow(row, { ...page, application: 'Pet Store' }, petCtx);

  // Captured in the native decimal type (no string→number conversion at the use site).
  assert.match(code, /var petId = await ExtractField<decimal>\(response1, "id"\);/);
  assert.match(code, /new PetStorePostStoreOrder\(\)\s*\{ PetId = petId \}/);
  assert.equal(/\.Parse\(petId\)/.test(code), false, 'no conversion at the assignment');
});

test('a captured value used only in a URL stays the string extractor (no typing needed)', () => {
  // GetById uses the captured id in the URL (string concat) — no typed field consumes it, so it stays string.
  const petCtx: E2EGenContext = {
    methods,
    classes: [
      { className: 'PetStorePostPet', endpoint: '/pet (POST)', method: 'POST', contentType: 'application/json' },
      { className: 'PetStoreGetPetByPetId', endpoint: '/pet/{petId} (GET)', method: 'GET' },
    ],
  };
  const row: E2ETestCaseRow = {
    id: 'r', name: 'Create then get', items: [
      { type: 'Class', ref: 'PetStorePostPet' },
      { type: 'Method', ref: 'ExtractFieldFromResponse', args: { fieldPath: { value: 'id' } }, assignTo: 'petId' },
      { type: 'Class', ref: 'PetStoreGetPetByPetId', args: { petId: { value: 'petId', isVariable: true } } },
    ],
  };
  const code = generateTestForRow(row, { ...page, application: 'Pet Store' }, petCtx);
  assert.match(code, /var petId = await ExtractFieldFromResponse\(response1, "id"\);/);
  assert.equal(/ExtractField</.test(code), false);
});

test('framework selection switches attributes + usings', () => {
  const row: E2ETestCaseRow = { id: 'r', name: 'Smoke', items: [{ type: 'Method', ref: 'ValidateDeleteResponseAsync' }] };
  const xunit = generateTestForRow(row, { ...page, framework: 'xUnit' }, ctx);
  assert.match(xunit, /using Xunit;/);
  assert.match(xunit, /\[Fact\]/);
  assert.match(xunit, /Assert\.True\(/);

  const nunit = generateTestForRow(row, { ...page, framework: 'NUnit' }, ctx);
  assert.match(nunit, /using NUnit\.Framework;/);
  assert.match(nunit, /\[Test\]/);
  assert.match(nunit, /\[TestFixture\]/);
});
