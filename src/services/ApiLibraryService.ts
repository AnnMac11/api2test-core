import { StorageProvider } from '../adapters/StorageProvider';
import { ApiFormatDetector } from './ApiFormatDetector';
import { ApiFormatAdapter } from './ApiFormatAdapter';
import { ApiMethodDto } from '../models/ApiMethodDto';

/**
 * The API library: the two ways endpoints get in, and the reads/writes over what is stored.
 *
 * There are exactly two import paths — `importFromAny` (any supported spec, format detected) and
 * `importSingleEndpoint` (a bare URL). Format-specific ones used to exist alongside them
 * (`importFromPostman`, `importFromOpenApi`); they had no caller in any client and still contained the
 * per-endpoint write loop that IMPORT-HANG removed, so they were a fixed bug kept alive under a name
 * that autocomplete offers. Removed 2026-08-10 (IMPORT-DEAD) — `importWriteCost.test.ts` asserts the
 * surface stays at two, because a third path is how the first one survived.
 */
export class ApiLibraryService {
    private fileStorage: StorageProvider;
    private formatDetector: ApiFormatDetector;
    private formatAdapter: ApiFormatAdapter;

    constructor(fileStorage: StorageProvider) {
        this.fileStorage = fileStorage;
        this.formatDetector = new ApiFormatDetector();
        this.formatAdapter = new ApiFormatAdapter();
    }

    async getApiMethods(): Promise<ApiMethodDto[]> {
        return await this.fileStorage.readJsonFile<ApiMethodDto>('api-methods.json');
    }

    /**
     * Single method to import any format (RAML, GraphQL, Insomnia, Postman, OpenAPI).
     *
     * @param applicationId - Stable id of the application being imported into (APP-ID-IMPORT).
     * Stamped on every endpoint so the link survives a rename; omit only for legacy callers.
     */
    async importFromAny(content: string, fileName: string, application: string, applicationId?: string): Promise<void> {
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
            
            // 3. Convert to our internal format and save — in ONE write. `addItem` rewrites the whole
            // collection each call, so appending 589 Stripe endpoints one at a time re-serialises a
            // multi-megabyte file 589 times: gigabytes of work that looks, from the dialog, like a hang.
            const existing = await this.fileStorage.readJsonFile<ApiMethodDto>('api-methods.json');
            const imported = unifiedEndpoints.map(unified =>
                this.formatAdapter.toApiMethodDto(unified, format, application, applicationId));
            await this.fileStorage.writeJsonFile('api-methods.json', [...existing, ...imported]);

            console.log(`Imported ${unifiedEndpoints.length} endpoints from ${format} format`);
        } catch (error) {
            if (error instanceof SyntaxError) {
                throw new Error('Invalid format in imported file');
            }
            throw new Error(`Failed to import: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Registers a bare URL as a single GET endpoint — the fallback for a URL that is not a spec.
     *
     * @param applicationId - Stable id of the application (APP-ID-IMPORT), same contract as
     * `importFromAny`. Both entry points into the library must stamp it, or a URL import is the one
     * row a rename still orphans.
     */
    async importSingleEndpoint(url: string, application: string, applicationId?: string): Promise<void> {
        const parsed = new URL(url);
        const endpoint: ApiMethodDto = {
            id: Math.random().toString(36).substr(2, 9),
            name: parsed.pathname.split('/').filter(Boolean).join(' / ') || parsed.hostname,
            method: 'GET',
            endpoint: parsed.pathname + parsed.search,
            url: url,
            description: `Imported from ${url}`,
            application,
            applicationId,
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
