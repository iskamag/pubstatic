const crypto = require('crypto');
const { publication, document } = require('./records');
const PUBLICATION = 'site.standard.publication';
const DOCUMENT = 'site.standard.document';

// Own table and injected I/O keep this independent of ActivityPub and blog migrations.
function createPublisher({ db, config, fetch = globalThis.fetch, now = Date.now, logger = console }) {
    if (!config.enabled) return { reconcile() {}, async process() {}, publicationUri() { return null; }, documentUri() { return null; } };
    db.exec(`CREATE TABLE IF NOT EXISTS standard_site_records (
        scope TEXT NOT NULL, slug TEXT NOT NULL, collection TEXT NOT NULL, rkey TEXT NOT NULL,
        record TEXT NOT NULL, published_at TEXT, deleted INTEGER NOT NULL DEFAULT 0,
        revision INTEGER NOT NULL DEFAULT 1, delivered_revision INTEGER NOT NULL DEFAULT 0,
        attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(scope, slug), UNIQUE(scope, collection, rkey)
    )`);
    const scope = JSON.stringify([config.pds, config.did, config.root]);
    const get = slug => db.prepare('SELECT * FROM standard_site_records WHERE scope = ? AND slug = ?').get(scope, slug);
    const uri = row => `at://${config.did}/${row.collection}/${row.rkey}`;
    function key(collection) {
        let value = (BigInt(now()) * 1000n << 10n) | BigInt(crypto.randomInt(1024));
        let result;
        do {
            let candidate = value++;
            result = '';
            for (let i = 0; i < 13; i++) { result = '234567abcdefghijklmnopqrstuvwxyz'[Number(candidate & 31n)] + result; candidate >>= 5n; }
        } while (db.prepare('SELECT 1 FROM standard_site_records WHERE scope = ? AND collection = ? AND rkey = ?').get(scope, collection, result));
        return result;
    }
    function save(slug, collection, record) {
        const previous = get(slug);
        if (previous) {
            const before = JSON.parse(previous.record);
            delete before.updatedAt;
            if (!previous.deleted && JSON.stringify(before) === JSON.stringify(record)) return;
            if (collection === DOCUMENT) record.updatedAt = new Date(now()).toISOString();
            db.prepare(`UPDATE standard_site_records SET record = ?, deleted = 0, revision = revision + 1,
                attempts = 0, next_attempt = 0 WHERE scope = ? AND slug = ?`).run(JSON.stringify(record), scope, slug);
        } else {
            db.prepare(`INSERT INTO standard_site_records(scope, slug, collection, rkey, record, published_at)
                VALUES (?, ?, ?, ?, ?, ?)`).run(scope, slug, collection, key(collection), JSON.stringify(record), record.publishedAt || null);
        }
    }
    const reconcile = db.transaction(posts => {
        // All construction is transactional: a bad file must never imply deletion of others.
        save('', PUBLICATION, publication(config));
        const site = uri(get(''));
        const slugs = new Set();
        for (const post of posts) {
            if (!/^[A-Za-z0-9_-]{1,100}$/.test(post.slug) || slugs.has(post.slug)) throw new Error('Invalid or duplicate document slug');
            slugs.add(post.slug);
            save(post.slug, DOCUMENT, document(post, site, get(post.slug)?.published_at));
        }
        for (const row of db.prepare('SELECT * FROM standard_site_records WHERE scope = ? AND slug != ? AND deleted = 0').all(scope, '')) {
            if (!slugs.has(row.slug)) db.prepare(`UPDATE standard_site_records SET deleted = 1, revision = revision + 1,
                attempts = 0, next_attempt = 0 WHERE scope = ? AND slug = ?`).run(scope, row.slug);
        }
    });
    let running = false;
    async function rpc(method, body, token) {
        const response = await fetch(`${config.pds}/xrpc/com.atproto.${method}`, {
            method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify(body)
        });
        if (!response.ok) throw new Error('ATProto request failed');
        return response.status === 204 ? {} : response.json();
    }
    function fail(row) {
        db.prepare(`UPDATE standard_site_records SET attempts = attempts + 1, next_attempt = ?
            WHERE scope = ? AND slug = ? AND revision = ?`).run(now() + Math.min(3600000, 60000 * 2 ** Math.min(row.attempts, 6)), scope, row.slug, row.revision);
        logger.warn('[Standard.site] Delivery failed; will retry (check PDS, credentials and record limits)');
    }
    async function deliver(row, session) {
        try {
            const body = { repo: config.did, collection: row.collection, rkey: row.rkey };
            if (row.deleted) {
                await rpc('repo.deleteRecord', body, session.accessJwt);
            } else {
                // Default validation supports PDSes without these application lexicons installed.
                const result = await rpc('repo.putRecord', { ...body, record: JSON.parse(row.record) }, session.accessJwt);
                if (result.uri !== uri(row) || typeof result.cid !== 'string' || !result.cid) throw new Error('Invalid write response');
            }
            db.prepare(`UPDATE standard_site_records SET delivered_revision = ?, attempts = 0, next_attempt = 0
                WHERE scope = ? AND slug = ? AND revision = ?`).run(row.revision, scope, row.slug, row.revision);
            return true;
        } catch { fail(row); return false; }
    }
    return {
        reconcile,
        publicationUri() { const row = get(''); return row && row.delivered_revision === row.revision ? uri(row) : null; },
        documentUri(slug) { const row = get(slug); return row && !row.deleted && row.delivered_revision === row.revision ? uri(row) : null; },
        async process() {
            if (running) return;
            running = true;
            try {
                const pub = get('');
                if (!pub || (pub.revision !== pub.delivered_revision && pub.next_attempt > now())) return;
                const rows = db.prepare(`SELECT * FROM standard_site_records WHERE scope = ? AND slug != ''
                    AND revision != delivered_revision AND next_attempt <= ? ORDER BY rowid LIMIT 10`).all(scope, now());
                const pubPending = pub.revision !== pub.delivered_revision;
                if (!pubPending && !rows.length) return;
                let session;
                try {
                    session = await rpc('server.createSession', { identifier: config.did, password: config.password });
                    if (session.did !== config.did || typeof session.accessJwt !== 'string' || !session.accessJwt || session.active === false) throw new Error('Wrong or inactive account');
                } catch {
                    if (pubPending) fail(pub);
                    rows.forEach(fail);
                    return;
                }
                if (pubPending && !await deliver(pub, session)) return;
                for (const row of rows) await deliver(row, session);
            } finally { running = false; }
        }
    };
}
module.exports = { createPublisher };
