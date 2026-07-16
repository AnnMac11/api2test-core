import { CodeEmitter, TargetLanguage } from './CodeEmitter';
import { CSharpEmitter } from './CSharpEmitter';
import { StorageProvider } from './StorageProvider';
import { ClassGenerationRequest } from '../models/ClassGenerationDto';
import { TestGenerationRequest } from '../services/TestGenerationService';
import { ApiMethodForGeneration, CSharpGenerationOptions } from '../services/generateApiMethodsCSharp';
import { generateApiMethodsTypeScript } from '../services/generateApiMethodsTypeScript';
import { generateRequestClassTypeScript } from '../services/generateRequestClassTypeScript';
import { generateDataLibraryTypeScript } from '../services/generateDataLibraryTypeScript';
import { generateTestTypeScript } from '../services/generateTestTypeScript';
import { generateE2ETestTypeScript } from '../services/generateE2ETestTypeScript';
import { DataMethodCode } from '../services/generateDataLibrary';
import { E2EPage, E2ETestCaseRow, E2EGenContext } from '../models/E2EDto';

/**
 * TypeScript {@link CodeEmitter} — produces Vitest-targeted TS sources. All five emit kinds are
 * implemented by pure render functions (TS-C3…C7); each `emit*` delegates to one.
 */
export class TypeScriptEmitter implements CodeEmitter {
    readonly language: TargetLanguage = 'typescript';
    readonly fileExtension = 'ts';

    // Storage is accepted for parity with CSharpEmitter's constructor signature, but TS rendering is pure
    // (no persistence), so it is unused — the selector passes one uniformly for both emitters.
    constructor(_storage: StorageProvider) { /* intentionally unused — see note above */ }

    emitRequestClass(request: ClassGenerationRequest): string | null {
        return generateRequestClassTypeScript(request);
    }

    emitTest(request: TestGenerationRequest): string {
        return generateTestTypeScript(request);
    }

    emitApiMethods(methods: ApiMethodForGeneration[], options?: CSharpGenerationOptions): string {
        return generateApiMethodsTypeScript(methods, options);
    }

    emitDataLibrary(methods: DataMethodCode[], root?: string): string {
        return generateDataLibraryTypeScript(methods, root);
    }

    emitE2ETest(row: E2ETestCaseRow, page: E2EPage, ctx: E2EGenContext): string {
        return generateE2ETestTypeScript(row, page, ctx);
    }
}

/** Construct the {@link CodeEmitter} for a target language. */
export function emitterFor(language: TargetLanguage, storage: StorageProvider): CodeEmitter {
    switch (language) {
        case 'typescript': return new TypeScriptEmitter(storage);
        case 'csharp':     return new CSharpEmitter(storage);
        default:
            throw new Error(`No CodeEmitter for language '${language}'.`);
    }
}
