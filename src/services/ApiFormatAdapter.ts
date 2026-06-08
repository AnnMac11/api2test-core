import * as yaml from 'yaml';
import { ApiMethodDto } from '../models/ApiMethodDto';
import { ApiFormat, UnifiedApiDto } from '../models/UnifiedApiDto';

export class ApiFormatAdapter {
    
    // Convert any format to UnifiedApiDto array
    adaptToUnified(content: string, format: ApiFormat): UnifiedApiDto[] {
        switch (format) {
            case 'postman':
                return this.adaptPostman(content);
            case 'openapi':
                return this.adaptOpenApi(content);
            case 'raml':
                return this.adaptRaml(content);
            case 'graphql':
                return this.adaptGraphQL(content);
            case 'insomnia':
                return this.adaptInsomnia(content);
            default:
                throw new Error(`Unsupported format: ${format}`);
        }
    }
    
    // Convert UnifiedApiDto to ApiMethodDto (our internal format)
    toApiMethodDto(unified: UnifiedApiDto, source: ApiFormat, application: string): ApiMethodDto {
        // Filter out 'unknown' format
        const validSource = source === 'unknown' ? 'postman' : source;
        
        return {
            id: this.generateId(),
            name: unified.name,
            method: unified.method,
            endpoint: unified.path,
            description: unified.description || '',
            parameters: this.formatParameters(unified.parameters),
            returnType: 'Task<HttpResponseMessage>',
            application: application,
            createdDate: new Date().toISOString(),
            isCustom: false,
            fileName: `${application}.${validSource}`,
            url: unified.url || '',
            source: validSource,
            hasExampleData: !!unified.requestBody || !!unified.responseExample,
            requestBodyTemplate: unified.requestBody ? JSON.stringify(unified.requestBody, null, 2) : '',
            responseExamples: unified.responseExample ? JSON.stringify(unified.responseExample, null, 2) : '',
            requestHeaders: this.formatHeaders(unified.headers),
            contentType: this.detectContentType(unified),
            parameterDetails: unified.parameterDetails || [],
            requestBodySchema: unified.requestBodySchema ? JSON.stringify(unified.requestBodySchema) : ''
        };
    }
    
    // Postman adapter
    private adaptPostman(content: string): UnifiedApiDto[] {
        const data = JSON.parse(content);
        const endpoints: UnifiedApiDto[] = [];
        
        const extractFromItems = (items: any[]) => {
            for (const item of items) {
                if (item.request) {
                    endpoints.push({
                        name: item.name || 'Unnamed',
                        method: item.request.method || 'GET',
                        path: this.extractPath(item.request.url),
                        url: this.extractUrl(item.request.url),
                        description: item.request.description || '',
                        headers: this.extractPostmanHeaders(item.request.header),
                        requestBody: this.extractPostmanBody(item.request.body),
                        responseExample: null,
                        parameters: this.extractPostmanParams(item.request.url)
                    });
                }
                if (item.item) {
                    extractFromItems(item.item);
                }
            }
        };
        
        if (data.item) {
            extractFromItems(data.item);
        }
        
        return endpoints;
    }
    
