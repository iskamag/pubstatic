# Optional Bluesky announcements

Pubstatic can announce new posts on an existing Bluesky/ATProto account. This is
an outbound bridge, not an ATProto blog repository or a second authoring interface.
Keep writing Org files and exporting HTML into `content/posts/` as before.
No new dependencies are required (Node 22+ provides fetch and Intl.Segmenter).

## Setup

The default is disabled, with no Bluesky network requests. To opt in, supply these
environment variables to the server through your normal private configuration:

- `BLUESKY_ENABLED=true` (only literal `true` or `false` accepted)
- `BLUESKY_IDENTIFIER`: your account handle or DID
- `BLUESKY_APP_PASSWORD`: an app password created in your account settings
- `BLUESKY_SERVICE`: your account's PDS HTTPS origin; default `https://bsky.social`

Use the PDS that hosts your account, not an AppView. The service must be an HTTPS
origin without a path, credentials, query, or fragment. Discovery and OAuth are
outside this single-user integration. Invalid configuration disables the bridge
with a generic warning; the blog and ActivityPub continue working. Set DOMAIN,
PROTOCOL and BLOG_PATH to the public blog address before enabling.
Never put credentials in HTML, Org exports, committed files, or issue reports.

## Publication and recovery

Only new files added while the server is running (or newly synced through the
existing test API) are announced. Startup scans never backfill old posts. Posts
added while the server is stopped or while Bluesky is disabled are not announced.

An announcement contains a bounded plain-text title, an external link card with
the canonical blog URL and excerpt, and up to eight exact, distinct tags. Tags
longer than 64 graphemes or 640 UTF-8 bytes are omitted. They are Bluesky additional
tags, not injected text hashtags. Text is limited to 300 graphemes and 3000 UTF-8
bytes, without splitting a grapheme. HTML tags are stripped; HTML entities are
kept as written. No remote previews, avatars, or images are fetched.

The initial announcement is a snapshot. Edits and deletions do not change or
remove it, including while awaiting delivery. Remove unwanted announcements in
Bluesky itself. Replies, likes, moderation, and interaction counts are not synced.
ActivityPub behavior is unchanged.

The SQLite `bluesky_queue` table survives restarts. Delivery runs once per minute,
using createSession and validated putRecord calls. Each request has a 15-second
timeout and refuses redirects. Sessions exist only for one batch in memory.
Failures retry with exponential delay from one minute to one hour, indefinitely;
a generic warning contains no remote response or exception text. Fix credentials
and restart to resume after the stored delay. Pending records are scoped to the
configured PDS and identifier: changing either leaves the old queue dormant.
Use a stable DID identifier if you expect to change handles.

A persisted TID record key is reused on retries, so a lost success response does
not create a second post. The same canonical URL is queued once per configured
account, including after local deletion/recreation. Preserve and back up the blog
database; deleting it loses deduplication history. Do not run multiple publisher
processes against the same database. Queue insertion failure warns but does not
block local publishing; there is no automatic reconciliation of that rare case.

## Review and manual testing without credentials

1. Run `npm run test:unit`. All social services are mocked and SQLite is in memory.
   The watcher test exports an Org-shaped HTML fixture, checks title/tags, startup
   non-backfill, Create/Update behavior, and deletion, then removes the fixture.
2. Leave `BLUESKY_ENABLED=false`; start `npm start`, export a new Org post into
   `content/posts/`, and visit its blog URL and tag pages. Edit and re-export it;
   check the blog updates. No Bluesky credentials are needed.
3. Run `node --test tests/unit/bluesky.test.cjs` to inspect mocked authentication,
   link-card publication, retry after an ambiguous network failure and restart,
   backoff, deduplication, and isolation after changing accounts.

A later live smoke test requires explicit approval to publish and a disposable
account: supply its PDS/identifier/app password privately, enable the bridge,
add a new file after startup, wait up to a minute, and inspect the title/card/tags
in that account. Re-export and restart to confirm there is no second announcement.
Revoke the app password and disable the bridge afterward. No live test was done.

## Protocol references

Verified against Bluesky's primary lexicons: [post schema](https://github.com/bluesky-social/atproto/blob/0748d919d127d68ee8c8aeb130b477e3dd5a9be6/lexicons/app/bsky/feed/post.json),
[external card](https://github.com/bluesky-social/atproto/blob/0748d919d127d68ee8c8aeb130b477e3dd5a9be6/lexicons/app/bsky/embed/external.json),
[putRecord](https://github.com/bluesky-social/atproto/blob/main/lexicons/com/atproto/repo/putRecord.json),
and [createSession](https://github.com/bluesky-social/atproto/blob/main/lexicons/com/atproto/server/createSession.json).
