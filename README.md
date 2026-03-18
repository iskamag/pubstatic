# ActivityPub Blog

A minimalist ActivityPub-enabled blog with zero JavaScript frontend. Built with Node.js, Express, SQLite, and pure HTML+CSS.

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
```

## Configuration

Edit `.env` file:

```env
DOMAIN=blog.iskamag.com
USERNAME=admin
PORT=6767
PROTOCOL=https
DISPLAY_NAME=My ActivityPub Blog
BIO=A colorful minimalist blog
```

For local development:

```env
DOMAIN=localhost:6767
USERNAME=admin
PORT=6767
PROTOCOL=http
```

## Usage

### Start the Server

```bash
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

Your blog actor is available at:
- Actor URL: `https://your-domain/u/admin`
- WebFinger: `acct:admin@your-domain`

People can:
- **Follow** your blog from Mastodon/Pleroma
- **Like** posts (Like activity)
- **Share/Reblog** posts (Announce activity)
- **Reply** to posts (Create Note activity)

All interactions appear on post pages automatically.

## Development

### Run Tests

```bash
npm test
```

Tests use Playwright and cover:
- Frontend rendering
- ActivityPub endpoints
- Activity processing
- Responsive design

### Project Structure

```
apub-blog/
├── content/
│   └── posts/          # Blog posts (HTML files)
├── data/
│   └── blog.db         # SQLite database
├── public/
│   └── css/
│       └── style.css   # Colorful minimalist styles
├── src/
│   ├── config.js       # Configuration
│   ├── db.js           # Database setup
│   ├── models/
│   │   └── posts.js    # Post data model
│   ├── routes/
│   │   └── activitypub.js  # ActivityPub endpoints
│   ├── server.js       # Express server
│   └── watcher.js      # File watcher for posts
├── tests/
│   └── blog.spec.js    # Playwright tests
├── views/              # EJS templates
├── .env                # Environment variables
└── package.json
```

## ActivityPub Endpoints

- `GET /.well-known/webfinger` - WebFinger discovery
- `GET /u/:username` - Actor profile
- `GET /u/:username/outbox` - Posts collection
- `POST /u/:username/inbox` - Receive activities
- `GET /u/:username/followers` - Followers collection
- `GET /u/:username/following` - Following collection

## License

MIT