    // OpenAPI adapter (supports Swagger v2 and OpenAPI v3)
    private adaptOpenApi(content: string): UnifiedApiDto[] {
        let spec: any;
        try {
            spec = JSON.parse(content);
        } catch {
            spec = yaml.parse(content);
        }
        const endpoints: UnifiedApiDto[] = [];

        if (!spec.paths) { return endpoints; }

        const baseUrl = spec.servers?.[0]?.url || spec.host
            ? `${spec.schemes?.[0] || 'https'}://${spec.host}${spec.basePath || ''}`
            : '';

        for (const [path, pathItem] of Object.entries(spec.paths)) {
            for (const [method, operation] of Object.entries(pathItem as any)) {
                const op = operation as any;
                if (!['get', 'post', 'put', 'delete', 'patch'].includes(method)) { continue; }

                // Prefer operationId (technical) over summary (descriptive) — operationId
                // is more useful as a class name seed and avoids "looks like a description" confusion.
                const name = op.operationId || op.summary || `${method.toUpperCase()} ${path}`;
                // Keep description meaningful; fall back to summary if description is empty.
                const description = op.description || op.summary || '';

                // Request body — handles both Swagger v2 (body parameter) and OpenAPI v3 (requestBody).
                const requestBody = this.extractRequestBody(spec, op);

                // Capture the declared request media type (application/json,
                // application/x-www-form-urlencoded, …) so generation can pick JSON vs form encoding.
                const bodyMediaType = this.bodyMediaType(op);

                // Response example — OpenAPI v3 and v2 schema.
                const responseExample = op.responses?.['200']?.content?.['application/json']?.example
                    || this.generateExampleFromSchema(spec, op.responses?.['200']?.schema);

                endpoints.push({
                    name,
                    method: method.toUpperCase(),
                    path,
                    url: baseUrl + path,
                    description,
                    headers: bodyMediaType ? { 'Content-Type': bodyMediaType } : {},
                    requestBody,
                    responseExample,
                    requestBodySchema: this.resolveBodySchema(spec, op),
                    parameters: this.extractOpenApiParams(op.parameters),
                    parameterDetails: this.extractParameterDetails(op.parameters)
                });
            }
        }

        return endpoints;
    }

    /**
     * Extracts the request body for an operation, handling both formats:
     * - **Swagger v2**: body `in: body` parameter with a `schema`
     * - **OpenAPI v3**: `requestBody.content['application/json'].schema`
     *
     * Resolves `$ref` references against the spec's definitions/components.
     */
    private extractRequestBody(spec: any, op: any): any {
        // OpenAPI v3 — any content type (JSON, form-urlencoded, multipart, …).
        const v3 = this.firstBodyContent(op);
        if (v3?.schema) {
            return v3.example || this.generateExampleFromSchema(spec, v3.schema);
        }

        // Swagger v2: body parameter
        const bodyParam = (op.parameters || []).find((p: any) => p.in === 'body');
        if (bodyParam?.schema) {
            return this.generateExampleFromSchema(spec, bodyParam.schema);
        }

        return null;
    }

    /**
     * Generates a sample JSON object from an OpenAPI schema, resolving `$ref` references.
     * Returns `null` if the schema cannot be resolved or has no properties.
     */
    private generateExampleFromSchema(spec: any, schema: any): any {
        if (!schema) { return null; }

        // Resolve $ref (e.g. "#/definitions/Pet" or "#/components/schemas/Pet")
        if (schema.$ref) {
            schema = this.resolveRef(spec, schema.$ref);
            if (!schema) { return null; }
        }

        // No sample data: ignore schema-provided examples; emit a typed skeleton only.
        if (schema.type === 'object' || schema.properties) {
            const obj: Record<string, any> = {};
            for (const [key, prop] of Object.entries(schema.properties || {})) {
                obj[key] = this.getExampleValue(spec, prop as any);
            }
            return Object.keys(obj).length > 0 ? obj : null;
        }

        return null;
    }

    /**
     * Returns the resolved request-body schema for an operation (Swagger v2 body param or
     * OpenAPI v3 requestBody), with `$ref`s inlined into a plain tree. Returns null if none.
     */
    private resolveBodySchema(spec: any, op: any): any {
        const v3 = this.firstBodyContent(op);
        if (v3?.schema) { return this.resolveSchemaTree(spec, v3.schema, new Set()); }
        const bodyParam = (op.parameters || []).find((p: any) => p.in === 'body');
        if (bodyParam?.schema) { return this.resolveSchemaTree(spec, bodyParam.schema, new Set()); }
        return null;
    }

