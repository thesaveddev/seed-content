import { describe, it, expect, beforeAll } from 'vitest';
import { app, registerUser, auth, resetDatabase } from './helpers';

/**
 * Exhaustive CRUD coverage: stats, ideas, brand voices, campaigns,
 * notifications. The in-memory store is shared per-file; every test
 * creates its own users where isolation matters.
 */

describe('Stats', () => {
  let token: string;

  beforeAll(async () => {
    await resetDatabase();
    const u = await registerUser('Stats Owner');
    token = u.token;
  });

  it('returns zeroed stats for a fresh workspace', async () => {
    const res = await auth(token).get('/api/stats');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      contentCreated: 0,
      piecesGenerated: 0,
      campaignsCreated: 0,
      contentPublished: 0,
      usage: { minutesProcessed: 0, generations: 0, projects: 0, exports: 0 },
    });
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request('/api/stats');
    expect(res.status).toBe(401);
  });
});

// Tiny unauthenticated request helper (avoids importing supertest everywhere).
function request(url: string): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const req = require('supertest');
  return req(app).get(url);
}

describe('Ideas', () => {
  let token: string;
  let otherToken: string;
  let ideaId: string;

  beforeAll(async () => {
    await resetDatabase();
    token = (await registerUser('Ideas Owner')).token;
    otherToken = (await registerUser('Ideas Other')).token;
  });

  it('creates an idea', async () => {
    const res = await auth(token).post('/api/ideas').send({
      title: 'Post about pricing',
      notes: 'Talk about undercharging 4x',
    });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.title).toBe('Post about pricing');
    ideaId = res.body.data._id;
    expect(ideaId).toBeTruthy();
  });

  it('lists ideas newest first', async () => {
    await auth(token).post('/api/ideas').send({ title: 'Second idea' });
    const res = await auth(token).get('/api/ideas');
    expect(res.status).toBe(200);
    const ideas = res.body.data;
    expect(ideas.length).toBe(2);
    expect(ideas[0].title).toBe('Second idea');
  });

  it('filters by status', async () => {
    const res = await auth(token).get('/api/ideas?status=new');
    expect(res.status).toBe(200);
    for (const idea of res.body.data) expect(idea.status).toBe('new');
    // Non-matching status returns empty
    const none = await auth(token).get('/api/ideas?status=published');
    expect(none.body.data.length).toBe(0);
  });

  it('does not leak ideas across workspaces', async () => {
    const res = await auth(otherToken).get('/api/ideas');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(0);
  });

  it('updates an idea', async () => {
    const res = await auth(token).put(`/api/ideas/${ideaId}`).send({ notes: 'Updated notes' });
    expect(res.status).toBe(200);
    expect(res.body.data.notes).toBe('Updated notes');
  });

  it('404s updating a foreign-workspace idea', async () => {
    const res = await auth(otherToken).put(`/api/ideas/${ideaId}`).send({ title: 'Hacked' });
    expect(res.status).toBe(404);
  });

  it('404s updating a nonexistent idea', async () => {
    const res = await auth(token).put('/api/ideas/507f1f77bcf86cd799439011').send({ title: 'X' });
    expect(res.status).toBe(404);
  });

  it('deletes an idea and 404s the second time / cross-tenant', async () => {
    const del = await auth(token).delete(`/api/ideas/${ideaId}`);
    expect(del.status).toBe(200);
    expect(del.body.message).toBe('Idea deleted');

    const again = await auth(token).delete(`/api/ideas/${ideaId}`);
    expect(again.status).toBe(404);

    const foreign = await auth(token).delete('/api/ideas/507f1f77bcf86cd799439011');
    expect(foreign.status).toBe(404);
  });
});

