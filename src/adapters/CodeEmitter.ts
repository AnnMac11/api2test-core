import { ClassGenerationRequest } from '../models/ClassGenerationDto';
import { TestGenerationRequest } from '../services/TestGenerationService';
import { ApiMethodForGeneration, CSharpGenerationOptions } from '../services/generateApiMethodsCSharp';
import { DataMethodCode } from '../services/generateDataLibrary';
import { E2EPage, E2ETestCaseRow, E2EGenContext } from '../models/E2EDto';

/** Target output language for generated code. Selected at install time. */
export type TargetLanguage = 'csharp' | 'typescript' | 'python';

/**
 * Language-specific code emission contract.
 *
 * The engine decides *what* to generate (which fields, which data methods, which framework);
 * a {@link CodeEmitter} decides *how* to render it in a concrete language. This lets the same
 * Data Dictionary / Class Library drive C# today and TypeScript/Python later, chosen at install time.
 */
export interface CodeEmitter {
    /** Language this emitter produces. */
    readonly language: TargetLanguage;

    /** Source-file extension, without the dot (e.g. `cs`, `ts`, `py`). */
    readonly fileExtension: string;

    /**
     * Render a request-body class for the given request.
     * Returns `null` when the endpoint has no body fields (nothing to serialise).
     */
    emitRequestClass(request: ClassGenerationRequest): string | null;

    /** Render an integration-test class/source for the given request. */
    emitTest(request: TestGenerationRequest): string;

    /** Render the API Method Library source (HTTP wrappers + call reporter). */
    emitApiMethods(methods: ApiMethodForGeneration[], options?: CSharpGenerationOptions): string;

    /** Render the Data Library source (the data-generator class the request classes reference). */
    emitDataLibrary(methods: DataMethodCode[], root?: string): string;

    /** Render an E2E test source from an explicit, user-authored chain row. */
    emitE2ETest(row: E2ETestCaseRow, page: E2EPage, ctx: E2EGenContext): string;
}
