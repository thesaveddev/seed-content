# Auto-Publishing Roadmap

> Making scheduled posts actually go out on X, LinkedIn, Instagram, TikTok, and YouTube.
> Status today: **Telegram and X work end-to-end; LinkedIn and Instagram publish once OAuth app credentials are configured on the deployment.** The engineering below is built and tested — what remains is per-platform developer-app setup and approvals (see §3).

---

## 1. Where the code stands

| Piece | State |
|---|---|
| Scheduler worker (`services/scheduler`) | ✅ Runs every minute, claims due posts, no double-publish |
| Publisher (`services/publisher`) | ✅ Telegram + X real; LinkedIn real (needs app creds + approved product); Instagram real via image cards (needs Meta app review); TikTok/YouTube honest video-only errors |
| OAuth connect flow (`services/oauth`, `integrations/:provider/oauth/*`) | ✅ Built — authorize URL, state+PKCE, code exchange, verify, encrypted save. Per-provider buttons appear when `*_CLIENT_ID/_SECRET` are set |
| Token lifecycle | ✅ `ensureFreshCredentials` refreshes on publish + on 401 retry; daily scheduler sweep warns "expires in N days / needs reconnecting" |
| Credential storage | ✅ AES-256-GCM encrypted, never returned by API |
| Public media hosting (`services/media`, `/api/media/:file`) | ✅ Zero-dependency branded PNG card renderer + HMAC-signed expiring URLs (Instagram path) |
| Retry on failure | ✅ `PUT /api/scheduler/:id/retry` + Calendar retry button |

---

## 2. What every platform needs from us (cross-cutting work)

✅ **All built and tested** — the remaining work per platform is developer-app configuration:

1. **OAuth connect flow** — `GET /api/integrations/:provider/oauth/start` returns the platform authorize URL; `/oauth/callback` exchanges the code, verifies identity, encrypts and saves tokens, then redirects the browser to the Integrations page with `?oauth=ok|error`.
2. **Token lifecycle** — `expiresAt` + encrypted `refreshToken` in Integration credentials; refreshed lazily on publish (401 → forced refresh → one retry) and probed by a daily sweep that notifies the creator before expiry.
3. **Public media hosting** — branded 1080×1080 PNG cards rendered per post (deterministic filename per content+platform), served from `/api/media/:file` behind signed, expiring URLs.
4. **Retry** — failed posts retry from the Calendar UI or `PUT /api/scheduler/:id/retry`; the attempt publishes asynchronously and lands on a terminal state with a notification.

**Env per provider:** `*_CLIENT_ID`, `*_CLIENT_SECRET`, plus `PUBLIC_BASE_URL` (must be a real HTTPS origin in production — OAuth redirect URIs are registered against it).

---

## 3. Per-platform requirements

### LinkedIn — *do first: easiest approval, text posts, our core audience*
- **App**: LinkedIn Developer app; add the **"Share on LinkedIn"** product (member posting — usually fast approval). Organization posting needs `w_organization_social` + Community Management review (slower).
- **Scopes**: `openid profile w_member_social`.
- **Publish**: `POST https://api.linkedin.com/rest/posts` (`X-Restli-Protocol-Version` header), author = member URN.
- **Token**: 60-day expiry, refresh token supported → lifecycle work matters here.
- **Gotchas**: 3,000-char limit, no duplicate-post spam filtering surprises (LinkedIn silently rejects identical reposts within days).

### X (Twitter) — *second: text threads, free tier usable but limited*
- **App**: X Developer account + project/app; **paid tier matters** — Free tier allows writing tweets but with low monthly caps (~500 posts/app/month, low per-user daily limits). Basic (~$100/mo) removes the pain; **cost decision needed**.
- **Auth**: OAuth 2.0 user context (PKCE) with offline access, or OAuth 1.0a.
- **Publish**: `POST /2/tweets`; a thread = sequential posts with `reply.in_reply_to_tweet_id` chaining. 280 chars per tweet — our generated threads already come pre-split.
- **Token**: OAuth 2.0 refresh tokens → lifecycle work.

### Instagram — *third: needs Meta app review + public media hosting*
- **Requirement**: Business/Creator IG account **linked to a Facebook Page**; user connects via Facebook Login.
- **App**: Meta for Developers app with `instagram_content_publish` (App Review required — provide screencast + test account).
- **Publish**: two-step container flow — `POST /{ig-user-id}/media` (image/video **public URL** + caption) → `POST /{ig-user-id}/media_publish` after container finishes.
- **Consequence**: media hosting (§2.3) is a hard prerequisite. Text posts must be rendered to an image card.
- **Token**: 60-day Page tokens, refreshable.

### Threads — *cheap add-on once Meta app exists*
- Same Meta app; `threads_content_publish` permission; container flow very similar to Instagram. Add after Instagram since the machinery is shared.

### YouTube — *fourth: media-heavy, quota-gated*
- **App**: Google Cloud project + OAuth consent screen; `youtube.upload` scope (unverified apps: uploads private until verification; verification needed for public-by-default).
- **Publish**: `videos.insert` resumable upload (title/description from generated content).
- **Quota**: default 10,000 units/day; each upload ≈ 1,600 units → ~6 uploads/day. **Quota-increase request needed for scale.**
- **Token**: refresh tokens → lifecycle work.

### TikTok — *last: requires client audit for public posting*
- **App**: TikTok for Developers; Content Posting API. **Unaudited clients can only post as private/self-only** — public direct posts require passing TikTok's client audit.
- **Publish**: `POST /v2/post/publish/video/init/` with `PULL_FROM_URL` (needs our public media hosting) or chunked upload.
- **Decision needed**: whether launch-time private-posting ("drafts to TikTok") is acceptable before audit.

---

## 4. Remaining sequence (code is done — these are setup steps)

| Step | Scope | External dependency | Est. effort |
|---|---|---|---|
| ✅ 0 | OAuth framework, retry endpoint, token lifecycle, media hosting | none | done |
| 1 | LinkedIn member posting live | "Share on LinkedIn" product approval (days) + set `LINKEDIN_CLIENT_ID/_SECRET` | minutes once approved |
| 2 | X posting at scale (+ thread chaining) | X tier decision (cost) + `X_CLIENT_ID/_SECRET` | minutes once app exists |
| 3 | Instagram live (+ Threads) | Meta App Review + `INSTAGRAM_CLIENT_ID/_SECRET` | review takes 1–2 weeks |
| 4 | YouTube uploads | Google verification + quota increase + `YOUTUBE_CLIENT_ID/_SECRET` | medium |
| 5 | TikTok public posting | client audit + `TIKTOK_CLIENT_ID/_SECRET` | medium |

---

## 5. What we need from you (decisions / accounts)

1. **X tier**: is ~$100/mo Basic acceptable, or start on Free with its caps?
2. **Developer accounts** (can't be done for you — they're identity-bound): Meta, LinkedIn, X, Google Cloud, TikTok. We can create the apps together once you say go.
3. **Domain + HTTPS**: set `PUBLIC_BASE_URL` to the production origin and register `https://<domain>/api/integrations/<provider>/oauth/callback` as the redirect URI in each platform's app settings.

*Note: Instagram text posts automatically render as branded image cards (§2.3) — no user-supplied media needed.*
