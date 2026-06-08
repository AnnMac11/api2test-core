import { CodeEmitter, TargetLanguage } from './CodeEmitter';
import { StorageProvider } from './StorageProvider';
import { ClassGenerationRequest } from '../models/ClassGenerationDto';
import { ClassGenerationService } from '../services/ClassGenerationService';
import { TestGenerationService, TestGenerationRequest } from '../services/TestGenerationService';

/**
 * Default {@link CodeEmitter} — renders C# request classes and integration tests by delegating
 * to the existing generation services. Pure rendering (no persistence).
 */
export class CSharpEmitter implements CodeEmitter {
    readonly language: TargetLanguage = 'csharp';
    readonly fileExtension = 'cs';

    private classGen: ClassGenerationService;
    private testGen: TestGenerationService;

    constructor(storage: StorageProvider) {
        this.classGen = new ClassGenerationService(storage);
        this.testGen = new TestGenerationService(storage);
    }

    emitRequestClass(request: ClassGenerationRequest): string | null {
        return this.classGen.renderClassCode(request);
    }

    emitTest(request: TestGenerationRequest): string {
        return this.testGen.generateCode(request);
    }
}
