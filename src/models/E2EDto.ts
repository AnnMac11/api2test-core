/**
 * E2E test-case model — the explicit, user-authored chain that the E2E generator turns into a
 * framework-correct C# test. Shared by every edition (enterprise, VS, Jira) via the core.
 */
export type TestFramework = 'MSTest' | 'xUnit' | 'NUnit';

export type E2ECaseType = 'Method' | 'Class';

/** One ordered step in a test case — a method call or a class (request). */
export interface E2ECaseItem {
  type: E2ECaseType;
  /** The referenced method name or class name from the library. */
  ref: string;
  /** Class steps: capture a field from this request's response into a variable for later steps.
   *  Legacy single-capture shape — superseded by {@link captures} (kept for back-compat). */
  capture?: { fieldPath: string; variable: string };
  /** Class steps: OUT capture rows — each captures a response field into a variable, converted to the
   *  user-chosen store-as `type` (e.g. `long`, `string`). The user decides the type because the value may
   *  feed a later class field of a different type; it is not inferred. One typed extract line per row. */
  captures?: Array<{ fieldPath: string; variable: string; type: string }>;
  /** Method steps (extract): the user-chosen store-as type for a field extractor, so the generic
   *  `ExtractFieldAsync<T>` is emitted with this T. Set by the client when expanding an OUT capture row. */
  extractType?: string;
  /** Class steps: a previously-captured variable to substitute into the endpoint's {placeholder}. */
  pathBindVariable?: string;
  /** Method steps: endpoint path appended to the base URL for the method's url/urlTemplate argument. */
  endpoint?: string;
  /** Method steps (legacy): a captured variable to pass as the method's value argument. */
  bindVariable?: string;
  /** Method steps: the API Class this send method targets — supplies the url and the body. */
  classRef?: string;
  /** Method steps: class supplying the body argument (jsonBody/formBody). */
  bodyClass?: string;
  /** Method steps: which earlier response variable to pass to a `response` argument (default: most recent). */
  responseVar?: string;
  /** Explicit values for remaining parameters / {placeholder} values (literal or a variable reference). */
  args?: Record<string, { value: string; isVariable?: boolean }>;
  /** Class steps: per-test field overrides applied via object initializer (literal value or a captured variable). */
  overrides?: Record<string, { value: string; isVariable?: boolean }>;
  /** Variable name to assign this step's result to (so later steps can reference it). */
  assignTo?: string;
}

/** A named test case composed of an ordered list of steps. */
export interface E2ETestCaseRow {
  id: string;
  name: string;
  items: E2ECaseItem[];
  /** Generated C# test code; empty until generated. */
  code?: string;
}

/** An E2E suite (per-application). The generator reads framework/token/basePath from it. */
export interface E2EPage {
  id: string;
  name: string;
  application: string;
  basePath: string;
  token: string;
  framework: TestFramework;
  testCases?: E2ETestCaseRow[];
  createdDate: string;
  modifiedDate: string;
}

/** Library context the generator resolves names against (method + class library rows). */
export interface E2EGenContext {
  methods: any[];
  classes: any[];
}
