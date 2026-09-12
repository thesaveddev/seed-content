import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { Workspace, Usage } from '../models';
import { AuthRequest, PLAN_LIMITS } from '../types';
import { config } from '../config/env';
import { getStripe, isStripeConfigured, PLAN_TO_PRICE, PRICE_TO_PLAN } from '../config/stripe';

const router = Router();

// ============================================================
// Plans — always static, no Stripe needed
// ============================================================

router.get('/plans', (_req, res: Response) => {
  res.json({
    success: true,
    data: [
      {
        id: 'free', name: 'Free', price: 0, interval: 'month',
        features: [
          `${PLAN_LIMITS.free.projectsPerMonth} content projects/month`,
          `${PLAN_LIMITS.free.maxFileSize}MB max file size`, '3 platforms',
          `${PLAN_LIMITS.free.transcriptionMinutes} min transcription`,
          `${PLAN_LIMITS.free.brandVoices} brand voice`,
        ],
      },
      {
        id: 'creator', name: 'Creator', price: 9, interval: 'month', popular: true,
        features: [
          `${PLAN_LIMITS.creator.projectsPerMonth} content projects/month`,
          `${PLAN_LIMITS.creator.maxFileSize}MB max file size`, 'All platforms',
          `${PLAN_LIMITS.creator.transcriptionMinutes} min transcription`,
          `${PLAN_LIMITS.creator.brandVoices} brand voices`,
          `${PLAN_LIMITS.creator.campaigns} campaigns`,
        ],
      },
      {
        id: 'pro', name: 'Pro', price: 19, interval: 'month',
        features: [
          `${PLAN_LIMITS.pro.projectsPerMonth} content projects/month`,
          `${PLAN_LIMITS.pro.maxFileSize}MB max file size`, 'All platforms',
          `${PLAN_LIMITS.pro.transcriptionMinutes} min transcription`,
          `${PLAN_LIMITS.pro.brandVoices} brand voices`,
          `${PLAN_LIMITS.pro.campaigns} campaigns`,
        ],
      },
      {
        id: 'agency', name: 'Agency', price: 59, interval: 'month',
        features: [
          `${PLAN_LIMITS.agency.projectsPerMonth} content projects/month`,
          `${PLAN_LIMITS.agency.maxFileSize}MB max file size`, 'All platforms',
          `${PLAN_LIMITS.agency.transcriptionMinutes} min transcription`,
          'Unlimited brand voices', 'Unlimited campaigns', 'Multiple workspaces',
        ],
      },
    ],
  });
});

// ============================================================
// Usage — always works (no Stripe needed)
// ============================================================

