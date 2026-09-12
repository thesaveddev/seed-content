import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { app, registerUser, auth, resetDatabase } from './helpers';

/** Promote a user to platform admin directly in the store. */
async function makeAdmin(userId: string): Promise<void> {
  const models = await import('../models');
  await models.User.findByIdAndUpdate(userId, { isAdmin: true });
}

async function registerByEmail() {
  const email = `admin-${crypto.randomUUID()}@test.local`;
  const res = await request(app).post('/api/auth/register').send({
    email,
    password: 'Password123!',
    name: 'Admin Tester',
  });
  return { email, token: res.body.data.token as string, userId: res.body.data.user.id as string };
}

describe('Admin API', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  it('rejects unauthenticated access', async () => {
    const res = await request(app).get('/api/admin/overview');
    expect(res.status).toBe(401);
  });

  it('rejects non-admin users with 403', async () => {
    const { token } = await registerUser('Plain User');
    const res = await auth(token).get('/api/admin/overview');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/admin access required/i);
  });

  it('admin sees platform overview with real counts', async () => {
    const { token } = await registerByEmail();
    const models = await import('../models');
    // Find this user in the store and promote
    const me = await auth(token).get('/api/auth/me');
    await makeAdmin(me.body.data.user.id);

    const res = await auth(token).get('/api/admin/overview');
    expect(res.status).toBe(200);
    expect(res.body.data.users.total).toBeGreaterThanOrEqual(1);
    expect(res.body.data.users.admins).toBeGreaterThanOrEqual(1);
    expect(res.body.data.workspaces.plans).toHaveProperty('free');
    expect(res.body.data.content).toHaveProperty('totalProjects');
  });

  it('lists users with search and pagination', async () => {
    const { token, userId } = await registerByEmail();
    await makeAdmin(userId);
    await registerUser('Searchable Person');

    const all = await auth(token).get('/api/admin/users?limit=1&page=1');
    expect(all.status).toBe(200);
    expect(all.body.data.length).toBe(1);
    expect(all.body.total).toBeGreaterThanOrEqual(2);
    expect(all.body.pages).toBeGreaterThanOrEqual(2);

    // Search by email substring — find the second registered user
    const second = await registerUser('Zebra Seeker');
    const found = await auth(token).get(`/api/admin/users?search=${second.user.email.split('@')[0]}`);
    expect(found.status).toBe(200);
    expect(found.body.data.some((u: any) => u.id === second.user.id)).toBe(true);
  });

  it('disabling a user locks them out immediately; re-enable restores access', async () => {
    const admin = await registerByEmail();
    await makeAdmin(admin.userId);
    const victim = await registerUser('Disable Victim');

    const disable = await auth(admin.token).put(`/api/admin/users/${victim.user.id}/status`).send({
      status: 'disabled',
    });
    expect(disable.status).toBe(200);
    expect(disable.body.data.status).toBe('disabled');

    // Victim's existing token stops working right away
    const blocked = await auth(victim.token).get('/api/auth/me');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toMatch(/account has been disabled/i);

    // Disabled user cannot log in either
    const login = await request(app).post('/api/auth/login').send({
      email: victim.user.email,
      password: 'Password123!',
    });
    expect(login.status).toBe(403);

    // Re-enable restores access
    const enable = await auth(admin.token).put(`/api/admin/users/${victim.user.id}/status`).send({
      status: 'active',
    });
    expect(enable.status).toBe(200);
    const restored = await auth(victim.token).get('/api/auth/me');
    expect(restored.status).toBe(200);
  });

  it('enforces admin safety rules: no self-disable, no self-revoke, no losing the last admin', async () => {
    // Fresh state: this test reasons about exact admin counts
    await resetDatabase();

    const admin = await registerByEmail();
    await makeAdmin(admin.userId);

    // Second admin for revocation test
    const second = await registerByEmail();
    await makeAdmin(second.userId);

    // Revoke second admin — OK (two admins exist)
    const revoke = await auth(admin.token).put(`/api/admin/users/${second.userId}/admin`).send({ isAdmin: false });
    expect(revoke.status).toBe(200);
    expect(revoke.body.data.isAdmin).toBe(false);

    // Now admin is the last admin: self-revoke blocked (own-access guard fires first)
    const selfRevoke = await auth(admin.token).put(`/api/admin/users/${admin.userId}/admin`).send({ isAdmin: false });
    expect(selfRevoke.status).toBe(400);
    expect(selfRevoke.body.error).toMatch(/own admin access/i);

    // Self-disable blocked
    const selfDisable = await auth(admin.token).put(`/api/admin/users/${admin.userId}/status`).send({ status: 'disabled' });
    expect(selfDisable.status).toBe(400);
    expect(selfDisable.body.error).toMatch(/own admin account/i);

    // Reachable last-admin guard: disable the second admin (allowed, 2 exist),
    // then revoking the disabled admin's rights must fail — the actor would
    // become the only active admin.
    const third = await registerByEmail();
    await makeAdmin(third.userId);
    const disableThird = await auth(admin.token).put(`/api/admin/users/${third.userId}/status`).send({ status: 'disabled' });
    expect(disableThird.status).toBe(200);

    const revokeDisabled = await auth(admin.token).put(`/api/admin/users/${third.userId}/admin`).send({ isAdmin: false });
    expect(revokeDisabled.status).toBe(400);
    expect(revokeDisabled.body.error).toMatch(/last active admin/i);

    // Cleanup: re-enable third so later tests are unaffected
    await auth(admin.token).put(`/api/admin/users/${third.userId}/status`).send({ status: 'active' });
  });

  it('grants admin and lists workspaces with member/usage details', async () => {
    const admin = await registerByEmail();
    await makeAdmin(admin.userId);
    const member = await registerUser('WS Member');

    // Grant admin to member
    const grant = await auth(admin.token).put(`/api/admin/users/${member.user.id}/admin`).send({ isAdmin: true });
    expect(grant.status).toBe(200);
    expect(grant.body.data.isAdmin).toBe(true);

    // Workspaces listing
    const res = await auth(admin.token).get('/api/admin/workspaces');
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
    const ws = res.body.data[0];
    expect(ws).toHaveProperty('memberCount');
    expect(ws).toHaveProperty('projectCount');
    expect(ws.members.length).toBeGreaterThanOrEqual(1);
  });

  it('user detail returns workspaces and recent projects', async () => {
    const admin = await registerByEmail();
    await makeAdmin(admin.userId);
    const { token } = await registerUser('Detail User');
    await auth(token).post('/api/content/text').send({
      title: 'Detail project',
      text: 'First, one thing. Second, another thing.',
      selectedPlatforms: ['linkedin'],
    });

    const me = await auth(token).get('/api/auth/me');
    const res = await auth(admin.token).get(`/api/admin/users/${me.body.data.user.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toMatch(/@test\.local$/);
    expect(res.body.data.workspaces.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.recentProjects.length).toBe(1);
  });
});
