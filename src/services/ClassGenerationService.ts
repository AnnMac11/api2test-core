import { GeneratedClassDto } from '../models/GeneratedClassDto';
import { FieldConfiguration, ClassGenerationRequest } from '../models/ClassGenerationDto';
import { NOT_ASSIGNED, PARAMETER } from './DataDictionaryService';
import { StorageProvider } from '../adapters/StorageProvider';
import { classesNs, librariesNs } from './generatedNamespaces';
import { csPropertyName } from './classNaming';
import { fieldDisplayType } from './fieldTypes';

/**
 * Generates C# request-body classes from API Class Library entries.
 *
 * Each generated class has:
 * - Properties with inline `new DataGenerator().Method()` defaults for fields that
 *   have a Data Library method assigned.
 * - Nullable properties decorated with `[JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]`
 *   for optional fields with no assigned method â€” these are simply omitted from the
 *   serialised JSON so the API uses its own default.
 * - Mandatory fields with no assigned method get a safe empty default plus a TODO comment.
 * - A `ToJson()` helper that serialises the instance to a JSON string.
 */
export class ClassGenerationService {
    private fileStorage: StorageProvider;

    constructor(fileStorage: StorageProvider) {
        this.fileStorage = fileStorage;
    }

    /**
     * Generates a C# class from the request, saves a record to `generated-classes.json`,
     * and returns the class source code.
     *
     * @param request - Class generation parameters including fields and class name.
     * @returns The generated C# source code, or `null` if the endpoint has no body fields
     *   (a request-body class would be empty â€” path/query params are handled in the test instead).
     */
    /**
     * Renders the C# class source **without persisting**. Returns `null` when the endpoint has
     * no body fields (a request-body class would be empty). Used by the {@link CodeEmitter} and
     * for live preview; {@link generateClass} wraps this and saves a record.
     */
    renderClassCode(request: ClassGenerationRequest): string | null {
        const className = this.resolveClassName(request);
        // Body fields become the serialised request-body class.
        const bodyFields = request.fieldConfigurations.filter(f => (f.location || 'body') === 'body');
        if (bodyFields.length === 0) {
            // No request body: build a class from the URL/header params (already extracted from the {}
            // placeholders) so a body-less endpoint (e.g. GET /user/{username}) still reaches the Class
            // Library and can be added to a test. The generated test declares + interpolates these values
            // into the URL, so this class carries plain properties (no JSON serialisation).
            const urlParams = request.fieldConfigurations.filter(f => ['path', 'query', 'header'].includes(f.location || ''));
            if (urlParams.length === 0) {
                return null;
            }
            return this.generateUrlParamClass(className, request, urlParams, classesNs(request.application));
        }

        // Form-encoded specs (e.g. Stripe) also get a ToFormBody(); JSON specs are unchanged.
        const isForm = (request.contentType || '').toLowerCase().includes('x-www-form-urlencoded');
        return this.generateClassCodeInternal(className, bodyFields, classesNs(request.application), isForm);
    }

    async generateClass(request: ClassGenerationRequest): Promise<string | null> {
        const classCode = this.renderClassCode(request);
        if (classCode === null) {
            return null;
        }

        const className = this.resolveClassName(request);

        const record: GeneratedClassDto = {
            id: this.generateId(),
            className,
            code: classCode,
            endpoint: request.endpoint,
            method: request.method,
            application: request.application,
            createdDate: new Date().toISOString(),
            namespace: classesNs(request.application)
        };

        await this.fileStorage.addItem('generated-classes.json', record);
        return classCode;
    }

    /**
     * Returns all previously generated class records.
     * @returns Array of {@link GeneratedClassDto} entries.
     */
    async getGeneratedClasses(): Promise<GeneratedClassDto[]> {
        return await this.fileStorage.readJsonFile<GeneratedClassDto>('generated-classes.json');
    }

    /**
     * Returns the most recently generated class with the given name, or `undefined`
     * if it has never been generated.
     * @param className - The class name to look up.
     */
    async getLatestGeneratedByName(className: string): Promise<GeneratedClassDto | undefined> {
        const all = await this.getGeneratedClasses();
        return all
            .filter(c => c.className === className)
            .sort((a, b) => (b.createdDate || '').localeCompare(a.createdDate || ''))[0];
    }

