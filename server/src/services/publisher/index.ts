import { Integration, GeneratedContent, ScheduledPost } from '../../models';
import { decryptCredentials } from '../crypto/secrets';
import { ensureFreshCredentials } from '../oauth';
import { renderTextCard, mediaPublicUrl } from '../media';

/**
 * Publish result contract
 */
export interface PublishResult {
  ok: boolean;
  externalId?: string;
  externalUrl?: string;
  message?: string;
  error?: string;
  /** Set when the failure was an auth/401 — triggers one refresh+retry */
  authError?: boolean;
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

// ── LinkedIn: real publishing (ugcPosts, OAuth token) ────────────

async function publishToLinkedIn(text: string, creds: Record<string, string>, meta: Record<string, any>): Promise<PublishResult> {
  try {
    let authorUrn: string | undefined = meta?.memberUrn;
    if (!authorUrn) {
      const me = await fetchWithTimeout('https://api.linkedin.com/v2/userinfo', {
        headers: { Authorization: `Bearer ${creds.accessToken}` },
      });
      if (me.ok) authorUrn = ((await me.json()) as any)?.sub;
    }
    if (!authorUrn) {
      return { ok: false, error: 'LinkedIn integration is missing the member identity — reconnect the account.' };
    }

    const res = await fetchWithTimeout('https://api.linkedin.com/v2/ugcPosts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: JSON.stringify({
        author: `urn:li:person:${authorUrn}`,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: { text: text.slice(0, 3000) },
            shareMediaCategory: 'NONE',
          },
        },
        visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
      }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (res.status === 401) return { ok: false, error: 'auth-401', authError: true };
    if (!res.ok) {
      const msg = body?.message || `HTTP ${res.status}`;
      return { ok: false, error: `LinkedIn rejected the post: ${msg}` };
    }
    const urn: string = body?.id || '';
    return {
      ok: true,
      externalId: urn,
      externalUrl: urn.startsWith('urn:li:share:') || urn.startsWith('urn:li:activity:')
        ? `https://www.linkedin.com/feed/update/${urn}`
        : undefined,
    };
  } catch (err: any) {
    return { ok: false, error: `LinkedIn request failed: ${err?.message || 'network error'}` };
  }
}

// ── X: real publishing (POST /2/tweets, OAuth2 user token) ───────

