import { ApiClassLibraryDto, ApiClassLibraryFieldDto } from '../models/ApiClassLibraryDto';
import { ApiMethodDto } from '../models/ApiMethodDto';
import { DataDictionaryField } from '../models/DataDictionaryDto';
import { NOT_ASSIGNED } from './DataDictionaryService';
import { FileStorageService } from './FileStorageService';

/**
 * Service for managing the API Class Library — a collection of class entries
 * that link imported API endpoints to their Data Dictionary fields.
 *
 * Each entry stores enough information to generate a C# request-body class at
 * any time, even after the source endpoint has been deleted.
 */
export class ApiClassLibraryService {
    private fileStorage: FileStorageService;

    constructor(fileStorage: FileStorageService) {
        this.fileStorage = fileStorage;
    }

    /**
     * Returns all class library entries.
     * @returns Array of {@link ApiClassLibraryDto}, or empty array if the file is missing.
     */
    async getClassLibrary(): Promise<ApiClassLibraryDto[]> {
        return await this.fileStorage.readJsonFile<ApiClassLibraryDto>('api-class-library.json');
    }

    /**
     * Creates a new class library entry from an imported endpoint and its Data Dictionary fields.
     *
     * @remarks
     * Stores `mandatory` and `dataMethod` from each {@link DataDictionaryField} so the
     * class generator can produce correctly typed and data-bound properties without
     * needing to re-query the Data Dictionary later.
     *
     * @param apiMethod - The imported API endpoint this class represents.
     * @param fields - Data Dictionary fields linked to this endpoint.
     */
    async addClass(apiMethod: ApiMethodDto, fields: DataDictionaryField[]): Promise<void> {
        const className = this.generateClassName(
            apiMethod.application,
            apiMethod.name || apiMethod.endpoint
        );

        const classEntry: ApiClassLibraryDto = {
            id: this.generateId(),
            endpointId: apiMethod.id,
            className,
            application: apiMethod.application,
            method: apiMethod.method,
            endpoint: apiMethod.endpoint,
            fields: fields.map((f): ApiClassLibraryFieldDto => ({
                fieldName: f.fieldName,
                fieldType: f.fieldType,
                mandatory: f.mandatory ?? false,
                dataMethod: f.dataMethod || NOT_ASSIGNED,
                dataMethodArgs: f.dataMethodArgs || '',
                location: f.location || 'body'
            })),
            requestBodySchema: apiMethod.requestBodySchema || '',
            contentType: apiMethod.contentType || 'application/json',
            createdDate: new Date().toISOString()
        };

        await this.fileStorage.addItem('api-class-library.json', classEntry);
    }

    /**
     * Returns a single class entry by ID.
     * @param id - The class entry ID.
     * @returns The matching {@link ApiClassLibraryDto}, or `undefined` if not found.
     */
    async getClassById(id: string): Promise<ApiClassLibraryDto | undefined> {
        return await this.fileStorage.getItemById<ApiClassLibraryDto>('api-class-library.json', id);
    }

    /**
     * Returns the class entry linked to a specific API endpoint ID, if one exists.
     * @param endpointId - The `id` of the source {@link ApiMethodDto}.
     * @returns The matching {@link ApiClassLibraryDto}, or `undefined`.
     */
    async getClassByEndpointId(endpointId: string): Promise<ApiClassLibraryDto | undefined> {
        const classes = await this.getClassLibrary();
        return classes.find(c => c.endpointId === endpointId);
    }

    /**
     * Updates an existing class entry in place.
     * @param id - ID of the entry to update.
     * @param classEntry - Updated {@link ApiClassLibraryDto}.
     */
    async updateClass(id: string, classEntry: ApiClassLibraryDto): Promise<void> {
        await this.fileStorage.updateItem('api-class-library.json', id, classEntry);
    }

    /**
     * Permanently removes a class entry.
     * @param id - ID of the entry to delete.
     */
    async deleteClass(id: string): Promise<void> {
        await this.fileStorage.deleteItem('api-class-library.json', id);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────

    /**
     * Generates a PascalCase C# class name from the application name and API name.
     * e.g. application="ABC Website", apiName="addPet" → "ABCWebsiteAddpet"
     */
    private generateClassName(application: string, apiName: string): string {
        const pascalCase = (s: string) => s
            .replace(/[^A-Za-z0-9]+/g, ' ')   // split on any non-alphanumeric (hyphen, space, dot, slash…)
            .split(' ')
            .filter(Boolean)
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join('');
        const name = `${pascalCase(application)}${pascalCase(apiName)}`;
        return /^[0-9]/.test(name) ? `_${name}` : (name || 'GeneratedClass');
    }

    /** Generates a short random ID. */
    private generateId(): string {
        return Math.random().toString(36).substr(2, 9);
    }
}
