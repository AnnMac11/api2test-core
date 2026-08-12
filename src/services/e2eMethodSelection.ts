/**
 * E2E-SEL-1 (core): smart-default method selection for the E2E builder.
 *
 * When a user drops a class step into a test case, the builder should pre-select the *sensible* send
 * method for that endpoint — the user's words: "the methods to send the class is selected by the class
 * POST PUT etc." A form-encoded POST wants `PostFormAsync`, a JSON PUT wants `PutJsonAsync`, and so on.
 *
 * This is a **default only**: the client keeps offering the full method list, so a power user can still
 * pick a variant (e.g. `DeleteByPathValueAsync`). Core owns the mapping so Desktop and VS Code agree on it.
 * Pure and UI-free — no DOM, no store, no language emitter. Unit-tested in e2eMethodSelection.test.ts.
 */

/** Is this request content-type form-encoded (`application/x-www-form-urlencoded`)? */
export function isFormEncoded(contentType: string | undefined): boolean {
  return (contentType || '').toLowerCase().includes('x-www-form-urlencoded');
}

/**
 * The default send-method name for an endpoint's verb + request content-type.
 *
 * GET → GetAsync, DELETE → DeleteAsync (the plain form; `DeleteByPathValueAsync` is a manual variant),
 * POST/PUT/PATCH → the form or JSON helper per {@link isFormEncoded}. Returns `''` for an unknown verb
 * so the client simply shows no pre-selection (rather than guessing wrong). The names match the seeded
 * api-method library so the returned value resolves to a real method in every language.
 */
export function chooseSendMethod(verb: string | undefined, contentType?: string): string {
  const v = (verb || '').trim().toUpperCase();
  const form = isFormEncoded(contentType);
  switch (v) {
    case 'GET': return 'GetAsync';
    case 'DELETE': return 'DeleteAsync';
    case 'POST': return form ? 'PostFormAsync' : 'PostJsonAsync';
    case 'PUT': return form ? 'PutFormAsync' : 'PutJsonAsync';
    case 'PATCH': return form ? 'PatchFormAsync' : 'PatchJsonAsync';
    default: return '';
  }
}

/**
 * The default follow-up method for a class step's response — the user's rule: "the response is based on
 * the api type and if there is a response selected."
 *
 * If a response field IS selected, the step extracts it → `ExtractFieldAsync`, emitted with the capture's
 * own store-as type as `ExtractFieldAsync<T>`. The `<T>` is NOT chosen here: it stays with the capture's
 * type picker (E2E-CAP-1 / {@link mapCaptureType}), so method-choice and type-choice remain two things.
 *
 * If NO response field is selected, the step just validates the call by verb: DELETE →
 * `ValidateDeleted_200_204Async`, every other verb → `ValidateSuccess_200_201Async` (which covers a GET's
 * 200 and a POST's 201). Names match the seeded library in all three languages.
 *
 * A default only — the client keeps offering the full method list (other validators, `ExtractToken`, …).
 */
export function chooseExtractMethod(responseField: string | undefined, verb?: string): string {
  if ((responseField || '').trim()) { return 'ExtractFieldAsync'; }
  return (verb || '').trim().toUpperCase() === 'DELETE'
    ? 'ValidateDeleted_200_204Async'
    : 'ValidateSuccess_200_201Async';
}

/**
 * NAME-1: the names the curated library used before the rename that made them say what they do.
 *
 * A saved E2E test case stores the method it picked *by name* (`item.ref`). After the rename a case saved
 * on an older build would name a method that no longer exists — the generator would find no library entry
 * and emit the dead name. Mapping the old name to the new one at generation time keeps those cases working
 * without a data migration.
 */
const LEGACY_METHOD_NAMES: Record<string, string> = {
  ExtractFieldFromResponse: 'ExtractFieldAsync',
  ExtractTokenFromResponse: 'ExtractToken',
  ParseJsonResponse: 'ExtractBodyAs',
  DeleteByParamAsync: 'DeleteByPathValueAsync',
  PostMultipartAsync: 'UploadFileAsync',
  ValidateResponseAsync: 'ValidateSuccess_200_201Async',
  ValidateDeleteResponseAsync: 'ValidateDeleted_200_204Async',
  ValidateBadRequestResponseAsync: 'ValidateBadRequest_400Async',
  ValidateUnauthorizedResponseAsync: 'ValidateUnauthorized_401Async',
  ValidateForbiddenResponseAsync: 'ValidateForbidden_403Async',
  ValidateNotFoundResponseAsync: 'ValidateNotFound_404Async',
  ValidateConflictResponseAsync: 'ValidateConflict_409Async',
  ValidateValidationErrorResponseAsync: 'ValidateValidationError_422Async',
  petstoreTestBasePath: 'PetStoreBaseUrl',
  petstoreTestToken: 'PetStoreApiKey',
  stripeTestBasePath: 'StripeBaseUrl',
  stripeTestToken: 'StripeSecretKey',
};

/** The current name for a method reference, translating a pre-rename name. Unknown names pass through. */
export function canonicalMethodName(ref: string | undefined): string {
  const name = (ref || '').trim();
  return LEGACY_METHOD_NAMES[name] || name;
}
