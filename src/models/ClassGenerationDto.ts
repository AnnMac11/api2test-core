/**
 * Inputs to class generation. Extracted into the core (previously defined on the VS Code
 * webview) so the engine has no UI dependency.
 */

export interface FieldConfiguration {
    name: string;
    type: string;
    required: boolean;
    description?: string;
    /** Linked Data Library method name, e.g. `FirstName`. */
    dataMethod?: string;
    /** Optional argument list for the data method, e.g. `-3` or `"GB"`. Emitted verbatim in the call. */
    dataMethodArgs?: string;
    /** Where the field is sent. Only `body` fields are serialised into the generated class. */
    location?: 'body' | 'path' | 'query' | 'header';
}

export interface ClassGenerationRequest {
    endpoint: string;
    method: string;
    application: string;
    fieldConfigurations: FieldConfiguration[];
    /** If provided, use this class name instead of deriving one from the endpoint. */
    className?: string;
    /** Resolved request-body schema as JSON ($refs inlined). When present, nested classes + List<T> are generated. */
    bodySchema?: string;
    /**
     * Declared request media type from the source spec. When `application/x-www-form-urlencoded`,
     * the generated class also gets a `ToFormBody()` (bracket-notation form encoding). Defaults to JSON.
     */
    contentType?: string;
}
