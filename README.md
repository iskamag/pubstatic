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

### Debugging ActivityPub

To enable detailed logging for debugging federation issues:

```bash
DEBUG_AP=true npm start
```

This logs:
- Incoming request headers and bodies
- Activity processing details
- Parent comment resolution steps
- Signature verification

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

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/.well-known/webfinger` | GET | WebFinger discovery |
| `/u/:username` | GET | Actor profile (ActivityPub JSON) |
| `/u/:username/outbox` | GET | Posts collection |
| `/u/:username/inbox` | POST | Receive activities |
| `/u/:username/followers` | GET | Followers collection |
| `/u/:username/following` | GET | Following collection |
| `/p/:slug` | GET | Post (HTML or ActivityPub JSON) |
| `/p/:slug/likes` | GET | Likes collection |
| `/p/:slug/shares` | GET | Shares collection |
| `/p/new` | GET | Embeddable latest posts (for iframe embedding) |
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

The `/p/new` endpoint provides a condensed, self-contained HTML page showing the 3 latest posts. It's designed to be embedded in other websites via iframe:

```html
<iframe src="https://yourblog.com/p/new" width="100%" height="300" loading="lazy"></iframe>
```

Features:
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

# ActivityPub actor and inbox/outbox at root
location /u/ {
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

