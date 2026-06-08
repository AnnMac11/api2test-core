import { ClassGenerationRequest } from '../models/ClassGenerationDto';
import { TestGenerationRequest } from '../services/TestGenerationService';

/** Target output language for generated code. Selected at install time. */
export type TargetLanguage = 'csharp' | 'python';

/**
 * Language-specific code emission contract.
 *
 * The engine decides *what* to generate (which fields, which data methods, which framework);
 * a {@link CodeEmitter} decides *how* to render it in a concrete language. This lets the same
 * Data Dictionary / Class Library drive C# today and Python later, chosen at install time.
 */
export interface CodeEmitter {
    /** Language this emitter produces. */
    readonly language: TargetLanguage;

    /** Source-file extension, without the dot (e.g. `cs`, `py`). */
    readonly fileExtension: string;

    /**
     * Render a request-body class for the given request.
     * Returns `null` when the endpoint has no body fields (nothing to serialise).
     */
    emitRequestClass(request: ClassGenerationRequest): string | null;

    /** Render an integration-test class/source for the given request. */
    emitTest(request: TestGenerationRequest): string;
}