router.get('/usage', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const workspace = await Workspace.findById(req.workspaceId);
    if (!workspace) {
      res.status(404).json({ success: false, error: 'Workspace not found' });
      return;
    }
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const usage = await Usage.findOne({ workspaceId: workspace._id, month });
    const planLimits = PLAN_LIMITS[workspace.plan as keyof typeof PLAN_LIMITS] || PLAN_LIMITS.free;
    res.json({
      success: true,
      data: {
        plan: workspace.plan,
        month,
        usage: usage || { minutesProcessed: 0, generations: 0, projects: 0, exports: 0, aiTokens: 0 },
        limits: planLimits,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// Subscription status — current plan, Stripe details, renewal
// ============================================================

router.get('/subscription', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const workspace = await Workspace.findById(req.workspaceId);
    if (!workspace) {
      res.status(404).json({ success: false, error: 'Workspace not found' });
      return;
    }

    const stripe = getStripe();
    let subscription: any = null;

    // If we have a Stripe subscription ID, fetch live status
    if (stripe && (workspace as any).stripeSubscriptionId) {
      try {
        subscription = await stripe.subscriptions.retrieve((workspace as any).stripeSubscriptionId);
      } catch {
        // Subscription may have been deleted externally
      }
    }

    res.json({
      success: true,
      data: {
        plan: workspace.plan,
        stripeConfigured: isStripeConfigured(),
        hasStripeCustomer: !!(workspace as any).stripeCustomerId,
        subscription: subscription
          ? {
              id: subscription.id,
              status: subscription.status,
              currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
              cancelAtPeriodEnd: subscription.cancel_at_period_end,
              plan: PRICE_TO_PLAN[subscription.items.data[0]?.price?.id] || workspace.plan,
            }
          : null,
        currentPeriodEnd: (workspace as any).currentPeriodEnd,
        cancelAtPeriodEnd: (workspace as any).cancelAtPeriodEnd,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// Checkout — create Stripe Checkout Session (or dev upgrade)
// ============================================================

router.post('/checkout', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { planId } = req.body;

    if (!planId || !PLAN_LIMITS[planId]) {
      res.status(400).json({ success: false, error: 'Invalid plan' });
      return;
    }

    const workspace = await Workspace.findById(req.workspaceId);
    if (!workspace) {
      res.status(404).json({ success: false, error: 'Workspace not found' });
      return;
    }

    const stripe = getStripe();
    const priceId = PLAN_TO_PRICE[planId];

    if (stripe && priceId) {
      // --- Real Stripe checkout ---

      // Create or reuse Stripe customer
      let customerId = (workspace as any).stripeCustomerId;

      if (!customerId) {
        const user = await (await import('../models')).User.findById(req.userId);
        const customer = await stripe.customers.create({
          email: user?.email,
          name: user?.name,
          metadata: { workspaceId: req.workspaceId },
        });
        customerId = customer.id;
        await Workspace.findByIdAndUpdate(req.workspaceId, { stripeCustomerId: customerId });
      }

      // Check if upgrading from an existing subscription
      const existingSubId = (workspace as any).stripeSubscriptionId;
      if (existingSubId) {
        // Update existing subscription to new price
        try {
          const existingSub = await stripe.subscriptions.retrieve(existingSubId);
          await stripe.subscriptions.update(existingSubId, {
            items: [{ id: existingSub.items.data[0].id, price: priceId }],
            proration_behavior: 'create_prorations',
          });
          await Workspace.findByIdAndUpdate(req.workspaceId, {
            plan: planId,
            stripePriceId: priceId,
          });
          return res.json({ success: true, data: { checkoutUrl: null, upgraded: true } });
        } catch {
          // Existing sub may be cancelled/deleted — fall through to new checkout
        }
      }

      // New checkout session
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${config.FRONTEND_URL}/billing?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${config.FRONTEND_URL}/billing`,
        metadata: { workspaceId: req.workspaceId, planId },
        subscription_data: {
          metadata: { workspaceId: req.workspaceId, planId },
        },
      });

      return res.json({ success: true, data: { checkoutUrl: session.url } });
    } else {
      // --- Dev mode: direct upgrade ---
      await Workspace.findByIdAndUpdate(req.workspaceId, { plan: planId });
      return res.json({ success: true, data: { checkoutUrl: null, upgraded: true } });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// Customer Portal — redirect to Stripe Billing Portal
// ============================================================

router.post('/portal', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const stripe = getStripe();
    if (!stripe) {
      return res.status(400).json({ success: false, error: 'Stripe is not configured' });
    }

    const workspace = await Workspace.findById(req.workspaceId);
    if (!workspace) {
      res.status(404).json({ success: false, error: 'Workspace not found' });
      return;
    }

    const customerId = (workspace as any).stripeCustomerId;
    if (!customerId) {
      return res.status(400).json({ success: false, error: 'No billing account found. Subscribe first.' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${config.FRONTEND_URL}/billing`,
    });

    res.json({ success: true, data: { url: session.url } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// Cancel subscription — at period end
// ============================================================

router.post('/cancel', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const stripe = getStripe();
    if (!stripe) {
      // Dev mode: just downgrade
      await Workspace.findByIdAndUpdate(req.workspaceId, { plan: 'free', cancelAtPeriodEnd: false });
      return res.json({ success: true, data: { cancelled: true, devMode: true } });
    }

    const workspace = await Workspace.findById(req.workspaceId);
    if (!workspace) {
      res.status(404).json({ success: false, error: 'Workspace not found' });
      return;
    }

    const subId = (workspace as any).stripeSubscriptionId;
    if (!subId) {
      return res.status(400).json({ success: false, error: 'No active subscription' });
    }

    // Cancel at period end (user keeps access until billing period ends)
    await stripe.subscriptions.update(subId, { cancel_at_period_end: true });
    await Workspace.findByIdAndUpdate(req.workspaceId, { cancelAtPeriodEnd: true });

    res.json({ success: true, data: { cancelled: true, message: 'Subscription will cancel at the end of the billing period' } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// Uncancel — reverse a pending cancellation
// ============================================================

router.post('/uncancel', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const stripe = getStripe();
    if (!stripe) {
      return res.status(400).json({ success: false, error: 'Stripe is not configured' });
    }

    const workspace = await Workspace.findById(req.workspaceId);
    if (!workspace) {
      res.status(404).json({ success: false, error: 'Workspace not found' });
      return;
    }

    const subId = (workspace as any).stripeSubscriptionId;
    if (!subId) {
      return res.status(400).json({ success: false, error: 'No active subscription' });
    }

    await stripe.subscriptions.update(subId, { cancel_at_period_end: false });
    await Workspace.findByIdAndUpdate(req.workspaceId, { cancelAtPeriodEnd: false });

    res.json({ success: true, data: { uncanceled: true } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// Webhook — Stripe event handler
//
// IMPORTANT: This route MUST use raw body parsing for signature
// verification.  In production, add this BEFORE express.json():
//   app.post('/api/billing/webhooks',
//     express.raw({ type: 'application/json' }),
//     billingRoutes
//   );
// In dev mode without Stripe, this route is never called.
// ============================================================

router.post('/webhooks', async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'];
  const stripe = getStripe();

  if (!sig || !stripe || !config.STRIPE_WEBHOOK_SECRET) {
    res.status(400).json({ error: 'Webhook not configured' });
    return;
  }

  let event: any;
  try {
    // express.raw delivers a Buffer — pass it through untouched (JSON.stringify
    // would corrupt the exact bytes the signature covers)
    const payload = Buffer.isBuffer(req.body)
      ? req.body.toString('utf8')
      : typeof req.body === 'string'
        ? req.body
        : JSON.stringify(req.body);
    event = stripe.webhooks.constructEvent(payload, sig, config.STRIPE_WEBHOOK_SECRET);
  } catch (err: any) {
    console.error('Webhook signature verification failed:', err.message);
    res.status(400).json({ error: `Webhook Error: ${err.message}` });
    return;
  }

  console.log(`📨 Stripe webhook: ${event.type}`);

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const workspaceId = session.metadata?.workspaceId;
        const planId = session.metadata?.planId;

        if (workspaceId && planId) {
          // Activate the plan
          const update: any = { plan: planId };

          // Store Stripe IDs
          if (session.customer) update.stripeCustomerId = session.customer;
          if (session.subscription) update.stripeSubscriptionId = session.subscription;

          // Look up the price to store
          if (session.subscription) {
            const sub = await stripe.subscriptions.retrieve(session.subscription);
            update.stripePriceId = sub.items.data[0]?.price?.id;
            update.currentPeriodEnd = new Date(sub.current_period_end * 1000);
          }

          await Workspace.findByIdAndUpdate(workspaceId, update);
          console.log(`✅ Workspace ${workspaceId} upgraded to ${planId}`);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const workspaceId = subscription.metadata?.workspaceId;

        if (workspaceId) {
          const priceId = subscription.items.data[0]?.price?.id;
          const plan = PRICE_TO_PLAN[priceId] || 'free';

          const update: any = {
            plan,
            stripePriceId: priceId,
            currentPeriodEnd: new Date(subscription.current_period_end * 1000),
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
          };

          // If subscription was cancelled (not just at period end), downgrade
          if (subscription.status === 'canceled' || subscription.status === 'unpaid') {
            update.plan = 'free';
            update.stripeSubscriptionId = null;
            update.stripePriceId = null;
            update.cancelAtPeriodEnd = false;
          }

          await Workspace.findByIdAndUpdate(workspaceId, update);
          console.log(`🔄 Workspace ${workspaceId} subscription updated: ${plan} (${subscription.status})`);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const workspaceId = subscription.metadata?.workspaceId;

        if (workspaceId) {
          await Workspace.findByIdAndUpdate(workspaceId, {
            plan: 'free',
            stripeSubscriptionId: null,
            stripePriceId: null,
            currentPeriodEnd: null,
            cancelAtPeriodEnd: false,
          });
          console.log(`❌ Workspace ${workspaceId} subscription cancelled — downgraded to free`);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const customerId = invoice.customer;

        // Find workspace by Stripe customer ID
        if (customerId) {
          const workspace = await Workspace.findOne({ stripeCustomerId: customerId } as any);
          if (workspace) {
            console.log(`⚠️  Payment failed for workspace ${workspace._id} (${invoice.id})`);
            // Optionally: create a notification, send email, etc.
          }
        }
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object;
        const workspaceId = invoice.metadata?.workspaceId;
        console.log(`💰 Invoice paid: ${invoice.id} (${workspaceId || 'unknown workspace'})`);
        break;
      }

      default:
        console.log(`ℹ️  Unhandled Stripe event: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error: any) {
    console.error(`Webhook handler error for ${event.type}:`, error.message);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
});

export default router;
