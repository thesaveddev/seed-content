import { describe, it, expect, beforeAll } from 'vitest';
import { app, registerUser, auth, resetDatabase } from './helpers';

/**
 * Scheduler route coverage: list + filters, single fetch, create validation,
 * reschedule/notes/status transitions, retry, cancel, delete, clear.
 * Retry is tested against the real publisher path (no integration connected
 * → honest failure), no network stubbing needed.
 */

const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

async function makeContent(token: string, workspaceId: string, projectId: string, platform = 'newsletter') {
  const models = await import('../models');
  return models.GeneratedContent.create({
    workspaceId,
    projectId,
    platform,
    content: { text: 'Ready-to-post copy for the schedule test.' },
    status: 'ready',
  });
}

describe('Scheduler routes', () => {
  let token: string;
  let otherToken: string;
  let workspaceId: string;
  let gcId: string;
  let projectId: string;
  let postId: string;

  beforeAll(async () => {
    await resetDatabase();
    const u = await registerUser('Sched Owner');
    token = u.token;
    otherToken = (await registerUser('Sched Other')).token;
    workspaceId = u.workspace.id;

    // A project so the content pack has a real owner for notifications.
    const models = await import('../models');
    const project = await models.ContentProject.create({
      workspaceId,
      createdBy: u.user.id,
      title: 'Sched project',
      sourceType: 'text',
      status: 'ready',
    });
    projectId = String((project as any)._id);

    const gc = await makeContent(token, workspaceId, projectId);
    gcId = String((gc as any)._id);
  });

  it('creates a scheduled post (201) with defaults', async () => {
    const res = await auth(token).post('/api/scheduler').send({
      projectId,
      generatedContentId: gcId,
      platform: 'newsletter',
      scheduledAt: FUTURE,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('scheduled');
    expect(res.body.data.notes).toBe('');
    expect(res.body.data.platform).toBe('newsletter');
    postId = res.body.data._id;
  });

  it('rejects missing fields (400)', async () => {
    const res = await auth(token).post('/api/scheduler').send({ projectId });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/projectId, generatedContentId, platform/);
  });

  it('rejects an invalid date (400) and a past date (400)', async () => {
    const bad = await auth(token).post('/api/scheduler').send({
      projectId, generatedContentId: gcId, platform: 'x', scheduledAt: 'not-a-date',
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('Invalid scheduledAt date');

    const past = await auth(token).post('/api/scheduler').send({
      projectId, generatedContentId: gcId, platform: 'x', scheduledAt: '2001-01-01T00:00:00Z',
    });
    expect(past.status).toBe(400);
    expect(past.body.error).toBe('Cannot schedule in the past');
  });

  it('404s when generated content belongs to another workspace', async () => {
    const res = await auth(otherToken).post('/api/scheduler').send({
      projectId: '507f1f77bcf86cd799439011',
      generatedContentId: gcId,
      platform: 'x',
      scheduledAt: FUTURE,
    });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Generated content not found');
  });

  it('lists posts with date-range, status and platform filters', async () => {
    // Second post on a different platform + time
    const second = await auth(token).post('/api/scheduler').send({
      projectId, generatedContentId: gcId, platform: 'x', scheduledAt: FUTURE,
    });
    expect(second.status).toBe(201);
    const secondId = second.body.data._id;

    const all = await auth(token).get('/api/scheduler');
    expect(all.status).toBe(200);
    expect(all.body.data.length).toBe(2);
    // Sorted by scheduledAt ascending — same instant, stable either way.

    const byPlatform = await auth(token).get('/api/scheduler?platform=x');
    expect(byPlatform.body.data.length).toBe(1);
    expect(byPlatform.body.data[0]._id).toBe(secondId);

    const byStatus = await auth(token).get('/api/scheduler?status=scheduled');
    expect(byStatus.body.data.length).toBe(2);

    const window = await auth(token).get(
      `/api/scheduler?from=${encodeURIComponent(FUTURE)}&to=${encodeURIComponent(FUTURE)}`
    );
    expect(window.body.data.length).toBe(2);

    const narrow = await auth(token).get(
      `/api/scheduler?from=${encodeURIComponent(new Date(Date.now() + 25 * 3600 * 1000).toISOString())}`
    );
    expect(narrow.body.data.length).toBe(0);

    // Other workspace sees nothing
    const foreign = await auth(otherToken).get('/api/scheduler');
    expect(foreign.body.data.length).toBe(0);
  });

  it('fetches a single post and 404s foreign/unknown ids', async () => {
    const ok = await auth(token).get(`/api/scheduler/${postId}`);
    expect(ok.status).toBe(200);
    expect(ok.body.data._id).toBe(postId);

    const foreign = await auth(otherToken).get(`/api/scheduler/${postId}`);
    expect(foreign.status).toBe(404);

    const unknown = await auth(token).get('/api/scheduler/507f1f77bcf86cd799439011');
    expect(unknown.status).toBe(404);
  });

  it('reschedules and updates notes (PUT)', async () => {
    const newDate = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
    const res = await auth(token).put(`/api/scheduler/${postId}`).send({
      scheduledAt: newDate,
      notes: 'Morning slot',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.notes).toBe('Morning slot');
    expect(new Date(res.body.data.scheduledAt).toISOString()).toBe(newDate);
  });

  it('rejects invalid/past reschedule dates and invalid status values are ignored', async () => {
    const bad = await auth(token).put(`/api/scheduler/${postId}`).send({ scheduledAt: 'nope' });
    expect(bad.status).toBe(400);

    const past = await auth(token).put(`/api/scheduler/${postId}`).send({ scheduledAt: '2001-01-01T00:00:00Z' });
    expect(past.status).toBe(400);

    // 'scheduled' is not in the allowed status list → ignored, no crash
    const weird = await auth(token).put(`/api/scheduler/${postId}`).send({ status: 'weird-status' });
    expect(weird.status).toBe(200);
    expect(weird.body.data.status).toBe('scheduled');
  });

  it('marks a post published via PUT with publishedAt set', async () => {
    const res = await auth(token).put(`/api/scheduler/${postId}`).send({ status: 'published' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('published');
    expect(res.body.data.publishedAt).toBeTruthy();
  });

  it('cancel: scheduled → cancelled; second cancel 404s', async () => {
    const created = await auth(token).post('/api/scheduler').send({
      projectId, generatedContentId: gcId, platform: 'x', scheduledAt: FUTURE,
    });
    const id = created.body.data._id;

    const cancel = await auth(token).put(`/api/scheduler/${id}/cancel`);
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.status).toBe('cancelled');

    const again = await auth(token).put(`/api/scheduler/${id}/cancel`);
    expect(again.status).toBe(404);
  });

  it('retry: only failed posts can be retried; failed → publishing → honest failure', async () => {
    // Create a post and force it into the failed state directly.
    const models = await import('../models');
    const created = await auth(token).post('/api/scheduler').send({
      projectId, generatedContentId: gcId, platform: 'newsletter', scheduledAt: FUTURE,
    });
    const id = created.body.data._id;
    await models.ScheduledPost.findByIdAndUpdate(id, {
      status: 'failed',
      errorMessage: 'No connected newsletter integration for this workspace',
    });

    // A scheduled post cannot be retried
    const scheduled = await auth(token).post('/api/scheduler').send({
      projectId, generatedContentId: gcId, platform: 'x', scheduledAt: FUTURE,
    });
    const retryScheduled = await auth(token).put(`/api/scheduler/${scheduled.body.data._id}/retry`);
    expect(retryScheduled.status).toBe(404);
    expect(retryScheduled.body.error).toMatch(/only failed posts can be retried/i);

    // Retry the failed one → responds publishing, then the async publish
    // honestly fails (no newsletter integration) → back to failed.
    const retry = await auth(token).put(`/api/scheduler/${id}/retry`);
    expect(retry.status).toBe(200);
    expect(retry.body.data.status).toBe('publishing');
    expect(retry.body.data.errorMessage).toBeNull();

    // Wait for the async publish to fail and notify.
    let finalState: any = null;
    for (let i = 0; i < 40; i++) {
      const check = await auth(token).get(`/api/scheduler/${id}`);
      finalState = check.body.data;
      if (finalState?.status === 'failed' && finalState?.errorMessage) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(finalState.status).toBe('failed');
    expect(finalState.errorMessage).toMatch(/No connected newsletter integration/i);

    // The failure path also notifies the creator.
    const notifs = await auth(token).get('/api/notifications');
    const failedNotif = notifs.body.data.find((n: any) => /Post to newsletter failed/.test(n.title));
    expect(failedNotif).toBeTruthy();
  }, 20000);

  it('deletes a post; foreign and unknown deletes 404', async () => {
    const created = await auth(token).post('/api/scheduler').send({
      projectId, generatedContentId: gcId, platform: 'x', scheduledAt: FUTURE,
    });
    const id = created.body.data._id;

    const foreign = await auth(otherToken).delete(`/api/scheduler/${id}`);
    expect(foreign.status).toBe(404);

    const ok = await auth(token).delete(`/api/scheduler/${id}`);
    expect(ok.status).toBe(200);

    const gone = await auth(token).delete(`/api/scheduler/${id}`);
    expect(gone.status).toBe(404);
  });

  it('clear deletes only scheduled posts (leaves published/failed/cancelled)', async () => {
    const models = await import('../models');
    const before = await models.ScheduledPost.countDocuments({ workspaceId });
    expect(before).toBeGreaterThanOrEqual(3);

    const res = await auth(token).delete('/api/scheduler');
    expect(res.status).toBe(200);

    const remaining = await models.ScheduledPost.countDocuments({ workspaceId });
    const remainingScheduled = await models.ScheduledPost.countDocuments({ workspaceId, status: 'scheduled' });
    expect(remainingScheduled).toBe(0);
    expect(remaining).toBeGreaterThan(0); // published/failed ones survive
  });
});
