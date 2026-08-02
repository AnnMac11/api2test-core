import { test } from 'node:test';
import assert from 'node:assert';
import {
  WARN_WITHIN_DAYS, accessDaysLeft, accessWarns, daysUntil, describeAccess, licenceSummary, nudgeFor,
} from '../src/licensing/presentation';
import type { Access } from '../src/licensing/manager';

/**
 * LIC-6 — what the user is TOLD about their access. The rule these lock down is commercial, not
 * cosmetic: how many days are left, when that becomes a warning, and which reminder fires when.
 * Every edition must say the same thing, which is why it is here and not in a client.
 *
 * A fixed "today" so the day counts don't drift.
 */
const NOW = new Date('2026-07-23T00:00:00Z');
const licensed = (expiresAt: Date | null): Access => ({ state: 'licensed', expiresAt });
const trial = (daysLeft: number): Access => ({ state: 'trial', daysLeft });
const expired: Access = { state: 'expired' };

test('days left: a trial carries its own count; a licence counts to its expiry', () => {
  assert.strictEqual(accessDaysLeft(trial(42), NOW), 42);
  assert.strictEqual(accessDaysLeft(licensed(new Date('2027-01-31T00:00:00Z')), NOW), 192);
  assert.strictEqual(accessDaysLeft(licensed(null), NOW), undefined, 'an undated licence counts nothing');
  assert.strictEqual(accessDaysLeft(expired, NOW), undefined);
});

test('daysUntil never goes negative — a past expiry is 0 days, not -3', () => {
  assert.strictEqual(daysUntil(new Date('2026-07-20T00:00:00Z'), NOW), 0);
});

test('the warning threshold is the same for a trial and a licence', () => {
  assert.strictEqual(WARN_WITHIN_DAYS, 7);
  assert.strictEqual(accessWarns(trial(WARN_WITHIN_DAYS), NOW), true);
  assert.strictEqual(accessWarns(trial(WARN_WITHIN_DAYS + 1), NOW), false);
  assert.strictEqual(accessWarns(licensed(new Date('2026-07-28T00:00:00Z')), NOW), true, '5 days left');
  assert.strictEqual(accessWarns(licensed(new Date('2027-01-31T00:00:00Z')), NOW), false);
  assert.strictEqual(accessWarns(expired, NOW), true, 'already out of days');
});

test('summary: a trial reads in plain words with the day count', () => {
  const s = licenceSummary(trial(54), NOW);
  assert.match(s.text, /Trial — 54 days left/);
  assert.strictEqual(s.warn, false);
  assert.strictEqual(s.canRemove, false, 'there is no key to remove during a trial');
});

test('summary: a licence counts down AND keeps its date', () => {
  const s = licenceSummary(licensed(new Date('2027-01-31T00:00:00Z')), NOW);
  assert.match(s.text, /Licensed/);
  assert.match(s.text, /192 days left/, 'the user asked for days, not just a date');
  assert.match(s.text, /2027-01-31/);
  assert.strictEqual(s.canRemove, true);
});

test('summary: an undated licence just says licensed', () => {
  const s = licenceSummary(licensed(null), NOW);
  assert.match(s.text, /Licensed/);
  assert.ok(!/days left/.test(s.text), 'nothing to count down');
});

test('summary: near expiry the hint changes to renew, and expired says what to do', () => {
  assert.match(licenceSummary(licensed(new Date('2026-07-28T00:00:00Z')), NOW).hint, /Renew soon/);
  const e = licenceSummary(expired, NOW);
  assert.match(e.text, /expired/i);
  assert.match(e.hint, /licence key/i);
  assert.strictEqual(e.warn, true);
});

test('nudges: a fresh trial is welcomed once, then stays quiet mid-trial', () => {
  const n = nudgeFor(trial(60), [], NOW);
  assert.strictEqual(n?.key, 'welcome');
  assert.strictEqual(n?.kind, 'info');
  assert.match(n!.message, /60 days/);
  assert.strictEqual(nudgeFor(trial(59), ['welcome'], NOW), undefined, 'it never welcomes twice');
  assert.strictEqual(nudgeFor(trial(30), ['welcome'], NOW), undefined, 'mid-trial says nothing');
});

test('nudges: the last 7 days nudge, the last day nudges harder, each once', () => {
  const seven = nudgeFor(trial(6), ['welcome'], NOW);
  assert.strictEqual(seven?.key, 'd7');
  assert.strictEqual(seven?.kind, 'warning');
  assert.strictEqual(nudgeFor(trial(5), ['welcome', 'd7'], NOW), undefined, 'd7 fires once');

  const one = nudgeFor(trial(1), ['welcome', 'd7'], NOW);
  assert.strictEqual(one?.key, 'd1');
  assert.match(one!.message, /1 day\b/, 'singular on the last day');
  assert.strictEqual(nudgeFor(trial(1), ['welcome', 'd7', 'd1'], NOW), undefined);
});

test('nudges: urgency beats the welcome — a trial nearly over does not say hello', () => {
  assert.strictEqual(nudgeFor(trial(3), [], NOW)?.key, 'd7');
});

test('nudges: an expiring LICENCE nudges too, in its own words', () => {
  const n = nudgeFor(licensed(new Date('2026-07-28T00:00:00Z')), [], NOW);
  assert.strictEqual(n?.key, 'd7');
  assert.match(n!.message, /licence ends/, 'a paying customer is not told their "trial" is ending');
});

test('nudges: expired says nothing — the gate already blocks everything', () => {
  assert.strictEqual(nudgeFor(expired, [], NOW), undefined);
  assert.strictEqual(nudgeFor(licensed(null), [], NOW), undefined, 'an undated licence has nothing to warn about');
});

test('describeAccess is one line per state', () => {
  assert.match(describeAccess(licensed(new Date('2027-01-31T00:00:00Z'))), /licensed, expires 2027-01-31/);
  assert.strictEqual(describeAccess(licensed(null)), 'licensed');
  assert.match(describeAccess(trial(12)), /trial — 12 days left/);
  assert.match(describeAccess(expired), /expired/);
});
