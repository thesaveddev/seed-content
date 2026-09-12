import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import { app, registerUser, auth, resetDatabase } from './helpers';
import { Workspace } from '../models';
import { config } from '../config/env';

/**
 * Billing suite — Stripe paths exercised through a fully-mocked Stripe
 * instance injected into the config/stripe singleton.
 *
 * IMPORTANT: the developer's machine may carry real STRIPE_* env values.
 * Every test runs with an explicitly injected (or explicitly cleared)
 * Stripe config so no test ever touches the real Stripe API.
 */

type MockStripe = {
  customers: { create: any };
  checkout: { sessions: { create: any } };
  billingPortal: { sessions: { create: any } };
  subscriptions: { retrieve: any; update: any };
  webhooks: { constructEvent: any };
};

const PRICE_IDS: Record<string, string> = {
  creator: 'price_creator',
  pro: 'price_pro',
  agency: 'price_agency',
};
const PLAN_BY_PRICE: Record<string, string> = {
  price_creator: 'creator',
  price_pro: 'pro',
  price_agency: 'agency',
};

function makeMockStripe(overrides: Record<string, any> = {}): MockStripe {
  return {
    customers: { create: vi.fn().mockResolvedValue({ id: 'cus_new123' }) },
    checkout: {
      sessions: {
        create: vi.fn().mockResolvedValue({ id: 'cs_test', url: 'https://checkout.stripe.com/cs_test' }),
      },
    },
    billingPortal: {
      sessions: {
        create: vi.fn().mockResolvedValue({ id: 'bps_test', url: 'https://billing.stripe.com/bps_test' }),
      },
    },
    subscriptions: {
      retrieve: vi.fn().mockResolvedValue({
        id: 'sub_123',
        status: 'active',
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
        cancel_at_period_end: false,
        items: { data: [{ id: 'si_1', price: { id: 'price_creator' } }] },
      }),
      update: vi.fn().mockResolvedValue({ id: 'sub_123' }),
    },
    webhooks: {
      constructEvent: vi.fn((payload: string, _sig: string) => JSON.parse(payload)),
    },
    ...overrides,
  };
}

async function injectStripe(mock: MockStripe | null) {
  const mod: any = await import('../config/stripe');
  mod.__setStripeForTests(mock);
  // The config gate must match the singleton, or getStripe() builds a real
  // client from the developer's env keys.
  (config as any).STRIPE_SECRET_KEY = mock ? 'sk_test_injected' : undefined;
}

/** Standard price-id mapping used across checkout/webhook assertions. */
async function mapPrices() {
  const mod: any = await import('../config/stripe');
  Object.assign(mod.PLAN_TO_PRICE, PRICE_IDS);
  mod.PRICE_TO_PLAN.price_creator = 'creator';
  mod.PRICE_TO_PLAN.price_pro = 'pro';
  mod.PRICE_TO_PLAN.price_agency = 'agency';
}

async function unmapPrices() {
  const mod: any = await import('../config/stripe');
  for (const k of Object.keys(PRICE_IDS)) mod.PLAN_TO_PRICE[k] = undefined;
  delete mod.PRICE_TO_PLAN.price_creator;
  delete mod.PRICE_TO_PLAN.price_pro;
  delete mod.PRICE_TO_PLAN.price_agency;
}

async function setWorkspaceFields(workspaceId: string, fields: Record<string, any>) {
  await Workspace.findByIdAndUpdate(workspaceId, fields);
}

