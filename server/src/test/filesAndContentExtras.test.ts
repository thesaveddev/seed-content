import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { app, registerUser, auth, resetDatabase, waitForProject, SAMPLE_ARTICLE } from './helpers';
import { config } from '../config/env';

/**
 * Protected file endpoints (/api/files, /uploads) and the remaining
 * content-route branches: multipart upload, transcript edit, rewrite,
 * export in all three formats (+ unknown format), and project delete.
 */

describe('protected file endpoints', () => {
  let user: any;
  let projectId: string;
  let storedFile: string;
  const uploadDir = path.resolve(config.STORAGE_DIR);

  beforeAll(async () => {
    await resetDatabase();
    user = await registerUser();

    // Create a fake stored source file and a project referencing it
    fs.mkdirSync(uploadDir, { recursive: true });
    storedFile = `testsrc-${Date.now()}.txt`;
    fs.writeFileSync(path.join(uploadDir, storedFile), 'protected file body');

    const created = await auth(user.token).post('/api/content/text').send({
      title: 'File proj', text: SAMPLE_ARTICLE, selectedPlatforms: ['linkedin'],
    });
    projectId = created.body.data._id;
    // Let the async pipeline finish first — its save() calls overwrite the
    // whole record, so later mutations must happen after it settles.
    await waitForProject(user.token, projectId);
    // Point the project at our fake stored file
    const { ContentProject } = await import('../models');
    await (ContentProject as any).findOneAndUpdate(
      { _id: projectId },
      { $set: { sourceFile: storedFile } }
    );
  });

  it('requires authentication', async () => {
    const res = await request(app).get(`/api/files/${storedFile}`);
    expect(res.status).toBe(401);
  });

  it('404s when no project references the file', async () => {
    const res = await auth(user.token).get('/api/files/nobody-references-this.txt');
    expect(res.status).toBe(404);
  });

  it('403s members of other workspaces', async () => {
    const other = await registerUser('Other Owner');
    const res = await auth(other.token).get(`/api/files/${storedFile}`);
    expect(res.status).toBe(403);
  });

  it('serves the file to authorised users (both mounts)', async () => {
    // Verify the project still references the file (guards against cross-test resets)
    const { ContentProject } = await import('../models');
    const proj: any = await (ContentProject as any).findOne({ _id: projectId });
    expect(proj?.sourceFile).toBe(storedFile);

    const res = await auth(user.token).get(`/api/files/${storedFile}`);
    expect(res.status).toBe(200);
    expect(res.text).toBe('protected file body');

    const res2 = await auth(user.token).get(`/uploads/${storedFile}`);
    expect(res2.status).toBe(200);
  });

  it('404s when the referencing project exists but the file is gone', async () => {
    const { ContentProject } = await import('../models');
    const ghost = 'ghost-file.txt';
    await (ContentProject as any).findOneAndUpdate({ _id: projectId }, { $set: { sourceFile: ghost } });
    const res = await auth(user.token).get(`/api/files/${ghost}`);
    expect(res.status).toBe(404);
    await (ContentProject as any).findOneAndUpdate({ _id: projectId }, { $set: { sourceFile: storedFile } });
  });
});

describe('multipart file upload', () => {
  it('accepts an mp3 upload and creates an audio project', async () => {
    const user = await registerUser('Uploader');
    const res = await request(app)
      .post('/api/content')
      .set('Authorization', `Bearer ${user.token}`)
      .field('title', 'Audio test')
      .attach('file', Buffer.from('fake mp3 bytes'), { filename: 'clip.mp3', contentType: 'audio/mpeg' });
    expect(res.status).toBe(201);
    expect(res.body.data.sourceType).toBe('audio');
    expect(res.body.data.sourceFile).toBeTruthy();
  });

  it('rejects unsupported file types with 500 from multer', async () => {
    const user = await registerUser('BadUploader');
    const res = await request(app)
      .post('/api/content')
      .set('Authorization', `Bearer ${user.token}`)
      .field('title', 'Bad file')
      .attach('file', Buffer.from('not really'), { filename: 'evil.exe', contentType: 'application/octet-stream' });
    expect([400, 500]).toContain(res.status);
  });
});

