import { ApiTestDto } from '../models/ApiTestDto';
import { StorageProvider } from '../adapters/StorageProvider';

/**
 * Parameters that drive a single test-class generation.
 */
export interface TestGenerationRequest {
    /** Name of the generated test class (without the `Tests` suffix). */
    className: string;
    /** Endpoint path, e.g. `/pet`. Combined with the global base URL at runtime. */
    endpoint: string;
    /** HTTP method, e.g. `POST`. */
    method: string;
    /** Application the test belongs to. */
    application: string;
    /** Wrapper class from the API Method Library that performs the HTTP call, e.g. `ApiMethods`. */
    wrapperClass: string;
    /** Wrapper method invoked for the call, e.g. `SendApiRequestAsync`. */
    wrapperMethod: string;
    /**
     * Name of the request-body class from the API Class Library, e.g. `ABCWebsiteAddPet`.
     * Empty for methods that send no body (GET / DELETE).
     */
    bodyClassName?: string;
    /** Test framework: `MSTest`, `NUnit`, or `xUnit`. */
    testFramework: string;
    /**
     * Declared request media type from the source spec. When `application/x-www-form-urlencoded`,
     * the body is serialised with `.ToFormBody()` (Stripe-style); otherwise `.ToJson()`.
     * Defaults to JSON when absent.
     */
    contentType?: string;
    /**
     * User-supplied test case name. Sanitised and used as the generated C# test class name.
     * Falls back to `${className}Tests` when not provided.
     */
    testClassName?: string;
    /** Data Library method (returns string) that supplies the base URL, e.g. `PetStoreBaseUrl`. Required. */
    basePathMethod?: string;
    /**
     * Optional API Method Library response handler (a validator taking the response and returning
     * bool/Task<bool>). When set, the test asserts its result â€” letting the handler define what
     * "pass" means (e.g. a negative test where a 400 is the expected/passing outcome). Empty â†’
     * built-in success + content assertions.
     */
    responseHandler?: string;
    /** Whether the selected response handler is async (return type includes `Task`), so it's awaited. */
    responseHandlerAsync?: boolean;
    /**
     * API Method Library token provider (Authentication category, parameterless), e.g. `GetStripeToken`.
     * When set, the generated `GetToken()` delegates to it; otherwise a placeholder is emitted.
     */
    tokenMethod?: string;
    /** Path parameters to declare and interpolate into the URL, with their data methods. */
    pathParams?: Array<{ name: string; dataMethod?: string; dataMethodArgs?: string; type?: string }>;
    /** Query parameters to declare and append to the URL, with their data methods. */
    queryParams?: Array<{ name: string; dataMethod?: string; dataMethodArgs?: string; type?: string }>;
}

/**
 * Generates C# integration-test classes that call an API through a wrapper method
 * and assert the response.
 *
 * @remarks
 * Each generated test embeds a `GetToken()` placeholder method so the demo runs
 * end-to-end without a real auth provider; the user replaces its body with a real
 * token call (e.g. AWS Cognito). For methods that carry a body (POST/PUT/PATCH),
 * the request body is built from the generated request-body class
 * (`new BodyClass().ToJson()`), whose properties are auto-populated via DataGenerator.
 */
export class TestGenerationService {
    private fileStorage: StorageProvider;

    constructor(fileStorage: StorageProvider) {
        this.fileStorage = fileStorage;
    }

    /**
     * Generates the C# test source for the given request **without** persisting it.
     * Used for the live preview in the Generate Test dialog.
     * @param request - Test generation parameters.
     * @returns The generated C# test source.
     */
    generateCode(request: TestGenerationRequest): string {
        const cls = this.resolveTestClassName(request);
        switch (request.testFramework) {
            case 'xUnit': return this.generateXUnit(request, cls);
            case 'NUnit': return this.generateNUnit(request, cls);
            default:      return this.generateMSTest(request, cls);
        }
    }

    /**
     * Persists (creates or updates) a test record in `api-tests.json`.
     * @param record - The test record to save.
     */
    async saveTest(record: ApiTestDto): Promise<void> {
        const existing = await this.getTestById(record.id);
        if (existing) {
            await this.fileStorage.updateItem('api-tests.json', record.id, record);
        } else {
            await this.fileStorage.addItem('api-tests.json', record);
        }
    }

    /** Returns all saved test records. */
    async getTests(): Promise<ApiTestDto[]> {
        return await this.fileStorage.readJsonFile<ApiTestDto>('api-tests.json');
    }

    /** Returns a single test record by id, or undefined. */
    async getTestById(id: string): Promise<ApiTestDto | undefined> {
        return await this.fileStorage.getItemById<ApiTestDto>('api-tests.json', id);
    }

    /** Deletes a test record by id. */
    async deleteTest(id: string): Promise<void> {
        await this.fileStorage.deleteItem('api-tests.json', id);
    }

