If you have a basic website and want to start blogging, this is the software for you.

## Features

- **Zero JavaScript Frontend**: Pure HTML and CSS, no JavaScript required
- **ActivityPub Support**: Supports likes, comments, and shares from Fediverse instances
- **File-based Content**: Create and edit posts by adding HTML files to `content/posts/`
- **Tag System**: Organize posts with tags
- **Colorful Design**: Beautiful gradient accents with minimalist aesthetic
- **Single User**: Simple single-user architecture

## Installation

```bash
npm install

npm start
```

The server will run on http://localhost:6767

### Creating Posts

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

The filename (without `.html`) becomes the post slug.

### ActivityPub Interactions

People can:
- **Follow** your blog from Mastodon/Pleroma
- **Like** posts (Like activity)
- **Share/Reblog** posts (Announce activity)
- **Reply** to posts (Create Note activity)

All interactions appear on post pages automatically.

### Run Tests

```bash
npm test
```

This will use playwright.

## ActivityPub Endpoints

- `GET /.well-known/webfinger` - WebFinger discovery
- `GET /u/:username` - Actor profile
- `GET /u/:username/outbox` - Posts collection
- `POST /u/:username/inbox` - Receive activities
- `GET /u/:username/followers` - Followers collection
- `GET /u/:username/following` - Following collection

