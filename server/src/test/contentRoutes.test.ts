import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { app, registerUser, auth, resetDatabase, SAMPLE_ARTICLE, waitForProject } from './helpers';

/**
 * Remaining content-route branches: export formats, regenerate (all +
 * per-platform), transcript edit, generated-content update, AI rewrite,
 * URL import, delete. The AI provider is the in-repo mock, so rewrite and
 * generation run for real without network.
 */

describe('Content routes — remaining branches', () => {
  let token: string;
  let otherToken: string;
  let projectId: string;
  let gcId: string;

  beforeAll(async () => {
    await resetDatabase();
    const u = await registerUser('Content Owner');
    token = u.token;
    otherToken = (await registerUser('Content Other')).token;

    // Create a text project and wait for the pipeline to finish.
    const created = await auth(token).post('/api/content/text').send({
      title: 'Founder notes',
      text: SAMPLE_ARTICLE,
      selectedPlatforms: ['linkedin', 'x'],
    });
    expect(created.status).toBe(201);
    projectId = created.body.data._id;

    const done = await waitForProject(token, projectId);
    expect(done.body.data.project.status).toBe('ready');

    const detail = await auth(token).get(`/api/content/${projectId}`);
    expect(detail.body.data.generatedContent.length).toBeGreaterThan(0);
    gcId = detail.body.data.generatedContent[0]._id;
  });

  it('edits the transcript (PUT /:id/transcript)', async () => {
    const res = await auth(token).put(`/api/content/${projectId}/transcript`).send({
      transcript: 'Manually corrected transcript text.',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.transcript).toBe('Manually corrected transcript text.');

    const foreign = await auth(otherToken).put(`/api/content/${projectId}/transcript`).send({ transcript: 'x' });
    expect(foreign.status).toBe(404);
  });

  it('updates a generated piece (PUT /:generatedId/content) and marks it edited', async () => {
    const res = await auth(token).put(`/api/content/${gcId}/content`).send({
      content: { text: 'Hand-polished LinkedIn copy.' },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('edited');
    expect(res.body.data.content.text).toBe('Hand-polished LinkedIn copy.');

    const foreign = await auth(otherToken).put(`/api/content/${gcId}/content`).send({ content: { text: 'x' } });
    expect(foreign.status).toBe(404);
  });

  it('AI rewrite updates the piece and keeps the original', async () => {
    const res = await auth(token).post(`/api/content/${projectId}/rewrite`).send({
      generatedId: gcId,
      instruction: 'Make it punchier',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('edited');
    expect(res.body.data.content.text).toBeTruthy();
    expect(res.body.data.content.original).toBeTruthy();

    const foreign = await auth(otherToken).post(`/api/content/${projectId}/rewrite`).send({
      generatedId: gcId, instruction: 'nope',
    });
    expect(foreign.status).toBe(404);
  });

  it('rewrite 404s for unknown generated content', async () => {
    const res = await auth(token).post(`/api/content/${projectId}/rewrite`).send({
      generatedId: '507f1f77bcf86cd799439011',
      instruction: 'x',
    });
    expect(res.status).toBe(404);
  });

  it('regenerates a single platform and replaces its content', async () => {
    const before = await auth(token).get(`/api/content/${projectId}`);
    const beforeCount = before.body.data.generatedContent.length;
    const xBefore = before.body.data.generatedContent.filter((g: any) => g.platform === 'x').length;
    expect(xBefore).toBeGreaterThan(0);

    const res = await auth(token).post(`/api/content/${projectId}/regenerate/linkedin`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('processing');

    const done = await waitForProject(token, projectId);
    expect(done.body.data.project.status).toBe('ready');

    // The platform override must be honored: total count unchanged, no
    // duplicate linkedin pieces, x pieces untouched.
    const after = await auth(token).get(`/api/content/${projectId}`);
    expect(after.body.data.generatedContent.length).toBe(beforeCount);
    const linkedin = after.body.data.generatedContent.filter((g: any) => g.platform === 'linkedin');
    expect(linkedin.length).toBe(1);
    const xAfter = after.body.data.generatedContent.filter((g: any) => g.platform === 'x').length;
    expect(xAfter).toBe(xBefore);
  });

  it('regenerate-all deletes and recreates content', async () => {
    const res = await auth(token).post(`/api/content/${projectId}/generate`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('processing');

    const done = await waitForProject(token, projectId);
    expect(done.body.data.project.status).toBe('ready');

    const detail = await auth(token).get(`/api/content/${projectId}`);
    expect(detail.body.data.generatedContent.length).toBeGreaterThan(0);
  });

  it('regenerate endpoints 404 cross-tenant', async () => {
    const all = await auth(otherToken).post(`/api/content/${projectId}/generate`);
    expect(all.status).toBe(404);
    const one = await auth(otherToken).post(`/api/content/${projectId}/regenerate/x`);
    expect(one.status).toBe(404);
  });

  it('exports markdown with platform sections and increments usage', async () => {
    const res = await auth(token).post(`/api/content/${projectId}/export`).send({ format: 'markdown' });
    expect(res.status).toBe(200);
    expect(res.body.data.format).toBe('markdown');
    expect(res.body.data.content).toContain('# Founder notes');
    expect(res.body.data.content).toContain('Exported from Seed');

    // Usage export counter incremented
    const models = await import('../models');
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const usage = await models.Usage.findOne({ workspaceId: (await import('../models')).Usage ? undefined : undefined } as any);
    void usage;
    const usageList = await (models.Usage as any).find({ month });
    const mine = usageList.find((u: any) => String(u.workspaceId) !== undefined && u.exports > 0);
    expect(mine).toBeTruthy();
  });

  it('exports plain text format', async () => {
    const res = await auth(token).post(`/api/content/${projectId}/export`).send({ format: 'text' });
    expect(res.status).toBe(200);
    expect(res.body.data.format).toBe('text');
    expect(res.body.data.content).toContain('Founder notes');
  });

  it('exports json format with platform map', async () => {
    const res = await auth(token).post(`/api/content/${projectId}/export`).send({ format: 'json' });
    expect(res.status).toBe(200);
    expect(res.body.data.format).toBe('json');
    const parsed = JSON.parse(res.body.data.content);
    expect(parsed.title).toBe('Founder notes');
    expect(parsed.exportedAt).toBeTruthy();
    expect(Object.keys(parsed.platforms).length).toBeGreaterThan(0);
  });

  it('rejects an unsupported export format (400)', async () => {
    const res = await auth(token).post(`/api/content/${projectId}/export`).send({ format: 'pdf' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/markdown, text, json/);
  });

  it('export 404s cross-tenant and for unknown projects', async () => {
    const foreign = await auth(otherToken).post(`/api/content/${projectId}/export`).send({ format: 'markdown' });
    expect(foreign.status).toBe(404);
    const unknown = await auth(token).post('/api/content/507f1f77bcf86cd799439011/export').send({ format: 'markdown' });
    expect(unknown.status).toBe(404);
  });

  describe('URL import', () => {
    afterAll(() => {
      vi.unstubAllGlobals();
    });

    // URL imports create real projects, so upgrade the workspace to creator
    // first to avoid the free-plan 3-project cap mid-suite.
    beforeAll(async () => {
      const models = await import('../models');
      const projects = await models.ContentProject.find({ workspaceId: { $exists: true } });
      const wsId = projects[0]?.workspaceId;
      if (wsId) await models.Workspace.findByIdAndUpdate(wsId, { plan: 'creator' });
    });

    it('rejects a missing url (400)', async () => {
      const res = await auth(token).post('/api/content/url').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('URL is required');
    });

    it('imports a web page by fetching and extracting text', async () => {
      const html = `<html><head><title>My Great Article</title></head><body>
        <nav>ignore me</nav>
        <p>${'Real article content. '.repeat(10)}</p>
        <script>console.log('nope')</script>
      </body></html>`;
      vi.stubGlobal('fetch', vi.fn(async () => new Response(html, { status: 200 })));

      const res = await auth(token).post('/api/content/url').send({
        url: 'https://example.com/article',
        selectedPlatforms: ['linkedin'],
      });
      expect(res.status).toBe(201);
      expect(res.body.data.sourceType).toBe('url');
      expect(res.body.data.title).toBe('My Great Article');
      expect(res.body.data.transcript).toContain('Real article content.');
      expect(res.body.data.transcript).not.toContain('console.log');
      expect(res.body.data.status).toBe('processing');
    });

    it('handles a fetch failure honestly with a fallback transcript', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('DNS fail'); }));
      const res = await auth(token).post('/api/content/url').send({
        url: 'https://broken.example.com/page',
        title: 'Preset title',
      });
      expect(res.status).toBe(201);
      expect(res.body.data.title).toBe('Preset title');
      expect(res.body.data.transcript).toMatch(/Content extraction failed: DNS fail/);
    });

    it('falls back to a notice transcript for a YouTube video without captions', async () => {
      const pageHtml = '<html><title>Cool Video - YouTube</title><body>x</body></html>';
      vi.stubGlobal('fetch', vi.fn(async (url: any) => {
        if (String(url).includes('youtube.com/watch')) return new Response(pageHtml, { status: 200 });
        return new Response('{}', { status: 200 });
      }));

      const res = await auth(token).post('/api/content/url').send({
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      });
      expect(res.status).toBe(201);
      expect(res.body.data.sourceType).toBe('url');
      expect(res.body.data.transcript).toMatch(/YouTube video:/);
      expect(res.body.data.title).toBe('Cool Video');
    });

    it('rejects a non-URL youtube path gracefully (invalid id → fallback notice)', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('nope'); }));
      const res = await auth(token).post('/api/content/url').send({
        url: 'https://youtube.com/watch?v=short',
        title: 'YT fallback',
      });
      expect(res.status).toBe(201);
      expect(res.body.data.transcript).toMatch(/Transcript extraction failed/);
    });
  });

  it('deletes a project and its generated content', async () => {
    const detail = await auth(token).get(`/api/content/${projectId}`);
    const gcCount = detail.body.data.generatedContent.length;

    const foreign = await auth(otherToken).delete(`/api/content/${projectId}`);
    expect(foreign.status).toBe(404);

    const res = await auth(token).delete(`/api/content/${projectId}`);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Project deleted');

    const models = await import('../models');
    const remaining = await models.GeneratedContent.countDocuments({ projectId });
    expect(remaining).toBe(0);
    void gcCount;

    const gone = await auth(token).get(`/api/content/${projectId}`);
    expect(gone.status).toBe(404);
  });

  it('list supports status and search filters', async () => {
    await resetDatabase();
    const u = await registerUser('Filter Owner');
    const t = u.token;

    await auth(t).post('/api/content/text').send({ title: 'Alpha post', text: SAMPLE_ARTICLE, selectedPlatforms: ['linkedin'] });
    await auth(t).post('/api/content/text').send({ title: 'Beta guide', text: SAMPLE_ARTICLE, selectedPlatforms: ['x'] });

    const search = await auth(t).get('/api/content?search=alpha');
    expect(search.status).toBe(200);
    expect(search.body.data.length).toBe(1);
    expect(search.body.data[0].title).toBe('Alpha post');
    expect(search.body.total).toBe(1);
    expect(search.body.pages).toBe(1);

    const paging = await auth(t).get('/api/content?page=1&limit=1');
    expect(paging.body.data.length).toBe(1);
    expect(paging.body.total).toBe(2);
    expect(paging.body.pages).toBe(2);
  });
});
