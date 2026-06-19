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
