/**
 * A generated API test case, persisted in `api-tests.json`.
 */
export interface ApiTestDto {
    id: string;
    /** User-supplied test case name; also used as the C# test class name and default file name. */
    testName: string;
    /** Name of the API Class Library class used for the request body (if any). */
    className: string;
    endpoint: string;
    method: string;
    /** The generated (and possibly user-edited) C# test source. */
    testCode: string;
    application: string;
    createdDate: string;
    testFramework: string;
    /** Absolute path the test was last saved to, if the user saved it to disk. */
    filePath?: string;
    /** Wrapper method from the API Method Library used to make the call. */
    wrapperMethod?: string;
    /** Token provider method (API Method Library, Authentication category) that drives GetToken(). */
    tokenMethod?: string;
    /** Response handler (validator) the test asserts on; empty = built-in success asserts. */
    responseHandler?: string;
    /** ID of the source API Class Library entry (used for edit/regenerate). */
    classId?: string;
}