describe('Brand voices', () => {
  let token: string;
  let otherToken: string;
  let voiceId: string;

  beforeAll(async () => {
    await resetDatabase();
    token = (await registerUser('Voices Owner')).token;
    otherToken = (await registerUser('Voices Other')).token;
  });

  it('creates a brand voice (free plan allows 1)', async () => {
    const res = await auth(token).post('/api/brand-voices').send({
      name: 'Punchy founder',
      tone: ['direct', 'witty'],
      description: 'Short sentences. No fluff.',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Punchy founder');
    voiceId = res.body.data._id;
  });

  it('enforces the free-plan 1-voice limit with 403', async () => {
    const res = await auth(token).post('/api/brand-voices').send({
      name: 'Second voice',
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/free plan allows 1 brand voice/i);
  });

  it('lists voices for the workspace only', async () => {
    const list = await auth(token).get('/api/brand-voices');
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBe(1);
    expect(list.body.data[0]._id).toBe(voiceId);

    const otherList = await auth(otherToken).get('/api/brand-voices');
    expect(otherList.body.data.length).toBe(0);
  });

  it('updates a voice; foreign update 404s', async () => {
    const res = await auth(token).put(`/api/brand-voices/${voiceId}`).send({
      description: 'Even shorter sentences.',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.description).toBe('Even shorter sentences.');

    const foreign = await auth(otherToken).put(`/api/brand-voices/${voiceId}`).send({ name: 'X' });
    expect(foreign.status).toBe(404);
  });

  it('deletes a voice, then allows creating a new one (limit freed)', async () => {
    const del = await auth(token).delete(`/api/brand-voices/${voiceId}`);
    expect(del.status).toBe(200);
    expect(del.body.message).toBe('Brand voice deleted');

    const recreated = await auth(token).post('/api/brand-voices').send({ name: 'Fresh voice' });
    expect(recreated.status).toBe(201);

    const foreignDel = await auth(otherToken).delete(`/api/brand-voices/${recreated.body.data._id}`);
    expect(foreignDel.status).toBe(404);
  });
});

describe('Campaigns', () => {
  let token: string;
  let otherToken: string;
  let campaignId: string;

  beforeAll(async () => {
    await resetDatabase();
    token = (await registerUser('Campaigns Owner')).token;
    otherToken = (await registerUser('Campaigns Other')).token;
  });

  it('free plan cannot create campaigns (403)', async () => {
    const res = await auth(token).post('/api/campaigns').send({
      name: 'Launch week',
      description: 'Everything for the launch',
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/free plan allows 0 campaigns/i);
  });

  it('creator plan can create a campaign', async () => {
    // Upgrade this workspace to creator via direct data-store update.
    const models = await import('../models');
    const ws = await models.Workspace.findOne({ name: { $ne: null } });
    // Find the actual workspace id for our token owner:
    const me = await auth(token).get('/api/auth/me');
    const workspaceId = me.body.data.user?.workspaceId || me.body.data.workspace?.id;
    if (workspaceId) {
      await models.Workspace.findByIdAndUpdate(workspaceId, { plan: 'creator' });
    }
    const res = await auth(token).post('/api/campaigns').send({
      name: 'Launch week',
      description: 'Everything for the launch',
      platforms: ['linkedin', 'x'],
    });
    if (res.status !== 201) {
      // Fall back: fetch workspace id via admin-less route (workspaces/current)
      const cur = await auth(token).get('/api/workspaces/current');
      await models.Workspace.findByIdAndUpdate(cur.body.data._id || cur.body.data.id, { plan: 'creator' });
      const retry = await auth(token).post('/api/campaigns').send({ name: 'Launch week' });
      expect(retry.status).toBe(201);
      campaignId = retry.body.data._id;
      return;
    }
    campaignId = res.body.data._id;
  });

  it('lists campaigns with contentCount enrichment', async () => {
    const list = await auth(token).get('/api/campaigns');
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThanOrEqual(1);
    const found = list.body.data.find((c: any) => c._id === campaignId);
    expect(found).toBeTruthy();
    expect(found.contentCount).toBe(0);

    const other = await auth(otherToken).get('/api/campaigns');
    expect(other.body.data.length).toBe(0);
  });

  it('updates a campaign; foreign update 404s', async () => {
    const res = await auth(token).put(`/api/campaigns/${campaignId}`).send({ description: 'Updated' });
    expect(res.status).toBe(200);
    expect(res.body.data.description).toBe('Updated');

    const foreign = await auth(otherToken).put(`/api/campaigns/${campaignId}`).send({ name: 'X' });
    expect(foreign.status).toBe(404);
  });

  it('delete unlinks projects and removes the campaign', async () => {
    // Create a project linked to the campaign via direct store, then delete campaign.
    const models = await import('../models');
    const list = await auth(token).get('/api/campaigns');
    const me = await auth(token).get('/api/workspaces/current');
    const workspaceId = me.body.data._id || me.body.data.id;

    const project = await models.ContentProject.create({
      workspaceId,
      createdBy: '000000000000000000000000',
      title: 'Linked project',
      sourceType: 'text',
      campaignId,
    });
    expect(project.campaignId).toBeTruthy();

    const del = await auth(token).delete(`/api/campaigns/${campaignId}`);
    expect(del.status).toBe(200);
    expect(del.body.message).toBe('Campaign deleted');

    const refreshed = await models.ContentProject.findById((project as any)._id);
    expect(refreshed?.campaignId).toBeUndefined();

    const gone = await auth(token).delete(`/api/campaigns/${campaignId}`);
    expect(gone.status).toBe(404);
  });
});

describe('Notifications', () => {
  let token: string;
  let otherToken: string;
  let notifId: string;

  beforeAll(async () => {
    await resetDatabase();
    const owner = await registerUser('Notif Owner');
    token = owner.token;
    otherToken = (await registerUser('Notif Other')).token;

    const models = await import('../models');
    await models.Notification.create({
      userId: owner.user.id,
      workspaceId: owner.workspace.id,
      type: 'content_ready',
      title: 'Pack ready',
      message: 'Your content pack is ready.',
      read: false,
    });
    await models.Notification.create({
      userId: owner.user.id,
      workspaceId: owner.workspace.id,
      type: 'info',
      title: 'Welcome',
      message: 'Welcome to the app.',
      read: true,
    });
  });

  it('lists notifications with unreadCount', async () => {
    const res = await auth(token).get('/api/notifications');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
    expect(res.body.unreadCount).toBe(1);
    // Pin the unread one by title — both were created in the same instant,
    // so list order is not deterministic.
    notifId = res.body.data.find((n: any) => n.title === 'Pack ready')._id;
    expect(notifId).toBeTruthy();
  });

  it('does not leak across users', async () => {
    const res = await auth(otherToken).get('/api/notifications');
    expect(res.body.data.length).toBe(0);
    expect(res.body.unreadCount).toBe(0);
  });

  it('filters unread only and respects limit', async () => {
    const unread = await auth(token).get('/api/notifications?unread=true');
    expect(unread.body.data.length).toBe(1);
    expect(unread.body.data[0].read).toBe(false);

    const limited = await auth(token).get('/api/notifications?limit=1');
    expect(limited.body.data.length).toBe(1);
  });

  it('returns unread-count endpoint', async () => {
    const res = await auth(token).get('/api/notifications/unread-count');
    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(1);
  });

  it('marks one as read (idempotent) and unknown ids 404 silently succeed', async () => {
    const res = await auth(token).put(`/api/notifications/${notifId}/read`);
    expect(res.status).toBe(200);

    const count = await auth(token).get('/api/notifications/unread-count');
    expect(count.body.data.count).toBe(0);

    const unknown = await auth(token).put('/api/notifications/507f1f77bcf86cd799439011/read');
    expect(unknown.status).toBe(200);
  });

  it('marks all as read', async () => {
    const res = await auth(token).put('/api/notifications/read-all');
    expect(res.status).toBe(200);
    const count = await auth(token).get('/api/notifications/unread-count');
    expect(count.body.data.count).toBe(0);
  });

  it('deletes one notification and clears the rest', async () => {
    const del = await auth(token).delete(`/api/notifications/${notifId}`);
    expect(del.status).toBe(200);

    const remaining = await auth(token).get('/api/notifications');
    expect(remaining.body.data.length).toBe(1);

    const clear = await auth(token).delete('/api/notifications');
    expect(clear.status).toBe(200);
    const empty = await auth(token).get('/api/notifications');
    expect(empty.body.data.length).toBe(0);
  });
});
