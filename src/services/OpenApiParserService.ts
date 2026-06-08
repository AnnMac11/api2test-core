import { ApiMethodDto } from '../models/ApiMethodDto';

export interface OpenApiSpec {
    openapi?: string;
    swagger?: string;
    info?: {
        title?: string;
        description?: string;
        version?: string;
    };
    paths?: {
        [path: string]: {
            [method: string]: OpenApiOperation;
        };
    };
}

export interface OpenApiOperation {
    summary?: string;
    description?: string;
    operationId?: string;
    parameters?: OpenApiParameter[];
    requestBody?: OpenApiRequestBody;
    responses?: {
        [statusCode: string]: OpenApiResponse;
    };
}

export interface OpenApiParameter {
    name?: string;
    in?: string;
    description?: string;
    required?: boolean;
    schema?: {
        type?: string;
        format?: string;
    };
}

export interface OpenApiRequestBody {
    description?: string;
    required?: boolean;
    content?: {
        [mediaType: string]: {
            schema?: any;
            example?: any;
        };
    };
}

export interface OpenApiResponse {
    description?: string;
    content?: {
        [mediaType: string]: {
            schema?: any;
            example?: any;
        };
    };
}

export class OpenApiParserService {
    
    parseSpec(specJson: string): OpenApiSpec {
        try {
            const spec = JSON.parse(specJson);
            return spec;
        } catch (error) {
            throw new Error('Invalid JSON format in OpenAPI specification');
        }
    }
    
    extractEndpoints(spec: OpenApiSpec): ApiMethodDto[] {
        const endpoints: ApiMethodDto[] = [];
        
        if (!spec.paths) {
            return endpoints;
        }
        
        const collectionName = spec.info?.title || 'OpenAPI Spec';
        
        for (const [path, pathItem] of Object.entries(spec.paths)) {
            for (const [method, operation] of Object.entries(pathItem)) {
                if (this.isValidHttpMethod(method)) {
                    const endpoint = this.createApiMethodFromOperation(
                        path,
                        method.toUpperCase(),
                        operation,
                        collectionName
                    );
                    endpoints.push(endpoint);
                }
            }
        }
        
        return endpoints;
    }
    
    private isValidHttpMethod(method: string): boolean {
        const validMethods = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'];
        return validMethods.includes(method.toLowerCase());
    }
    
    private createApiMethodFromOperation(
        path: string,
        method: string,
        operation: OpenApiOperation,
        collectionName: string
    ): ApiMethodDto {
        const fileName = `${collectionName}.json`;
        
        return {
            id: this.generateId(),
            name: operation.summary || operation.operationId || `${method} ${path}`,
            method: method,
            endpoint: path,
            description: operation.description || '',
            parameters: this.extractParameters(operation),
            returnType: 'Task<HttpResponseMessage>',
            application: collectionName,
            createdDate: new Date().toISOString(),
            url: this.buildUrl(path, method),
            source: 'openapi',
            hasExampleData: this.hasExampleData(operation),
            requestHeaders: this.extractHeaders(operation),
            requestBodyTemplate: this.extractRequestBody(operation),
            responseExamples: this.extractResponseExamples(operation),
            contentType: this.getContentType(operation)
        };
    }
    
    private extractParameters(operation: OpenApiOperation): string {
        const params: string[] = [];
        
        if (operation.parameters) {
            for (const param of operation.parameters) {
                if (param.in === 'header') {
                    params.push('headers: Dictionary<string, string>');
                    break; // Only add once
                }
            }
        }
        
        if (operation.requestBody) {
            params.push('body: string');
        }
        
        return params.join(', ');
    }
    
    private extractHeaders(operation: OpenApiOperation): string {
        if (!operation.parameters) {
            return '';
        }
        
        const headerParams = operation.parameters.filter(p => p.in === 'header');
        return headerParams
            .map(h => `${h.name}: ${h.schema?.type || 'string'}`)
            .join('\n');
    }
    
    private extractRequestBody(operation: OpenApiOperation): string {
        if (!operation.requestBody?.content) {
            return '';
        }
        
        const contentTypes = Object.keys(operation.requestBody.content);
        const primaryContentType = contentTypes.find(ct => ct.includes('json')) || contentTypes[0];
        
        if (primaryContentType && operation.requestBody.content[primaryContentType]) {
            const content = operation.requestBody.content[primaryContentType];
            if (content.example) {
                return JSON.stringify(content.example, null, 2);
            }
            if (content.schema) {
                return JSON.stringify(this.generateExampleFromSchema(content.schema), null, 2);
            }
        }
        
        return '';
    }
    
    private extractResponseExamples(operation: OpenApiOperation): string {
        if (!operation.responses) {
            return '';
        }
        
        const responses: string[] = [];
        
        for (const [statusCode, response] of Object.entries(operation.responses)) {
            if (response.content) {
                const contentTypes = Object.keys(response.content);
                const primaryContentType = contentTypes.find(ct => ct.includes('json')) || contentTypes[0];
                
                if (primaryContentType && response.content[primaryContentType]) {
                    const content = response.content[primaryContentType];
                    if (content.example) {
                        responses.push(`${statusCode}: ${JSON.stringify(content.example, null, 2)}`);
                    }
                }
            }
        }
        
        return responses.join('\n\n');
    }
    
    private getContentType(operation: OpenApiOperation): string {
        if (operation.requestBody?.content) {
            const contentTypes = Object.keys(operation.requestBody.content);
            return contentTypes.find(ct => ct.includes('json')) || contentTypes[0] || 'application/json';
        }
        
        return 'application/json';
    }
    
    private buildUrl(path: string, method: string): string {
        // This is a simplified URL builder - in a real implementation,
        // you might want to extract the server/base URL from the OpenAPI spec
        return `https://api.example.com${path}`;
    }
    
    private hasExampleData(operation: OpenApiOperation): boolean {
        if (operation.requestBody?.content) {
            for (const content of Object.values(operation.requestBody.content)) {
                if (content.example || content.schema) {
                    return true;
                }
            }
        }
        
        if (operation.responses) {
            for (const response of Object.values(operation.responses)) {
                if (response.content) {
                    for (const content of Object.values(response.content)) {
                        if (content.example || content.schema) {
                            return true;
                        }
                    }
                }
            }
        }
        
        return false;
    }
    
    private generateExampleFromSchema(schema: any): any {
        if (!schema) {
            return {};
        }
        
        switch (schema.type) {
            case 'string':
                return schema.example || 'string';
            case 'integer':
                return schema.example || 123;
            case 'number':
                return schema.example || 123.45;
            case 'boolean':
                return schema.example || true;
            case 'array':
                return schema.example || [];
            case 'object':
                if (schema.properties) {
                    const example: any = {};
                    for (const [propName, propSchema] of Object.entries(schema.properties as any)) {
                        example[propName] = this.generateExampleFromSchema(propSchema);
                    }
                    return example;
                }
                return schema.example || {};
            default:
                return schema.example || null;
        }
    }
    
    private generateId(): string {
        return Math.random().toString(36).substr(2, 9);
    }
}