async function publishToX(content: any, creds: Record<string, string>): Promise<PublishResult> {
  // X has a 280-char limit and no multi-tweet support in one call —
  // post the first tweet of a thread, or the text, truncated honestly.
  const raw = Array.isArray(content?.tweets) && content.tweets.length > 0
    ? String(content.tweets[0])
    : String(content?.text || '');
  const text = raw.length > 280 ? `${raw.slice(0, 277)}…` : raw;

  try {
    const res = await fetchWithTimeout('https://api.twitter.com/2/tweets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (res.status === 401) return { ok: false, error: 'auth-401', authError: true };
    if (!res.ok) {
      const detail = body?.detail || body?.title || `HTTP ${res.status}`;
      return { ok: false, error: `X rejected the post: ${detail}` };
    }
    const id = body?.data?.id;
    const username = body?.data?.username;
    return {
      ok: true,
      externalId: String(id ?? ''),
      externalUrl: username && id ? `https://x.com/${username}/status/${id}` : undefined,
    };
  } catch (err: any) {
    return { ok: false, error: `X request failed: ${err?.message || 'network error'}` };
  }
}

// ── Instagram: image-card publishing (Graph API, two-step container) ──

async function publishToInstagram(
  text: string,
  creds: Record<string, string>,
  meta: Record<string, any>,
  contentId: string
): Promise<PublishResult> {
  const igUserId = meta?.igUserId;
  if (!igUserId) {
    return { ok: false, error: 'Instagram integration is missing the business account ID — reconnect via OAuth.' };
  }

  try {
    // 1. Render the branded card and expose it at a signed public URL
    const card = renderTextCard(text, 'instagram', contentId);
    const imageUrl = mediaPublicUrl(card.file);

    // 2. Create the media container
    const createRes = await fetchWithTimeout(`https://graph.facebook.com/v19.0/${igUserId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: imageUrl, caption: text.slice(0, 2200), access_token: creds.accessToken }),
    });
    const created: any = await createRes.json().catch(() => ({}));
    if (createRes.status === 401 || created?.error?.code === 190) {
      return { ok: false, error: 'auth-401', authError: true };
    }
    if (!createRes.ok || created?.error) {
      return { ok: false, error: `Instagram container creation failed: ${created?.error?.message || `HTTP ${createRes.status}`}` };
    }
    const creationId = created?.id;

    // 3. Wait for the container to finish processing (images are quick)
    let finished = false;
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const statusRes = await fetchWithTimeout(`https://graph.facebook.com/v19.0/${creationId}?fields=status_code&access_token=${encodeURIComponent(creds.accessToken)}`);
      const status: any = await statusRes.json().catch(() => ({}));
      if (status?.status_code === 'FINISHED') {
        finished = true;
        break;
      }
      if (status?.status_code === 'ERROR') {
        return { ok: false, error: 'Instagram rejected the generated image card' };
      }
    }
    if (!finished) {
      return { ok: false, error: 'Instagram took too long to process the image — try again' };
    }

    // 4. Publish the container
    const pubRes = await fetchWithTimeout(`https://graph.facebook.com/v19.0/${igUserId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creation_id: creationId, access_token: creds.accessToken }),
    });
    const published: any = await pubRes.json().catch(() => ({}));
    if (!pubRes.ok || published?.error) {
      return { ok: false, error: `Instagram publish failed: ${published?.error?.message || `HTTP ${pubRes.status}`}` };
    }

    return { ok: true, externalId: String(published?.id ?? '') };
  } catch (err: any) {
    return { ok: false, error: `Instagram request failed: ${err?.message || 'network error'}` };
  }
}

// ── YouTube / TikTok: video platforms — honest limitation ────────

function videoOnlyMessage(platform: string): PublishResult {
  return {
    ok: false,
    error: `${platform} is a video platform — automatic posting needs a rendered video file. The post is ready to copy from the content pack.`,
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

  // OAuth platforms: refresh the token if it's expired or near expiry.
  // A revoked token surfaces as a 401 inside the platform call below,
  // which triggers one forced refresh + retry before failing.
  const meta = integration.metadata || {};
  let creds: Record<string, string>;
  if (platform !== 'telegram') {
    const fresh = await ensureFreshCredentials(integration);
    if (!fresh.ok) return { ok: false, error: fresh.error };
    creds = fresh.creds;
  } else {
    creds = decryptCredentials(integration.credentials || {});
  }

  const content = gc.content || {};
  const text = extractPostText(content, platform);

  if (!text || !text.trim()) {
    return { ok: false, error: 'Generated content has no publishable text' };
  }

  const withRetry = async (fn: () => Promise<PublishResult>): Promise<PublishResult> => {
    const first = await fn();
    if (!(first as any)?.authError) return first;
    // Token revoked mid-flight → force a refresh and try exactly once more
    const integrationNow = await Integration.findById(integration._id);
    if (!integrationNow) return { ok: false, error: 'Integration was removed mid-publish' };
    const fresh = await ensureFreshCredentials(integrationNow, true);
    if (!fresh.ok) return { ok: false, error: fresh.error };
    creds = fresh.creds;
    return fn();
  };

  switch (platform) {
    case 'telegram':
      return publishToTelegram(text, creds);
    case 'linkedin':
      return withRetry(() => publishToLinkedIn(text, creds, meta));
    case 'x':
      return withRetry(() => publishToX(content, creds));
    case 'instagram':
      return withRetry(() => publishToInstagram(text, creds, meta, String(postId)));
    case 'tiktok':
    case 'youtube':
      return videoOnlyMessage(platform);
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
