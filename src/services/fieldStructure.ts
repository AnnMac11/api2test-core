/**
 * What is *inside* one Data Dictionary field (DD-STRUCT).
 *
 * The dictionary stores an `object` or `array` field as a single row — that is deliberate (the row
 * mirrors the request body's top level, see `DataDictionaryService.extractFieldsFromSchema`), but it
 * leaves the user picking a data method for `data: array` with nothing on screen saying what one
 * element looks like. The shape is still there in the endpoint's own `requestBodySchema`; this reads
 * it back out for display.
 *
 * Description only: nothing here creates rows, changes types, or feeds generation. One level deep is
 * the whole point — enough to say what a matching data method must return.
 */

/** One member of an object (or of an array's element object). */
export interface FieldStructureMember {
    name: string;
    /** JSON-schema type as the spec declares it — `string`, `integer`, `object`, `array`, … */
    type: string;
}

/** The described shape of a single dictionary field. */
export interface FieldStructure {
    /** The field's own shape, matching the row's stored `fieldType`. */
    kind: 'object' | 'array' | 'scalar';
    /** For an array: what one element is (`object`, or a scalar type such as `string`). */
    elementType?: string;
    /** Members of the object — or, for an array of objects, of one element. Empty for scalars. */
    members: FieldStructureMember[];
}

/**
 * Describes one field of a request body from the endpoint's resolved schema.
 *
 * @param requestBodySchema - `ApiMethodDto.requestBodySchema`, the JSON-schema string stored at
 *   import. Unparseable or absent → `undefined`, so callers can simply omit the display.
 * @param fieldName - The dictionary row's field name. Dotted names (`address.city`) are walked.
 * @returns The shape, or `undefined` when the schema has nothing under that name.
 */
export function describeFieldStructure(
    requestBodySchema: string | undefined,
    fieldName: string,
): FieldStructure | undefined {
    if (!requestBodySchema || !fieldName) { return undefined; }

    let schema: any;
    try {
        schema = JSON.parse(requestBodySchema);
    } catch {
        return undefined;
    }

    const node = findProperty(schema, fieldName.split('.'));
    if (!node) { return undefined; }
    return describeNode(node);
}

/** Walks `path` through a schema's `properties`, stepping through array wrappers on the way. */
function findProperty(node: any, path: string[]): any {
    let current = unwrapArrayRoot(node);
    for (const key of path) {
        if (!current || current.type !== 'object' || !current.properties) { return undefined; }
        current = current.properties[key];
        if (!current) { return undefined; }
        // Only unwrap between steps — the final node is returned as it stands, arrays included.
        if (path[path.length - 1] !== key) { current = unwrapArrayRoot(current); }
    }
    return current;
}

/**
 * An array-rooted body (`POST /user/createWithList` sends `[ {…} ]`) is addressed by its element's
 * properties, the same way the dictionary extracts its rows from them.
 */
function unwrapArrayRoot(node: any): any {
    return node && node.type === 'array' && node.items ? unwrapArrayRoot(node.items) : node;
}

/** Turns a schema node into the one-level-deep description. */
function describeNode(node: any): FieldStructure {
    if (node.type === 'array') {
        const items = node.items || {};
        return items.type === 'object' && items.properties
            ? { kind: 'array', elementType: 'object', members: membersOf(items) }
            : { kind: 'array', elementType: items.type || 'string', members: [] };
    }
    if (node.type === 'object' && node.properties) {
        return { kind: 'object', members: membersOf(node) };
    }
    return { kind: 'scalar', members: [] };
}

/** The immediate members of an object node, in the order the spec declares them. */
function membersOf(node: any): FieldStructureMember[] {
    return Object.entries(node.properties || {}).map(([name, prop]) => ({
        name,
        type: (prop as any)?.type || 'string',
    }));
}
