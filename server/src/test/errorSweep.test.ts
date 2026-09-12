import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import request from 'supertest';
import { app, registerUser, auth, resetDatabase } from './helpers';
import { getCollection } from '../config/database';

/**
 * Error-path sweep: force the data layer to throw and assert every route's
 * catch block answers a JSON 500 instead of leaking a stack or hanging.
 * The spy targets getCollection-backed models through the shared store.
 */

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

/** Replace every method on a collection with a throwing stub for one call. */
function breakCollection(name: string, method: string) {
  const coll = getCollection(name) as any;
  const original = coll[method].bind(coll);
  coll[method] = async () => { throw new Error(`synthetic ${name}.${method} failure`); };
  return () => { coll[method] = original; };
}

describe('500-catch sweep (routes with remaining uncovered catch blocks)', () => {
  let user: any;

  beforeAll(async () => {
    await resetDatabase();
    user = await registerUser('Error Sweep');
  });

  it('brand-voices: GET / answers 500 when the store throws', async () => {
    const restore = breakCollection('BrandVoice', 'find');
    try {
      const res = await auth(user.token).get('/api/brand-voices');
      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    } finally { restore(); }
  });

  it('campaigns: GET / answers 500 when the store throws', async () => {
    const restore = breakCollection('Campaign', 'find');
    try {
      const res = await auth(user.token).get('/api/campaigns');
      expect(res.status).toBe(500);
    } finally { restore(); }
  });

  it('ideas: GET / answers 500 when the store throws', async () => {
    const restore = breakCollection('ContentIdea', 'find');
    try {
      const res = await auth(user.token).get('/api/ideas');
      expect(res.status).toBe(500);
    } finally { restore(); }
  });

  it('notifications: GET / answers 500 when the store throws', async () => {
    const restore = breakCollection('Notification', 'find');
    try {
      const res = await auth(user.token).get('/api/notifications');
      expect(res.status).toBe(500);
    } finally { restore(); }
  });

  it('workspaces: GET / answers 500 when membership lookup throws', async () => {
    const restore = breakCollection('WorkspaceMember', 'find');
    try {
      const res = await auth(user.token).get('/api/workspaces');
      expect(res.status).toBe(500);
    } finally { restore(); }
  });

  it('stats: GET / answers 500 when the store throws', async () => {
    const restore = breakCollection('ContentProject', 'countDocuments');
    try {
      const res = await auth(user.token).get('/api/stats');
      expect(res.status).toBe(500);
    } finally { restore(); }
  });

  it('content list: GET / answers 500 when the store throws', async () => {
    const restore = breakCollection('ContentProject', 'find');
    try {
      const res = await auth(user.token).get('/api/content');
      expect(res.status).toBe(500);
    } finally { restore(); }
  });

  it('scheduler list: GET / answers 500 when the store throws', async () => {
    const restore = breakCollection('ScheduledPost', 'find');
    try {
      const res = await auth(user.token).get('/api/scheduler');
      expect(res.status).toBe(500);
    } finally { restore(); }
  });

  it('integrations list: GET / answers 500 when the store throws', async () => {
    const restore = breakCollection('Integration', 'find');
    try {
      const res = await auth(user.token).get('/api/integrations');
      expect(res.status).toBe(500);
    } finally { restore(); }
  });

  it('media route: 404s cleanly for unsigned requests of missing files', async () => {
    const res = await request(app).get('/api/media/no-such-card.png');
    expect([403, 404]).toContain(res.status);
  });

  it('auth register: 500 when user creation throws', async () => {
    const restore = breakCollection('User', 'create');
    try {
      const res = await request(app).post('/api/auth/register').send({
        email: `sweep-${Date.now()}@test.local`,
        password: 'Password123!',
        name: 'Sweep',
      });
      expect(res.status).toBe(500);
    } finally { restore(); }
  });

  it('auth login: 500 when lookup throws', async () => {
    const restore = breakCollection('User', 'findOne');
    try {
      const res = await request(app).post('/api/auth/login').send({
        email: 'anyone@test.local',
        password: 'Password123!',
      });
      expect(res.status).toBe(500);
    } finally { restore(); }
  });

  it('billing usage: 503/500 when the store throws without stripe', async () => {
    const restore = breakCollection('Workspace', 'findOne');
    try {
      const res = await auth(user.token).get('/api/billing/usage');
      expect([500, 503]).toContain(res.status);
    } finally { restore(); }
  });
});
