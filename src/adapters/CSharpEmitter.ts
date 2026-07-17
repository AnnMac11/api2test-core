import { CodeEmitter, TargetLanguage } from './CodeEmitter';
import { StorageProvider } from './StorageProvider';
import { ClassGenerationRequest } from '../models/ClassGenerationDto';
import { ClassGenerationService } from '../services/ClassGenerationService';
import { TestGenerationService, TestGenerationRequest } from '../services/TestGenerationService';
import { generateApiMethodsCSharp, ApiMethodForGeneration, CSharpGenerationOptions } from '../services/generateApiMethodsCSharp';
import { generateDataLibraryCode, DataMethodCode } from '../services/generateDataLibrary';
import { generateTestForRow } from '../services/E2ETestGenerationService';
import { E2EPage, E2ETestCaseRow, E2EGenContext } from '../models/E2EDto';

/**
 * Default {@link CodeEmitter} — renders C# request classes, tests, libraries and E2E chains by
 * delegating to the existing generation services/functions. Pure rendering (no persistence).
 */
export class CSharpEmitter implements CodeEmitter {
    readonly language: TargetLanguage = 'csharp';
    readonly fileExtension = 'cs';
    readonly libraryFileNames = { apiMethods: 'ApiMethods.cs', dataLibrary: 'DataGenerator.cs' };

    testFileName(baseName: string): string { return `${baseName}Tests.cs`; }
    classFileName(baseName: string): string { return `${baseName}.cs`; }

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

    emitApiMethods(methods: ApiMethodForGeneration[], options?: CSharpGenerationOptions): string {
        return generateApiMethodsCSharp(methods, options);
    }

    emitDataLibrary(methods: DataMethodCode[], root?: string): string {
        return generateDataLibraryCode(methods, root);
    }

    emitE2ETest(row: E2ETestCaseRow, page: E2EPage, ctx: E2EGenContext): string {
        return generateTestForRow(row, page, ctx);
    }
}
