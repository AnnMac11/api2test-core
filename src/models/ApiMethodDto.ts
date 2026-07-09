export interface ApiMethodDto {
    id: string;
    name: string;
    method: string;
    endpoint: string;
    url: string;
    description: string;
    application: string;
    createdDate: string;
    source?: 'postman' | 'openapi' | 'raml' | 'graphql' | 'insomnia';
    fileName?: string;
    isCustom?: boolean;
    parameters?: string;
    returnType?: string;
    contentType?: string;
    requestHeaders?: string;
    requestBodyTemplate?: string;
    responseExamples?: string;
    hasExampleData?: boolean;
    importedToDataDictionary?: boolean;
    /** Structured path/query/header parameters, preserved from the source spec for field extraction. */
    parameterDetails?: Array<{ name: string; type: string; location: 'path' | 'query' | 'header'; required: boolean }>;
    /** Resolved request-body schema as JSON ($refs inlined). Carries nested object/array structure. */
    requestBodySchema?: string;
}

export interface ApiMethodLibraryDto {
    id: string;
    methodName: string;
    description: string;
    parameters: string;
    returnType: string;
    code: string;
    category: string;
    /**
     * Display-only application name. Kept for readability and back-compat; NOT used for matching.
     * The authoritative link to an application is {@link applicationId}.
     */
    application: string;
    /**
     * Id of the application this method belongs to — the authoritative, rename-proof link used to
     * filter app-scoped methods (base paths, tokens) into the right application's dropdowns. Empty/
     * absent means a global utility helper (HTTP verbs, response/serialization helpers) available to
     * every application. Base-path and token methods must set this.
     */
    applicationId?: string;
    isCustom: boolean;
    createdDate: string;
    comments?: string;
}