    /**
     * Returns the directory of the most recently saved test (for "remember last used"),
     * or undefined if no test has been saved with a file path yet.
     */
    async getLastSaveDir(): Promise<string | undefined> {
        const tests = await this.getTests();
        const withPath = tests.filter(t => t.filePath).sort((a, b) => (b.createdDate || '').localeCompare(a.createdDate || ''));
        if (withPath.length === 0) { return undefined; }
        const p = withPath[0].filePath as string;
        const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
        return idx >= 0 ? p.substring(0, idx) : undefined;
    }

    /** Generates a fresh record id. */
    newId(): string {
        return this.generateId();
    }

    // â”€â”€ Code generation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    /** Resolves the C# test class name: sanitised test-case name, else `${className}Tests`. */
    private resolveTestClassName(request: TestGenerationRequest): string {
        const raw = (request.testClassName || '').trim();
        if (raw) {
            const cleaned = raw.replace(/[^A-Za-z0-9]/g, '');
            if (cleaned) { return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned; }
        }
        return `${request.className}Tests`;
    }

    /** Whether the HTTP method carries a request body. */
    private hasBody(method: string): boolean {
        return ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase());
    }

    /** Whether the request body should be form-urlencoded (vs JSON). */
    private isFormEncoded(contentType?: string): boolean {
        return (contentType || '').toLowerCase().includes('x-www-form-urlencoded');
    }

    /**
     * Builds the Arrange/Act lines shared by all frameworks:
     * token, path/query parameter variables, the URL, optional body, and the wrapper call.
     */
    private buildArrangeAct(request: TestGenerationRequest): string {
        const lines: string[] = [];
        lines.push('        // Arrange');
        lines.push('        var token = await GetToken();');

        // Declare a variable per path/query parameter, sourced from its data method.
        const allParams = [...(request.pathParams || []), ...(request.queryParams || [])];
        for (const p of allParams) {
            const varName = this.paramVar(p.name);
            if (p.dataMethod && p.dataMethod !== 'Not Assigned') {
                const args = (p.dataMethodArgs || '').trim();
                lines.push(`        var ${varName} = new DataGenerator().${p.dataMethod}(${args});`);
            } else {
                const def = this.paramDefault(p.type);
                lines.push(`        var ${varName} = ${def}; // TODO: set value`);
            }
        }

        // Build the URL: base + endpoint (path placeholders interpolate the declared vars),
        // then append any query parameters.
        let urlTemplate = '$"{BaseUrl}' + request.endpoint;
        const query = (request.queryParams || [])
            .map((p, i) => `${i === 0 ? '?' : '&'}${p.name}={${this.paramVar(p.name)}}`)
            .join('');
        urlTemplate += query + '"';
        lines.push(`        var url = ${urlTemplate};`);

        if (this.hasBody(request.method) && request.bodyClassName) {
            // Spec-driven: form-encoded APIs (e.g. Stripe) serialise to bracket-notation form data;
            // everything else stays JSON. JSON apps are unaffected because they never hit this branch.
            const bodySerializer = this.isFormEncoded(request.contentType) ? 'ToFormBody' : 'ToJson';
            lines.push(`        var requestBody = new ${request.bodyClassName}().${bodySerializer}();`);
            lines.push('');
            lines.push('        // Act');
            lines.push(`        var response = await ${request.wrapperClass}.${request.wrapperMethod}(token, url, requestBody);`);
        } else {
            lines.push('');
            lines.push('        // Act');
            lines.push(`        var response = await ${request.wrapperClass}.${request.wrapperMethod}(token, url);`);
        }
        return lines.join('\n');
    }

    /** C# variable name for a parameter (strip braces, camel-ish). */
    private paramVar(name: string): string {
        return name.replace(/[{}]/g, '').replace(/[^A-Za-z0-9]/g, '');
    }

    /** Typed default for an unassigned parameter. */
    private paramDefault(type?: string): string {
        switch ((type || 'string').toLowerCase()) {
            case 'int': case 'integer': return '0';
            case 'decimal': case 'number': return '0m';
            case 'bool': case 'boolean': return 'false';
            default: return '""';
        }
    }

    /**
     * The `using` block â€” one using per library for a clear one-to-one mapping:
     * `DataLibrary` (DataGenerator), `ApiMethodLibrary` (ApiMethods), and `GeneratedClasses`
     * (the request-body class, only when the method carries a body).
     */
    private usings(request: TestGenerationRequest, frameworkUsing: string): string {
        const list = [
            frameworkUsing,
            'using System;',
            'using System.Threading.Tasks;',
            'using DataLibrary;',        // DataGenerator (Data Library)
            'using ApiMethodLibrary;'    // ApiMethods (API Method Library)
        ];
        if (this.hasBody(request.method) && request.bodyClassName) {
            list.push('using GeneratedClasses;');   // request-body class
        }
        return list.join('\n');
    }

    /** The BaseUrl member â€” resolved at runtime from the selected base-path Data Library method. */
    private baseUrlMember(request: TestGenerationRequest): string {
        const method = request.basePathMethod || 'BaseUrlMethod';
        return `    // Base URL comes from a Data Library method â€” change it once there to retarget environments.\n    private string BaseUrl => new DataGenerator().${method}();`;
    }

    /**
     * The embedded GetToken method. When a token provider is selected (from the API Method
     * Library's Authentication methods, e.g. `GetStripeToken`), it delegates to that method;
     * otherwise it emits a placeholder the user replaces.
     */
    private getTokenMethod(request: TestGenerationRequest): string {
        const tokenMethod = (request.tokenMethod || '').trim();
        if (tokenMethod) {
            return `    /// <summary>Returns a bearer token via the selected API Method Library provider.</summary>
    private async Task<string> GetToken() => await ApiMethods.${tokenMethod}();`;
        }
        return `    /// <summary>
    /// Returns a bearer token for API authentication.
    /// TODO: Replace the placeholder below with a real token call,
    ///       e.g. return await ApiMethods.GetTokenAsync(clientId, clientSecret, tokenUrl);
    /// </summary>
    private async Task<string> GetToken()
    {
        // Placeholder token for demo purposes.
        return await Task.FromResult(string.Empty);
    }`;
    }

    private generateMSTest(request: TestGenerationRequest, cls: string): string {
        return `${this.usings(request, 'using Microsoft.VisualStudio.TestTools.UnitTesting;')}

[TestClass]
public class ${cls}
{
${this.baseUrlMember(request)}

${this.getTokenMethod(request)}

    [TestMethod]
    public async Task ${request.method}_ReturnsSuccess()
    {
${this.buildArrangeAct(request)}

${this.responseAssertion(request, 'mstest')}
    }
}`;
    }

    private generateNUnit(request: TestGenerationRequest, cls: string): string {
        return `${this.usings(request, 'using NUnit.Framework;')}

[TestFixture]
public class ${cls}
{
${this.baseUrlMember(request)}

${this.getTokenMethod(request)}

    [Test]
    public async Task ${request.method}_ReturnsSuccess()
    {
${this.buildArrangeAct(request)}

${this.responseAssertion(request, 'nunit')}
    }
}`;
    }

    private generateXUnit(request: TestGenerationRequest, cls: string): string {
        return `${this.usings(request, 'using Xunit;')}

public class ${cls}
{
${this.baseUrlMember(request)}

${this.getTokenMethod(request)}

    [Fact]
    public async Task ${request.method}_ReturnsSuccess()
    {
${this.buildArrangeAct(request)}

${this.responseAssertion(request, 'xunit')}
    }
}`;
    }

    /**
     * Builds the Assert section. Always reads + logs the response body. If a response handler is
     * selected it asserts the handler's boolean result (the handler defines "pass" â€” e.g. a
     * negative test where a 400 is expected); otherwise it falls back to built-in success asserts.
     */
    private responseAssertion(request: TestGenerationRequest, framework: 'mstest' | 'nunit' | 'xunit'): string {
        const lines: string[] = [];
        lines.push('        // Assert');
        lines.push('        var content = await response.Content.ReadAsStringAsync();');
        lines.push('        Console.WriteLine($"[{(int)response.StatusCode} {response.StatusCode}] {content}");');

        const handler = (request.responseHandler || '').trim();
        if (handler) {
            const call = request.responseHandlerAsync
                ? `await ApiMethods.${handler}(response)`
                : `ApiMethods.${handler}(response)`;
            const msg = `$"Response check ${handler} failed ({response.StatusCode}). Body: {content}"`;
            if (framework === 'nunit') { lines.push(`        Assert.That(${call}, Is.True, ${msg});`); }
            else if (framework === 'xunit') { lines.push(`        Assert.True(${call}, ${msg});`); }
            else { lines.push(`        Assert.IsTrue(${call}, ${msg});`); }
        } else if (framework === 'nunit') {
            lines.push('        Assert.That(response.IsSuccessStatusCode, Is.True, $"Expected success but got {response.StatusCode}. Body: {content}");');
            lines.push('        Assert.That(content, Is.Not.Null);');
        } else if (framework === 'xunit') {
            lines.push('        Assert.True(response.IsSuccessStatusCode, $"Expected success but got {response.StatusCode}. Body: {content}");');
            lines.push('        Assert.NotNull(content);');
        } else {
            lines.push('        Assert.IsTrue(response.IsSuccessStatusCode, $"Expected success but got {response.StatusCode}. Body: {content}");');
            lines.push('        Assert.IsNotNull(content);');
        }
        return lines.join('\n');
    }

    private generateId(): string {
        return 'test-' + Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9);
    }
}
