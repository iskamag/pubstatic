# ActivityPub Blog

A minimalist, single-user blog with ActivityPub federation support.

## Features

- **Zero JavaScript Frontend**: Pure HTML and CSS, no JavaScript required
- **ActivityPub Support**: Follows, likes, comments, and shares from Fediverse instances (Mastodon, Pleroma, etc.)
- **File-based Content**: Create and edit posts by adding HTML files to `content/posts/`
- **Tag System**: Organize posts with tags
- **RSS Feed**: Subscribe via RSS at `/rss.xml`
- **Colorful Design**: Beautiful gradient accents with minimalist aesthetic

## Installation

```bash
npm install
npm start
```

The server runs on http://localhost:6767 by default.

## Environment Variables

Create a `.env` file or set environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `DOMAIN` | `localhost:6767` | Your domain (e.g., `blog.example.com`) |
| `PROTOCOL` | `http` | `http` or `https` (use `https` in production) |
| `USERNAME` | `admin` | Your ActivityPub username |
| `PORT` | `6767` | Server port |
| `DISPLAY_NAME` | `Blog Admin` | Display name shown on profile |
| `BIO` | `A minimalist ActivityPub blog` | Profile bio |
| `DEBUG_AP` | `false` | Enable verbose ActivityPub logging |
| `BLOG_PATH` | `/` | Blog UI path (e.g., `/posts/` for integration with existing static sites) |
| `RATE_LIMIT_ENABLED` | `true` | Enable/disable rate limiting on inbox |
| `RATE_LIMIT_MAX` | `100` | Max requests per window per IP |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window in milliseconds |

### Debugging ActivityPub

To enable detailed logging for debugging federation issues:

```bash
DEBUG_AP=true npm start
```

This logs:
- Incoming request headers and bodies
- Activity processing details
- Parent comment resolution steps
- HTTP Signature verification details (protocol, host, signing string, algorithm used)
- Key object creation (type and algorithm)
- Actor URL fetching

## Security

### HTTP Signature Verification

All incoming activities require valid HTTP signatures. The server verifies:

1. **Signature validity** - The signature must match the actor's public key
2. **Actor ownership** - The activity's actor must match the signature's key owner
3. **Digest verification** - Request body digest must match (when present)

Supported signature algorithms:
- RSA-SHA256, RSA-SHA512 (Mastodon, Pleroma)
- Ed25519 (GoToSocial, Pixelfed)
- ECDSA with P-256, P-384, P-521 curves

### Undo Activity Protection

Undo requests (for likes, shares, follows) are verified to ensure the requesting actor owns the original activity. Malicious actors cannot delete another user's likes or follows.

### SSRF Protection

Actor URLs and inbox URLs are validated before fetching to prevent Server-Side Request Forgery:

- Blocks localhost (127.0.0.1, ::1)
- Blocks private IP ranges (10.x, 172.16-31.x, 192.168.x)
- Blocks cloud metadata endpoints (169.254.x.x)
- Blocks internal TLDs (.local, .internal, .localhost)
- Blocks IPv6 addresses
- Only allows HTTP/HTTPS protocols

### Rate Limiting

The inbox endpoint is rate-limited to prevent abuse and denial-of-service attacks. Configuration:

| Variable | Default | Description |
|----------|---------|-------------|
| `RATE_LIMIT_ENABLED` | `true` | Set to `false` to disable (e.g., if using reverse proxy rate limiting) |
| `RATE_LIMIT_MAX` | `100` | Maximum requests per window per IP |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Time window in milliseconds (default: 1 minute) |

Example: To allow 200 requests per 5 minutes:

```bash
RATE_LIMIT_MAX=200 RATE_LIMIT_WINDOW_MS=300000
```

To disable rate limiting (when using nginx/Cloudflare rate limiting):

```bash
RATE_LIMIT_ENABLED=false
```

## Creating Posts

Create HTML files in `content/posts/` with metadata in HTML comments:

