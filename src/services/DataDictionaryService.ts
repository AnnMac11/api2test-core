import { DataDictionaryField } from '../models/DataDictionaryDto';
import { DataMethodDto } from '../models/DataMethodDto';
import { FileStorageService } from './FileStorageService';

/**
 * Sentinel value stored on a {@link DataDictionaryField} when no matching
 * Data Library method has been found or selected by the user.
 * Using a named constant avoids magic strings across the codebase.
 */
export const NOT_ASSIGNED = 'Not Assigned';

/**
 * Service for managing the Data Dictionary — the catalogue of API field
 * definitions used by the code generator to produce typed, realistic test data.
 *
 * Responsibilities:
 * - CRUD on `data-dictionary.json`
 * - Extracting {@link DataDictionaryField} entries from an imported API endpoint
 * - Matching extracted fields to Data Library methods via {@link autoMatchDataMethods}
 *
 * @remarks
 * This service deliberately does **not** read `data-library.json`. Callers that
 * need data methods must fetch them through {@link DataLibraryService} and pass
 * them into {@link autoMatchDataMethods}.
 */
export class DataDictionaryService {
    private fileStorage: FileStorageService;

    constructor(fileStorage: FileStorageService) {
        this.fileStorage = fileStorage;
    }

    /**
     * Returns all fields currently stored in the Data Dictionary.
     * @returns Array of {@link DataDictionaryField} entries, or empty array if file is missing.
     */
    async getDataDictionary(): Promise<DataDictionaryField[]> {
        return await this.fileStorage.readJsonFile<DataDictionaryField>('data-dictionary.json');
    }

    /**
     * Returns a single field by ID.
     * @param id - The unique identifier of the field.
     * @returns The matching {@link DataDictionaryField}, or `undefined` if not found.
     */
    async getFieldById(id: string): Promise<DataDictionaryField | undefined> {
        return await this.fileStorage.getItemById<DataDictionaryField>('data-dictionary.json', id);
    }

    /**
     * Persists a new field to the Data Dictionary.
     * @param field - The {@link DataDictionaryField} to add.
     */
    async addField(field: DataDictionaryField): Promise<void> {
        await this.fileStorage.addItem('data-dictionary.json', field);
    }

    /**
     * Applies a partial update to an existing field, merging `updates` over the stored record.
     * Silently does nothing if the ID is not found.
     * @param id - ID of the field to update.
     * @param updates - Partial {@link DataDictionaryField} values to merge in.
     */
    async updateField(id: string, updates: Partial<DataDictionaryField>): Promise<void> {
        const fields = await this.getDataDictionary();
        const idx = fields.findIndex(f => f.id === id);
        if (idx >= 0) {
            fields[idx] = { ...fields[idx], ...updates };
            await this.fileStorage.writeJsonFile('data-dictionary.json', fields);
        }
    }

    /**
     * Permanently removes a field from the Data Dictionary.
     * @param id - ID of the field to delete.
     */
    async deleteField(id: string): Promise<void> {
        await this.fileStorage.deleteItem('data-dictionary.json', id);
    }

    /**
     * Checks whether a field with the same name and type already exists in the dictionary.
     * Comparison is case-insensitive on both properties.
     * @param fieldName - Field name to check.
     * @param fieldType - Field type to check.
     * @returns `true` if a duplicate exists, `false` otherwise.
     */
    async checkDuplicateField(fieldName: string, fieldType: string): Promise<boolean> {
        const fields = await this.getDataDictionary();
        return fields.some(f =>
            f.fieldName.toLowerCase() === fieldName.toLowerCase() &&
            f.fieldType.toLowerCase() === fieldType.toLowerCase()
        );
    }

    /**
     * Returns fields whose `fieldName` or `fieldType` contains the query string (case-insensitive).
     * @param query - Search string to match against field name and type.
     * @returns Matching {@link DataDictionaryField} entries.
     */
    async searchFields(query: string): Promise<DataDictionaryField[]> {
        const fields = await this.getDataDictionary();
        const q = query.toLowerCase();
        return fields.filter(f =>
            f.fieldName.toLowerCase().includes(q) ||
            f.fieldType.toLowerCase().includes(q)
        );
    }

    // ── Field extraction ─────────────────────────────────────────────────────────