    /**
     * Returns the request-body content object for an OpenAPI v3 operation, preferring JSON
     * but falling back to form-urlencoded, multipart, or the first available media type.
     *
     * @remarks
     * Critical for APIs like Stripe, whose request bodies are all
     * `application/x-www-form-urlencoded` (never `application/json`). The schema shape is
     * the same regardless of media type — only the content-type key differs.
     */
    private firstBodyContent(op: any): any {
        const content = op.requestBody?.content;
        if (!content) { return null; }
        return content['application/json']
            || content['application/x-www-form-urlencoded']
            || content['multipart/form-data']
            || (Object.values(content)[0] as any)
            || null;
    }

    /**
     * Returns the request body's declared media type for an OpenAPI v3 operation
     * (e.g. `application/json`, `application/x-www-form-urlencoded`), or `null` if the
     * operation has no request body. Uses the same precedence as {@link firstBodyContent}.
     *
     * @remarks Drives JSON-vs-form serialisation downstream: Stripe (form-urlencoded) and
     * JSON APIs are distinguished purely from the spec, with no per-application hardcoding.
     */
    private bodyMediaType(op: any): string | null {
        const content = op.requestBody?.content;
        if (!content) { return null; }
        if (content['application/json']) { return 'application/json'; }
        if (content['application/x-www-form-urlencoded']) { return 'application/x-www-form-urlencoded'; }
        if (content['multipart/form-data']) { return 'multipart/form-data'; }
        return Object.keys(content)[0] || null;
    }

    /**
     * Recursively inlines `$ref`s in a schema, producing a self-contained tree of
     * `{ type, properties?, items? }`. A `seen` set guards against recursive schemas.
     */
    private resolveSchemaTree(spec: any, schema: any, seen: Set<string>): any {
        if (!schema) { return null; }
        if (schema.$ref) {
            if (seen.has(schema.$ref)) { return { type: 'object' }; } // cycle guard
            seen.add(schema.$ref);
            const resolved = this.resolveRef(spec, schema.$ref);
            return this.resolveSchemaTree(spec, resolved, seen);
        }
        // Composition keywords (Stripe uses `anyOf: [<object>, {type:string, enum:['']}]` for
        // optional object fields like `address`). Prefer the object/array alternative so the
        // field resolves to its real shape instead of falling through to a scalar string.
        const union = schema.anyOf || schema.oneOf;
        if (Array.isArray(union)) {
            const best = union.find((s: any) => s && (s.$ref || s.type === 'object' || s.type === 'array' || s.properties || s.items))
                || union[0];
            return this.resolveSchemaTree(spec, best, new Set(seen));
        }
        if (Array.isArray(schema.allOf)) {
            // Merge member objects' properties into one.
            const merged: any = { type: 'object', properties: {}, required: [] };
            for (const part of schema.allOf) {
                const r = this.resolveSchemaTree(spec, part, new Set(seen));
                if (r && r.properties) { Object.assign(merged.properties, r.properties); }
                if (r && Array.isArray(r.required)) { merged.required.push(...r.required); }
            }
            return merged;
        }
        if (schema.type === 'array' || schema.items) {
            return { type: 'array', items: this.resolveSchemaTree(spec, schema.items, new Set(seen)) };
        }
        if (schema.type === 'object' || schema.properties) {
            const properties: Record<string, any> = {};
            for (const [key, prop] of Object.entries(schema.properties || {})) {
                properties[key] = this.resolveSchemaTree(spec, prop, new Set(seen));
            }
            // Preserve the object's `required` list so body fields can be marked mandatory.
            return { type: 'object', properties, required: Array.isArray(schema.required) ? schema.required : [] };
        }
        return { type: schema.type || 'string' };
    }

