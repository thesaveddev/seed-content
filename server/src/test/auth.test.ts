import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app, registerUser, auth, resetDatabase } from './helpers';

describe('Auth API', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  it('registers a user and creates a workspace', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: `auth-test-${Date.now()}@test.local`,
      password: 'Password123!',
      name: 'Auth Tester',
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeTruthy();
    expect(res.body.data.user.email).toMatch(/@test\.local$/);
    // In-memory store does not apply schema defaults; both false and undefined are acceptable
    expect([false, undefined]).toContain(res.body.data.user.onboardingCompleted);
    expect(res.body.data.workspace.plan).toBe('free');
  });

  it('rejects duplicate email with 409', async () => {
    const { user } = await registerUser('Dup Check');
    const res = await request(app).post('/api/auth/register').send({
      email: user.email,
      password: 'Password123!',
      name: 'Dup Check',
    });
    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
  });

  it('rejects invalid registration payloads with 400', async () => {
    const bad1 = await request(app).post('/api/auth/register').send({
      email: 'not-an-email',
      password: 'short',
      name: '',
    });
    expect(bad1.status).toBe(400);

    const bad2 = await request(app).post('/api/auth/register').send({});
    expect(bad2.status).toBe(400);
  });

  it('logs in with valid credentials and returns workspace', async () => {
    const { user } = await registerUser('Login Tester');
    const res = await request(app).post('/api/auth/login').send({
      email: user.email,
      password: 'Password123!',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeTruthy();
    expect(res.body.data.workspace).toBeTruthy();
  });

  it('rejects wrong password with 401', async () => {
    const { user } = await registerUser('Wrong Pass');
    const res = await request(app).post('/api/auth/login').send({
      email: user.email,
      password: 'WrongPassword999!',
    });
    expect(res.status).toBe(401);
  });

  it('rejects unknown email with 401', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: `nobody-${Date.now()}@test.local`,
      password: 'Password123!',
    });
    expect(res.status).toBe(401);
  });

  it('GET /api/auth/me requires authentication', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('GET /api/auth/me returns user + workspace with valid token', async () => {
    const { token, user, workspace } = await registerUser('Me Test');
    const res = await auth(token).get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(user.id);
    expect(res.body.data.workspace.id).toBe(workspace.id);
  });

  it('rejects a garbage token with 401', async () => {
    const res = await auth('not.a.real.token').get('/api/auth/me');
    expect(res.status).toBe(401);
  });
});
