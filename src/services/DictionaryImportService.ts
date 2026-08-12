import { StorageProvider } from '../adapters/StorageProvider';
import { CodeEmitter } from '../adapters/CodeEmitter';
import { DataDictionaryService } from './DataDictionaryService';
import { DataLibraryService } from './DataLibraryService';
import { ApiClassLibraryService } from './ApiClassLibraryService';
import { ApiLibraryService } from './ApiLibraryService';
import { ApiMethodDto } from '../models/ApiMethodDto';
import { generateClassLibrary, BatchGenerateResult } from './batchClassGeneration';

/** Tally returned by {@link DictionaryImportService.importApi}. */
export interface DictionaryImportResult {
  /** Fields added to the Data Dictionary (after de-duplication + auto-match). */
  addedFields: number;
  /** Fields dropped as duplicates of dictionary entries already present. */
  skipped: number;
}

/** Per-endpoint outcome within a batch import (one row of the import table). */
export interface BatchImportItem extends DictionaryImportResult {
  endpointId: string;
  /** Set when this endpoint threw; the rest of the batch still runs. */
  error?: string;
}

/** Summary of a batch import (the import table's result). */
export interface BatchImportResult {
  perEndpoint: BatchImportItem[];
  /** Endpoints imported without error. */
  imported: number;
  /** Endpoints that threw (see each item's `error`). */
  failed: number;
  totalAddedFields: number;
  totalSkipped: number;
}

/**
 * ORCH-1 — the "Add API to Dictionary" orchestration, lifted into core (was hand-assembled in each
 * client: VS Code `DataDictionaryImportDialog`, Desktop `server/coreExtract.ts` + its route).
 *
 * The sequence: extract all fields (for the total) and the de-duplicated set (what we add) → look up the
 * Data Library → auto-match a data method to each field → persist each field → add the request class →
 * mark the API method imported. Returns the `{ addedFields, skipped }` tally.
 *
 * Persistence stays per-client: this takes a {@link StorageProvider} and drives the same core services the
 * clients already use, so File / SQL / Mongo storage all work unchanged. Only the SEQUENCE moved here.
 *
 * Policy (owned here now, not each client): **a class-library failure must NOT block the dictionary
 * import** — the fields are already saved and are the point of the import; the class is best-effort.
 */
export class DictionaryImportService {
  private dd: DataDictionaryService;
  private dataLib: DataLibraryService;
  private classLib: ApiClassLibraryService;
  private apiLib: ApiLibraryService;

  constructor(storage: StorageProvider) {
    this.dd = new DataDictionaryService(storage);
    this.dataLib = new DataLibraryService(storage);
    this.classLib = new ApiClassLibraryService(storage);
    this.apiLib = new ApiLibraryService(storage);
  }

  /**
   * Import one endpoint into the Data Dictionary (+ Class Library) and mark it imported.
   * @param endpoint The resolved API method (endpoint discovery / spec parsing stays in the client).
   */
  async importApi(endpoint: ApiMethodDto): Promise<DictionaryImportResult> {
    // `extractFieldsFromEndpoint` JSON.parses requestBodySchema, so it must be a string. Clients differ
    // (VS Code passes a string; Desktop stringifies) — normalise here so either shape works.
    const ep = this.normalizeSchema(endpoint);

    // Full extraction (for the total) vs deduplicated (what we actually add).
    const allFields = await this.dd.extractFieldsFromEndpoint(ep, false);
    const fieldsToAdd = await this.dd.extractFieldsFromEndpoint(ep, true);
    const skipped = allFields.length - fieldsToAdd.length;

    const dataMethods = await this.dataLib.getDataMethods();
    const matched = this.dd.autoMatchDataMethods(fieldsToAdd, dataMethods);

    for (const field of matched) {
      await this.dd.addField(field);
    }

    // Best-effort: a class-library failure must not block the (already-saved) dictionary import.
    try {
      // CLS-7: the class gets ITS OWN fields, not the de-duplicated subset this import happened to add.
      // `matched` is only what was new to the dictionary — for an endpoint whose field names were all
      // claimed by an earlier import that set is empty, and the class came out with no fields at all.
      // Read after the addField loop above, so the rows just written are included.
      await this.classLib.addClass(ep, await this.dd.fieldsForEndpoint(ep));
    } catch {
      /* intentionally swallowed — see class-doc policy */
    }

    await this.apiLib.updateApiMethod(endpoint.id, { ...endpoint, importedToDataDictionary: true });

    return { addedFields: matched.length, skipped };
  }

  /**
   * Import a selection of endpoints (the import table — e.g. 5 ticked of Stripe's 200+). Each is imported
   * independently: one endpoint throwing is recorded on its row and does NOT abort the rest of the batch.
   */
  async importApis(endpoints: ApiMethodDto[]): Promise<BatchImportResult> {
    const perEndpoint: BatchImportItem[] = [];
    for (const endpoint of endpoints) {
      try {
        const r = await this.importApi(endpoint);
        perEndpoint.push({ endpointId: endpoint.id, ...r });
      } catch (e) {
        perEndpoint.push({ endpointId: endpoint.id, addedFields: 0, skipped: 0, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return {
      perEndpoint,
      imported: perEndpoint.filter(i => !i.error).length,
      failed: perEndpoint.filter(i => i.error).length,
      totalAddedFields: perEndpoint.reduce((n, i) => n + i.addedFields, 0),
      totalSkipped: perEndpoint.reduce((n, i) => n + i.skipped, 0),
    };
  }

  /**
   * ORCH-2 — batch-generate classes from the Class Library (the class-library "Generate" action). Renders
   * each ready class via `emitter` (its target language), leaves classes with an unassigned mandatory field
   * pending, and returns the code + status per class. **Persistence is the client's** — save the returned
   * code where it keeps generated classes. Pass `endpointIds` to limit to a selection (else all classes).
   */
  async generateClasses(emitter: CodeEmitter, endpointIds?: string[]): Promise<BatchGenerateResult> {
    const all = await this.classLib.getClassLibrary();
    const entries = endpointIds ? all.filter(e => endpointIds.includes(e.endpointId)) : all;
    return generateClassLibrary(entries, emitter);
  }

  /** Return a copy of the endpoint whose `requestBodySchema` is a JSON string (or left as-is). */
  private normalizeSchema(endpoint: ApiMethodDto): ApiMethodDto {
    const schema = (endpoint as any).requestBodySchema;
    if (schema && typeof schema !== 'string') {
      return { ...endpoint, requestBodySchema: JSON.stringify(schema) } as ApiMethodDto;
    }
    return endpoint;
  }
}
