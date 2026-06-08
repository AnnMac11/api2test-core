# api2test-core

Shared, UI-agnostic engine for **API2Test**. It imports an API specification, builds a
**Data Dictionary** of fields, maintains the **Data / API Method / API Class** libraries, and
generates C# request-body classes and integration tests.

It contains **no UI code** and is consumed by:

- the **VS Code extension**,
- the **web / enterprise app** (Next.js), and
- (later) the **Jira app** (Forge).

## What's inside

```
src/
├─ models/      # DTOs (data dictionary, methods, classes, tests, …) + generation inputs
└─ services/    # the engine
   ├─ ApiFormatDetector / OpenApiParserService / PostmanParserService / ApiFormatAdapter
   ├─ DataDictionaryService     (extraction, mirror-the-body, anyOf, type-first matching)
   ├─ DataLibraryService / ApiMethodLibraryService / ApiClassLibraryService
   ├─ ClassGenerationService    (request-body classes; object/array → object props; ToJson/ToFormBody)
   ├─ TestGenerationService     (integration tests; token + response-handler aware)
   └─ FileStorageService        (file-backed storage; default StorageProvider)
resources/data/                 # seed Data Library + API Method Library + applications
```

## Build

```bash
npm install
npm run build      # → dist/
```

## Roadmap (adapters)

The engine is being decoupled from its concrete file storage and C# emission so consumers can
configure them at install time:

- **StorageProvider** — File (now) · SqlServer · MongoDB
- **CodeEmitter** — C# (now) · Python
- **DeployTarget** — local file (VS Code) · repo PR (enterprise/Jira)

`api2test-e2e` (the API-chaining / E2E layer) and the Epic2Test layer build **on top** of this
package and are kept in separate packages (E2E is **not** shipped to the VS Code extension).