describe('content route extras', () => {
  let user: any;
  let projectId: string;
  let generatedId: string;

  beforeAll(async () => {
    await resetDatabase();
    user = await registerUser('Extras');
    const created = await auth(user.token).post('/api/content/text').send({
      title: 'Extras proj', text: SAMPLE_ARTICLE, selectedPlatforms: ['linkedin'],
    });
    projectId = created.body.data._id;
    const done = await waitForProject(user.token, projectId);
    expect(done.body.data.project.status).toBe('ready');
    const detail = await auth(user.token).get(`/api/content/${projectId}`);
    generatedId = detail.body.data.generatedContent[0]._id;
  });

  it('PUT /:id/transcript updates the transcript', async () => {
    const res = await auth(user.token).put(`/api/content/${projectId}/transcript`).send({
      transcript: 'Updated transcript body',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.transcript).toBe('Updated transcript body');
  });

  it('PUT /:id/transcript 404s for foreign projects', async () => {
    const other = await registerUser('Nope');
    const res = await auth(other.token).put(`/api/content/${projectId}/transcript`).send({ transcript: 'x' });
    expect(res.status).toBe(404);
  });

  it('PUT /:generatedId/content edits generated content', async () => {
    const res = await auth(user.token).put(`/api/content/${generatedId}/content`).send({
      content: { text: 'hand-edited body' },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('edited');
  });

  it('POST /:id/rewrite rewrites through the AI provider', async () => {
    const res = await auth(user.token).post(`/api/content/${projectId}/rewrite`).send({
      generatedId,
      instruction: 'make it shorter and concise',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('edited');
    expect(res.body.data.content.text).toBeTruthy();
  });

  it('POST /:id/rewrite 404s for unknown generatedId', async () => {
    const res = await auth(user.token).post(`/api/content/${projectId}/rewrite`).send({
      generatedId: 'missing-id', instruction: 'shorter',
    });
    expect(res.status).toBe(404);
  });

  it('export supports markdown, text, json, and rejects unknown formats', async () => {
    for (const format of ['markdown', 'text', 'json']) {
      const res = await auth(user.token).post(`/api/content/${projectId}/export`).send({ format });
      expect(res.status).toBe(200);
      expect(res.body.data.format).toBe(format);
      expect(res.body.data.content.length).toBeGreaterThan(10);
    }
    const bad = await auth(user.token).post(`/api/content/${projectId}/export`).send({ format: 'pdf' });
    expect(bad.status).toBe(400);
  });

  it('list supports search and status filters', async () => {
    const bySearch = await auth(user.token).get('/api/content?search=Extras');
    expect(bySearch.status).toBe(200);
    expect(bySearch.body.data.length).toBeGreaterThanOrEqual(1);

    const byStatus = await auth(user.token).get('/api/content?status=ready');
    expect(byStatus.status).toBe(200);

    const none = await auth(user.token).get('/api/content?search=zzz-not-there');
    expect(none.body.data).toHaveLength(0);
  });

  it('DELETE /:id removes project + generated content', async () => {
    const created = await auth(user.token).post('/api/content/text').send({
      title: 'Doomed proj', text: SAMPLE_ARTICLE, selectedPlatforms: ['linkedin'],
    });
    const pid = created.body.data._id;
    await waitForProject(user.token, pid);

    const del = await auth(user.token).delete(`/api/content/${pid}`);
    expect(del.status).toBe(200);

    const gone = await auth(user.token).get(`/api/content/${pid}`);
    expect(gone.status).toBe(404);

    const again = await auth(user.token).delete(`/api/content/${pid}`);
    expect(again.status).toBe(404);
  });
});
