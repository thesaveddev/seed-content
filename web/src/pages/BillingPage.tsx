import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { billing as api } from '../lib/api';
import { useAuthStore } from '../stores/authStore';
import {
  Check, CreditCard, ExternalLink, AlertTriangle, X, Clock, Shield
} from 'lucide-react';
import toast from 'react-hot-toast';

const PLAN_COLORS: Record<string, string> = {
  free: 'var(--color-muted)',
  creator: 'oklch(55% 0.14 60)',
  pro: 'var(--color-accent)',
  agency: 'oklch(50% 0.16 150)',
};

export default function BillingPage() {
  const { workspace } = useAuthStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const [plans, setPlans] = useState<any[]>([]);
  const [usage, setUsage] = useState<any>(null);
  const [subscription, setSubscription] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [plansRes, usageRes, subRes] = await Promise.all([
          api.plans(),
          api.usage(),
          api.subscription().catch(() => ({ data: null })),
        ]);
        setPlans(plansRes.data);
        setUsage(usageRes.data);
        setSubscription(subRes.data);
      } catch (err: any) {
        toast.error('Failed to load billing info');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Handle post-checkout redirect
  useEffect(() => {
    const sessionId = searchParams.get('session_id');
    if (sessionId) {
      toast.success('Payment successful! Your plan has been activated.');
      setSearchParams({});
      // Refresh billing data
      api.subscription().then((res) => setSubscription(res.data)).catch(() => {});
      api.usage().then((res) => setUsage(res.data)).catch(() => {});
    }
  }, [searchParams, setSearchParams]);

  const handleUpgrade = async (planId: string) => {
    setCheckoutLoading(planId);
    try {
      const res = await api.checkout(planId);
      if (res.data.checkoutUrl) {
        // Redirect to Stripe Checkout
        window.location.href = res.data.checkoutUrl;
      } else {
        // Dev mode — plan upgraded directly
        toast.success(`Upgraded to ${planId}!`);
        const [usageRes, subRes] = await Promise.all([
          api.usage(),
          api.subscription().catch(() => ({ data: null })),
        ]);
        setUsage(usageRes.data);
        setSubscription(subRes.data);
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setCheckoutLoading(null);
    }
  };

  const handlePortal = async () => {
    setPortalLoading(true);
    try {
      const res = await api.portal();
      if (res.data.url) {
        window.location.href = res.data.url;
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setPortalLoading(false);
    }
  };

  const handleCancel = async () => {
    setCancelLoading(true);
    try {
      await api.cancel();
      toast.success('Subscription will cancel at the end of the billing period');
      setShowCancelConfirm(false);
      const subRes = await api.subscription();
      setSubscription(subRes.data);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setCancelLoading(false);
    }
  };

  const handleUncancel = async () => {
    try {
      await api.uncancel();
      toast.success('Cancellation reversed');
      const subRes = await api.subscription();
      setSubscription(subRes.data);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '2rem', color: 'var(--color-muted)' }}>
        <div style={{ height: 24, width: 120, background: 'var(--color-paper-2)', borderRadius: 4, marginBottom: '1.5rem' }} />
        <div style={{ height: 80, background: 'var(--color-paper-2)', borderRadius: 8 }} />
      </div>
    );
  }

  const sub = subscription?.subscription;
  const isOnPaidPlan = usage?.plan && usage.plan !== 'free';
  const isCancelling = subscription?.cancelAtPeriodEnd;

  return (
    <div style={{ color: 'var(--color-ink)' }}>
      {/* Header */}
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem', fontWeight: 700, letterSpacing: '-0.02em' }}>
          Billing
        </h1>
        <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', marginTop: '0.25rem' }}>
          Manage your plan, payment method, and subscription.
        </p>
      </div>

      {/* Current subscription card */}
      {usage && (
        <div style={{
          padding: '1.5rem',
          borderRadius: '8px',
          border: '1px solid var(--color-rule)',
          background: 'var(--color-paper)',
          marginBottom: '2rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <CreditCard style={{ width: 20, height: 20, color: PLAN_COLORS[usage.plan] || 'var(--color-muted)' }} />
              <div>
                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: 600 }}>
                  Current Plan
                </h2>
                <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)' }}>
                  {usage.month}
                </p>
              </div>
            </div>
            {subscription?.stripeConfigured && isOnPaidPlan && (
              <button
                onClick={handlePortal}
                disabled={portalLoading}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.375rem',
                  padding: '0.375rem 0.75rem',
                  borderRadius: '6px',
                  border: '1px solid var(--color-rule)',
                  background: 'var(--color-paper)',
                  color: 'var(--color-ink)',
                  fontSize: '0.8125rem',
                  fontFamily: 'var(--font-body)',
                  cursor: 'pointer',
                }}
              >
                <ExternalLink style={{ width: 13, height: 13 }} />
                {portalLoading ? 'Loading...' : 'Manage billing'}
              </button>
            )}
          </div>

          {/* Plan badge + renewal */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
            <span style={{
              padding: '0.25rem 0.75rem',
              borderRadius: '12px',
              fontSize: '0.8125rem',
              fontWeight: 600,
              fontFamily: 'var(--font-display)',
              textTransform: 'capitalize',
              color: PLAN_COLORS[usage.plan] || 'var(--color-muted)',
              background: `${PLAN_COLORS[usage.plan] || 'var(--color-muted)'}12`,
            }}>
              {usage.plan}
            </span>
            {isCancelling && (
              <span style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
                padding: '0.25rem 0.625rem',
                borderRadius: '12px',
                fontSize: '0.75rem',
                fontWeight: 600,
                color: 'oklch(55% 0.15 25)',
                background: 'oklch(55% 0.15 25 / 0.08)',
              }}>
                <AlertTriangle style={{ width: 12, height: 12 }} />
                Cancels {sub?.currentPeriodEnd
                  ? new Date(sub.currentPeriodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                  : 'soon'}
              </span>
            )}
          </div>

          {/* Usage stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '1rem' }}>
            <div>
              <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Projects</p>
              <p style={{ fontSize: '1.25rem', fontFamily: 'var(--font-display)', fontWeight: 700 }}>
                {usage.usage.projects}
                <span style={{ fontSize: '0.875rem', fontWeight: 400, color: 'var(--color-muted)' }}>
                  {' '}/ {usage.limits.projectsPerMonth}
                </span>
              </p>
            </div>
            <div>
              <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Generations</p>
              <p style={{ fontSize: '1.25rem', fontFamily: 'var(--font-display)', fontWeight: 700 }}>
                {usage.usage.generations}
              </p>
            </div>
            <div>
              <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Exports</p>
              <p style={{ fontSize: '1.25rem', fontFamily: 'var(--font-display)', fontWeight: 700 }}>
                {usage.usage.exports}
              </p>
            </div>
            <div>
              <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>AI Tokens</p>
              <p style={{ fontSize: '1.25rem', fontFamily: 'var(--font-display)', fontWeight: 700 }}>
                {usage.usage.aiTokens?.toLocaleString() || '0'}
              </p>
            </div>
          </div>

          {/* Cancel / uncancel actions */}
          {isOnPaidPlan && (
            <div style={{
              marginTop: '1.25rem',
              paddingTop: '1rem',
              borderTop: '1px solid var(--color-rule)',
            }}>
              {isCancelling ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)', flex: 1 }}>
                    Your subscription will cancel at the end of the current billing period. You'll retain access until then.
                  </p>
                  <button
                    onClick={handleUncancel}
                    style={{
                      padding: '0.375rem 0.75rem',
                      borderRadius: '6px',
                      border: '1px solid var(--color-accent)',
                      background: 'transparent',
                      color: 'var(--color-accent)',
                      fontSize: '0.8125rem',
                      fontFamily: 'var(--font-body)',
                      fontWeight: 500,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Keep subscription
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowCancelConfirm(true)}
                  style={{
                    padding: '0.375rem 0.75rem',
                    borderRadius: '6px',
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--color-muted)',
                    fontSize: '0.8125rem',
                    fontFamily: 'var(--font-body)',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                  }}
                >
                  Cancel subscription
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Plans */}
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{
          fontFamily: 'var(--font-display)',
          fontSize: '0.8125rem',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--color-muted)',
          marginBottom: '1rem',
        }}>
          Plans
        </h2>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: '1rem',
        }}>
          {plans.map((plan) => {
            const isCurrent = usage?.plan === plan.id;
            const planColor = PLAN_COLORS[plan.id] || 'var(--color-muted)';
            const isCheckoutLoading = checkoutLoading === plan.id;

            return (
              <div
                key={plan.id}
                style={{
                  padding: '1.25rem',
                  borderRadius: '8px',
                  border: `1px solid ${isCurrent ? planColor : 'var(--color-rule)'}`,
                  background: 'var(--color-paper)',
                  position: 'relative',
                  transition: 'border-color 0.15s ease',
                }}
              >
                {isCurrent && (
                  <span style={{
                    position: 'absolute',
                    top: '0.75rem',
                    right: '0.75rem',
                    padding: '0.125rem 0.5rem',
                    borderRadius: '10px',
                    fontSize: '0.6875rem',
                    fontWeight: 600,
                    color: planColor,
                    background: `${planColor}12`,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}>
                    Current
                  </span>
                )}
                {plan.popular && !isCurrent && (
                  <span style={{
                    position: 'absolute',
                    top: '0.75rem',
                    right: '0.75rem',
                    padding: '0.125rem 0.5rem',
                    borderRadius: '10px',
                    fontSize: '0.6875rem',
                    fontWeight: 600,
                    color: 'white',
                    background: 'var(--color-accent)',
                    letterSpacing: '0.05em',
                  }}>
                    Popular
                  </span>
                )}

                <h3 style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: '1rem',
                  fontWeight: 700,
                  marginBottom: '0.5rem',
                }}>
                  {plan.name}
                </h3>
                <div style={{ marginBottom: '1rem' }}>
                  <span style={{ fontSize: '1.75rem', fontFamily: 'var(--font-display)', fontWeight: 700 }}>
                    {plan.price === 0 ? 'Free' : `£${plan.price}`}
                  </span>
                  {plan.price > 0 && (
                    <span style={{ fontSize: '0.8125rem', color: 'var(--color-muted)' }}>/mo</span>
                  )}
                </div>

                <ul style={{ listStyle: 'none', padding: 0, margin: 0, marginBottom: '1.25rem' }}>
                  {plan.features.map((f: string) => (
                    <li key={f} style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '0.5rem',
                      fontSize: '0.8125rem',
                      color: 'var(--color-ink-2)',
                      padding: '0.25rem 0',
                    }}>
                      <Check style={{ width: 14, height: 14, color: planColor, marginTop: 2, flexShrink: 0 }} />
                      {f}
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => handleUpgrade(plan.id)}
                  disabled={isCurrent || isCheckoutLoading}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    borderRadius: '6px',
                    border: isCurrent ? '1px solid var(--color-rule)' : 'none',
                    background: isCurrent ? 'transparent' : planColor,
                    color: isCurrent ? 'var(--color-muted)' : 'white',
                    fontSize: '0.875rem',
                    fontFamily: 'var(--font-display)',
                    fontWeight: 600,
                    cursor: isCurrent ? 'default' : 'pointer',
                    opacity: isCheckoutLoading ? 0.7 : 1,
                    transition: 'all 0.15s ease',
                  }}
                >
                  {isCheckoutLoading ? 'Redirecting...' : isCurrent ? 'Current plan' : plan.price === 0 ? 'Downgrade' : 'Upgrade'}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* No Stripe configured notice */}
      {subscription && !subscription.stripeConfigured && isOnPaidPlan && (
        <div style={{
          padding: '1rem',
          borderRadius: '8px',
          border: '1px solid oklch(55% 0.15 25 / 0.2)',
          background: 'oklch(55% 0.15 25 / 0.04)',
          fontSize: '0.8125rem',
          color: 'var(--color-ink-2)',
          lineHeight: 1.6,
        }}>
          <strong>Dev mode:</strong> Stripe is not configured. Plans are upgraded directly without payment.
          To enable real payments, set <code style={{ padding: '0.125rem 0.375rem', borderRadius: '4px', background: 'var(--color-paper-2)', fontFamily: 'monospace', fontSize: '0.75rem' }}>STRIPE_SECRET_KEY</code> and <code style={{ padding: '0.125rem 0.375rem', borderRadius: '4px', background: 'var(--color-paper-2)', fontFamily: 'monospace', fontSize: '0.75rem' }}>STRIPE_WEBHOOK_SECRET</code> in your environment.
        </div>
      )}

      {/* Cancel confirmation modal */}
      {showCancelConfirm && (
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 50,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'oklch(18% 0.014 270 / 0.4)',
        }}>
          <div style={{
            width: '100%',
            maxWidth: 400,
            background: 'var(--color-paper)',
            borderRadius: '12px',
            border: '1px solid var(--color-rule)',
            boxShadow: '0 8px 32px oklch(18% 0.014 270 / 0.12)',
            padding: '1.5rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
              <AlertTriangle style={{ width: 20, height: 20, color: 'oklch(55% 0.15 25)' }} />
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: 700 }}>
                Cancel subscription?
              </h3>
            </div>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-ink-2)', lineHeight: 1.6, marginBottom: '1.25rem' }}>
              Your subscription will remain active until the end of the current billing period. After that, you'll be downgraded to the Free plan and lose access to premium features.
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowCancelConfirm(false)}
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: '6px',
                  border: '1px solid var(--color-rule)',
                  background: 'var(--color-paper)',
                  color: 'var(--color-ink)',
                  fontSize: '0.875rem',
                  fontFamily: 'var(--font-body)',
                  cursor: 'pointer',
                }}
              >
                Keep plan
              </button>
              <button
                onClick={handleCancel}
                disabled={cancelLoading}
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: '6px',
                  border: 'none',
                  background: 'oklch(55% 0.15 25)',
                  color: 'white',
                  fontSize: '0.875rem',
                  fontFamily: 'var(--font-body)',
                  fontWeight: 500,
                  cursor: 'pointer',
                  opacity: cancelLoading ? 0.7 : 1,
                }}
              >
                {cancelLoading ? 'Cancelling...' : 'Cancel subscription'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
