import { FileStorageService } from './FileStorageService';
import { PostmanParserService } from './PostmanParserService';
import { OpenApiParserService } from './OpenApiParserService';
import { ApiFormatDetector } from './ApiFormatDetector';
import { ApiFormatAdapter } from './ApiFormatAdapter';
import { ApiMethodDto } from '../models/ApiMethodDto';

export class ApiLibraryService {
    private fileStorage: FileStorageService;
    private postmanParser: PostmanParserService;
    private openApiParser: OpenApiParserService;
    private formatDetector: ApiFormatDetector;
    private formatAdapter: ApiFormatAdapter;
    
    constructor(fileStorage: FileStorageService) {
        this.fileStorage = fileStorage;
        this.postmanParser = new PostmanParserService();
        this.openApiParser = new OpenApiParserService();
        this.formatDetector = new ApiFormatDetector();
        this.formatAdapter = new ApiFormatAdapter();
    }

    async getApiMethods(): Promise<ApiMethodDto[]> {
        return await this.fileStorage.readJsonFile<ApiMethodDto>('api-methods.json');
    }

    // Single method to import any format (RAML, GraphQL, Insomnia, Postman, OpenAPI)
    async importFromAny(content: string, fileName: string, application: string): Promise<void> {
        try {
            // 1. Detect format
            const format = this.formatDetector.detect(content, fileName);
            
            if (format === 'unknown') {
                throw new Error('Unknown API format. Supported: Postman, OpenAPI, RAML, GraphQL, Insomnia');
            }
            
            // 2. Adapt to unified format
            const unifiedEndpoints = this.formatAdapter.adaptToUnified(content, format);
            
            if (unifiedEndpoints.length === 0) {
                throw new Error('No endpoints found in the imported file');
            }
            
            // 3. Convert to our internal format and save
            for (const unified of unifiedEndpoints) {
                const apiMethod = this.formatAdapter.toApiMethodDto(unified, format, application);
                await this.fileStorage.addItem('api-methods.json', apiMethod);
            }
            
            console.log(`Imported ${unifiedEndpoints.length} endpoints from ${format} format`);
        } catch (error) {
            if (error instanceof SyntaxError) {
                throw new Error('Invalid format in imported file');
            }
            throw new Error(`Failed to import: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async importFromPostman(collectionJson: string, collectionName: string): Promise<void> {
        try {
            const collection = this.postmanParser.parseCollection(collectionJson);
            const endpoints = this.postmanParser.extractEndpoints(collection);

            if (endpoints.length === 0) {
                throw new Error('No endpoints found in Postman collection');
            }

            for (const endpoint of endpoints) {
                await this.fileStorage.addItem('api-methods.json', endpoint);
            }

        } catch (error) {
            if (error instanceof SyntaxError) {
                throw new Error('Invalid JSON format in Postman collection');
            }
            throw new Error(`Failed to import Postman collection: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async importFromOpenApi(openApiJson: string, collectionName: string): Promise<void> {
        try {
            const spec = this.openApiParser.parseSpec(openApiJson);
            const endpoints = this.openApiParser.extractEndpoints(spec);

            if (endpoints.length === 0) {
                throw new Error('No endpoints found in OpenAPI specification');
            }

            for (const endpoint of endpoints) {
                await this.fileStorage.addItem('api-methods.json', endpoint);
            }

        } catch (error) {
            if (error instanceof SyntaxError) {
                throw new Error('Invalid JSON format in OpenAPI specification');
            }
            throw new Error(`Failed to import OpenAPI specification: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async importSingleEndpoint(url: string, application: string): Promise<void> {
        const parsed = new URL(url);
        const endpoint: ApiMethodDto = {
            id: Math.random().toString(36).substr(2, 9),
            name: parsed.pathname.split('/').filter(Boolean).join(' / ') || parsed.hostname,
            method: 'GET',
            endpoint: parsed.pathname + parsed.search,
            url: url,
            description: `Imported from ${url}`,
            application,
            createdDate: new Date().toISOString(),
            source: undefined,
            isCustom: false,
            contentType: 'application/json'
        };
        await this.fileStorage.addItem('api-methods.json', endpoint);
    }

    async deleteApiMethod(id: string): Promise<void> {
        await this.fileStorage.deleteItem('api-methods.json', id);
    }

    async getApiMethodById(id: string): Promise<ApiMethodDto | undefined> {
        return await this.fileStorage.getItemById<ApiMethodDto>('api-methods.json', id);
    }

    async updateApiMethod(id: string, method: ApiMethodDto): Promise<void> {
        await this.fileStorage.updateItem('api-methods.json', id, method);
    }

}