    /**
     * Permanently removes a generated class record.
     * @param id - ID of the record to delete.
     */
    async deleteGeneratedClass(id: string): Promise<void> {
        await this.fileStorage.deleteItem('generated-classes.json', id);
    }

    // â”€â”€ Nested code generation (schema-driven) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    private tryParseSchema(json?: string): any {
        if (!json) { return null; }
        try {
            const s = JSON.parse(json);
            return (s && s.type === 'object' && s.properties) ? s : null;
        } catch {
            return null;
        }
    }

    /**
     * Generates the main class plus any nested companion classes from a resolved body schema.
     *
     * @remarks
     * Walks the schema tree:
     * - **object** property â†’ a nested companion class; the property is initialised `= new Child();`
     * - **array of objects** â†’ `List<Child>` initialised with one element
     * - **array of scalars** â†’ `List<T>` (one generated element if the field has a data method)
     * - **scalar** â†’ property via {@link generateProperty} (DataGenerator default / TODO / nullable)
     *
     * Each leaf's data method is looked up from `fields` by its dot-path name.
     */
    private generateNestedClasses(
        rootClassName: string,
        schema: any,
        fields: FieldConfiguration[],
        namespace: string,
        isForm: boolean = false
    ): string {
        const byPath = new Map<string, FieldConfiguration>();
        for (const f of fields) { byPath.set(f.name, f); }

        const classes: string[] = [];
        let usesDataMethods = false;
        let usesList = false;

        // Recursively build a class definition; returns nothing (collects into `classes`).
        const buildClass = (className: string, node: any, prefix: string): void => {
            const lines: string[] = [];
            for (const [key, propRaw] of Object.entries(node.properties || {})) {
                const prop: any = propRaw;
                const path = prefix ? `${prefix}.${key}` : key;
                const propName = this.formatPropertyName(key);
                const jsonAttr = `[JsonPropertyName("${key}")]`;

                if (prop.type === 'object' && prop.properties) {
                    const childName = this.formatPropertyName(key);
                    buildClass(childName, prop, path);
                    lines.push(`        ${jsonAttr} public ${childName} ${propName} { get; set; } = new ${childName}();`);
                } else if (prop.type === 'array') {
                    usesList = true;
                    const items = prop.items || {};
                    if (items.type === 'object' && items.properties) {
                        const childName = this.formatPropertyName(this.singular(key));
                        buildClass(childName, items, path);
                        lines.push(`        ${jsonAttr} public List<${childName}> ${propName} { get; set; } = new List<${childName}> { new ${childName}() };`);
                    } else {
                        const elemType = this.getCSharpType(items.type || 'string');
                        const f = byPath.get(path);
                        if (f && this.hasAssignedMethod(f)) {
                            usesDataMethods = true;
                            lines.push(`        ${jsonAttr} public List<${elemType}> ${propName} { get; set; } = new List<${elemType}> { ${this.dataCall(f)} };`);
                        } else {
                            lines.push(`        ${jsonAttr} public List<${elemType}> ${propName} { get; set; } = new List<${elemType}>();`);
                        }
                    }
                } else {
                    const f = byPath.get(path) || { name: path, type: prop.type || 'string', required: false } as FieldConfiguration;
                    if (this.hasAssignedMethod(f)) { usesDataMethods = true; }
                    lines.push('        ' + this.generateProperty({ ...f, type: prop.type || f.type, name: key }));
                }
            }

            const isRoot = className === rootClassName;
            const serializers = isRoot ? this.serializerMethods(isForm) : '';
            classes.push(`    public class ${className}\n    {\n${lines.join('\n')}${serializers}\n    }`);
        };

        buildClass(rootClassName, schema, '');

        const usings = [
            'using System;',
            usesList ? 'using System.Collections.Generic;' : null,
            'using System.Text.Json;',
            'using System.Text.Json.Serialization;',
            (usesDataMethods || isForm) ? `using ${librariesNs()};` : null, // DataGenerator + ApiMethods
        ].filter(Boolean).join('\n');

        // Root class first, nested classes after (nested were pushed during recursion before root completes,
        // so reverse to put the root â€” pushed last â€” at the top for readability).
        const ordered = classes.slice().reverse();
        return `${usings}\n\nnamespace ${namespace}\n{\n${ordered.join('\n\n')}\n}`;
    }

    /** Naive singulariser for array-element class names (tags â†’ Tag, addresses â†’ Address). */
    private singular(word: string): string {
        if (word.endsWith('ies') && word.length > 3) { return word.slice(0, -3) + 'y'; }
        if (word.endsWith('ses') && word.length > 3) { return word.slice(0, -2); }
        if (word.endsWith('s') && !word.endsWith('ss') && word.length > 1) { return word.slice(0, -1); }
        return word;
    }

    // â”€â”€ Code generation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    private resolveClassName(request: ClassGenerationRequest): string {
        const raw = request.className || this.deriveClassName(request.application, request.endpoint);
        return this.sanitizeClassName(raw);
    }

    private deriveClassName(application: string, endpoint: string): string {
        const appPart = application.replace(/\s+/g, '');
        const endpointPart = endpoint
            .replace(/^\//, '')
            .split('/')
            .filter(p => p && !p.startsWith('{') && !p.startsWith(':'))
            .map(p => p.charAt(0).toUpperCase() + p.slice(1).replace(/[-_]/g, ''))
            .join('') || 'Resource';
        return `${appPart}${endpointPart}`;
    }

    /**
     * Ensures a string is a valid C# identifier: strips any non-alphanumeric characters
     * (hyphens, spaces, dots, etc.) and prefixes an underscore if it would start with a digit.
     * e.g. `"ABC-WebsiteCreateUser"` â†’ `"ABCWebsiteCreateUser"`.
     */
    private sanitizeClassName(name: string): string {
        const cleaned = name.replace(/[^A-Za-z0-9]/g, '');
        if (!cleaned) { return 'GeneratedClass'; }
        return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
    }

    private generateClassCodeInternal(
        className: string,
        fields: FieldConfiguration[],
        namespace: string,
        isForm: boolean = false
    ): string {
        const hasDataMethods = fields.some(f => this.hasAssignedMethod(f));

        const usings = [
            'using System;',
            'using System.Text.Json;',
            'using System.Text.Json.Serialization;',
            (hasDataMethods || isForm) ? `using ${librariesNs()};` : null, // DataGenerator + ApiMethods
        ].filter(Boolean).join('\n');

        const properties = fields
            .map(f => '        ' + this.generateProperty(f))
            .join('\n');

        return `${usings}

namespace ${namespace}
{
    /// <summary>
    /// Request body class for the API endpoint.
    /// Properties initialised with DataGenerator calls produce realistic test data automatically.
    /// Nullable properties (no data method assigned) are omitted from the JSON body if not set.
    /// </summary>
    public class ${className}
    {
${properties}${this.serializerMethods(isForm)}
    }
}`;
    }

    /**
     * Emits the body-serialisation helper(s) for the root request class.
     * Always emits `ToJson()`. When the spec is form-encoded (e.g. Stripe), also emits
     * `ToFormBody()`, which delegates to `ApiMethods.FormUrlEncode` (bracket-notation flattening).
     */
    private serializerMethods(isForm: boolean): string {
        const toJson = `\n\n        /// <summary>Serialises this instance to a JSON string for use as a request body.</summary>\n        public string ToJson() => JsonSerializer.Serialize(this);`;
        if (!isForm) { return toJson; }
        const toForm = `\n\n        /// <summary>Serialises this instance to an application/x-www-form-urlencoded body\n        /// with bracket notation for nested objects (e.g. address[line1]). Used by form APIs like Stripe.</summary>\n        public string ToFormBody() => ApiMethods.FormUrlEncode(this);`;
        return toJson + toForm;
    }

    /**
     * Synthesises a class for a BODY-LESS endpoint — one property per URL/header parameter (already
     * extracted from the endpoint's `{}` placeholders) — so the endpoint reaches the API Class Library and
     * can be added to a test. The generated test declares + interpolates these values into the request URL
     * (see {@link TestGenerationService}), so this class carries **plain** properties — no
     * `[JsonPropertyName]`, no `ToJson()`: URL/header params are never a serialised JSON body.
     */
    private generateUrlParamClass(
        className: string,
        request: ClassGenerationRequest,
        params: FieldConfiguration[],
        namespace: string,
    ): string {
        const lines = params.map(p => `        public ${this.getCSharpType(p.type)} ${this.formatPropertyName(p.name)} { get; set; }`);
        return `using System;

namespace ${namespace}
{
    /// <summary>
    /// URL/header parameters for ${(request.method || '').toUpperCase()} ${request.endpoint}.
    /// The generated test supplies these values and interpolates them into the request URL.
    /// </summary>
    public class ${className}
    {
${lines.join('\n')}
    }
}`;
    }

    /**
     * Generates a single C# property declaration.
     *
     * @remarks
     * Every property carries a `[JsonPropertyName("<originalFieldName>")]` attribute so the
     * serialised JSON keys match the real API contract exactly, regardless of the PascalCase
     * C# property name. Three value cases:
     * 1. **Assigned data method** â€” non-nullable, initialised with `new DataGenerator().Method()`.
     * 2. **Mandatory, no method** â€” non-nullable with safe empty default and TODO comment.
     * 3. **Optional, no method** â€” nullable + `[JsonIgnore]` so the field is omitted from JSON.
     */
    private generateProperty(field: FieldConfiguration): string {
        const csType  = this.getCSharpType(field.type);
        const propName = this.formatPropertyName(field.name);
        // Preserve the original API field name as the JSON key (e.g. "firstName").
        const jsonName = `[JsonPropertyName("${field.name}")]`;

        if (this.hasAssignedMethod(field)) {
            return `${jsonName} public ${csType} ${propName} { get; set; } = ${this.dataCall(field)};`;
        }

        if (field.dataMethod === PARAMETER) {
            // Value is supplied at runtime (e.g. from another API's output) — emit a settable
            // property with a safe default so the class compiles and the test can assign it. No
            // DataGenerator call: PARAMETER is a placeholder, not a real Data Library method.
            const paramDefault = this.getEmptyDefault(field.type);
            return `${jsonName} public ${csType} ${propName} { get; set; } = ${paramDefault}; // parameter — value supplied at runtime`;
        }

        if (field.required) {
            // Mandatory field â€” must appear in the JSON body but has no data method yet.
            const emptyDefault = this.getEmptyDefault(field.type);
            return `${jsonName} public ${csType} ${propName} { get; set; } = ${emptyDefault}; // TODO: assign a data method in the Data Dictionary`;
        }

        // Optional, unassigned â€” omit from JSON if null (API will use its own default).
        return `[JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] ${jsonName} public ${csType}? ${propName} { get; set; }`;
    }

    /**
     * Builds the `new DataGenerator().Method(args)` call for a field, passing the field's
     * optional `dataMethodArgs` verbatim inside the parentheses (empty â†’ no args â†’ method defaults).
     */
    private dataCall(field: FieldConfiguration): string {
        const args = (field.dataMethodArgs || '').trim();
        return `new DataGenerator().${field.dataMethod}(${args})`;
    }

    private hasAssignedMethod(field: FieldConfiguration): boolean {
        return !!(field.dataMethod
            && field.dataMethod.trim() !== ''
            && field.dataMethod !== NOT_ASSIGNED
            // PARAMETER is a runtime-supplied placeholder, not a generator method — handled separately.
            && field.dataMethod !== PARAMETER);
    }

    private getEmptyDefault(type: string): string {
        switch (type.toLowerCase()) {
            case 'int': case 'integer': return '0';
            case 'decimal': case 'number': case 'double': return '0m';
            case 'bool': case 'boolean': return 'false';
            case 'datetime': case 'date': return 'DateTime.MinValue';
            case 'object': case 'array': return 'null';
            default: return 'string.Empty';
        }
    }

    /**
     * TYPE-1: delegates to the shared map so the type a client SHOWS the user is by construction the type
     * this generator DECLARES. (Object and array stay `object` there too — the property has to hold
     * whatever the assigned data method returns, and ToFormBody/ToJson serialise the runtime value.)
     */
    private getCSharpType(type: string): string {
        return fieldDisplayType(type, 'csharp');
    }

    /** Delegates to the shared rule (`csPropertyName`) so the E2E emitter names the same property. */
    private formatPropertyName(name: string): string {
        return csPropertyName(name);
    }

    private generateId(): string {
        return Math.random().toString(36).substr(2, 9);
    }
}
