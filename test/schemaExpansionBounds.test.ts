/**
 * SCHEMA-BOUNDS — `$ref` inlining must stay bounded on a real-world spec.
 *
 * `resolveSchemaTree` clones its cycle guard per branch, so a type reached by two paths is expanded
 * twice — deliberately, for shape fidelity. Once RESP-SCHEMA started resolving *response* schemas as
 * well, that met Stripe's response object graph (Customer → subscriptions → plan → product → …, ~50
 * properties a node) and went combinatorial: importing the 7.9 MB Stripe spec exhausted an 8 GB heap
 * after ~140 s. Nothing threw, so the import dialog just sat on "Importing…" forever.
 *
 * The spec below is that graph in miniature — a handful of schemas that all reference each other, the
 * shape every real API has. These tests hold the two things that must both be true: the expansion is
 * bounded, and it is still deep enough for what reads it.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { ApiFormatAdapter } from '../src/services/ApiFormatAdapter';

/** N schemas, each with N object properties pointing at all the others — a dense cycle. */
function densSpec(n = 7, fanout = 6): string {
  const schemas: Record<string, any> = {};
  for (let i = 0; i < n; i++) {
    const properties: Record<string, any> = { id: { type: 'string' }, object: { type: 'string' } };
    for (let j = 0; j < fanout; j++) {
      properties[`link_${j}`] = { $ref: `#/components/schemas/S${(i + j + 1) % n}` };
    }
    schemas[`S${i}`] = { type: 'object', properties };
  }
  return JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'Dense', version: '1' },
    servers: [{ url: 'https://api.example.com' }],
    paths: {
      '/things': {
        get: {
          operationId: 'ListThings',
          responses: {
            '200': {
              description: 'ok',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { type: 'array', items: { $ref: '#/components/schemas/S0' } },
                      has_more: { type: 'boolean' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    components: { schemas },
  });
}

test('a densely cross-referenced spec resolves in bounded time and size', () => {
  const started = Date.now();
  const endpoints = new ApiFormatAdapter().adaptToUnified(densSpec(), 'openapi');
  const elapsed = Date.now() - started;

  const stored = JSON.stringify(endpoints[0].responseBodySchema);
  assert.ok(stored.length < 100_000,
    `the inlined response schema is ${stored.length} bytes — unbounded expansion; one endpoint must not ` +
    `outweigh the whole spec (Stripe has 589 of them)`);
  assert.ok(elapsed < 3_000, `resolving one endpoint took ${elapsed} ms — that is the hang, not a slow test`);
});

test('and it is still deep enough for what reads it', () => {
  // DD-STRUCT renders a field's kind, its element type, and the element's member names. Whatever the
  // limits are, they must not cut above that — the field, its items, and the items' members.
  const endpoints = new ApiFormatAdapter().adaptToUnified(densSpec(), 'openapi');
  const schema: any = endpoints[0].responseBodySchema;

  assert.equal(schema.properties.data.type, 'array', 'the top-level field keeps its kind');
  const item = schema.properties.data.items;
  assert.equal(item.type, 'object', 'the array element is resolved, not left as a $ref');
  assert.ok(Object.keys(item.properties).includes('id'),
    'the element members are what the Structure block lists — they must survive the cap');
  assert.ok(Object.keys(item.properties).includes('link_0'));
});

test('every endpoint of a big spec is bounded, not just the first', () => {
  // The budget is per schema, so 100 endpoints cost 100 × the bound — not 100 × an unbounded tree.
  const spec = JSON.parse(densSpec());
  for (let i = 0; i < 60; i++) { spec.paths[`/things${i}`] = spec.paths['/things']; }

  const started = Date.now();
  const endpoints = new ApiFormatAdapter().adaptToUnified(JSON.stringify(spec), 'openapi');
  const elapsed = Date.now() - started;

  assert.equal(endpoints.length, 61);
  const total = endpoints.reduce((n, e) => n + JSON.stringify(e.responseBodySchema).length, 0);
  assert.ok(total < 61 * 100_000, `${total} bytes of schema for 61 endpoints`);
  assert.ok(elapsed < 10_000, `61 endpoints took ${elapsed} ms`);
});
