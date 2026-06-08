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

## Adapters (`src/adapters`)

The engine is decoupled from concrete storage, language, and delivery so consumers configure
them at install time. Every service depends on `StorageProvider`, not a concrete store.

- **StorageProvider** — File (`FileStorageService`, default) · SqlServer · MongoDB *(future)*
- **CodeEmitter** — C# (`CSharpEmitter`, default) · Python *(future)*
- **DeployTarget** — local folder (VS Code) · repo PR (enterprise / Jira) *(future)*

```ts
import { FileStorageService, CSharpEmitter } from 'api2test-core';

const storage = new FileStorageService('/path/to/data'); // or SQL/Mongo provider
const emitter = new CSharpEmitter(storage);              // or PythonEmitter
const code = emitter.emitRequestClass(request);          // pure render, no persistence
```

`api2test-e2e` (the API-chaining / E2E layer) and the Epic2Test layer build **on top** of this
package and are kept in separate packages (E2E is **not** shipped to the VS Code extension).
