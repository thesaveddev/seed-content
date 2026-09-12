import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../app';
import { connectDatabase, isUsingInMemory, getCollection } from '../config/database';

// Initialise the database layer before anything else. In test mode this
// is hermetic: connectDatabase() flips straight to the in-memory store
// and never touches a real MongoDB (see config/database.ts).
await connectDatabase();

// Initialise the in-process content queue exactly like index.ts does,
// so content routes can enqueue pipeline jobs in tests.
const { initQueue } = await import('../services/queue');
const { contentPipeline } = await import('../services/content/pipeline');
await initQueue(async (data) => {
  try {
    await contentPipeline.processProject(data.projectId);
  } catch (err: any) {
    console.error(`[test] pipeline failed for project ${data.projectId}:`, err.message);
  }
});

export const app = createApp();

/**
 * Reset database state between tests.
 * - In-memory mode: wipe all collections (instant).
 * - MongoDB mode: best-effort deleteMany on the collections we know about.
 */
export async function resetDatabase(): Promise<void> {
  if (isUsingInMemory()) {
    for (const name of KNOWN_COLLECTIONS) {
      getCollection(name).deleteMany({});
    }
    return;
  }
  // MongoDB mode — clear the models directly to avoid circular imports at module top
  const models = await import('../models');
  const targets = [
    models.User, models.Workspace, models.WorkspaceMember, models.BrandVoice,
    models.ContentProject, models.GeneratedContent, models.Campaign,
    models.ContentIdea, models.Integration, models.Usage, models.Notification,
    models.ScheduledPost, models.Invite,
  ];
  for (const m of targets) {
    await m.deleteMany({});
  }
}

const KNOWN_COLLECTIONS = [
  'User', 'Workspace', 'WorkspaceMember', 'BrandVoice', 'ContentProject',
  'GeneratedContent', 'Campaign', 'ContentIdea', 'Integration', 'Usage',
  'Notification', 'ScheduledPost', 'Invite',
];

export interface TestUser {
  token: string;
  user: { id: string; email: string; name: string };
  workspace: { id: string; name: string; plan: string };
}

/** Register a fresh user + workspace, returning auth token and ids. */
export async function registerUser(name = 'Test User'): Promise<TestUser> {
  const email = `user-${crypto.randomUUID()}@test.local`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email, password: 'Password123!', name });
  if (res.status !== 201) {
    throw new Error(`registerUser failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return {
    token: res.body.data.token,
    user: res.body.data.user,
    workspace: res.body.data.workspace,
  };
}

/** Authenticated request helper. */
export function auth(token: string) {
  return {
    get: (url: string) => request(app).get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string) => request(app).post(url).set('Authorization', `Bearer ${token}`),
    put: (url: string) => request(app).put(url).set('Authorization', `Bearer ${token}`),
    delete: (url: string) => request(app).delete(url).set('Authorization', `Bearer ${token}`),
  };
}

/**
 * Poll a project until it reaches the expected status (the pipeline runs
 * asynchronously, mirroring how the real frontend polls for completion).
 */
export async function waitForProject(
  token: string,
  projectId: string,
  expectedStatus = 'ready',
  timeoutMs = 10000
): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  let last: any = null;
  while (Date.now() < deadline) {
    last = await auth(token).get(`/api/content/${projectId}`);
    if (last.status === 200 && last.body.data?.project?.status === expectedStatus) return last;
    if (last.body.data?.project?.status === 'failed') return last;
    await new Promise((r) => setTimeout(r, 100));
  }
  return last;
}

/** Sample article used by content-generation tests. */
export const SAMPLE_ARTICLE = `I spent the last 3 months building a SaaS product from scratch and here is what I learned.

First, ship early and iterate. Your first version will be wrong, and that is fine — the faster you get it in front of users, the faster you learn.

Second, talk to your users every single day. Five conversations taught me more than three weeks of building.

Third, pricing is harder than you think. I undercharged by 4x and it shaped how users valued the product.

Fourth, focus on one thing and do it well. Every feature I cut made the product clearer.

Fifth, your tech stack matters less than you think. Nobody asked what I built it with.`;
