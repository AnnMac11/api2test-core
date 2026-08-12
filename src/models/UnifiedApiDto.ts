/** A single request parameter with its location in the request. */
export interface ApiParameterDetail {
    name: string;
    type: string;
    /** Where the parameter is sent. */
    location: 'path' | 'query' | 'header';
    required: boolean;
}

// Normalized structure that all formats convert to
export interface UnifiedApiDto {
    name: string;
    method: string;
    path: string;
    url?: string;
    description?: string;
    headers?: { [key: string]: string };
    requestBody?: any;
    responseExample?: any;
    /** Resolved request-body schema ($refs inlined) — carries nested/array structure for extraction + class gen. */
    requestBodySchema?: any;
    /**
     * Resolved 2xx response schema ($refs inlined). {@link responseExample} is a flattened skeleton —
     * every array in it is `[]` — so it cannot say what an array element holds; this can.
     */
    responseBodySchema?: any;
    /** Flat name→type map (legacy display use). */
    parameters?: { [key: string]: any };
    /** Structured parameters with location (path/query/header), used for field extraction. */
    parameterDetails?: ApiParameterDetail[];
}

export type ApiFormat = 'postman' | 'openapi' | 'raml' | 'graphql' | 'insomnia' | 'unknown';