describe('Billing — full coverage', () => {
  beforeAll(async () => {
    await resetDatabase();
    await injectStripe(null); // start unconfigured
  });

  // ── Plans + usage (no Stripe) ──────────────────────────────────

  it('plans: lists all four tiers with features and pricing', async () => {
    const res = await request(app).get('/api/billing/plans');
    expect(res.status).toBe(200);
    const plans = res.body.data;
    expect(plans.map((p: any) => p.id)).toEqual(['free', 'creator', 'pro', 'agency']);
    expect(plans.find((p: any) => p.id === 'creator').popular).toBe(true);
    expect(plans.find((p: any) => p.id === 'agency').features.join(' ')).toMatch(/Unlimited/);
  });

  it('usage: 404 for an unknown workspace is unreachable normally, but works for a real one', async () => {
    const { token, workspace } = await registerUser('Usage User');
    const res = await auth(token).get('/api/billing/usage');
    expect(res.status).toBe(200);
    expect(res.body.data.plan).toBe(workspace.plan);
    expect(res.body.data.usage).toMatchObject({ minutesProcessed: 0, generations: 0 });
  });

  // ── Subscription status ────────────────────────────────────────

  it('subscription: without Stripe shows unconfigured with no subscription', async () => {
    const { token, workspace } = await registerUser('Sub Unconfigured');
    const res = await auth(token).get('/api/billing/subscription');
    expect(res.status).toBe(200);
    expect(res.body.data.stripeConfigured).toBe(false);
    expect(res.body.data.hasStripeCustomer).toBe(false);
    expect(res.body.data.subscription).toBeNull();
    void workspace;
  });

  it('subscription: with a live subscription id, fetches and maps plan from price', async () => {
    const mock = makeMockStripe();
    await injectStripe(mock as any);
    await mapPrices();
    const { token, workspace } = await registerUser('Sub Live');

    await setWorkspaceFields(workspace.id, {
      stripeCustomerId: 'cus_live1',
      stripeSubscriptionId: 'sub_live1',
    });

    const res = await auth(token).get('/api/billing/subscription');
    expect(res.status).toBe(200);
    expect(res.body.data.stripeConfigured).toBe(true);
    expect(res.body.data.hasStripeCustomer).toBe(true);
    expect(res.body.data.subscription.id).toBe('sub_123');
    expect(res.body.data.subscription.status).toBe('active');
    expect(res.body.data.subscription.plan).toBe('creator'); // mapped from price_creator
    expect(mock.subscriptions.retrieve).toHaveBeenCalledWith('sub_live1');

    await unmapPrices();
    await injectStripe(null);
  });

  it('subscription: tolerates an externally-deleted subscription', async () => {
    const mock = makeMockStripe({
      subscriptions: { retrieve: vi.fn().mockRejectedValue(new Error('No such subscription')), update: vi.fn() },
    });
    await injectStripe(mock as any);
    const { token, workspace } = await registerUser('Sub Deleted');

    await setWorkspaceFields(workspace.id, { stripeSubscriptionId: 'sub_gone' });

    const res = await auth(token).get('/api/billing/subscription');
    expect(res.status).toBe(200);
    expect(res.body.data.subscription).toBeNull(); // fell back to workspace data

    await injectStripe(null);
  });

  // ── Checkout: dev mode ─────────────────────────────────────────

  it('checkout: invalid plan → 400; dev mode upgrades directly', async () => {
    const { token, workspace } = await registerUser('Checkout Dev');

    const bad = await auth(token).post('/api/billing/checkout').send({ planId: 'platinum' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/invalid plan/i);

    const ok = await auth(token).post('/api/billing/checkout').send({ planId: 'pro' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.checkoutUrl).toBeNull();
    expect(ok.body.data.upgraded).toBe(true);

    const ws = await Workspace.findById(workspace.id);
    expect(ws?.plan).toBe('pro');
    await setWorkspaceFields(workspace.id, { plan: 'free' });
  });

  // ── Checkout: real Stripe ──────────────────────────────────────

  it('checkout (Stripe): creates a customer, then a checkout session', async () => {
    const mock = makeMockStripe();
    await injectStripe(mock as any);
    await mapPrices();

    const { token, user, workspace } = await registerUser('Checkout Stripe');

    const res = await auth(token).post('/api/billing/checkout').send({ planId: 'creator' });
    expect(res.status).toBe(200);
    expect(res.body.data.checkoutUrl).toBe('https://checkout.stripe.com/cs_test');

    // Customer created with the user's identity + workspace metadata
    expect(mock.customers.create).toHaveBeenCalledTimes(1);
    const custArgs = mock.customers.create.mock.calls[0][0];
    expect(custArgs.email).toBe(user.email);
    expect(custArgs.metadata.workspaceId).toBe(workspace.id);

    // Customer id persisted on the workspace
    const ws = await Workspace.findById(workspace.id);
    expect(ws?.stripeCustomerId).toBe('cus_new123');

    // Session created with the mapped price + metadata
    const sessArgs = mock.checkout.sessions.create.mock.calls[0][0];
    expect(sessArgs.line_items[0].price).toBe('price_creator');
    expect(sessArgs.metadata.planId).toBe('creator');
    expect(sessArgs.mode).toBe('subscription');

    await unmapPrices();
    await injectStripe(null);
  });

  it('checkout (Stripe): reuses the existing customer and upgrades an existing subscription in place', async () => {
    const mock = makeMockStripe();
    await injectStripe(mock as any);
    await mapPrices();

    const { token, workspace } = await registerUser('Upgrade In Place');
    await setWorkspaceFields(workspace.id, {
      stripeCustomerId: 'cus_existing',
      stripeSubscriptionId: 'sub_existing',
    });

    const res = await auth(token).post('/api/billing/checkout').send({ planId: 'pro' });
    expect(res.status).toBe(200);
    expect(res.body.data.upgraded).toBe(true);
    expect(res.body.data.checkoutUrl).toBeNull();

    // No new customer, no new checkout session
    expect(mock.customers.create).not.toHaveBeenCalled();
    expect(mock.checkout.sessions.create).not.toHaveBeenCalled();
    // Existing subscription updated to the new price with prorations
    expect(mock.subscriptions.update).toHaveBeenCalledWith(
      'sub_existing',
      expect.objectContaining({ proration_behavior: 'create_prorations' })
    );

    const ws = await Workspace.findById(workspace.id);
    expect(ws?.plan).toBe('pro');

    await unmapPrices();
    await injectStripe(null);
  });

  it('checkout (Stripe): falls through to a new session when the existing subscription is gone', async () => {
    const mock = makeMockStripe({
      subscriptions: {
        retrieve: vi.fn().mockRejectedValue(new Error('No such subscription')),
        update: vi.fn(),
      },
    });
    await injectStripe(mock as any);
    await mapPrices();

    const { token, workspace } = await registerUser('Upgrade Fallback');
    await setWorkspaceFields(workspace.id, {
      stripeCustomerId: 'cus_x',
      stripeSubscriptionId: 'sub_dead',
    });

    const res = await auth(token).post('/api/billing/checkout').send({ planId: 'creator' });
    expect(res.status).toBe(200);
    expect(res.body.data.checkoutUrl).toBe('https://checkout.stripe.com/cs_test');
    expect(mock.checkout.sessions.create).toHaveBeenCalled();

    await unmapPrices();
    await injectStripe(null);
  });

  // ── Customer portal ────────────────────────────────────────────

  it('portal: unconfigured → 400; no customer → 400; with customer → url', async () => {
    const { token, workspace } = await registerUser('Portal User');

    const unconfigured = await auth(token).post('/api/billing/portal').send({});
    expect(unconfigured.status).toBe(400);
    expect(unconfigured.body.error).toMatch(/not configured/i);

    const mock = makeMockStripe();
    await injectStripe(mock as any);

    const noCustomer = await auth(token).post('/api/billing/portal').send({});
    expect(noCustomer.status).toBe(400);
    expect(noCustomer.body.error).toMatch(/subscribe first/i);

    await setWorkspaceFields(workspace.id, { stripeCustomerId: 'cus_portal' });
    const ok = await auth(token).post('/api/billing/portal').send({});
    expect(ok.status).toBe(200);
    expect(ok.body.data.url).toContain('billing.stripe.com');

    await injectStripe(null);
  });

  // ── Cancel / uncancel ──────────────────────────────────────────

  it('cancel: dev mode downgrades; Stripe mode cancels at period end; no-sub → 400', async () => {
    const { token, workspace } = await registerUser('Cancel User');

    // Dev mode: direct downgrade
    await setWorkspaceFields(workspace.id, { plan: 'pro' });
    const dev = await auth(token).post('/api/billing/cancel').send({});
    expect(dev.status).toBe(200);
    expect(dev.body.data.devMode).toBe(true);
    const wsAfterDev = await Workspace.findById(workspace.id);
    expect(wsAfterDev?.plan).toBe('free');

    // Stripe mode without a subscription
    const mock = makeMockStripe();
    await injectStripe(mock as any);
    const noSub = await auth(token).post('/api/billing/cancel').send({});
    expect(noSub.status).toBe(400);
    expect(noSub.body.error).toMatch(/no active subscription/i);

    // Stripe mode with a subscription
    await setWorkspaceFields(workspace.id, { stripeSubscriptionId: 'sub_cancel' });
    const ok = await auth(token).post('/api/billing/cancel').send({});
    expect(ok.status).toBe(200);
    expect(ok.body.data.cancelled).toBe(true);
    expect(mock.subscriptions.update).toHaveBeenCalledWith('sub_cancel', { cancel_at_period_end: true });
    const ws = await Workspace.findById(workspace.id);
    expect(ws?.cancelAtPeriodEnd).toBe(true);

    await injectStripe(null);
  });

  it('uncancel: unconfigured → 400; no-sub → 400; with sub → reverse flag', async () => {
    const { token, workspace } = await registerUser('Uncancel User');

    const unconfigured = await auth(token).post('/api/billing/uncancel').send({});
    expect(unconfigured.status).toBe(400);

    const mock = makeMockStripe();
    await injectStripe(mock as any);

    const noSub = await auth(token).post('/api/billing/uncancel').send({});
    expect(noSub.status).toBe(400);

    await setWorkspaceFields(workspace.id, { stripeSubscriptionId: 'sub_uncancel' });
    const ok = await auth(token).post('/api/billing/uncancel').send({});
    expect(ok.status).toBe(200);
    expect(ok.body.data.uncanceled).toBe(true);
    expect(mock.subscriptions.update).toHaveBeenCalledWith('sub_uncancel', { cancel_at_period_end: false });

    await injectStripe(null);
  });

  // ── Webhooks ───────────────────────────────────────────────────

  function webhookRequest(payload: any, sig = 'sig_test') {
    return request(app)
      .post('/api/billing/webhooks')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', sig)
      .send(payload);
  }

  async function webhookWithStripe(mock: any, event: any) {
    await injectStripe(mock);
    const mod: any = await import('../config/env');
    const saved = mod.config.STRIPE_WEBHOOK_SECRET;
    mod.config.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    const res = await webhookRequest(event);
    mod.config.STRIPE_WEBHOOK_SECRET = saved;
    await injectStripe(null);
    return res;
  }

  it('webhook: rejects missing signature, unconfigured stripe, and bad signatures', async () => {
    // No signature header
    const noSig = await request(app).post('/api/billing/webhooks').send({});
    expect(noSig.status).toBe(400);

    // Stripe unconfigured
    const sigOnly = await webhookRequest({ type: 'x' });
    expect(sigOnly.status).toBe(400);

    // constructEvent throws → 400
    const mock = makeMockStripe({
      webhooks: { constructEvent: vi.fn(() => { throw new Error('Invalid signature'); }) },
    });
    await injectStripe(mock as any);
    const mod: any = await import('../config/env');
    const saved = mod.config.STRIPE_WEBHOOK_SECRET;
    mod.config.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    const badSig = await webhookRequest({ type: 'x' });
    mod.config.STRIPE_WEBHOOK_SECRET = saved;
    await injectStripe(null);
    expect(badSig.status).toBe(400);
    expect(badSig.body.error).toMatch(/webhook error/i);
  });

  it('webhook checkout.session.completed: activates the plan and stores ids', async () => {
    const { workspace } = await registerUser('Webhook Checkout');
    const mock = makeMockStripe();
    // retrieve called for period end lookup
    mock.subscriptions.retrieve = vi.fn().mockResolvedValue({
      items: { data: [{ price: { id: 'price_creator' } }] },
      current_period_end: Math.floor(Date.now() / 1000) + 86400,
    });

    const res = await webhookWithStripe(mock, {
      type: 'checkout.session.completed',
      data: { object: {
        customer: 'cus_web1',
        subscription: 'sub_web1',
        metadata: { workspaceId: workspace.id, planId: 'creator' },
      } },
    });
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);

    const ws: any = await Workspace.findById(workspace.id);
    expect(ws.plan).toBe('creator');
    expect(ws.stripeCustomerId).toBe('cus_web1');
    expect(ws.stripeSubscriptionId).toBe('sub_web1');
    expect(ws.stripePriceId).toBe('price_creator');
    expect(ws.currentPeriodEnd).toBeTruthy();
  });

  it('webhook customer.subscription.updated: maps price → plan; canceled status downgrades', async () => {
    const { workspace } = await registerUser('Webhook Updated');
    await mapPrices();

    // Update to pro
    const mock = makeMockStripe();
    await webhookWithStripe(mock, {
      type: 'customer.subscription.updated',
      data: { object: {
        metadata: { workspaceId: workspace.id },
        status: 'active',
        cancel_at_period_end: false,
        current_period_end: Math.floor(Date.now() / 1000) + 86400,
        items: { data: [{ price: { id: 'price_pro' } }] },
      } },
    });
    let ws: any = await Workspace.findById(workspace.id);
    expect(ws.plan).toBe('pro');

    // Canceled → downgrade to free, clear ids
    await webhookWithStripe(mock, {
      type: 'customer.subscription.updated',
      data: { object: {
        metadata: { workspaceId: workspace.id },
        status: 'canceled',
        cancel_at_period_end: false,
        current_period_end: Math.floor(Date.now() / 1000),
        items: { data: [{ price: { id: 'price_pro' } }] },
      } },
    });
    ws = await Workspace.findById(workspace.id);
    expect(ws.plan).toBe('free');
    expect(ws.stripeSubscriptionId).toBeNull();
    expect(ws.stripePriceId).toBeNull();
    expect(ws.cancelAtPeriodEnd).toBe(false);

    await unmapPrices();
  });

  it('webhook customer.subscription.deleted: downgrades to free', async () => {
    const { workspace } = await registerUser('Webhook Deleted');
    await setWorkspaceFields(workspace.id, {
      plan: 'pro',
      stripeSubscriptionId: 'sub_delete',
      stripePriceId: 'price_pro',
      cancelAtPeriodEnd: true,
    });

    const mock = makeMockStripe();
    const res = await webhookWithStripe(mock, {
      type: 'customer.subscription.deleted',
      data: { object: { metadata: { workspaceId: workspace.id } } },
    });
    expect(res.status).toBe(200);

    const ws: any = await Workspace.findById(workspace.id);
    expect(ws.plan).toBe('free');
    expect(ws.stripeSubscriptionId).toBeNull();
    expect(ws.currentPeriodEnd).toBeNull();
    expect(ws.cancelAtPeriodEnd).toBe(false);
  });

  it('webhook invoice.payment_failed finds the workspace by customer; invoice.paid and unknown types ack', async () => {
    const { workspace } = await registerUser('Webhook Invoice');
    await setWorkspaceFields(workspace.id, { stripeCustomerId: 'cus_invoice' });

    const mock = makeMockStripe();

    const failed = await webhookWithStripe(mock, {
      type: 'invoice.payment_failed',
      data: { object: { customer: 'cus_invoice', id: 'in_fail' } },
    });
    expect(failed.status).toBe(200);

    const paid = await webhookWithStripe(mock, {
      type: 'invoice.paid',
      data: { object: { id: 'in_paid', metadata: { workspaceId: workspace.id } } },
    });
    expect(paid.status).toBe(200);

    const unknown = await webhookWithStripe(mock, {
      type: 'weird.event',
      data: { object: {} },
    });
    expect(unknown.status).toBe(200);
  });

  it('webhook: handler crash → 500', async () => {
    const { workspace } = await registerUser('Webhook Crash');
    const mock = makeMockStripe();
    // Force the handler to throw: Workspace.findByIdAndUpdate rejects
    const models: any = await import('../models');
    const savedFn = models.Workspace.findByIdAndUpdate;
    models.Workspace.findByIdAndUpdate = vi.fn().mockRejectedValue(new Error('db down'));

    try {
      const res = await webhookWithStripe(mock, {
        type: 'checkout.session.completed',
        data: { object: {
          customer: 'cus_c',
          subscription: 'sub_c',
          metadata: { workspaceId: workspace.id, planId: 'creator' },
        } },
      });
      expect(res.status).toBe(500);
    } finally {
      models.Workspace.findByIdAndUpdate = savedFn;
    }
  });
});
