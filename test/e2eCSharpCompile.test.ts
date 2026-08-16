/**
 * SEND-1 — the C# half of the compile guard.
 *
 * e2eTypeScript.test.ts already compiles its generated file with `tsc`. The C# side had no equivalent, so
 * `GetAsync<object>` — a send returning the deserialised body to a follow-up that takes an
 * HttpResponseMessage — shipped and every generated GET step failed with CS1503 at the user's machine while
 * every string-matching test passed. This builds the real thing: the curated seed emitted as ApiMethods.cs
 * plus a generated E2E chain, compiled by the .NET SDK.
 *
 * Skipped (not failed) when no .NET SDK is installed, so the suite still runs on a machine without it.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { getDefaultApiMethodLibrary } from '../src/data/defaultLibraries';
import { generateApiMethodsCSharp } from '../src/services/generateApiMethodsCSharp';
import { generateTestForRow } from '../src/services/E2ETestGenerationService';
import { E2EPage, E2ETestCaseRow, E2EGenContext } from '../src/models/E2EDto';
import { tmpDir } from './tmp';

function hasDotnet(): boolean {
  try {
    execFileSync('dotnet', ['--version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

const CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>disable</Nullable>
    <LangVersion>latest</LangVersion>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.11.1" />
    <PackageReference Include="MSTest.TestAdapter" Version="3.6.1" />
    <PackageReference Include="MSTest.TestFramework" Version="3.6.1" />
    <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
  </ItemGroup>
</Project>
`;

/** Emit the seed library + `code` into a throwaway project and build it. Fails with the compiler output. */
function assertCompiles(code: string, stubClasses: string): void {
  const dir = tmpDir('a2t-cs-');
  const methods = getDefaultApiMethodLibrary('csharp').filter((m: any) => m.code && m.code.trim());
  const write = (rel: string, contents: string) => {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  };
  write('Libraries/ApiMethods.cs',
    generateApiMethodsCSharp(methods as any, { namespace: 'Api2Test.Generated.Libraries', includeApiClient: true }));
  write('Tests/Chain.cs', code);
  write('Classes/Stubs.cs', stubClasses);
  write('p.csproj', CSPROJ);
  try {
    execFileSync('dotnet', ['build', path.join(dir, 'p.csproj'), '-v', 'q', '--nologo'], { stdio: 'pipe' });
  } catch (e: any) {
    assert.fail('generated C# did not compile:\n' + (e.stdout?.toString() || e.message));
  }
}

const page: E2EPage = {
  id: 'p', name: 'Pet Store', application: 'Pet Store', basePath: 'PetStoreBaseUrl',
  token: 'PetStoreApiKey', framework: 'MSTest', createdDate: '', modifiedDate: '',
};

test('SEND-1: the seed library + a GET→extract→DELETE chain compile with the .NET SDK', { skip: !hasDotnet() && 'no .NET SDK on this machine' }, () => {
  // Exactly the shape that failed for the user: a GET step whose response feeds an extract, then a
  // path-bound DELETE and its validator. Nothing here is stubbed away — the library is the shipped one.
  const ctx: E2EGenContext = {
    methods: getDefaultApiMethodLibrary('csharp') as any,
    classes: [
      { className: 'PetStoreGetPetByPetId', endpoint: '/pet/{petId} (GET)', method: 'GET' },
      { className: 'PetStoreDeletePetByPetId', endpoint: '/pet/{petId} (DELETE)', method: 'DELETE' },
    ] as any,
  };
  const row: E2ETestCaseRow = {
    id: 'r', name: 'Read then delete pet', items: [
      { type: 'Class', ref: 'PetStoreGetPetByPetId', args: { petId: { value: '1' } } },
      { type: 'Method', ref: 'ExtractFieldAsync', args: { fieldPath: { value: 'id' } }, assignTo: 'capturedId' },
      { type: 'Class', ref: 'PetStoreDeletePetByPetId', args: { petId: { value: 'capturedId', isVariable: true } } },
    ],
  };
  assertCompiles(generateTestForRow(row, page, ctx), `namespace Api2Test.Generated.Classes.PetStore
{
    public class PetStoreGetPetByPetId { }
    public class PetStoreDeletePetByPetId { }
}
`);
});

test('TYPE-1: a typed OUT capture pinned onto an int? field compiles (no CS0266)', { skip: !hasDotnet() && 'no .NET SDK on this machine' }, () => {
  // The other way the extract can fail to build: captured in one type, assigned to a field declared as
  // another. The capture must take the destination's type, and `ExtractFieldAsync<T>` must convert to it.
  const ctx: E2EGenContext = {
    methods: getDefaultApiMethodLibrary('csharp') as any,
    classes: [
      { className: 'PetStoreAddPet', endpoint: '/pet (POST)', method: 'POST', contentType: 'application/json',
        classCode: 'public string Name { get; set; }' },
      { className: 'PetStorePlaceOrder', endpoint: '/store/order (POST)', method: 'POST', contentType: 'application/json',
        classCode: 'public int? PetId { get; set; }' },
    ] as any,
  };
  const row: E2ETestCaseRow = {
    id: 'r', name: 'Create then order', items: [
      { type: 'Class', ref: 'PetStoreAddPet', captures: [{ fieldPath: 'id', variable: 'petid', type: 'number' }] },
      { type: 'Class', ref: 'PetStorePlaceOrder', overrides: { PetId: { value: 'petid', isVariable: true } } },
    ],
  };
  assertCompiles(generateTestForRow(row, page, ctx), `namespace Api2Test.Generated.Classes.PetStore
{
    public class PetStoreAddPet { public string Name { get; set; } public string ToJson() { return ""; } }
    public class PetStorePlaceOrder { public int? PetId { get; set; } public string ToJson() { return ""; } }
}
`);
});
