# Pubstatic

A simple blog for your simple website, accesible through the Fediverse.

## Features

- **Zero JavaScript Frontend**: Pure HTML and CSS, no JavaScript required
- **ActivityPub Support**: Follows, likes, comments, and shares from Fediverse instances (Mastodon, Pleroma, etc.)
- **File-based Content**: Create and edit posts just by adding HTML files to `content/posts/`
- **Tag System**: Organize posts with tags
- **RSS Feed**: Subscribe via RSS at `/rss.xml`
- **Org-compatible** Just point your HTML exports to the posts folder!
- **Featured posts** Embed `/new` to give the readers a glimpse of your writing. They would see new and pinned posts of your choosing

## Installation

```bash
npm install
npm start
```

The server runs on http://localhost:6767 by default.

## Environment Variables

The config reads from environment variables, or `.env`. Read `.env.example` carefully. Here are the parameters not written there:

`RATE_LIMIT_ENABLED   (true)` - Enable/disable rate limiting on inbox

`RATE_LIMIT_MAX       (100)` - Max requests per window per IP

`RATE_LIMIT_WINDOW_MS (60000)` - Rate limit window in milliseconds

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

The filename (without `.html`) becomes the post slug. For example, `my-first-post.html` will be accessible at `/my-first-post`.

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

## Embedding your posts

The `/new` endpoint provides a condensed, self-contained HTML page showing the latest and pinned posts. It's designed to be embedded in other websites via iframe:

```html
<iframe src="https://yourblog.com/new" width="100%" height="300" loading="lazy"></iframe>
```

**Pinning**
You can pin a post (or several) to the top of your list by writing to `content/pinned`. This is a line-seperated file with # for comments.

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

See `nginx-blog.example.conf` for a complete configuration including `/posts/:slug/likes`, `/posts/:slug/shares`, RSS, and static assets.

# License

MIT
