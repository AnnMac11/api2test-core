import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export class FileStorageService {
    private dataPath: string;
    
    constructor() {
        // Use a more appropriate path for VS Code extension data
        this.dataPath = path.join(os.homedir(), '.vscode', 'API2Test', 'data');
        this.ensureDataDirectory();
        this.initializeDefaultData();
    }
    
    private ensureDataDirectory(): void {
        if (!fs.existsSync(this.dataPath)) {
            fs.mkdirSync(this.dataPath, { recursive: true });
        }
    }
    
    private initializeDefaultData(): void {
        const defaultFiles = [
            'applications.json',
            'data-library.json',
            'data-dictionary.json',
            'api-methods.json',
            'api-method-library.json',
            'api-class-library.json',
            'generated-classes.json',
            'api-tests.json'
        ];
        
        for (const filename of defaultFiles) {
            const targetPath = path.join(this.dataPath, filename);
            
            // Only copy if file doesn't exist (don't overwrite user data)
            if (!fs.existsSync(targetPath)) {
                const sourcePath = path.join(__dirname, '..', '..', 'resources', 'data', filename);
                
                // Check if source file exists in resources
                if (fs.existsSync(sourcePath)) {
                    try {
                        const content = fs.readFileSync(sourcePath, 'utf8');
                        fs.writeFileSync(targetPath, content, 'utf8');
                    } catch (error) {
                        console.warn(`Failed to copy default file ${filename}:`, error);
                    }
                }
            }
        }
        
        // data-dictionary.json is now included in defaultFiles and will be copied with proper wrapper format
    }
    
    async readJsonFile<T>(filename: string): Promise<T[]> {
        const filePath = path.join(this.dataPath, filename);
        if (!fs.existsSync(filePath)) {
            return [];
        }
        
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const data = JSON.parse(content);
            return this.extractArrayFromWrapper<T>(data, filename);
        } catch (error) {
            console.error(`Error reading JSON file ${filename}:`, error);
            return [];
        }
    }
    
    async writeJsonFile<T>(filename: string, data: T[]): Promise<void> {
        const filePath = path.join(this.dataPath, filename);
        
        // Always wrap data in object for consistency
        const wrapperKey = this.getWrapperKey(filename);
        const wrappedData = wrapperKey ? { [wrapperKey]: data } : data;
        
        const content = JSON.stringify(wrappedData, null, 2);
        
        try {
            fs.writeFileSync(filePath, content, 'utf8');
        } catch (error) {
            console.error(`Error writing JSON file ${filename}:`, error);
            throw error;
        }
    }

    private extractArrayFromWrapper<T>(data: any, filename: string): T[] {
        // If the root is already an array, accept it.
        if (Array.isArray(data)) {
            return data;
        }

        // Case-insensitive wrapper lookup
        if (data && typeof data === 'object') {
            const wrapperKey = this.getWrapperKey(filename);
            if (wrapperKey) {
                const matchKey = Object.keys(data).find(k => k.toLowerCase() === wrapperKey.toLowerCase());
                if (matchKey && Array.isArray((data as any)[matchKey])) {
                    return (data as any)[matchKey];
                }
            }

            // Fallback: if there is exactly one array value in the object, use it
            const arrayValue = Object.values(data).find(v => Array.isArray(v)) as T[] | undefined;
            if (arrayValue) {
                return arrayValue;
            }
        }
        
        // If format is incorrect, return empty array and log warning
        console.warn(`Invalid data format in ${filename}. Expected object-wrapped array.`);
        return [];
    }

    private getWrapperKey(filename: string): string {
        const keyMap: { [key: string]: string } = {
            'api-methods.json': 'apiMethods',
            'api-method-library.json': 'apiMethods',
            'data-library.json': 'dataMethods',
            'data-dictionary.json': 'dataDictionary',
            'api-class-library.json': 'apiClassLibrary',
            'applications.json': 'applications',
            'generated-classes.json': 'generatedClasses',
            'api-tests.json': 'apiTests'
        };
        return keyMap[filename] || '';
    }

    
    async addItem<T extends { id?: string }>(filename: string, item: T): Promise<void> {
        const data = await this.readJsonFile<T>(filename);
        
        // Generate ID if not provided
        if (!item.id) {
            item.id = this.generateId();
        }
        
        data.push(item);
        await this.writeJsonFile(filename, data);
    }
    
    async updateItem<T extends { id: string }>(filename: string, id: string, item: T): Promise<void> {
        const data = await this.readJsonFile<T>(filename);
        const index = data.findIndex(x => x.id === id);
        
        if (index !== -1) {
            data[index] = { ...item, id }; // Ensure ID is preserved
            await this.writeJsonFile(filename, data);
        } else {
            throw new Error(`Item with id ${id} not found in ${filename}`);
        }
    }
    
    async deleteItem(filename: string, id: string): Promise<void> {
        const data = await this.readJsonFile<any>(filename);
        const filtered = data.filter(x => x.id !== id);
        
        if (filtered.length === data.length) {
            throw new Error(`Item with id ${id} not found in ${filename}`);
        }
        
        await this.writeJsonFile(filename, filtered);
    }
    
    async getItemById<T extends { id: string }>(filename: string, id: string): Promise<T | undefined> {
        const data = await this.readJsonFile<T>(filename);
        return data.find(x => x.id === id);
    }
    
    private generateId(): string {
        return Math.random().toString(36).substr(2, 9);
    }
    
    getDataPath(): string {
        return this.dataPath;
    }
}
