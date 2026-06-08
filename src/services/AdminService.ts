import { FileStorageService } from './FileStorageService';
import { ApplicationDto } from '../models/ApplicationDto';

export class AdminService {
    private fileStorage: FileStorageService;
    
    constructor(fileStorage: FileStorageService) {
        this.fileStorage = fileStorage;
    }
    
    async getApplications(): Promise<ApplicationDto[]> {
        return await this.fileStorage.readJsonFile<ApplicationDto>('applications.json');
    }
    
    async addApplication(application: ApplicationDto): Promise<void> {
        await this.fileStorage.addItem('applications.json', application);
    }
    
    async updateApplication(id: string, application: ApplicationDto): Promise<void> {
        await this.fileStorage.updateItem('applications.json', id, application);
    }
    
    async deleteApplication(id: string): Promise<void> {
        await this.fileStorage.deleteItem('applications.json', id);
    }
    
    async getApplicationById(id: string): Promise<ApplicationDto | undefined> {
        return await this.fileStorage.getItemById<ApplicationDto>('applications.json', id);
    }
}
