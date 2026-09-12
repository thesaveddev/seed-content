import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { scheduledPostPublisher } from '../services/scheduler';
import { ContentProject, GeneratedContent, ScheduledPost, Integration, Notification } from '../models';
import { registerUser, auth, resetDatabase, type TestUser } from './helpers';

// ── fetch mocking (Telegram Bot API simulation) ───────────────────

function mockResponse(status: number, body: any) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

interface SentCall {
  url: string;
  body: Record<string, any>;
}

type TelegramMode = 'ok' | 'sendfail' | 'unauthorized';

/**
 * Build a global fetch stub that behaves like the Telegram Bot API.
 * Records every sendMessage payload so tests can assert what was published.
 */
function stubTelegramApi(mode: TelegramMode) {
  const sent: SentCall[] = [];
  const fetchMock = vi.fn(async (url: any, init?: any) => {
    const u = String(url);
    if (u.includes('/getMe')) {
      return mode === 'unauthorized'
        ? mockResponse(401, { ok: false, description: 'Unauthorized' })
        : mockResponse(200, { ok: true, result: { username: 'test_bot' } });
    }
    if (u.includes('/getChat')) {
      return mockResponse(200, { ok: true, result: { title: 'Test Channel' } });
    }
    if (u.includes('/sendMessage')) {
      if (mode === 'sendfail') {
        return mockResponse(400, { ok: false, description: 'Chat not found' });
      }
      const payload = JSON.parse(init?.body || '{}');
      sent.push({ url: u, body: payload });
      return mockResponse(200, { ok: true, result: { message_id: 42 } });
    }
    return mockResponse(404, { ok: false, description: 'Not found' });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { sent, fetchMock };
}

// ── Seed helpers ──────────────────────────────────────────────────

async function seedDuePost(
  user: TestUser,
  platform: string,
  when: Date,
  contentText = 'Hello from the scheduled post'
) {
  const project = await ContentProject.create({
    workspaceId: user.workspace.id,
    createdBy: user.user.id,
    title: 'Scheduler project',
    sourceType: 'text',
    transcript: 'source text',
    goal: 'auto',
    selectedPlatforms: [platform],
    status: 'ready',
  });
  const gc = await GeneratedContent.create({
    projectId: String(project._id),
    workspaceId: user.workspace.id,
    platform,
    type: 'post',
    content: { text: contentText },
    status: 'ready',
  });
  const post = await ScheduledPost.create({
    workspaceId: user.workspace.id,
    projectId: String(project._id),
    generatedContentId: String(gc._id),
    platform,
    scheduledAt: when,
    notes: '',
    status: 'scheduled',
  });
  return { project, gc, post: String(post._id) };
}

async function connectTelegram(user: TestUser): Promise<any> {
  return auth(user.token).post('/api/integrations/telegram/connect').send({
    credentials: { botToken: '123456:AAETestBotToken', chatId: '@testchannel' },
  });
}

async function getPost(id: string) {
  return ScheduledPost.findById(id);
}

async function notificationsFor(user: TestUser) {
  return Notification.find({ userId: user.user.id });
}

// ── Tests ─────────────────────────────────────────────────────────

describe('Scheduler & publisher', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('publishes a due Telegram post when connected: API attempted, post flips to published, success notification sent', async () => {
    const user = await registerUser('Telegram Publisher');
    const { sent } = stubTelegramApi('ok');

    const connect = await connectTelegram(user);
    expect(connect.status).toBe(200);

    const { post } = await seedDuePost(user, 'telegram', new Date(Date.now() - 5000));

    await scheduledPostPublisher.tick();

    // Publish actually went to Telegram's sendMessage endpoint
    expect(sent.length).toBe(1);
    expect(sent[0].body.chat_id).toBe('@testchannel');
    expect(sent[0].body.text).toContain('Hello from the scheduled post');

    const updated = await getPost(post);
    expect(updated!.status).toBe('published');
    expect(updated!.publishedAt).toBeTruthy();
    expect(updated!.externalUrl).toBe('https://t.me/testchannel/42');
    expect(updated!.errorMessage).toBeNull();

    const notes = await notificationsFor(user);
    const success = notes.find((n: any) => /Published to telegram/.test(n.title));
    expect(success).toBeTruthy();
    expect(success.type).toBe('info');
  });

  it('does not double-publish: a second tick leaves a published post alone', async () => {
    const user = await registerUser('No Double Publish');
    const { sent } = stubTelegramApi('ok');
    await connectTelegram(user);

    const { post } = await seedDuePost(user, 'telegram', new Date(Date.now() - 5000));
    await scheduledPostPublisher.tick();
    expect((await getPost(post))!.status).toBe('published');
    expect(sent.length).toBe(1);

    await scheduledPostPublisher.tick();
    expect(sent.length).toBe(1); // still once — no re-send
    expect((await getPost(post))!.status).toBe('published');
  });

  it('marks the post failed and notifies when Telegram rejects the publish call', async () => {
    const user = await registerUser('Telegram Reject');
    stubTelegramApi('sendfail');
    await connectTelegram(user); // verification succeeds, publishing fails

    const { post } = await seedDuePost(user, 'telegram', new Date(Date.now() - 5000));
    await scheduledPostPublisher.tick();

    const updated = await getPost(post);
    expect(updated!.status).toBe('failed');
    expect(updated!.errorMessage).toMatch(/Telegram rejected the post: Chat not found/);
    expect(updated!.publishedAt).toBeFalsy();

    const notes = await notificationsFor(user);
    const warning = notes.find((n: any) => /Post to telegram failed/.test(n.title));
    expect(warning).toBeTruthy();
    expect(warning.type).toBe('warning');
  });

  it('fails honestly when no integration is connected, with a warning notification', async () => {
    const user = await registerUser('No Integration');
    stubTelegramApi('ok'); // not used — nothing to call

    const { post } = await seedDuePost(user, 'telegram', new Date(Date.now() - 5000));
    await scheduledPostPublisher.tick();

    const updated = await getPost(post);
    expect(updated!.status).toBe('failed');
    expect(updated!.errorMessage).toMatch(/No connected telegram integration for this workspace/);

    const notes = await notificationsFor(user);
    const warning = notes.find((n: any) => /Post to telegram failed/.test(n.title));
    expect(warning).toBeTruthy();
    expect(warning.message).toMatch(/No connected telegram integration/);
  });

  it('attempts a real X publish when connected and fails honestly when the API rejects', async () => {
    const user = await registerUser('X Publish');
    stubTelegramApi('ok'); // telegram stub returns 404 for non-telegram URLs

    await auth(user.token).post('/api/integrations/x/connect').send({
      credentials: { accessToken: 'X'.repeat(30) },
    });

    const { post } = await seedDuePost(user, 'x', new Date(Date.now() - 5000));
    await scheduledPostPublisher.tick();

    const updated = await getPost(post);
    expect(updated!.status).toBe('failed');
    // The publisher now really calls the X API; the stub 404s it
    expect(updated!.errorMessage).toMatch(/X rejected the post/i);

    const notes = await notificationsFor(user);
    const warning = notes.find((n: any) => /Post to x failed/.test(n.title));
    expect(warning).toBeTruthy();
  });

  it('publishes to X end-to-end when the API accepts the tweet', async () => {
    const user = await registerUser('X Success');
    const tweets: any[] = [];
    const fetchMock = vi.fn(async (url: any, init?: any) => {
      const u = String(url);
      if (u.includes('api.twitter.com/2/tweets') && init?.method === 'POST') {
        const payload = JSON.parse(init.body || '{}');
        tweets.push(payload);
        return mockResponse(201, { data: { id: '1234567890', text: payload.text, username: 'xuser' } });
      }
      if (u.includes('/getMe') || u.includes('/getChat') || u.includes('/sendMessage')) {
        return mockResponse(200, { ok: true, result: { username: 'test_bot', message_id: 42, title: 'T' } });
      }
      return mockResponse(404, {});
    });
    vi.stubGlobal('fetch', fetchMock);

    await auth(user.token).post('/api/integrations/x/connect').send({
      credentials: { accessToken: 'X'.repeat(30) },
    });

    const { post } = await seedDuePost(user, 'x', new Date(Date.now() - 5000), 'My first automated tweet');
    await scheduledPostPublisher.tick();

    const updated = await getPost(post);
    expect(updated!.status).toBe('published');
    expect(updated!.externalUrl).toContain('x.com/xuser/status/1234567890');
    expect(tweets.length).toBe(1);
    expect(tweets[0].text).toMatch(/My first automated tweet/);

    const notes = await notificationsFor(user);
    const success = notes.find((n: any) => /Published to x/.test(n.title));
    expect(success).toBeTruthy();

    vi.unstubAllGlobals();
  });

  it('marks the post failed when the referenced generated content no longer exists', async () => {
    const user = await registerUser('Missing GC');
    stubTelegramApi('ok');

    const post = await ScheduledPost.create({
      workspaceId: user.workspace.id,
      projectId: 'project-gone',
      generatedContentId: 'gc-does-not-exist',
      platform: 'telegram',
      scheduledAt: new Date(Date.now() - 5000),
      status: 'scheduled',
    });

    await scheduledPostPublisher.tick();

    const updated = await getPost(String(post._id));
    expect(updated!.status).toBe('failed');
    expect(updated!.errorMessage).toMatch(/Generated content no longer exists/);
  });

  it('leaves future posts and in-flight posts untouched', async () => {
    const user = await registerUser('Not Due Yet');
    const { sent } = stubTelegramApi('ok');
    await connectTelegram(user);

    // Future post: tick must not touch it
    const { post: futureId } = await seedDuePost(user, 'telegram', new Date(Date.now() + 60 * 60 * 1000));
    await scheduledPostPublisher.tick();
    expect((await getPost(futureId))!.status).toBe('scheduled');
    expect(sent.length).toBe(0);

    // In-flight ('publishing') post: not re-claimed by an overlapping tick
    const { post: inflightId } = await seedDuePost(user, 'telegram', new Date(Date.now() - 5000));
    await ScheduledPost.findByIdAndUpdate(inflightId, { status: 'publishing' });
    await scheduledPostPublisher.tick();
    expect((await getPost(inflightId))!.status).toBe('publishing');
    expect(sent.length).toBe(0);
  });

  it('cancelled posts are never published', async () => {
    const user = await registerUser('Cancelled Post');
    const { sent } = stubTelegramApi('ok');
    await connectTelegram(user);

    const { post } = await seedDuePost(user, 'telegram', new Date(Date.now() - 5000));
    await ScheduledPost.findByIdAndUpdate(post, { status: 'cancelled' });

    await scheduledPostPublisher.tick();
    expect((await getPost(post))!.status).toBe('cancelled');
    expect(sent.length).toBe(0);
  });
});
