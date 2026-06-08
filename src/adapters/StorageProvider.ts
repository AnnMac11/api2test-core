/**
 * Persistence contract used by every engine service.
 *
 * The engine never talks to a concrete store directly — it depends on this interface so the
 * backing store can be selected at install time:
 *
 *   - File   (default; {@link FileStorageService}) — JSON files on disk
 *   - SQL    (SqlServerStorageProvider — future)
 *   - Mongo  (MongoStorageProvider — future)
 *
 * Each "collection" is addressed by a logical name (today a `*.json` filename, e.g.
 * `data-library.json`). A SQL/Mongo implementation maps that name to a table/collection.
 */
export interface StorageProvider {
    /** Read all records from a collection. Returns `[]` when the collection is empty/absent. */
    readJsonFile<T>(filename: string): Promise<T[]>;

    /** Replace the entire contents of a collection. */
    writeJsonFile<T>(filename: string, data: T[]): Promise<void>;

    /** Append one record, assigning an id when the item has none. */
    addItem<T extends { id?: string }>(filename: string, item: T): Promise<void>;

    /** Replace the record with the given id (id is preserved). Throws if not found. */
    updateItem<T extends { id: string }>(filename: string, id: string, item: T): Promise<void>;

    /** Remove the record with the given id. Throws if not found. */
    deleteItem(filename: string, id: string): Promise<void>;

    /** Fetch a single record by id, or `undefined`. */
    getItemById<T extends { id: string }>(filename: string, id: string): Promise<T | undefined>;

    /** Human-readable location of the store (a directory path for File; a connection label otherwise). */
    getDataPath(): string;
}
