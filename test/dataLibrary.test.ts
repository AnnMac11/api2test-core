import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { generateDataLibraryCode } from '../src/services/generateDataLibrary';

test('generateDataLibraryCode emits an instance DataGenerator class (matches new DataGenerator())', () => {
  const code = generateDataLibraryCode([
    { methodName: 'FirstName', description: 'A first name', code: 'public string FirstName() => _faker.Name.FirstName();' },
    { methodName: 'Email', code: 'public string Email(string firstName = null) => _faker.Internet.Email(firstName ?? FirstName());' },
  ]);

  assert.match(code, /namespace Api2Test\.Generated\.Libraries/);
  assert.match(code, /public class DataGenerator/);
  assert.match(code, /private readonly Faker _faker = new Faker\(\);/);
  assert.match(code, /public string FirstName\(\) => _faker\.Name\.FirstName\(\);/);
  // The method code must NOT be re-wrapped in another method signature.
  assert.equal(/public string FirstName[\s\S]*public string FirstName/.test(code), false);
  assert.equal(/static class/.test(code), false);
});
