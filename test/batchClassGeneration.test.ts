/**
 * ORCH-2 — batch class generation (the class-library "Generate" driver). It reuses the existing pieces:
 * the green/amber decision is `fieldCompleteness.hasUnassignedMandatory`, the render is a `CodeEmitter`.
 * These tests prove the DRIVER: ready → generated (code), unassigned-mandatory → pending (emitter NOT
 * called), render error → captured per class without aborting the batch, and the summary counts.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { generateClassLibrary } from '../src/services/batchClassGeneration';
import { CodeEmitter } from '../src/adapters/CodeEmitter';

/** Fake emitter: records emitRequestClass calls; throws for a class named 'Boom'. */
function fakeEmitter(): CodeEmitter & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    language: 'typescript',
    fileExtension: 'ts',
    emitRequestClass(req) {
      calls.push(req.className || req.endpoint);
      if (req.className === 'Boom') { throw new Error('render blew up'); }
      if (req.className === 'Empty') { return null; }
      return `// class ${req.className}`;
    },
    emitTest() { throw new Error('n/a'); },
    emitApiMethods() { throw new Error('n/a'); },
    emitDataLibrary() { throw new Error('n/a'); },
    emitE2ETest() { throw new Error('n/a'); },
  };
}

const entry = (over: any) => ({
  id: 'c-' + over.className, endpointId: 'e-' + over.className, application: 'Stripe',
  method: 'POST', endpoint: '/x', fields: [], ...over,
});

const ready = entry({ className: 'Ready', fields: [{ fieldName: 'email', fieldType: 'string', mandatory: true, dataMethod: 'Email' }] });
const pending = entry({ className: 'Pending', fields: [{ fieldName: 'name', fieldType: 'string', mandatory: true, dataMethod: 'Not Assigned' }] });
const boom = entry({ className: 'Boom', fields: [{ fieldName: 'x', fieldType: 'string', mandatory: false, dataMethod: 'X' }] });

test('a ready class is generated (code returned) and the emitter is called', () => {
  const em = fakeEmitter();
  const r = generateClassLibrary([ready], em);
  assert.equal(r.perClass[0].status, 'generated');
  assert.equal(r.perClass[0].code, '// class Ready');
  assert.deepEqual(em.calls, ['Ready']);
});

test('an unassigned-mandatory class is PENDING — the emitter is never called', () => {
  const em = fakeEmitter();
  const r = generateClassLibrary([pending], em);
  assert.equal(r.perClass[0].status, 'pending');
  assert.equal(r.perClass[0].code, undefined);
  assert.deepEqual(em.calls, [], 'no render attempted for a pending class');
});

test('a render error is captured per class and does not abort the batch', () => {
  const em = fakeEmitter();
  const r = generateClassLibrary([boom, ready], em);
  const b = r.perClass.find(c => c.className === 'Boom')!;
  assert.equal(b.status, 'error');
  assert.match(b.error!, /blew up/);
  // The batch continued to the next class.
  assert.equal(r.perClass.find(c => c.className === 'Ready')!.status, 'generated');
});

test('summary counts generated / pending / errored', () => {
  const r = generateClassLibrary([ready, pending, boom], fakeEmitter());
  assert.equal(r.generated, 1);
  assert.equal(r.pending, 1);
  assert.equal(r.errored, 1);
});