```html
<!--
title: Your Post Title
excerpt: A brief description (optional)
tags: tag1, tag2, tag3
-->
<article>
    <p>Your HTML content here...</p>
</article>
```

The filename (without `.html`) becomes the post slug. For example, `my-first-post.html` will be accessible at `/p/my-first-post`.

### Reserved Slugs

Some slugs are reserved and cannot be used for posts:

**Reserved names:**
- Route paths: `new`, `u`, `tag`, `archive`, `static`, `rss`, `feed`, `index`
- API paths: `api`, `admin`, `login`, `logout`, `signin`, `signup`, `register`
- ActivityPub: `inbox`, `outbox`, `followers`, `following`, `oauth`, `actor`
- Static assets: `css`, `js`, `images`, `img`, `assets`, `fonts`, `media`, `static`, `pfp`, `static.css`
- Error pages: `404`, `500`, `error`
- Security: `security`, `auth`, `password`, `reset`, `confirm`
- CMS prefixes: `wp-*`, `ghost-*` (e.g., `wp-admin`, `ghost-frontend`)
- Other: `.well-known`, `favicon`, `sitemap`, `search`

**Slug restrictions:**
- Cannot contain whitespace
- Cannot contain path separators (`/` or `\`)
- Cannot start with a dot (`.`)
- Can only contain letters, numbers, hyphens, and underscores
- Maximum 100 characters

## ActivityPub Federation

### Following the Blog

From any ActivityPub-compatible platform (Mastodon, Pleroma, etc.), search for:
```
@username@yourdomain.com
```

### Supported Activities

- **Follow**: Users can follow your blog to receive new posts
- **Like**: Likes from followers appear on posts
- **Announce (Boost)**: Shares/boosts appear on posts
- **Create Note (Reply)**: Comments appear on posts with threading support
- **Undo**: Unfollows, unlikes, and un-boosts

### Media in Comments

ActivityPub comments support:
- Images (as attachments)
- Videos (as attachments)
- Audio (as attachments)
- HTML content (sanitized)

### ActivityPub Endpoints

**Note:** When `BLOG_PATH` is set (e.g., `/posts`), ActivityPub endpoints are mounted under that path. WebFinger remains at the root for discovery.

| Endpoint | Method | Description |
|----------|---------|-------------|
| `/.well-known/webfinger` | GET | WebFinger discovery (always at root) |
| `/u/:username` | GET | Actor profile (ActivityPub JSON) |
| `/u/:username/outbox` | GET | Posts collection |
| `/u/:username/inbox` | POST | Receive activities |
| `/u/:username/followers` | GET | Followers collection |
| `/u/:username/following` | GET | Following collection |
| `/p/:slug` | GET | Post (HTML or ActivityPub JSON) |
| `/p/:slug/likes` | GET | Likes collection |
| `/p/:slug/shares` | GET | Shares collection |

**With BLOG_PATH=/posts example:**
- WebFinger: `/.well-known/webfinger`
- Actor: `/posts/u/username`
- Inbox: `/posts/u/username/inbox`
- API: `/posts/api/...`

### Blog API Endpoints

The blog includes API endpoints for post management (available in test mode or when `ENABLE_TEST_API=true`):

| Endpoint | Method | Description |
|----------|---------|-------------|
| `/api/sync-post` | POST | Sync a post file to the database |
| `/api/scan-posts` | POST | Rescan all post files |
| `/api/add-follower` | POST | Add a follower (for testing) |
| `/api/remove-follower` | POST | Remove a follower (for testing) |
| `/api/outbound-activities` | GET | List pending outbound activities |
| `/api/clear-outbound-activities` | POST | Clear outbound activity queue |

**Note:** API routes are mounted under `BLOG_PATH` and are localhost-only in production.
| `/new` | GET | Embeddable latest posts (for iframe embedding) |
| `/rss.xml` | GET | RSS feed |

## Development

### Run Tests

```bash
npm test
```

Tests use Playwright for end-to-end testing.

### File Watcher

The server watches `content/posts/` for file changes and automatically:
- Creates new posts when files are added
- Updates posts when files are modified
- Queues ActivityPub Create/Update activities for federation
- Removes posts when files are deleted

## Embedding Latest Posts

The `/new` endpoint provides a condensed, self-contained HTML page showing the latest posts. It's designed to be embedded in other websites via iframe:

```html
<iframe src="https://yourblog.com/new" width="100%" height="300" loading="lazy"></iframe>
```

**URL Parameters:**

| Parameter | Default | Description |
|-----------|---------|-------------|
| `?n=3` | `2` | Number of posts to display (1-10, capped) |

**Examples:**
- `/new` - Shows 2 latest posts (default)
- `/new?n=1` - Shows 1 post
- `/new?n=5` - Shows 5 posts
- `/new?n=100` - Capped at 10 posts

**Note:** If using `BLOG_PATH=/posts`, the embed endpoint would be at `/posts/new`.

**Features:**
- Condensed format: title, date, excerpt (2-line clamp), interactions
- Self-contained styling with light/dark mode support
- Transparent background for seamless integration
- Responsive width

## Integrating with Existing Static Sites

The blog can run alongside an existing static website. Set `BLOG_PATH` to serve the blog UI from a sub-path while ActivityPub endpoints remain at root:

```bash
BLOG_PATH=/posts npm start
```

Then configure nginx to proxy requests:

```nginx
# Static website at root
location / {
    root /var/www/html;
    try_files $uri $uri/ =404;
}

# Blog UI at /posts/
location /posts/ {
    proxy_pass http://localhost:6767;
    proxy_set_header Host $host;
}

# WebFinger (only this, not all .well-known)
location /.well-known/webfinger {
    proxy_pass http://localhost:6767;
    proxy_set_header Host $host;
}
```

See `nginx-blog.example.conf` for a complete configuration including `/p/:slug/likes`, `/p/:slug/shares`, RSS, and static assets.

1. Set `PROTOCOL=https` in environment
2. Use a reverse proxy (nginx, Caddy, etc.) with SSL
3. Set your domain: `DOMAIN=blog.example.com`
4. Configure user settings in `user-settings.json`:

```json
{
  "display_name": "Your Name",
  "bio": "Your blog description",
  "avatar_url": "https://example.com/avatar.png"
}
```

## Troubleshooting

### Federation Not Working

1. Ensure `PROTOCOL=https` is set
2. Verify WebFinger returns correct URLs:
   ```bash
   curl https://yourdomain.com/.well-known/webfinger?resource=acct:username@yourdomain.com
   ```
3. Enable debug logging: `DEBUG_AP=true npm start`
4. Check that POST requests reach your server (check nginx logs)

### Comments Not Appearing

1. Old posts may have different URLs from domain/protocol changes
2. URL matching is now domain-agnostic - it extracts post slugs
3. Comments from ActivityPub include media attachments automatically
4. Nested comments (replies) are supported with proper threading

### Mastodon Not Delivering

If Mastodon can fetch your posts but not send likes/comments:
1. Mastodon may have marked your domain as unavailable after previous failures
2. The Mastodon instance admin can clear this with:
   ```sql
   DELETE FROM unavailable_domains WHERE domain = 'yourdomain.com';
   ```
3. New followers should work immediately after clearing

### Signature Verification Failing

If activities are being rejected with 401 errors:
1. Ensure `PROTOCOL=https` and `X-Forwarded-Proto` header is set by your reverse proxy
2. Enable debug logging: `DEBUG_AP=true npm start`
3. Check the logged signing string matches what the sending server expects
4. Verify the actor URL is accessible and returns a valid public key
5. Some servers use different header orders - check the `headers` field in the Signature header

### Testing with curl

To test signature verification manually:

```bash
# Generate a key pair
openssl genrsa -out private.pem 2048
openssl rsa -in private.pem -pubout -out public.pem

# Create a signed request (see HTTP Signatures spec)
# Your server logs will show the signing string when DEBUG_AP=true
```
