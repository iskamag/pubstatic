const crypto = require('crypto');

function readConfig(env) {
    if (env.BLUESKY_ENABLED === undefined || env.BLUESKY_ENABLED === 'false') return { enabled: false };
    if (env.BLUESKY_ENABLED !== 'true') throw new Error('BLUESKY_ENABLED must be true or false');
    const service = new URL(env.BLUESKY_SERVICE || 'https://bsky.social');
    if (service.protocol !== 'https:' || service.username || service.password || service.search || service.hash || service.pathname !== '/') {
        throw new Error('BLUESKY_SERVICE must be an HTTPS origin');
    }
    if (!env.BLUESKY_IDENTIFIER?.trim() || !env.BLUESKY_APP_PASSWORD?.trim()) {
        throw new Error('Bluesky requires BLUESKY_IDENTIFIER and BLUESKY_APP_PASSWORD');
    }
    return { enabled: true, service: service.origin, identifier: env.BLUESKY_IDENTIFIER.trim(), password: env.BLUESKY_APP_PASSWORD };
}

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
function truncate(text, max) {
    let result = '';
    for (const { segment } of segmenter.segment(String(text || ''))) {
        if (max-- <= 0 || Buffer.byteLength(result + segment) > 3000) break;
        result += segment;
    }
    return result;
}
function plain(text) {
    return String(text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
function buildRecord(post, url) {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Invalid post URL');
    // Tags remain exact metadata, rather than guessing how to turn Org tags into hashtags.
    const tags = [...new Set((post.tags || []).map(String).filter(t => t && Buffer.byteLength(t) <= 640 && Array.from(segmenter.segment(t)).length <= 64))].slice(0, 8);
    return {
        $type: 'app.bsky.feed.post', text: truncate(plain(post.title), 300),
        createdAt: new Date(post.published_at).toISOString(), tags,
        embed: { $type: 'app.bsky.embed.external', external: {
            uri: url, title: truncate(plain(post.title), 300), description: truncate(plain(post.excerpt), 1000)
        } }
    };
}

function createPublisher({ db, config, fetch = globalThis.fetch, logger = console }) {
    if (!config.enabled) return { enqueue() {}, async process() {} };
    db.exec(`CREATE TABLE IF NOT EXISTS bluesky_queue (
        account TEXT NOT NULL, url TEXT NOT NULL, rkey TEXT NOT NULL, record TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL DEFAULT 0,
        delivered INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(account, url), UNIQUE(account, rkey)
    )`);
    const account = `${config.service}/${config.identifier}`;
    let running = false;
    async function rpc(method, body, token) {
        const response = await fetch(`${config.service}/xrpc/${method}`, {
            method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify(body)
        });
        if (!response.ok) throw new Error('Bluesky request failed');
        return response.json();
    }
    return {
        enqueue(post, url) {
            if (db.prepare('SELECT 1 FROM bluesky_queue WHERE account = ? AND url = ?').get(account, url)) return;
            const record = JSON.stringify(buildRecord(post, url));
            const digest = crypto.createHash('sha256').update(url).digest();
            let value = (BigInt(new Date(post.published_at).getTime()) * 1000n << 10n) | BigInt(digest.readUInt16BE() % 1024);
            let rkey;
            const alphabet = '234567abcdefghijklmnopqrstuvwxyz';
            do {
                let candidate = value++;
                rkey = '';
                for (let i = 0; i < 13; i++) { rkey = alphabet[Number(candidate & 31n)] + rkey; candidate >>= 5n; }
            } while (db.prepare('SELECT 1 FROM bluesky_queue WHERE account = ? AND rkey = ?').get(account, rkey));
            db.prepare('INSERT OR IGNORE INTO bluesky_queue(account, url, rkey, record) VALUES (?, ?, ?, ?)')
                .run(account, url, rkey, record);
        },
        async process() {
            if (running) return;
            running = true;
            try {
                const rows = db.prepare('SELECT * FROM bluesky_queue WHERE account = ? AND delivered = 0 AND next_attempt <= ? LIMIT 10').all(account, Date.now());
                if (!rows.length) return;
                const session = await rpc('com.atproto.server.createSession', { identifier: config.identifier, password: config.password });
                if (typeof session.accessJwt !== 'string' || !session.did?.startsWith('did:') || session.active === false) throw new Error('Invalid session');
                for (const row of rows) {
                    try {
                        const result = await rpc('com.atproto.repo.putRecord', {
                            repo: session.did, collection: 'app.bsky.feed.post', rkey: row.rkey,
                            validate: true, record: JSON.parse(row.record)
                        }, session.accessJwt);
                        if (!result.uri || !result.cid) throw new Error('Invalid result');
                        db.prepare('UPDATE bluesky_queue SET delivered = 1 WHERE account = ? AND rkey = ?').run(account, row.rkey);
                    } catch {
                        fail(row);
                    }
                }
            } catch {
                // Never log remote responses, credentials, tokens, or exception messages.
                const rows = db.prepare('SELECT * FROM bluesky_queue WHERE account = ? AND delivered = 0 AND next_attempt <= ?').all(account, Date.now());
                rows.forEach(fail);
            } finally { running = false; }
        }
    };
    function fail(row) {
        db.prepare('UPDATE bluesky_queue SET attempts = attempts + 1, next_attempt = ? WHERE account = ? AND rkey = ?')
            .run(Date.now() + Math.min(3600000, 60000 * 2 ** Math.min(row.attempts, 6)), account, row.rkey);
        logger.warn('[Bluesky] Delivery failed; queued for retry');
    }
}

let publisher;
function getPublisher() {
    if (!publisher) publisher = createPublisher({ db: require('./db'), config: readConfig(process.env) });
    return publisher;
}
function queuePost(post) {
    try { getPublisher().enqueue(post, require('./urls').postUrl(post.slug)); }
    catch { console.warn('[Bluesky] Cannot queue announcement; check configuration'); }
}
function startPublisher() {
    try {
        const instance = getPublisher();
        const processQueue = () => instance.process().catch(() => console.warn('[Bluesky] Queue processing failed'));
        void processQueue();
        const timer = setInterval(() => void processQueue(), 60000);
        timer.unref();
    } catch { console.warn('[Bluesky] Disabled: invalid configuration'); }
}
module.exports = { readConfig, buildRecord, createPublisher, queuePost, startPublisher };
