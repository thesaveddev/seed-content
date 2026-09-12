import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app, registerUser, auth, resetDatabase } from './helpers';

/** Flip a workspace's plan directly in the data store (in-memory or Mongo). */
async function setPlan(workspaceId: string, plan: string): Promise<void> {
  const models = await import('../models');
  await models.Workspace.findByIdAndUpdate(workspaceId, { plan });
}

describe('Plan limits', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  it('blocks free-plan content creation with more platforms than allowed', async () => {
    const { token } = await registerUser('Platform Gate');
    const res = await auth(token).post('/api/content/text').send({
      title: 'Blocked platforms',
      text: 'Some content that should be rejected because tiktok is not on the free plan.',
      selectedPlatforms: ['linkedin', 'tiktok'],
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/tiktok/i);
    expect(res.body.error).toMatch(/upgrade/i);
  });

  it('allows paid plans to use every platform', async () => {
    const { token, workspace } = await registerUser('Paid Platforms');
    await setPlan(workspace.id, 'creator');

    const res = await auth(token).post('/api/content/text').send({
      title: 'All platforms ok',
      text: 'Creator plan content across every platform including blog and newsletter.',
      selectedPlatforms: ['linkedin', 'x', 'instagram', 'tiktok', 'youtube', 'threads', 'newsletter', 'blog'],
    });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('free plan: first 3 projects succeed, 4th returns 429 with upgrade message', async () => {
    const { token } = await registerUser('Project Cap');

    for (let i = 1; i <= 3; i++) {
      const ok = await auth(token).post('/api/content/text').send({
        title: `Free project ${i}`,
        text: `Project number ${i} within the free allowance.`,
        selectedPlatforms: ['linkedin'],
      });
      expect(ok.status).toBe(201);
    }

    const blocked = await auth(token).post('/api/content/text').send({
      title: 'Free project 4',
      text: 'This one should be blocked by the free plan project cap.',
      selectedPlatforms: ['linkedin'],
    });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/free plan limit of 3 projects/i);
  });

  it('upgraded workspace escapes the project cap', async () => {
    const { token, workspace } = await registerUser('Upgraded Cap');
    await setPlan(workspace.id, 'creator');

    for (let i = 1; i <= 4; i++) {
      const ok = await auth(token).post('/api/content/text').send({
        title: `Creator project ${i}`,
        text: `Creator plan project ${i} — four of these must succeed.`,
        selectedPlatforms: ['linkedin'],
      });
      expect(ok.status).toBe(201);
    }
  });

  it('campaign creation is capped on free (0) and allowed on creator (10)', async () => {
    const { token, workspace } = await registerUser('Campaign Cap');

    const freeAttempt = await auth(token).post('/api/campaigns').send({ name: 'Free Campaign' });
    expect(freeAttempt.status).toBe(403);
    expect(freeAttempt.body.error).toMatch(/free plan allows 0 campaigns/i);

    await setPlan(workspace.id, 'creator');
    const ok = await auth(token).post('/api/campaigns').send({ name: 'Creator Campaign' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.name).toBe('Creator Campaign');
  });

  it('billing usage endpoint reflects plan limits', async () => {
    const { token, workspace } = await registerUser('Usage Limits');
    const res = await auth(token).get('/api/billing/usage');
    expect(res.status).toBe(200);
    expect(res.body.data.plan).toBe(workspace.plan);
    expect(res.body.data.limits.projectsPerMonth).toBe(3);
    expect(res.body.data.limits.campaigns).toBe(0);
  });

  it('free plan cannot invite teammates', async () => {
    const { token } = await registerUser('Team Gate');
    const res = await auth(token).post('/api/team/invite').send({
      email: 'friend@test.local',
      role: 'member',
    });
    expect([403, 402]).toContain(res.status);
    expect(res.body.error).toMatch(/upgrade|plan/i);
  });
});
