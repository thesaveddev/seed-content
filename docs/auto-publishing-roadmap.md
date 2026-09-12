# Auto-Publishing Roadmap

> Making scheduled posts actually go out on X, LinkedIn, Instagram, TikTok, and YouTube.
> Status today: **Telegram works end-to-end.** Every other platform connects + validates credentials, but publishing returns a "validate-only" message. This document is the path from there to real posting.

---

## 1. Where the code stands

| Piece | State |
|---|---|
| Scheduler worker (`services/scheduler`) | ✅ Runs every minute, claims due posts, no double-publish |
| Publisher (`services/publisher`) | ✅ Telegram posts for real; others return honest validate-only errors |
| Credential storage | ✅ AES-256-GCM encrypted, never returned by API |
| Integration connect flow | ⚠️ Manual token paste — becomes OAuth for the platforms below |
| Retry on failure | ❌ Not built (posts currently fail terminally) |
| Token refresh | ❌ Not built (platform tokens expire — see per-platform notes) |
| Public media hosting | ❌ Not built (required by Instagram/TikTok) |

---

## 2. What every platform needs from us (cross-cutting work)

Regardless of platform, these four engineering pieces come first:

1. **OAuth connect flow** — replace manual token paste with "Connect with LinkedIn" buttons:
   - Server: `GET /api/integrations/:provider/oauth/start` (redirect) and `/oauth/callback` (exchange code → tokens, encrypt, save).
   - Env additions per provider: `*_CLIENT_ID`, `*_CLIENT_SECRET`, `*_REDIRECT_URI`.
   - Our existing encrypted-credential store and provider registry stay; OAuth just becomes the primary way credentials arrive.
2. **Token lifecycle** — platform tokens expire (Telegram's don't, which is why it was easy):
   - Add `expiresAt`, `refreshToken` (encrypted) to Integration credentials.
   - Refresh on publish (401 → refresh → retry once) and a daily sweep that warns users "LinkedIn reconnects in 5 days".
3. **Public media hosting** — Instagram/TikTok ingest media by **public URL**; text-only posts need a generated card image:
   - Public `GET /media/:id` endpoint (token-signed URLs, unlike user uploads).
   - Generate a branded image per post (we already have the OG-image generator pattern to reuse).
4. **Retry + queue hardening** — a failed post should be retryable from the UI/API (`POST /api/scheduler/:id/retry`), with per-platform rate-limit backoff.

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

## 4. Suggested sequence

| Phase | Scope | External dependency | Est. effort |
|---|---|---|---|
| 0 | OAuth framework + retry endpoint + token-lifecycle model | none | few days |
| 1 | LinkedIn member posting | "Share on LinkedIn" product approval (days) | small |
| 2 | X posting (+ thread chaining) | X tier decision (cost) | small |
| 3 | Instagram (+ Threads) | Meta App Review + media hosting | medium |
| 4 | YouTube | Google verification + quota increase | medium |
| 5 | TikTok | client audit | medium |

---

## 5. What we need from you (decisions / accounts)

1. **X tier**: is ~$100/mo Basic acceptable, or start on Free with its caps?
2. **Developer accounts** (can't be done for you — they're identity-bound): Meta, LinkedIn, X, Google Cloud, TikTok. We can create the apps together once you say go.
3. **Media for Instagram**: OK with auto-generated image cards for text-only posts, or should IG scheduling require user-supplied media?
4. **Domain + HTTPS**: OAuth redirect URIs need a real domain — which blocks on the production-deploy step anyway.
