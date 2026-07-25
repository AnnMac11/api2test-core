import { ApiClassLibraryDto, ApiClassLibraryFieldDto } from '../models/ApiClassLibraryDto';
import { ApiMethodDto } from '../models/ApiMethodDto';
import { DataDictionaryField } from '../models/DataDictionaryDto';
import { NOT_ASSIGNED } from './DataDictionaryService';
import { StorageProvider } from '../adapters/StorageProvider';

/**
 * Service for managing the API Class Library â€” a collection of class entries
 * that link imported API endpoints to their Data Dictionary fields.
 *
 * Each entry stores enough information to generate a C# request-body class at
 * any time, even after the source endpoint has been deleted.
 */
export class ApiClassLibraryService {
    private fileStorage: StorageProvider;

    constructor(fileStorage: StorageProvider) {
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
            fields: this.toClassFields(fields),
            requestBodySchema: apiMethod.requestBodySchema || '',
            contentType: apiMethod.contentType || 'application/json',
            createdDate: new Date().toISOString()
        };

        await this.fileStorage.addItem('api-class-library.json', classEntry);
    }

    /**
     * RB-4 — re-pull a class entry's fields from the current Data Dictionary and persist that fresh
     * snapshot onto the entry. This is a **full re-sync**: fields new to the dictionary are added, changed
     * `dataMethod`/type assignments are updated, and fields removed from the dictionary are dropped —
     * because a class stores its own snapshot (see {@link addClass}) and the dictionary is the source of
     * truth after the user assigns a newly-added data method.
     *
     * By design this REUSES the add-class population path exactly (filter by `sourceEndpointId` →
     * {@link toClassFields}) rather than diffing/merging — the caller hands in the current dictionary
     * (the same `getDataDictionary()` list both editions already load), and the method filters to this
     * class's endpoint. "Update & Generate" = call this, then run the existing generate.
     *
     * @param id - The class entry to re-sync.
     * @param dictionaryFields - The current Data Dictionary (unfiltered — filtered here by endpoint).
     * @returns The updated entry, or `undefined` if no class has that id.
     */
    async resyncClassFields(
        id: string,
        dictionaryFields: DataDictionaryField[]
    ): Promise<ApiClassLibraryDto | undefined> {
        const entry = await this.getClassById(id);
        if (!entry) { return undefined; }

        const linked = dictionaryFields.filter(f => f.sourceEndpointId === entry.endpointId);
        const updated: ApiClassLibraryDto = { ...entry, fields: this.toClassFields(linked) };
        await this.updateClass(id, updated);
        return updated;
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

    // â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    /**
     * Maps Data Dictionary fields to the class entry's stored field snapshot. Stores `mandatory`,
     * `dataMethod`, args and location so the generator produces correctly typed, data-bound properties
     * without re-querying the dictionary. Shared by {@link addClass} and {@link resyncClassFields} so the
     * initial population and a later re-sync build the snapshot identically.
     */
    private toClassFields(fields: DataDictionaryField[]): ApiClassLibraryFieldDto[] {
        return fields.map((f): ApiClassLibraryFieldDto => ({
            fieldName: f.fieldName,
            fieldType: f.fieldType,
            mandatory: f.mandatory ?? false,
            dataMethod: f.dataMethod || NOT_ASSIGNED,
            dataMethodArgs: f.dataMethodArgs || '',
            location: f.location || 'body'
        }));
    }

    /**
     * Generates a PascalCase C# class name from the application name and API name.
     * e.g. application="ABC Website", apiName="addPet" â†’ "ABCWebsiteAddpet"
     */
    private generateClassName(application: string, apiName: string): string {
        const pascalCase = (s: string) => s
            .replace(/[^A-Za-z0-9]+/g, ' ')   // split on any non-alphanumeric (hyphen, space, dot, slashâ€¦)
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
