# Standard.site publishing

Pubstatic can synchronize this blog into an existing ATProto account using
`site.standard.publication` and `site.standard.document`. Org files and their HTML
exports remain authoritative. There are no Bluesky posts, comments, likes,
subscriptions, or login UI in this integration. Existing ActivityPub behavior is
unchanged.

## Configuration

Disabled by default. Set `STANDARD_SITE_ENABLED=true` only when you want **all
existing and future posts** published to the configured account. The first sync
backfills the current `content/posts/*.html` files. This is public repository
content, even when the website itself is private.

Supply these variables through your normal private server configuration:

| Variable | Meaning |
| --- | --- |
| `STANDARD_SITE_ENABLED` | Literal `true` or `false`; default disabled |
| `STANDARD_SITE_PDS` | Account's exact HTTPS PDS origin, without a path, query or fragment |
| `STANDARD_SITE_DID` | Account DID (`did:plc:…` or `did:web:…`), not its mutable handle |
| `STANDARD_SITE_APP_PASSWORD` | App password belonging to that account |
| `STANDARD_SITE_NAME` | Publication name; defaults to configured `USER.name` |
| `STANDARD_SITE_DESCRIPTION` | Publication description; defaults to configured `USER.summary` |

Set `PROTOCOL=https`, `DOMAIN` and optional `BLOG_PATH` to the blog's public
canonical address before enabling. The PDS is explicitly configured, not
rediscovered on every write. The authenticated session must return the configured
DID. Invalid configuration disables publishing with a generic warning and leaves
the blog usable. Restart after changing configuration. Reader logins and OAuth
are not needed for this single-user server-side publisher.

Never commit or put app passwords in HTML exports. Credentials are supplied to
the authentication request over HTTPS; session tokens stay in memory for one
batch. Neither is stored in publisher state or logged. Network errors and remote
response bodies are not logged. Requests refuse redirects and time out after
15 seconds. Use Node 22+.

## Data and lifecycle

- One publication record contains the canonical blog URL, name and description.
- One document per slug contains its title, excerpt, tags, original publication
  time, relative path and **full plain-text article content**. `BLOG_PATH` belongs
  to the publication URL, so it is not repeated in the document path.
- HTML is parsed with `htmlparser2` (pinned, MIT; inspected before adding).
  Entities are decoded, paragraphs separated, and scripts/styles/head omitted.
  Rich HTML formatting, images and Org source are not stored in ATProto. The
  website retains the full HTML presentation. No media uploads or remote fetches
  are needed to derive article text.
- Tags are deduplicated, trimmed and stripped of leading `#`. Document titles
  and tags must fit the published schema limits. Oversized metadata or a record
  larger than this publisher's conservative 900,000-byte cap defers the whole
  reconciliation with a warning; content is never silently truncated.
- Startup and once-per-minute scans reconcile source files against durable state.
  New files are published after the existing watcher has ingested them locally.
  Edits, including excerpt-only edits, update the same record and set `updatedAt`.
  `publishedAt` is preserved from the first sync, initially using the local DB's
  publication date. There is no broadcast of ActivityPub history.
- Removing a file queues deletion of its managed document record. The publication
  itself is retained. Renaming a file means deletion plus a new document.
  Recreating the same slug reuses its saved identity and publication date.
- An incomplete or invalid source scan aborts reconciliation, rather than treating
  unreadable files as deleted posts. Fix the file or ingestion error to resume.

The `standard_site_records` SQLite table stores desired records, stable TID keys,
revision numbers, delivery acknowledgements and retry times. Publication delivery
precedes document delivery. Each cycle processes at most ten documents, with no
overlapping cycles in one process. Failures retry indefinitely with exponential
delay from one minute to one hour. Restarting preserves retry times and records.
An uncertain write is retried with the same record key and payload. Edits made
during a request remain pending until the newer revision succeeds.

PDS validation is left at its default: validate known lexicons. Local checks cover
the emitted fields; custom lexicons need not be preinstalled in the PDS.

Use **one process per blog database** and keep backups of `data/blog.db`.
State is isolated by PDS, DID and blog URL; changing any of these starts a new
publication scope and does not delete records from the old scope. Moving hosts
with the same URL/account requires carrying the database. Disabling stops sync
and verification; it does not remove already published records. Out-of-band PDS
edits are not imported or automatically repaired unless local content changes.

## Verification and reverse proxies

After delivery of the current publication revision, this route returns its AT-URI
as plain text:

- Root blog: `/.well-known/site.standard.publication`
- `BLOG_PATH=/posts`: `/.well-known/site.standard.publication/posts`

Each rendered article gets `<link rel="site.standard.document" href="at://…">`
in its HTML head after its current document revision is delivered. A publication
link in page heads provides an additional discovery hint. Verification returns
404 and document links are absent while disabled or pending delivery. An edit
can therefore temporarily hide the corresponding link until delivery completes.

Proxy the verification route at the **domain root**, like WebFinger, even when
other blog routes live under `/posts`. The nginx example includes this route.
Do not redirect it into `/posts/.well-known/…` or let static hosting swallow it.
For public indexers to verify records, the canonical website must be reachable
from the public internet; a tailnet-only preview can test delivery but cannot
provide public verification.

## Testing and manual review

Run `npm run test:unit`. Social services are mocked; publisher tests use in-memory
SQLite and web tests use local ephemeral HTTP servers. Tests cover records,
HTML/Org extraction, create/edit/delete/recreate, restart recovery, ambiguous
writes, authentication and HTTP failures, backoff, revision races, account
isolation, and verification at root and nested blog paths.

Without credentials:

1. Keep publishing disabled and run `npm start`.
2. Export an Org post to `content/posts/` with a title, abstract and FILETAGS.
3. Open its local article, edit and re-export it, and check the blog and tags.
4. Confirm the verification endpoint returns 404 and there are no Standard.site
   links in the article head. Inspect the mocked record assertions with
   `node --test tests/unit/standard-site.test.cjs`.

A live check requires explicit authorization to publish and privately supplied
credentials for a disposable account. In an isolated checkout, put only the
intended test article in `content/posts/`, enable the variables above and start
the server. Wait up to a minute; inspect the account's publication/document
collections with a repository viewer. Check the exact verification response and
article head link. Edit the excerpt/content and confirm the same AT-URI with a
new revision; remove the file and confirm deletion. Restart to check no duplicate
records appear. Disable afterward and revoke the test app password. No live
account credentials are required for automated tests.

## Primary references

- [Publication schema](https://standard.site/docs/lexicons/publication/)
- [Document schema and content representation](https://standard.site/docs/lexicons/document/)
- [Verification, including non-root publications](https://standard.site/docs/verification/)
- [putRecord validation and stable record keys](https://github.com/bluesky-social/atproto/blob/main/lexicons/com/atproto/repo/putRecord.json)
- [Idempotent deleteRecord](https://github.com/bluesky-social/atproto/blob/main/lexicons/com/atproto/repo/deleteRecord.json)
