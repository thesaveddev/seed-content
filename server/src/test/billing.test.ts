import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app, registerUser, auth, resetDatabase } from './helpers';

describe('Billing API (no Stripe configured)', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  it('GET /api/billing/plans returns the four plans with limits', async () => {
    const res = await request(app).get('/api/billing/plans');
    expect(res.status).toBe(200);
    const plans = res.body.data;
    expect(plans.map((p: any) => p.id)).toEqual(['free', 'creator', 'pro', 'agency']);
    const creator = plans.find((p: any) => p.id === 'creator');
    expect(creator.price).toBe(9);
    expect(creator.popular).toBe(true);
  });

  it('GET /api/billing/usage returns usage + limits for the workspace', async () => {
    const { token, workspace } = await registerUser('Usage User');
    const res = await auth(token).get('/api/billing/usage');
    expect(res.status).toBe(200);
    expect(res.body.data.plan).toBe('free');
    expect(res.body.data.limits.projectsPerMonth).toBe(3);
    expect(res.body.data.usage.projects).toBeDefined();
  });

  it('requires auth for usage', async () => {
    const res = await request(app).get('/api/billing/usage');
    expect(res.status).toBe(401);
  });

  it('checkout without Stripe configured fails gracefully', async () => {
    const { token } = await registerUser('No Stripe');
    const res = await auth(token).post('/api/billing/checkout').send({ plan: 'creator' });
    // Without STRIPE keys the route must not crash — it should return a clean error or upgrade hint
    expect([200, 400, 501]).toContain(res.status);
    expect(JSON.stringify(res.body)).not.toMatch(/Cannot read|undefined is not/i);
  });

  it('subscription endpoint reports plan without Stripe', async () => {
    const { token, workspace } = await registerUser('Sub Status');
    const res = await auth(token).get('/api/billing/subscription');
    expect(res.status).toBe(200);
    expect(res.body.data.plan).toBe(workspace.plan);
  });
});

describe('Health', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  it('GET /api/health responds ok without auth', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
