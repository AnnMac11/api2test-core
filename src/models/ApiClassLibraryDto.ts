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
    /** Application this class belongs to. */
    application: string;
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
}
