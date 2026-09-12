import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import { app, registerUser, auth, resetDatabase } from './helpers';

/**
 * Auth coverage beyond the basics: password reset lifecycle, onboarding,
 * logout, and disabled-account lockout. The reset token is captured from
 * the dev-mode email console output (no SMTP in tests).
 */

/** Capture the reset URL the email service logs in dev mode. */
async function requestReset(email: string): Promise<string> {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    const res = await request(app).post('/api/auth/forgot-password').send({ email });
    expect(res.status).toBe(200);
    const calls = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    const match = calls.match(/reset-password\?token=([a-f0-9]+)/);
    expect(match, 'reset token should appear in dev email output').toBeTruthy();
    return match![1];
  } finally {
    logSpy.mockRestore();
  }
}

describe('Auth — password reset lifecycle', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  it('forgot-password never reveals whether an email exists', async () => {
    const known = await request(app).post('/api/auth/forgot-password').send({ email: `known-${Date.now()}@test.local` });
    // Register the "known" user first so both branches are exercised
    const u = await registerUser('Reset Target');
    const res1 = await request(app).post('/api/auth/forgot-password').send({ email: u.user.email });
    const res2 = await request(app).post('/api/auth/forgot-password').send({ email: `ghost-${Date.now()}@test.local` });

    expect(known.status).toBe(200);
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res1.body.message).toBe(res2.body.message);
    expect(res1.body.message).toMatch(/if that email exists/i);
  });

  it('resets the password with a valid token and clears it (single use)', async () => {
    // Isolate: earlier tests minted reset tokens for other users, and the
    // store's findOne returns the first match — wipe before minting ours.
    await resetDatabase();
    const u = await registerUser('Reset Single Use');
    const token = await requestReset(u.user.email);

    const reset = await request(app).post('/api/auth/reset-password').send({ token, password: 'NewPassword123!' });
    expect(reset.status).toBe(200);
    expect(reset.body.message).toBe('Password reset successful');

    // Old password no longer works
    const oldLogin = await request(app).post('/api/auth/login').send({ email: u.user.email, password: 'Password123!' });
    expect(oldLogin.status).toBe(401);

    // New password works
    const newLogin = await request(app).post('/api/auth/login').send({ email: u.user.email, password: 'NewPassword123!' });
    expect(newLogin.status).toBe(200);

    // Replay the same token → invalid
    const replay = await request(app).post('/api/auth/reset-password').send({ token, password: 'AnotherPass123!' });
    expect(replay.status).toBe(400);
    expect(replay.body.error).toBe('Invalid or expired reset token');
  });

  it('rejects a garbage token', async () => {
    const res = await request(app).post('/api/auth/reset-password').send({ token: 'deadbeef', password: 'Whatever123!' });
    expect(res.status).toBe(400);
  });

  it('requires both token and password', async () => {
    const noToken = await request(app).post('/api/auth/reset-password').send({ password: 'Whatever123!' });
    expect(noToken.status).toBe(400);

    const noPass = await request(app).post('/api/auth/reset-password').send({ token: 'deadbeef' });
    expect(noPass.status).toBe(400);
  });
});

describe('Auth — onboarding, logout, lockout', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  it('PUT /api/auth/onboarding marks onboarding complete and stores data', async () => {
    const u = await registerUser('Onboard Me');
    const res = await auth(u.token).put('/api/auth/onboarding').send({
      role: 'founder',
      platforms: ['linkedin', 'x'],
      audience: 'indie hackers',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.user.onboardingCompleted).toBe(true);

    const me = await auth(u.token).get('/api/auth/me');
    expect(me.body.data.user.onboardingCompleted).toBe(true);
    expect(me.body.data.user.onboardingData).toMatchObject({ role: 'founder' });
  });

  it('onboarding requires authentication', async () => {
    const res = await request(app).put('/api/auth/onboarding').send({ role: 'x' });
    expect(res.status).toBe(401);
  });

  it('logout clears the session and succeeds unauthenticated too', async () => {
    const u = await registerUser('Logout Me');
    const res = await auth(u.token).post('/api/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Logged out');

    const anon = await request(app).post('/api/auth/logout');
    expect(anon.status).toBe(200);
  });

  it('a disabled account cannot log in even with valid credentials', async () => {
    const u = await registerUser('Disabled Target');
    const models = await import('../models');
    const user = await models.User.findById(u.user.id);
    await models.User.findByIdAndUpdate(u.user.id, { status: 'disabled' });

    const res = await request(app).post('/api/auth/login').send({
      email: u.user.email,
      password: 'Password123!',
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/disabled/i);

    // Existing token is also blocked by the authenticate middleware
    const blocked = await auth(u.token).get('/api/auth/me');
    expect(blocked.status).toBe(403);

    // Re-enable → token works again
    await models.User.findByIdAndUpdate(u.user.id, { status: 'active' });
    const restored = await auth(u.token).get('/api/auth/me');
    expect(restored.status).toBe(200);
  });
});
