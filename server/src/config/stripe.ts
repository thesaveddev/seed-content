/**
 * Stripe configuration and plan-to-price mapping.
 *
 * In production, create products + prices in the Stripe Dashboard, then set
 * the corresponding env vars.  In development without Stripe keys the app
 * falls back to direct plan upgrades (no payment).
 *
 * Env vars (all optional — app works without them in dev mode):
 *   STRIPE_SECRET_KEY          – sk_test_… / sk_live_…
 *   STRIPE_WEBHOOK_SECRET      – whsec_…
 *   STRIPE_PRICE_CREATOR       – price_… for Creator plan
 *   STRIPE_PRICE_PRO           – price_… for Pro plan
 *   STRIPE_PRICE_AGENCY        – price_… for Agency plan
 */

import { config } from './env';

// ---- Price-ID mapping ----

export const PLAN_TO_PRICE: Record<string, string | undefined> = {
  creator: config.STRIPE_PRICE_CREATOR || undefined,
  pro: config.STRIPE_PRICE_PRO || undefined,
  agency: config.STRIPE_PRICE_AGENCY || undefined,
};

// Reverse lookup: price → plan name
export const PRICE_TO_PLAN: Record<string, string> = {};
for (const [plan, priceId] of Object.entries(PLAN_TO_PRICE)) {
  if (priceId) PRICE_TO_PLAN[priceId] = plan;
}

// ---- Lazy Stripe instance ----

let _stripe: any = null;

export function getStripe() {
  if (_stripe) return _stripe;
  if (!config.STRIPE_SECRET_KEY) return null;
  // Dynamic import so the app boots without stripe installed
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Stripe = require('stripe').default;
    _stripe = new Stripe(config.STRIPE_SECRET_KEY, {
      apiVersion: '2024-12-18.acacia' as any,
    });
    return _stripe;
  } catch {
    console.warn('⚠️  stripe package not installed — Stripe features disabled');
    return null;
  }
}

export function isStripeConfigured() {
  return !!getStripe();
}
