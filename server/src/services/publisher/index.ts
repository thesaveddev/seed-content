import { Integration, GeneratedContent, ScheduledPost } from '../../models';
import { decryptCredentials } from '../crypto/secrets';

/**
 * Publish result contract
 */
export interface PublishResult {
  ok: boolean;
  externalId?: string;
  externalUrl?: string;
  message?: string;
  error?: string;
}

// ── Helpers ──────────────────────────────────────────────────────

function extractPostText(content: any, platform: string): string {
  const c = content || {};
  if (platform === 'x') {
    if (Array.isArray(c.tweets)) return c.tweets.map((t: string) => String(t)).join('\n\n');
    return String(c.text || '');
  }
  return String(
    c.text || c.caption || c.body || (Array.isArray(c.tweets) ? c.tweets.join('\n\n') : '')
  );
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 15000): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

// ── Telegram: real publishing (Bot API sendMessage) ──────────────

async function publishToTelegram(text: string, creds: Record<string, string>): Promise<PublishResult> {
  const token = creds.botToken;
  const chatId = creds.chatId;
  if (!token || !chatId) {
    return { ok: false, error: 'Telegram integration is missing a bot token or chat ID' };
  }

  try {
    const res = await fetchWithTimeout(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text.slice(0, 4000),
        disable_web_page_preview: false,
      }),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) {
      const desc = data?.description || `HTTP ${res.status}`;
      return { ok: false, error: `Telegram rejected the post: ${desc}` };
    }
    const msg = data?.result;
    return {
      ok: true,
      externalId: String(msg?.message_id ?? ''),
      externalUrl: `https://t.me/${String(chatId).replace('@', '')}/${msg?.message_id ?? ''}`,
    };
  } catch (err: any) {
    return { ok: false, error: `Telegram request failed: ${err?.message || 'network error'}` };
  }
}

// ── LinkedIn / X / Instagram: validate-only at publish time ──────

function validateOnlyMessage(platform: string): PublishResult {
  return {
    ok: false,
    error: `${platform} connected in validation mode — the platform API credentials for automatic posting are not configured on this deployment yet. The post is ready to copy from the content pack.`,
  };
}

// ── Dispatch ─────────────────────────────────────────────────────

export async function publishToPlatform(
  platform: string,
  gc: { content: any; workspaceId: any },
  postId: string
): Promise<PublishResult> {
  const integration = await Integration.findOne({
    workspaceId: gc.workspaceId,
    provider: platform,
    status: 'connected',
  });

  if (!integration) {
    return { ok: false, error: `No connected ${platform} integration for this workspace` };
  }

  const creds = decryptCredentials(integration.credentials || {});
  const text = extractPostText(gc.content, platform);

  if (!text || !text.trim()) {
    return { ok: false, error: 'Generated content has no publishable text' };
  }

  switch (platform) {
    case 'telegram':
      return publishToTelegram(text, creds);
    case 'linkedin':
    case 'x':
    case 'instagram':
    case 'tiktok':
    case 'youtube':
      return validateOnlyMessage(platform);
    default:
      return { ok: false, error: `Platform "${platform}" is not supported for publishing` };
  }
}

/**
 * Publish one scheduled post end-to-end: perform the platform call,
 * then transition the ScheduledPost to its terminal state + notify.
 */
export async function publishScheduledPost(post: any): Promise<void> {
  const gc = await GeneratedContent.findById(post.generatedContentId);
  const workspaceId = post.workspaceId ?? gc?.workspaceId;

  if (!gc) {
    await ScheduledPost.findByIdAndUpdate(post._id, {
      status: 'failed',
      errorMessage: 'Generated content no longer exists',
    });
    return;
  }

  let result: PublishResult;
  try {
    result = await publishToPlatform(post.platform, {
      content: gc.content,
      workspaceId,
    }, String(post._id));
  } catch (err: any) {
    result = { ok: false, error: err?.message || 'Publish attempt crashed' };
  }

  if (result.ok) {
    await ScheduledPost.findByIdAndUpdate(post._id, {
      status: 'published',
      publishedAt: new Date(),
      errorMessage: null,
      ...(result.externalUrl ? { externalUrl: result.externalUrl } : {}),
    });
    await notifyCreator(post, workspaceId, {
      type: 'info',
      title: `Published to ${post.platform} ✅`,
      message: `Your scheduled ${post.platform} post went out automatically.`,
    });
  } else {
    await ScheduledPost.findByIdAndUpdate(post._id, {
      status: 'failed',
      errorMessage: result.error || 'Publish failed',
    });
    await notifyCreator(post, workspaceId, {
      type: 'warning',
      title: `Post to ${post.platform} failed`,
      message: result.error || 'The scheduled post could not be published. Open the content pack to post manually.',
    });
  }
}

async function notifyCreator(
  post: any,
  workspaceId: any,
  payload: { type: 'info' | 'warning'; title: string; message: string }
) {
  try {
    const { Notification, ContentProject } = await import('../../models');
    const project = await ContentProject.findById(post.projectId);
    const userId = project?.createdBy;
    if (!userId || !workspaceId) return;
    await Notification.create({
      userId: String(userId),
      workspaceId: String(workspaceId),
      type: payload.type,
      title: payload.title,
      message: payload.message,
      projectId: String(post.projectId),
      read: false,
    });
  } catch {
    // Notification is best-effort — never fail the publish over it
  }
}
