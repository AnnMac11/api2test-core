import { ApiMethodDto } from '../models/ApiMethodDto';

export interface PostmanCollection {
    info?: {
        name?: string;
        description?: string;
    };
    item?: PostmanItem[];
}

export interface PostmanItem {
    name?: string;
    description?: string;
    request?: PostmanRequest;
    item?: PostmanItem[];
}

export interface PostmanRequest {
    method?: string;
    url?: PostmanUrl | string;
    header?: PostmanHeader[];
    body?: PostmanBody;
}

export interface PostmanUrl {
    raw?: string;
    protocol?: string;
    host?: string[];
    path?: string[];
    query?: PostmanQuery[];
}

export interface PostmanHeader {
    key?: string;
    value?: string;
    description?: string;
}

export interface PostmanBody {
    mode?: string;
    raw?: string;
    formdata?: any[];
    urlencoded?: any[];
}

export interface PostmanQuery {
    key?: string;
    value?: string;
    description?: string;
}

export class PostmanParserService {
    
    parseCollection(collectionJson: string): PostmanCollection {
        try {
            const collection = JSON.parse(collectionJson);
            return collection;
        } catch (error) {
            throw new Error('Invalid JSON format in Postman collection');
        }
    }
    
    extractEndpoints(collection: PostmanCollection): ApiMethodDto[] {
        const endpoints: ApiMethodDto[] = [];
        
        if (collection.item) {
            this.extractEndpointsFromItems(collection.item, endpoints, collection.info?.name || 'Collection');
        }
        
        return endpoints;
    }
    
    private extractEndpointsFromItems(items: PostmanItem[], endpoints: ApiMethodDto[], collectionName: string): void {
        for (const item of items) {
            if (item.request) {
                const endpoint = this.createApiMethodFromItem(item, collectionName);
                endpoints.push(endpoint);
            }
            
            if (item.item) {
                this.extractEndpointsFromItems(item.item, endpoints, collectionName);
            }
        }
    }
    
    private createApiMethodFromItem(item: PostmanItem, collectionName: string): ApiMethodDto {
        const request = item.request!;
        const method = request.method || 'GET';
        const url = this.parseUrl(request.url);
        const fileName = `${collectionName}.json`;
        
        return {
            id: this.generateId(),
            name: item.name || `${method} ${url.path}`,
            method: method,
            endpoint: url.path,
            description: item.description || '',
            parameters: this.extractParameters(request),
            returnType: 'Task<HttpResponseMessage>',
            application: collectionName,
            createdDate: new Date().toISOString(),
            url: url.fullUrl,
            source: 'postman',
            hasExampleData: false,
            requestHeaders: this.extractHeaders(request.header),
            requestBodyTemplate: this.extractBody(request.body),
            responseExamples: '',
            contentType: this.getContentType(request)
        };
    }
    
    private parseUrl(url: any): { path: string; fullUrl: string } {
        if (typeof url === 'string') {
            return { path: url, fullUrl: url };
        }
        
        if (url && typeof url === 'object') {
            const postmanUrl = url as PostmanUrl;
            
            if (postmanUrl.raw) {
                return { path: this.extractPath(postmanUrl.raw), fullUrl: postmanUrl.raw };
            }
            
            if (postmanUrl.path) {
                const pathArray = Array.isArray(postmanUrl.path) ? postmanUrl.path : [postmanUrl.path];
                const pathStr = '/' + pathArray.join('/');
                const protocol = postmanUrl.protocol || 'https';
                const host = postmanUrl.host ? postmanUrl.host.join('.') : 'api.example.com';
                const query = this.buildQueryString(postmanUrl.query);
                const fullUrl = `${protocol}://${host}${pathStr}${query}`;
                
                return { path: pathStr, fullUrl };
            }
        }
        
        return { path: '/', fullUrl: 'https://api.example.com/' };
    }
    
    private extractPath(fullUrl: string): string {
        try {
            const url = new URL(fullUrl);
            return url.pathname;
        } catch {
            return '/';
        }
    }
    
    private buildQueryString(queries?: PostmanQuery[]): string {
        if (!queries || queries.length === 0) {
            return '';
        }
        
        const queryParams = queries
            .filter(q => q.key && q.value)
            .map(q => `${encodeURIComponent(q.key!)}=${encodeURIComponent(q.value!)}`)
            .join('&');
        
        return queryParams ? `?${queryParams}` : '';
    }
    
    private extractParameters(request: PostmanRequest): string {
        const params: string[] = [];
        
        if (request.header && request.header.length > 0) {
            params.push('headers: Dictionary<string, string>');
        }
        
        if (request.body && request.body.mode !== 'raw' && request.body.raw) {
            params.push('body: string');
        }
        
        return params.join(', ');
    }
    
    private extractHeaders(headers?: PostmanHeader[]): string {
        if (!headers || headers.length === 0) {
            return '';
        }
        
        return headers
            .filter(h => h.key && h.value)
            .map(h => `${h.key}: ${h.value}`)
            .join('\n');
    }
    
    private extractBody(body?: PostmanBody): string {
        if (!body) {
            return '';
        }
        
        switch (body.mode) {
            case 'raw':
                return body.raw || '';
            case 'formdata':
                return JSON.stringify(body.formdata || [], null, 2);
            case 'urlencoded':
                return JSON.stringify(body.urlencoded || [], null, 2);
            default:
                return '';
        }
    }
    
    private getContentType(request: PostmanRequest): string {
        if (request.header) {
            const contentTypeHeader = request.header.find(h => 
                h.key?.toLowerCase() === 'content-type'
            );
            if (contentTypeHeader?.value) {
                return contentTypeHeader.value;
            }
        }
        
        return 'application/json';
    }
    
    private generateId(): string {
        return Math.random().toString(36).substr(2, 9);
    }
}
