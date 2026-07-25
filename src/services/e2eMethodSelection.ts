/**
 * E2E-SEL-1 (core): smart-default method selection for the E2E builder.
 *
 * When a user drops a class step into a test case, the builder should pre-select the *sensible* send
 * method for that endpoint — the user's words: "the methods to send the class is selected by the class
 * POST PUT etc." A form-encoded POST wants `PostFormAsync`, a JSON PUT wants `PutJsonAsync`, and so on.
 *
 * This is a **default only**: the client keeps offering the full method list, so a power user can still
 * pick a variant (e.g. `DeleteByParamAsync`). Core owns the mapping so Desktop and VS Code agree on it.
 * Pure and UI-free — no DOM, no store, no language emitter. Unit-tested in e2eMethodSelection.test.ts.
 */

/** Is this request content-type form-encoded (`application/x-www-form-urlencoded`)? */
export function isFormEncoded(contentType: string | undefined): boolean {
  return (contentType || '').toLowerCase().includes('x-www-form-urlencoded');
}

/**
 * The default send-method name for an endpoint's verb + request content-type.
 *
 * GET → GetAsync, DELETE → DeleteAsync (the plain form; `DeleteByParamAsync` is a manual variant),
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
 * If a response field IS selected, the step extracts it → `ExtractFieldFromResponse` (emitted as
 * `ExtractFields<T>`). The `<T>` is NOT chosen here: it stays with the capture's own store-as type picker
 * (E2E-CAP-1 / {@link mapCaptureType}), so method-choice and type-choice remain two separate things.
 *
 * If NO response field is selected, the step just validates the call by verb: DELETE →
 * `ValidateDeleteResponseAsync` (200/204), every other verb → `ValidateResponseAsync` (200/201, which
 * covers a GET's 200 and a POST's 201). Names match the seeded library in all three languages.
 *
 * A default only — the client keeps offering the full method list (other validators, `ExtractToken`, …).
 */
export function chooseExtractMethod(responseField: string | undefined, verb?: string): string {
  if ((responseField || '').trim()) { return 'ExtractFieldFromResponse'; }
  return (verb || '').trim().toUpperCase() === 'DELETE'
    ? 'ValidateDeleteResponseAsync'
    : 'ValidateResponseAsync';
}