    /** Resolves a JSON Pointer `$ref` string against the spec document. */
    private resolveRef(spec: any, ref: string): any {
        const parts = ref.replace(/^#\//, '').split('/');
        let node = spec;
        for (const part of parts) {
            if (!node || !(part in node)) { return null; }
            node = node[part];
        }
        return node;
    }

    /**
     * Returns a typed default value for a schema property — a clean skeleton with
     * NO sample data (spec-provided examples and enum values are intentionally ignored).
     */
    private getExampleValue(spec: any, prop: any): any {
        if (prop.$ref) {
            const resolved = this.resolveRef(spec, prop.$ref);
            if (resolved) { return this.generateExampleFromSchema(spec, resolved); }
        }
        switch (prop.type) {
            case 'string':  return '';
            case 'integer':
            case 'number':  return 0;
            case 'boolean': return false;
            case 'array':   return [];
            case 'object':  return this.generateExampleFromSchema(spec, prop) ?? {};
            default:        return '';
        }
    }
    
    // RAML adapter
    private adaptRaml(content: string): UnifiedApiDto[] {
        const spec = yaml.parse(content);
        const endpoints: UnifiedApiDto[] = [];
        const baseUri = spec.baseUri || '';
        
        const extractFromPath = (path: string, pathData: any) => {
            const methods = ['get', 'post', 'put', 'delete', 'patch'];
            for (const method of methods) {
                if (pathData[method]) {
                    const op = pathData[method];
                    endpoints.push({
                        name: op.displayName || `${method.toUpperCase()} ${path}`,
                        method: method.toUpperCase(),
                        path: path,
                        url: baseUri + path,
                        description: op.description || '',
                        headers: op.headers || {},
                        requestBody: op.body?.['application/json']?.example,
                        responseExample: op.responses?.['200']?.body?.['application/json']?.example,
                        parameters: op.queryParameters || {}
                    });
                }
            }
            
            // Nested paths
            for (const [key, value] of Object.entries(pathData)) {
                if (key.startsWith('/') && typeof value === 'object') {
                    extractFromPath(path + key, value);
                }
            }
        };
        
        for (const [key, value] of Object.entries(spec)) {
            if (key.startsWith('/')) {
                extractFromPath(key, value);
            }
        }
        
        return endpoints;
    }
    
    // GraphQL adapter
    private adaptGraphQL(content: string): UnifiedApiDto[] {
        const endpoints: UnifiedApiDto[] = [];
        
        try {
            // Try JSON (introspection result)
            const data = JSON.parse(content);
            if (data.__schema?.types) {
                for (const type of data.__schema.types) {
                    if (type.name === 'Query' || type.name === 'Mutation') {
                        const method = type.name === 'Query' ? 'QUERY' : 'MUTATION';
                        for (const field of type.fields || []) {
                            endpoints.push({
                                name: field.name,
                                method: method,
                                path: `/${field.name}`,
                                url: '/graphql',
                                description: field.description || '',
                                headers: { 'Content-Type': 'application/json' },
                                requestBody: { query: `${method.toLowerCase()} { ${field.name} }` },
                                responseExample: null,
                                parameters: field.args || []
                            });
                        }
                    }
                }
            }
        } catch {
            // Parse SDL (Schema Definition Language)
            const queryMatch = content.match(/type\s+Query\s*\{([^}]+)\}/s);
            const mutationMatch = content.match(/type\s+Mutation\s*\{([^}]+)\}/s);
            
            const extractFields = (fieldsContent: string, method: string) => {
                const fieldRegex = /(\w+)\s*(?:\([^)]*\))?\s*:/g;
                let match;
                while ((match = fieldRegex.exec(fieldsContent)) !== null) {
                    endpoints.push({
                        name: match[1],
                        method: method,
                        path: `/${match[1]}`,
                        url: '/graphql',
                        description: '',
                        headers: { 'Content-Type': 'application/json' },
                        requestBody: { query: `${method.toLowerCase()} { ${match[1]} }` },
                        responseExample: null,
                        parameters: {}
                    });
                }
            };
            
