/**
 * Represents a reusable C# data-generation method stored in the Data Library.
 *
 * Each entry wraps a Faker/Bogus call (or custom code) that the code generator
 * uses to produce realistic test data for a specific field type.
 */
export interface DataMethodDto {
    /** Unique identifier (UUID or legacy numeric string from data-library.json). */
    id: string;
    /** Name of the C# method, e.g. `FirstName`, `EmailAddress`. Used as the display name and for auto-matching against Data Dictionary fields. */
    methodName: string;
    /** Human-readable description of what the method generates. */
    description: string;
    /** Comma-separated parameter declarations, e.g. `gender:string=Random`. */
    parameters: string;
    /** C# return type of the method, e.g. `string`, `int`, `DateTime`. Used when matching fields by type. */
    returnType: string;
    /** Full C# method body or lambda expression. */
    code: string;
    /** Logical grouping, e.g. `Personal`, `Address`, `Financial`, `Custom`. */
    category: string;
    /** Application this method belongs to, or `Default` for shared methods. */
    application: string;
    /** `true` when the method was added by the user; `false` for built-in library methods. */
    isCustom: boolean;
    /** ISO 8601 timestamp of when the method was created. */
    createdDate: string;
    /** Optional free-text notes about the method. */
    comments?: string;
}
