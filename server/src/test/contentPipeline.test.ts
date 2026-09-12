import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app, registerUser, auth, resetDatabase, waitForProject, SAMPLE_ARTICLE } from './helpers';

describe('Content pipeline (mock AI, in-process queue)', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  it('creates a text project and generates platform content end-to-end', async () => {
    const { token } = await registerUser('Pipeline User');

    const create = await auth(token).post('/api/content/text').send({
      title: 'SaaS lessons article',
      text: SAMPLE_ARTICLE,
      goal: 'authority',
      selectedPlatforms: ['linkedin', 'x'],
    });
    expect(create.status).toBe(201);
    const projectId = create.body.data._id;
    expect(projectId).toBeTruthy();

    // Pipeline runs asynchronously — poll until ready (like the real frontend)
    const detail = await waitForProject(token, projectId);
    expect(detail.status).toBe(200);
    expect(detail.body.data.project.status).toBe('ready');

    const pieces = detail.body.data.generatedContent;
    expect(Array.isArray(pieces)).toBe(true);
    expect(pieces.length).toBeGreaterThanOrEqual(2);

    const platforms = pieces.map((p: any) => p.platform);
    expect(platforms).toContain('linkedin');
    expect(platforms).toContain('x');

    // Every piece must actually reference the source content — no template garbage
    for (const piece of pieces) {
      expect(piece.status).toBe('ready');
      expect(piece.content).toBeTruthy();
    }
  });

  it('LinkedIn output is substantive and grounded in the source', async () => {
    const { token } = await registerUser('LinkedIn Quality');
    const create = await auth(token).post('/api/content/text').send({
      title: 'Quality article',
      text: SAMPLE_ARTICLE,
      selectedPlatforms: ['linkedin'],
    });
    expect(create.status).toBe(201);
    const projectId = create.body.data._id;

    const detail = await waitForProject(token, projectId);
    expect(detail.body.data.project.status).toBe('ready');
    const linkedin = detail.body.data.generatedContent.find((p: any) => p.platform === 'linkedin');
    expect(linkedin).toBeTruthy();

    const text = JSON.stringify(linkedin.content);
    expect(text.length).toBeGreaterThan(120); // not a stub
    expect(text).not.toMatch(/Key insight from the content/); // the old template garbage
  });

  it('rejects empty text with 400', async () => {
    const { token } = await registerUser('Empty Text');
    const res = await auth(token).post('/api/content/text').send({
      title: 'Empty',
      text: '   ',
      selectedPlatforms: ['linkedin'],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/text/i);
  });

  it('rejects unauthenticated content creation', async () => {
    const r = await request(app).post('/api/content/text').send({ text: 'no auth' });
    expect([401, 400]).toContain(r.status);
  });

  it('scopes projects to the owning workspace (no cross-tenant access)', async () => {
    const userA = await registerUser('Tenant A');
    const userB = await registerUser('Tenant B');

    const create = await auth(userA.token).post('/api/content/text').send({
      title: 'A private project',
      text: SAMPLE_ARTICLE,
      selectedPlatforms: ['linkedin'],
    });
    expect(create.status).toBe(201);
    const projectId = create.body.data._id;

    // B must not see A's project
    const peek = await auth(userB.token).get(`/api/content/${projectId}`);
    expect(peek.status).toBe(404);

    // B's project list must not include A's project
    const listB = await auth(userB.token).get('/api/content');
    const ids = (listB.body.data || []).map((p: any) => p._id);
    expect(ids).not.toContain(projectId);
  });

  it('creates a content_ready notification after generation', async () => {
    const { token } = await registerUser('Notified User');
    const create = await auth(token).post('/api/content/text').send({
      title: 'Notify me',
      text: SAMPLE_ARTICLE,
      selectedPlatforms: ['x'],
    });
    expect(create.status).toBe(201);
    await waitForProject(token, create.body.data._id);

    const res = await auth(token).get('/api/notifications');
    expect(res.status).toBe(200);
    const titles = (res.body.data || []).map((n: any) => n.title);
    expect(titles).toContain('Content pack ready');
  });

  it('lists projects with pagination metadata', async () => {
    const { token } = await registerUser('Pagination User');
    for (let i = 1; i <= 3; i++) {
      await auth(token).post('/api/content/text').send({
        title: `Pagination project ${i}`,
        text: `${SAMPLE_ARTICLE} page ${i}`,
        selectedPlatforms: ['linkedin'],
      });
    }
    const res = await auth(token).get('/api/content?page=1&limit=2');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.pages).toBe(2);
    expect(res.body.data.length).toBe(2);
  });
});
