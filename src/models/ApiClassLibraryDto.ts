import { RagStatus } from './classStatus';

/**
 * A field entry stored inside an {@link ApiClassLibraryDto}.
 * Mirrors the relevant properties of {@link DataDictionaryField} at the time the class entry was created.
 */
export interface ApiClassLibraryFieldDto {
    fieldName: string;
    fieldType: string;
    /** Whether the field is required in the API request. Mandatory fields always appear in the generated class. */
    mandatory: boolean;
    /**
     * Name of the linked Data Library method used to generate test data, e.g. `FirstName`.
     * `'Not Assigned'` means no method has been linked yet.
     */
    dataMethod: string;
    /** Optional argument list for the data method, e.g. `-3` or `"GB"`. Emitted verbatim inside the call parentheses. */
    dataMethodArgs?: string;
    /**
     * Where the field is sent: `body` (serialised into the JSON class), `path`/`query`
     * (substituted into the URL by the test), or `header`. Defaults to `body`.
     */
    location?: 'body' | 'path' | 'query' | 'header';
}

/**
 * Represents a class entry in the API Class Library.
 *
 * A class entry is created automatically when an API endpoint is added to
 * the Data Dictionary. It captures the endpoint metadata and its fields
 * (with Data Library bindings) so a C# request-body class can be generated
 * at any time without requiring the original imported endpoint to still exist.
 */
export interface ApiClassLibraryDto {
    /** Unique identifier. */
    id: string;
    /** ID of the source {@link ApiMethodDto}. May no longer exist if the endpoint was deleted. */
    endpointId: string;
    /** Generated C# class name, e.g. `ABCWebsiteAddPet`. */
    className: string;
    /** Display-only application name. The rename-proof link is {@link applicationId}. */
    application: string;
    /**
     * Id of the application this class belongs to — copied from the source endpoint at
     * {@link ApiClassLibraryService.addClass} (APP-ID-IMPORT). Drives deploy folders and namespaces,
     * which fall back to {@link application} when it is absent (rows created before APP-ID-IMPORT).
     */
    applicationId?: string;
    /** HTTP method of the source endpoint, e.g. `POST`. */
    method: string;
    /** Endpoint path, e.g. `/pet`. */
    endpoint: string;
    /** Fields extracted from the Data Dictionary at the time this entry was created. */
    fields: ApiClassLibraryFieldDto[];
    /** Resolved request-body schema as JSON ($refs inlined) — used to rebuild nested classes/arrays. */
    requestBodySchema?: string;
    /**
     * Declared request media type from the source spec, e.g. `application/json` or
     * `application/x-www-form-urlencoded`. Drives JSON-vs-form body serialisation in the
     * generated test. Defaults to JSON when absent (back-compat with pre-existing entries).
     */
    contentType?: string;
    /** ISO 8601 timestamp of creation. */
    createdDate: string;
    /**
     * User-set real-world RAG status of the endpoint (grey=not automated, amber=in progress,
     * green=automated & working, red=API defect). Defaults to `'grey'`. The USER owns this — the
     * generator must NEVER write it (a generation failure sets {@link generationError}, not `status`).
     * Distinct from the transient `ClassGenerationState` returned by the batch generator.
     */
    status?: RagStatus;
    /**
     * Set only when a class generation errored — the one generation-state that can't be re-derived
     * from code presence + `hasUnassignedMandatory`. Kept apart from the user `status` on purpose.
     */
    generationError?: string;
}