    /**
     * Extracts {@link DataDictionaryField} entries from a single imported API endpoint.
     *
     * @remarks
     * Extraction is attempted in priority order, stopping as soon as any source yields fields:
     *
     * 1. **Body fields** (`location: 'body'`) — parsed from `endpoint.requestBodyTemplate`,
     *    or from `endpoint.responseExamples` if there is no body. Postman array format
     *    `[{ key, value, type, required? }]` and plain JSON objects are both supported.
     * 2. **URL parameters** (`location: 'path'|'query'`) — taken from `endpoint.parameterDetails`
     *    for **every** HTTP method. As a fallback, any `{param}` placeholders in the endpoint
     *    path are extracted (braces stripped) when no structured details exist.
     *
     * There is no generic catch-all field anymore — an endpoint with no body and no
     * parameters simply yields no fields.
     *
     * When `checkDuplicates` is `true` (default), each candidate field is checked against
     * the existing dictionary with {@link checkDuplicateField}; duplicates are silently dropped
     * and `sourceEndpointId` is set on surviving fields. When `false`, all fields are returned
     * without any I/O — useful for computing counts before filtering.
     *
     * @param endpoint - The imported API endpoint record (an {@link ApiMethodDto}-shaped object).
     * @param checkDuplicates - Whether to filter out fields already in the dictionary. Defaults to `true`.
     * @returns Array of new {@link DataDictionaryField} entries ready for insertion.
     */
    async extractFieldsFromEndpoint(
        endpoint: any,
        checkDuplicates: boolean = true
    ): Promise<DataDictionaryField[]> {
        const fields: DataDictionaryField[] = [];

        // 1. Body fields (location: 'body')
        //    Prefer the resolved schema (carries nested/array structure); fall back to the
        //    body template (Postman array format or a plain object example).
        if (endpoint.requestBodySchema) {
            try {
                const schema = JSON.parse(endpoint.requestBodySchema);
                this.extractFieldsFromSchema(schema, '', fields);
            } catch {
                // unparseable schema — fall through to template
            }
        }

        if (fields.length === 0 && endpoint.requestBodyTemplate) {
            try {
                const body = JSON.parse(endpoint.requestBodyTemplate);
                if (Array.isArray(body)) {
                    // Postman format: [{ key, value, type }]
                    body.forEach((item: any) => {
                        if (item.key && item.type) {
                            fields.push({
                                id: this.generateId(),
                                fieldName: item.key,
                                fieldType: this.mapTypeToFieldType(item.type),
                                mandatory: item.required !== undefined
                                    ? !!item.required
                                    : this.isFieldMandatory(item.value),
                                dataMethod: NOT_ASSIGNED,
                                location: 'body'
                            });
                        }
                    });
                } else {
                    this.extractFieldsFromObject(body, '', fields);
                }
            } catch {
                // unparseable body template — skip
            }
        }

        // If still nothing, fall back to response examples for the body shape.
        if (fields.length === 0 && endpoint.responseExamples) {
            try {
                const examples = JSON.parse(endpoint.responseExamples);
                this.extractFieldsFromObject(examples, '', fields);
            } catch {
                // unparseable — skip
            }
        }

        // 2. URL parameters (location: 'path' | 'query') — for ALL HTTP methods.
        const paramDetails = Array.isArray(endpoint.parameterDetails) ? endpoint.parameterDetails : [];
        if (paramDetails.length > 0) {
            for (const p of paramDetails) {
                if (p.location !== 'path' && p.location !== 'query') { continue; } // skip headers
                fields.push({
                    id: this.generateId(),
                    fieldName: p.name,
                    fieldType: this.mapTypeToFieldType(p.type || 'string'),
                    mandatory: p.required ?? (p.location === 'path'),
                    dataMethod: NOT_ASSIGNED,
                    location: p.location
                });
            }
        } else {
            // Fallback: derive path params from {placeholders} in the path (braces stripped).
            const placeholders = (endpoint.endpoint as string).match(/\{([^}]+)\}/g);
            if (placeholders) {
                for (const ph of placeholders) {
                    fields.push({
                        id: this.generateId(),
                        fieldName: ph.replace(/[{}]/g, ''),
                        fieldType: 'string',
                        mandatory: true,
                        dataMethod: NOT_ASSIGNED,
                        location: 'path'
                    });
                }
            }
        }

        if (!checkDuplicates) {
            return fields;
        }

