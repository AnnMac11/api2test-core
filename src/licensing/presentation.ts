/**
 * How an {@link Access} is put to the user — the second half of the licence rule (LIC-6).
 *
 * `manager.ts` decides WHAT the access is (licensed / trial / expired). This decides what the user is
 * told about it: how many days are left, when that becomes a warning, which reminder is due, and the
 * words for each. All of it is policy, not chrome — "warn inside 7 days", "welcome once, then nudge at
 * 7 days and again at 1" and "say Trial — N days left" are commercial decisions that must be the same
 * in every edition. They were living in the VS Code client, where Desktop would have had to reinvent
 * them (and drift).
 *
 * Every function here is **pure** and takes `now`, so the clock is injectable and the wording is
 * unit-testable. Rendering stays in the client: core supplies the strings and the flags, the client
 * decides whether that is a status-bar item, a toast or a page section.
 */
import type { Access } from './manager';

/** Inside this many days, the client colours the state as a warning. */
export const WARN_WITHIN_DAYS = 7;

const DAY_MS = 86_400_000;

/** Whole days from `now` until `expiresAt`, never negative. */
export function daysUntil(expiresAt: Date, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / DAY_MS));
}

/**
 * Days left in the current access state, or `undefined` when there is nothing to count (an undated
 * licence, or an expired trial). A trial carries its own count; a licence is counted to its expiry —
 * the user asked to see a licence counting down the same way a trial does.
 */
export function accessDaysLeft(access: Access, now: Date = new Date()): number | undefined {
  if (access.state === 'trial') { return access.daysLeft; }
  if (access.state === 'licensed' && access.expiresAt) { return daysUntil(access.expiresAt, now); }
  return undefined;
}

/** Whether the client should colour this state as a warning (nearly out of days, or already out). */
export function accessWarns(access: Access, now: Date = new Date()): boolean {
  if (access.state === 'expired') { return true; }
  const days = accessDaysLeft(access, now);
  return days !== undefined && days <= WARN_WITHIN_DAYS;
}

/** Licence state as a client's settings/admin surface shows it. */
export interface LicenceSummary {
  /** One line, e.g. "Trial — 54 days left" or "Licensed — 192 days left (expires 2027-01-31)". */
  text: string;
  /** What to do about it. */
  hint: string;
  /** Nearly out of days (or already out) — colour it. */
  warn: boolean;
  /** Only a stored key can be removed; during a trial there is nothing to remove. */
  canRemove: boolean;
}

/** Plain-words licence summary — the readable copy for a settings/admin page. */
export function licenceSummary(access: Access, now: Date = new Date()): LicenceSummary {
  const days = accessDaysLeft(access, now);
  const warn = days !== undefined && days <= WARN_WITHIN_DAYS;
  switch (access.state) {
    case 'licensed': {
      if (!access.expiresAt) {
        return { text: 'Licensed', hint: 'Your licence has no expiry date.', warn: false, canRemove: true };
      }
      const on = access.expiresAt.toISOString().slice(0, 10);
      return {
        text: `Licensed — ${days} days left (expires ${on})`,
        hint: warn ? 'Renew soon to avoid losing access.' : 'Enter a new key at any time to extend.',
        warn, canRemove: true,
      };
    }
    case 'trial':
      return {
        text: `Trial — ${access.daysLeft} days left`,
        hint: warn
          ? 'Enter a licence key soon — the trial is nearly over.'
          : 'Enter a licence key at any time to switch to a full licence.',
        warn, canRemove: false,
      };
    case 'expired':
      return { text: 'Trial expired', hint: 'Enter a licence key to continue using API2Test.', warn: true, canRemove: false };
  }
}

/** A reminder that is due: the welcome on first run, or an expiry nudge. Each fires once, ever. */
export interface Nudge {
  key: 'welcome' | 'd7' | 'd1';
  message: string;
  kind: 'info' | 'warning';
}

/**
 * Which reminder (if any) is due, given the keys already shown. The caller records the key it acts
 * on, so nothing repeats.
 *
 * Urgency wins over the welcome: a trial that is nearly over says so instead of saying hello.
 * `expired` gets nothing — the whole-app gate already blocks every command, and a popup on top of
 * that is nagging.
 */
export function nudgeFor(access: Access, shown: string[], now: Date = new Date()): Nudge | undefined {
  const days = accessDaysLeft(access, now);
  if (days === undefined) { return undefined; }
  const what = access.state === 'trial' ? 'trial' : 'licence';
  const due = (key: Nudge['key'], message: string, kind: Nudge['kind'] = 'warning'): Nudge | undefined =>
    shown.includes(key) ? undefined : { key, message, kind };

  if (days <= 1) {
    return due('d1', `API2Test: your ${what} ends in ${days} day${days === 1 ? '' : 's'}. Enter a licence key to keep working.`);
  }
  if (days <= WARN_WITHIN_DAYS) {
    return due('d7', `API2Test: your ${what} ends in ${days} days. Enter a licence key when you're ready.`);
  }
  if (access.state === 'trial') {
    return due('welcome', `API2Test: your free trial has started — ${days} days, everything unlocked.`, 'info');
  }
  return undefined;
}

/** One-line description of the access state, for a toast or a status command. */
export function describeAccess(access: Access): string {
  switch (access.state) {
    case 'licensed':
      return access.expiresAt ? `licensed, expires ${access.expiresAt.toISOString().slice(0, 10)}` : 'licensed';
    case 'trial':
      return `trial — ${access.daysLeft} days left`;
    case 'expired':
      return 'trial expired — enter a licence key to continue';
  }
}
