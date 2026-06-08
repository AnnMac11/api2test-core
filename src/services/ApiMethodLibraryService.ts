import { StorageProvider } from '../adapters/StorageProvider';
import { ApiMethodLibraryDto } from '../models/ApiMethodDto';

export class ApiMethodLibraryService {
    private fileStorage: StorageProvider;
    
    constructor(fileStorage: StorageProvider) {
        this.fileStorage = fileStorage;
    }
    
    async getApiMethods(): Promise<ApiMethodLibraryDto[]> {
        return await this.fileStorage.readJsonFile<ApiMethodLibraryDto>('api-method-library.json');
    }
    
    async addApiMethod(method: ApiMethodLibraryDto): Promise<void> {
        await this.fileStorage.addItem('api-method-library.json', method);
    }
    
    async updateApiMethod(id: string, method: ApiMethodLibraryDto): Promise<void> {
        await this.fileStorage.updateItem('api-method-library.json', id, method);
    }
    
    async deleteApiMethod(id: string): Promise<void> {
        await this.fileStorage.deleteItem('api-method-library.json', id);
    }
    
    async getApiMethodById(id: string): Promise<ApiMethodLibraryDto | undefined> {
        return await this.fileStorage.getItemById<ApiMethodLibraryDto>('api-method-library.json', id);
    }
}