            if (queryMatch) extractFields(queryMatch[1], 'QUERY');
            if (mutationMatch) extractFields(mutationMatch[1], 'MUTATION');
        }
        
        return endpoints;
    }
    
    // Insomnia adapter
    private adaptInsomnia(content: string): UnifiedApiDto[] {
        const workspace = JSON.parse(content);
        const endpoints: UnifiedApiDto[] = [];
        
        if (!workspace.resources) return endpoints;
        
        const requests = workspace.resources.filter((r: any) => r._type === 'request');
        
        for (const req of requests) {
            if (req.url && req.method) {
                endpoints.push({
                    name: req.name || `${req.method} ${req.url}`,
                    method: req.method.toUpperCase(),
                    path: this.extractPathFromUrl(req.url),
                    url: req.url,
                    description: req.description || '',
                    headers: this.extractInsomniaHeaders(req.headers),
                    requestBody: req.body?.text ? this.tryParseJson(req.body.text) : null,
                    responseExample: null,
                    parameters: req.parameters || {}
                });
            }
        }
        
        return endpoints;
    }
    
    // Helper methods
    private extractPath(url: any): string {
        if (typeof url === 'string') return url.split('?')[0];
        if (url.raw) return url.raw.split('?')[0];
        if (url.path) return '/' + url.path.join('/');
        return '/';
    }
    
    private extractUrl(url: any): string {
        if (typeof url === 'string') return url;
        return url.raw || '';
    }
    
    private extractPathFromUrl(url: string): string {
        try {
            return new URL(url).pathname;
        } catch {
            return url.split('?')[0];
        }
    }
    
    private extractPostmanHeaders(headers: any[]): { [key: string]: string } {
        if (!headers) return {};
        return headers.reduce((acc, h) => {
            if (h.key && h.value) acc[h.key] = h.value;
            return acc;
        }, {});
    }
    
    private extractPostmanBody(body: any): any {
        if (!body) return null;
        if (body.raw) {
            return this.tryParseJson(body.raw);
        }
        if (body.formdata || body.urlencoded) {
            return body.formdata || body.urlencoded;
        }
        return null;
    }
    
    private extractPostmanParams(url: any): { [key: string]: any } {
        if (!url || !url.query) return {};
        return url.query.reduce((acc: any, q: any) => {
            if (q.key) acc[q.key] = q.value || '';
            return acc;
        }, {});
    }
    
    private extractOpenApiParams(params: any[]): { [key: string]: any } {
        if (!params) return {};
        return params.reduce((acc, p) => {
            if (p.name) acc[p.name] = p.schema?.type || p.type || 'string';
            return acc;
        }, {});
    }

    /**
     * Extracts structured path/query/header parameters from an OpenAPI operation's
     * `parameters` array, preserving each parameter's location (`in`) and required flag.
     *
     * @remarks
     * The `body` parameter (Swagger v2) is intentionally skipped — it is handled as the
     * request body, not a URL parameter. Works for both Swagger v2 (`p.type`) and
     * OpenAPI v3 (`p.schema.type`).
     */
    private extractParameterDetails(params: any[]): Array<{ name: string; type: string; location: 'path' | 'query' | 'header'; required: boolean }> {
        if (!Array.isArray(params)) { return []; }
        return params
            .filter(p => p && p.name && ['path', 'query', 'header'].includes(p.in))
            .map(p => ({
                name: p.name,
                type: p.schema?.type || p.type || 'string',
                location: p.in as 'path' | 'query' | 'header',
                required: p.required ?? (p.in === 'path')   // path params are always required
            }));
    }
    
    private extractInsomniaHeaders(headers: any[]): { [key: string]: string } {
        if (!headers) return {};
        return headers.reduce((acc, h) => {
            if (h.name && h.value) acc[h.name] = h.value;
            return acc;
        }, {});
    }
    
    private tryParseJson(text: string): any {
        try {
            return JSON.parse(text);
        } catch {
            return text;
        }
    }
    
    private formatParameters(params?: { [key: string]: any }): string {
        if (!params) return '';
        return Object.entries(params).map(([k, v]) => `${k}: ${v}`).join(', ');
    }
    
    private formatHeaders(headers?: { [key: string]: string }): string {
        if (!headers) return '';
        return Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\n');
    }
    
    private detectContentType(unified: UnifiedApiDto): string {
        if (unified.headers?.['Content-Type']) {
            return unified.headers['Content-Type'];
        }
        return 'application/json';
    }
    
    private generateId(): string {
        return Math.random().toString(36).substr(2, 9);
    }
}