        // Filter out fields already in the dictionary (same name + type)
        const unique: DataDictionaryField[] = [];
        for (const field of fields) {
            const isDuplicate = await this.checkDuplicateField(field.fieldName, field.fieldType);
            if (!isDuplicate) {
                unique.push({ ...field, sourceEndpointId: endpoint.id });
            }
        }
        return unique;
    }

    /**
     * Walks a resolved request-body schema, creating Data Dictionary leaf fields.
     *
     * @remarks
     * - **Object** properties are containers — no row is created for them; recursion
     *   produces dot-notation leaves (e.g. `category.id`, `category.name`).
     * - **Array of objects** — no row for the array; element fields become dot-notation
     *   rows (e.g. `tags.id`, `tags.name`).
     * - **Array of scalars** — one row for the array itself (e.g. `photoUrls`, type `array`)
     *   → C# `List<T>`.
     * - **Scalar** properties become a single typed row.
     */
    private extractFieldsFromSchema(node: any, prefix: string, fields: DataDictionaryField[]): void {
        if (!node || node.type !== 'object' || !node.properties) { return; }
        // A property is mandatory when it appears in its immediate parent object's `required` list.
        const requiredSet = new Set<string>(Array.isArray(node.required) ? node.required : []);
        for (const [key, propRaw] of Object.entries(node.properties)) {
            const prop: any = propRaw;
            const name = prefix ? `${prefix}.${key}` : key;
            const isRequired = requiredSet.has(key);

            // Mirror the request body's top-level shape: one row per field, typed object /
            // array / scalar (no flattening). Object & array fields are assigned a data method
            // that returns that shape (e.g. StripeAddress → object, StripeTaxIds → array).
            if (prop.type === 'object' && prop.properties) {
                this.pushSchemaField(name, 'object', fields, isRequired);
            } else if (prop.type === 'array') {
                this.pushSchemaField(name, 'array', fields, isRequired);
            } else {
                this.pushSchemaField(name, this.mapTypeToFieldType(prop.type || 'string'), fields, isRequired);
            }
        }
    }

    /** Adds a body leaf field if one with the same name doesn't already exist. */
    private pushSchemaField(fieldName: string, fieldType: string, fields: DataDictionaryField[], mandatory: boolean = false): void {
        if (fields.some(f => f.fieldName === fieldName)) { return; }
        fields.push({
            id: this.generateId(),
            fieldName,
            fieldType,
            mandatory,
            dataMethod: NOT_ASSIGNED,
            location: 'body'
        });
    }

    /**
     * Recursively walks a plain JSON object example, creating a row per scalar leaf.
     * Nested objects are containers (no row) and produce dot-notation leaves (`address.city`).
     * Used only as a fallback when no resolved schema is available.
     */
    private extractFieldsFromObject(
        obj: any,
        prefix: string,
        fields: DataDictionaryField[]
    ): void {
        for (const [key, value] of Object.entries(obj)) {
            const fieldName = prefix ? `${prefix}.${key}` : key;
            const isObject = typeof value === 'object' && value !== null && !Array.isArray(value);

            if (isObject) {
                // Container — recurse, do not emit a row for the object itself.
                this.extractFieldsFromObject(value, fieldName, fields);
                continue;
            }

            if (!fields.some(f => f.fieldName === fieldName)) {
                fields.push({
                    id: this.generateId(),
                    fieldName,
                    fieldType: this.getFieldType(value),
                    mandatory: this.isFieldMandatory(value),
                    dataMethod: NOT_ASSIGNED,
                    location: 'body'
                });
            }
        }
    }

    // ── Data method matching ─────────────────────────────────────────────────────

    /**
     * Assigns the best-matching Data Library method to each field.
     *
     * @remarks
     * This is a **pure synchronous** function — it performs no I/O. Callers must fetch
     * `dataMethods` via {@link DataLibraryService.getDataMethods} before calling.
     *
     * Matching is attempted via {@link findBestMatch} for each field. Fields with no
     * match receive `dataMethod = NOT_ASSIGNED`.
     *
     * Returns a new array of fields; the input array is not mutated.
     *
     * @param fields - Fields to match (typically returned by {@link extractFieldsFromEndpoint}).
     * @param dataMethods - Full Data Library method list from {@link DataLibraryService}.
     * @returns New array of fields with `dataMethod` populated or set to {@link NOT_ASSIGNED}.
     */
    autoMatchDataMethods(
        fields: DataDictionaryField[],
        dataMethods: DataMethodDto[]
    ): DataDictionaryField[] {
        return fields.map(field => ({
            ...field,
            dataMethod: this.findBestMatch(field, dataMethods)?.methodName ?? NOT_ASSIGNED
        }));
    }

    /**
     * Finds the best matching Data Library method for a single field using a four-tier strategy:
     *
     * 1. **Exact** — method name exactly equals field name (case-insensitive).
     * 2. **Contains** — field name contains the method name; longest method name wins
     *    (e.g. field `"firstName"` matches method `"FirstName"`).
     * 3. **Reverse-contains** — method name, split on CamelCase word boundaries *before*
     *    lowercasing, contains the field name as a whole word, or the lowercased method
     *    name contains the field name as a substring; shortest method name wins
     *    (e.g. field `"email"` matches method `"EmailAddress"`).
     * 4. **Type-based** — only used when exactly one Data Library method has a `returnType`
     *    matching the field's `fieldType`; avoids false positives when many methods share a type.
     *
     * @param field - The field to find a match for.
     * @param dataMethods - Candidate data methods from the Data Library.
     * @returns The best-matching {@link DataMethodDto}, or `undefined` if none qualifies.
     */
    private findBestMatch(
        field: DataDictionaryField,
        dataMethods: DataMethodDto[]
    ): DataMethodDto | undefined {
        // TYPE FIRST: only consider methods whose return *kind* matches the field's kind
        // (object field → object-returning methods, array → array methods, scalar → scalar).
        // This stops an object field like `address` from matching the scalar `Address()` by name.
        const fieldKind = this.kindOf(field.fieldType);
        const candidates = dataMethods.filter(dm => this.kindOf(dm.returnType) === fieldKind);
        if (candidates.length === 0) { return undefined; }

        // Match on the LEAF segment of a dot-path (category.name → "name"), singularising
        // plural array names (photoUrls → "photourl") so they hit url/string methods.
        const leaf = field.fieldName.split('.').pop() || field.fieldName;
        // Normalise away case AND separators so snake_case / kebab-case fields match
        // CamelCase methods (e.g. "postal_code" → "postalcode" matches "PostalCode").
        const fieldName = this.normalizeForMatch(this.singularize(leaf.toLowerCase()));

        // 1. Exact name match (separator-insensitive)
        const exact = candidates.find(dm =>
            this.normalizeForMatch(dm.methodName) === fieldName
        );
        if (exact) { return exact; }

        // 2. Method name contained within field name (e.g. "preferred_locales" contains "Locale")
        const contains = candidates
            .filter(dm => {
                const m = this.normalizeForMatch(dm.methodName);
                return m.length > 0 && fieldName.includes(m);
            })
            .sort((a, b) => b.methodName.length - a.methodName.length);
        if (contains.length > 0) { return contains[0]; }

        // 3. Field name contained within method name — split on CamelCase before lowercasing
        //    (e.g. method "EmailAddress" → words ["email","address"] → matches field "email").
        const reverseContains = candidates
            .filter(dm => {
                const words = dm.methodName
                    .split(/(?=[A-Z])/)
                    .map(w => this.normalizeForMatch(w));
                return words.some(w => w === fieldName) ||
                    this.normalizeForMatch(dm.methodName).includes(fieldName);
            })
            .sort((a, b) => a.methodName.length - b.methodName.length);
        if (reverseContains.length > 0) { return reverseContains[0]; }

        // 4. Type fallback — if the kind has exactly one candidate method, use it
        //    (e.g. an object field with a single object-returning method).
        if (candidates.length === 1) { return candidates[0]; }

        return undefined;
    }

    /** Classifies a field type or a method return type as object / array / scalar. */
    private kindOf(type: string): 'object' | 'array' | 'scalar' {
        const t = (type || '').toLowerCase();
        if (t.includes('list<') || t.endsWith('[]') || t === 'array') { return 'array'; }
        if (t.includes('dictionary') || t === 'object') { return 'object'; }
        return 'scalar';
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────

    /**
     * Strips case and all non-alphanumeric separators for matching, so `snake_case`,
     * `kebab-case`, and `CamelCase` names compare equal (e.g. `postal_code`, `postal-code`,
     * and `PostalCode` all normalise to `postalcode`). Critical for APIs like Stripe that
     * use snake_case field names while Data Library methods are CamelCase.
     */
    private normalizeForMatch(word: string): string {
        return word.toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    /** Naive singulariser for matching plural array names (photoUrls → photoUrl, tags → tag, statuses → status). */
    private singularize(word: string): string {
        if (word.endsWith('ies') && word.length > 3) { return word.slice(0, -3) + 'y'; }
        if (word.endsWith('ses') && word.length > 3) { return word.slice(0, -2); }
        if (word.endsWith('s') && !word.endsWith('ss') && word.length > 1) { return word.slice(0, -1); }
        return word;
    }

    /** Generates a unique field ID with a timestamp prefix to minimise collisions. */
    private generateId(): string {
        return 'field-' + Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9);
    }

    /** Maps a runtime JavaScript value to its JSON schema type string. */
    private getFieldType(value: any): string {
        if (value === null) { return 'string'; }
        if (typeof value === 'boolean') { return 'boolean'; }
        // Distinguish whole numbers (integer → C# int) from fractional numbers (decimal).
        if (typeof value === 'number') { return Number.isInteger(value) ? 'integer' : 'number'; }
        if (Array.isArray(value)) { return 'array'; }
        if (typeof value === 'object') { return 'object'; }
        return 'string';
    }

    /** Infers mandatory status from a sample value — a non-empty, non-null value implies the field is required. */
    private isFieldMandatory(value: any): boolean {
        return value !== null && value !== undefined && value !== '';
    }

    /** Maps a Postman/OpenAPI type string to the normalised field type used in the Data Dictionary. */
    private mapTypeToFieldType(type: string): string {
        const map: Record<string, string> = {
            text: 'string', string: 'string', number: 'number',
            integer: 'number', boolean: 'boolean',
            date: 'string', email: 'string', url: 'string'
        };
        return map[type.toLowerCase()] ?? 'string';
    }
}
