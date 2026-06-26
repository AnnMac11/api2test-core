/**
 * Premium feature flags and subscription plans, shared by every edition (VS Code extension and the
 * enterprise app). A signed entitlement token (see ./entitlements) carries the plan; gating reads
 * the plan's features. Free tier has none — only the always-available single-test/authoring flow.
 */

/** Gated premium capabilities. */
export type Feature = 'e2e' | 'testSets' | 'dashboard';

/** Subscription plans. */
export type Plan = 'free' | 'pro' | 'enterprise';

export const ALL_FEATURES: readonly Feature[] = ['e2e', 'testSets', 'dashboard'];

/** Which features each plan unlocks. A token may also carry an explicit `features` override. */
export const PLAN_FEATURES: Record<Plan, Feature[]> = {
  free: [],
  pro: ['e2e', 'testSets', 'dashboard'],
  enterprise: ['e2e', 'testSets', 'dashboard'],
};
