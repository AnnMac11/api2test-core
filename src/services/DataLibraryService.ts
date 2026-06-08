import { DataMethodDto } from '../models/DataMethodDto';
import { FileStorageService } from './FileStorageService';

/**
 * Service for managing the Data Library — the collection of reusable C# data-generation
 * methods used to populate test data during code generation.
 *
 * All reads normalise PascalCase JSON properties (legacy backend format) to camelCase
 * so consumers always receive a consistent {@link DataMethodDto} shape.
 */
export class DataLibraryService {
    private fileStorage: FileStorageService;

    constructor(fileStorage: FileStorageService) {
        this.fileStorage = fileStorage;
    }

    /**
     * Returns all data methods from the library, normalised to camelCase.
     * @returns Array of all {@link DataMethodDto} entries, or an empty array if the file is missing.
     */
    async getDataMethods(): Promise<DataMethodDto[]> {
        const raw = await this.fileStorage.readJsonFile<any>('data-library.json');
        return raw.map(dm => this.normalizeDataMethod(dm));
    }

    /**
     * Returns a single data method by ID.
     * Routes through {@link getDataMethods} to ensure PascalCase normalisation is applied
     * before the ID comparison — the raw JSON uses `Id` (PascalCase) while callers
     * always work with `id` (camelCase).
     * @param id - The unique identifier of the method to retrieve.
     * @returns The matching {@link DataMethodDto}, or `undefined` if not found.
     */
    async getDataMethodById(id: string): Promise<DataMethodDto | undefined> {
        const all = await this.getDataMethods();
        return all.find(m => m.id === id);
    }

    /**
     * Persists a new data method to the library.
     * @param method - The {@link DataMethodDto} to add.
     */
    async createDataMethod(method: DataMethodDto): Promise<void> {
        await this.fileStorage.addItem('data-library.json', method);
    }

    /**
     * Updates an existing data method in place.
     * @param id - ID of the method to update.
     * @param method - Updated {@link DataMethodDto} values.
     */
    async updateDataMethod(id: string, method: DataMethodDto): Promise<void> {
        await this.fileStorage.updateItem('data-library.json', id, method);
    }

    /**
     * Permanently removes a data method from the library.
     * @param id - ID of the method to delete.
     */
    async deleteDataMethod(id: string): Promise<void> {
        await this.fileStorage.deleteItem('data-library.json', id);
    }

    // ── Private helpers ──────────────────────────────────────────────────────────

    /**
     * Normalises a raw JSON record from data-library.json to a {@link DataMethodDto}.
     *
     * @remarks
     * The backing JSON file uses PascalCase property names (`MethodName`, `ReturnType`, etc.)
     * because it was originally produced by a C# backend. This method maps both the legacy
     * PascalCase keys and the current camelCase keys so the service is forward-compatible
     * with either format.
     *
     * @param dm - Raw JSON object read directly from disk.
     * @returns A fully normalised {@link DataMethodDto}.
     */
    private normalizeDataMethod(dm: any): DataMethodDto {
        return {
            id:          dm.id          ?? dm.Id          ?? this.generateId(),
            methodName:  dm.methodName  ?? dm.MethodName  ?? '',
            description: dm.description ?? dm.Description ?? '',
            parameters:  dm.parameters  ?? dm.Parameters  ?? '',
            returnType:  dm.returnType  ?? dm.ReturnType  ?? '',
            code:        dm.code        ?? dm.Code        ?? '',
            category:    dm.category    ?? dm.Category    ?? '',
            application: dm.application ?? dm.Application ?? '',
            isCustom:    dm.isCustom    ?? dm.IsCustom    ?? false,
            createdDate: dm.createdDate ?? dm.CreatedDate ?? new Date().toISOString(),
            comments:    dm.comments    ?? dm.Comments    ?? ''
        };
    }

    /**
     * Generates a random ID for records that arrive from disk without one.
     * @returns A short random base-36 string.
     */
    private generateId(): string {
        return Math.random().toString(36).substr(2, 9);
    }
}
