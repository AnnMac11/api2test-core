import { CodeEmitter, TargetLanguage } from './CodeEmitter';
import { StorageProvider } from './StorageProvider';
import { ClassGenerationRequest } from '../models/ClassGenerationDto';
import { TestGenerationRequest } from '../services/TestGenerationService';
import { ApiMethodForGeneration, CSharpGenerationOptions } from '../services/generateApiMethodsCSharp';
import { generateApiMethodsPython } from '../services/generateApiMethodsPython';
import { generateRequestClassPython } from '../services/generateRequestClassPython';
import { generateDataLibraryPython } from '../services/generateDataLibraryPython';
import { generateTestPython } from '../services/generateTestPython';
import { generateE2ETestPython } from '../services/generateE2ETestPython';
import { DataMethodCode } from '../services/generateDataLibrary';
import { E2EPage, E2ETestCaseRow, E2EGenContext } from '../models/E2EDto';

/**
 * Python {@link CodeEmitter} (PY-GEN-1) — produces pytest-targeted Python sources. All five emit
 * kinds are implemented by pure render functions; each `emit*` delegates to one.
 */
export class PythonEmitter implements CodeEmitter {
    readonly language: TargetLanguage = 'python';
    readonly fileExtension = 'py';
    // api_methods/data_generator are the exact modules the emitted package imports resolve;
    // test_*.py is required for pytest discovery (default python_files: test_*.py).
    readonly libraryFileNames = { apiMethods: 'api_methods.py', dataLibrary: 'data_generator.py' };

    testFileName(baseName: string): string { return `test_${baseName}.py`; }
    classFileName(baseName: string): string { return `${baseName}.py`; }

    // Storage is accepted for parity with the other emitters' constructor signature, but Python
    // rendering is pure (no persistence), so it is unused — emitterFor passes one uniformly.
    constructor(_storage: StorageProvider) { /* intentionally unused — see note above */ }

    emitRequestClass(request: ClassGenerationRequest): string | null {
        return generateRequestClassPython(request);
    }

    emitTest(request: TestGenerationRequest): string {
        return generateTestPython(request);
    }

    emitApiMethods(methods: ApiMethodForGeneration[], options?: CSharpGenerationOptions): string {
        return generateApiMethodsPython(methods, options);
    }

    emitDataLibrary(methods: DataMethodCode[], root?: string): string {
        return generateDataLibraryPython(methods, root);
    }

    emitE2ETest(row: E2ETestCaseRow, page: E2EPage, ctx: E2EGenContext): string {
        return generateE2ETestPython(row, page, ctx);
    }
}
