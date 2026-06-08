/**
 * Represents a single field entry in the Data Dictionary.
 *
 * Fields are either extracted automatically from an imported API endpoint
 * (identified by {@link sourceEndpointId}) or added manually by the user.
 * Each field can be linked to a {@link DataMethodDto} from the Data Library
 * so the code generator knows how to produce realistic test data for it.
 */
export interface DataDictionaryField {
    /** Unique identifier generated at creation time. */
    id: string;
    /** Name of the field as it appears in the API request/response, e.g. `firstName`, `email`. */
    fieldName: string;
    /** JSON/C# data type of the field, e.g. `string`, `number`, `boolean`. */
    fieldType: string;
    /** Whether the field is required in API requests. Displayed as a badge in the table. */
    mandatory: boolean;
    /**
     * Name of the linked {@link DataMethodDto} used to generate test data for this field,
     * or `'Not Assigned'` when no matching method has been found or selected.
     */
    dataMethod: string;
    /**
     * Optional argument list passed to the linked data method, e.g. `-3` for `GetDate(-3)`
     * or `"GB"` for `StripeAddress("GB")`. Empty/absent → the method is called with no
     * arguments and uses its declared defaults. The value is emitted verbatim inside the
     * call parentheses, so string args must include their own quotes.
     */
    dataMethodArgs?: string;
    /**
     * Where the field is sent in the request:
     * - `body` (default) — part of the JSON request body.
     * - `path` — a URL path parameter, e.g. the `petId` in `/pet/{petId}`.
     * - `query` — a URL query-string parameter, e.g. `status` in `?status=available`.
     * - `header` — an HTTP header value.
     *
     * Class generation only serialises `body` fields into the JSON class; `path`/`query`
     * fields are substituted into the URL by the generated test instead.
     */
    location?: 'body' | 'path' | 'query' | 'header';
    /**
     * ID of the {@link ApiMethodDto} this field was extracted from.
     * Present only for fields imported via "Add API"; absent for manually added fields.
     * Used by the Edit dialog to restrict which properties can be changed
     * (API-sourced fields: mandatory and dataMethod only; manual fields: all properties).
     */
    sourceEndpointId?: string;
}
