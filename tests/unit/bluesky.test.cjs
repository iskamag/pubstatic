const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { readConfig, buildRecord, createPublisher } = require('../../src/bluesky');
const config = readConfig({ BLUESKY_ENABLED: 'true', BLUESKY_IDENTIFIER: 'test.invalid', BLUESKY_APP_PASSWORD: 'mock-only' });
const post = { title: 'Org post', excerpt: '<p>Summary</p>', published_at: '2026-01-01T00:00:00Z', tags: ['org', 'org', 'two words', '😀'] };
const url = 'https://blog.invalid/posts/org';
function setup(fetch) {
    const db = new Database(':memory:');
    const warnings = [];
    return { db, warnings, publisher: createPublisher({ db, config, fetch, logger: { warn: msg => warnings.push(msg) } }) };
}
const response = body => ({ ok: true, json: async () => body });
test('configuration defaults off and validates explicit opt-in and HTTPS origin', () => {
    assert.deepEqual(readConfig({}), { enabled: false });
    assert.throws(() => readConfig({ BLUESKY_ENABLED: 'yes' }));
    assert.throws(() => readConfig({ BLUESKY_ENABLED: 'true' }));
    for (const service of ['http://pds.invalid', 'https://user:pass@pds.invalid', 'https://pds.invalid/path', 'https://pds.invalid/?x=1']) {
        assert.throws(() => readConfig({ BLUESKY_ENABLED: 'true', BLUESKY_SERVICE: service }));
    }
    assert.equal(config.service, 'https://bsky.social');
});
test('disabled publisher never accesses database or network', async () => {
    const p = createPublisher({ config: { enabled: false } });
    p.enqueue(post, url); await p.process();
});
test('record preserves bounded Unicode and exact deduplicated tags with external canonical link', () => {
    const record = buildRecord({ ...post, title: '😀'.repeat(400), tags: [...post.tags, 'x'.repeat(65)] }, url);
    assert.equal([...record.text].length, 300);
    assert.deepEqual(record.tags, ['org', 'two words', '😀']);
    assert.equal(record.embed.external.uri, url);
    assert.equal(record.embed.external.description, 'Summary');
    assert.equal(record.createdAt, post.published_at.replace('Z', '.000Z'));
    assert.throws(() => buildRecord(post, 'javascript:bad'));
    assert.ok(Buffer.byteLength(buildRecord({ ...post, title: ('a' + '\u0301'.repeat(4000)).repeat(3) }, url).text) <= 3000);
});
test('durable queue deduplicates and publishes validated record using session DID and TID key', async () => {
    const calls = [];
    const { db, publisher } = setup(async (url, options) => {
        calls.push({ url, ...options, body: JSON.parse(options.body) });
        return response(calls.length === 1 ? { did: 'did:plc:mock', accessJwt: 'mock-token' } : { uri: 'at://mock', cid: 'mock' });
    });
    publisher.enqueue(post, url); publisher.enqueue({ ...post, title: 'changed' }, url);
    await Promise.all([publisher.process(), publisher.process()]);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].body.repo, 'did:plc:mock');
    assert.match(calls[1].body.rkey, /^[234567][234567a-z]{12}$/);
    assert.equal(calls[1].body.validate, true);
    assert.equal(calls[1].body.record.text, post.title);
    assert.equal(calls[1].redirect, 'error');
    assert.equal(calls[1].headers.Authorization, 'Bearer mock-token');
    assert.equal(db.prepare('SELECT delivered FROM bluesky_queue').get().delivered, 1);
    await publisher.process(); assert.equal(calls.length, 2); db.close();
});
test('ambiguous delivery retries same record after restart without logging remote errors', async () => {
    const calls = [];
    const { db, warnings, publisher } = setup(async (url, options) => {
        if (url.endsWith('createSession')) return response({ did: 'did:plc:mock', accessJwt: 'mock-token' });
        calls.push(JSON.parse(options.body)); throw new Error('secret remote response');
    });
    publisher.enqueue(post, url); await publisher.process(); await publisher.process();
    assert.equal(calls.length, 1);
    assert.equal(db.prepare('SELECT attempts FROM bluesky_queue').get().attempts, 1);
    assert.ok(!warnings.join('').includes('secret'));
    db.prepare('UPDATE bluesky_queue SET next_attempt = 0').run();
    const restarted = createPublisher({ db, config, fetch: async (url, options) => {
        if (url.endsWith('createSession')) return response({ did: 'did:plc:mock', accessJwt: 'mock-token' });
        assert.deepEqual(JSON.parse(options.body), calls[0]); return response({ uri: 'at://mock', cid: 'mock' });
    } });
    await restarted.process(); assert.equal(db.prepare('SELECT delivered FROM bluesky_queue').get().delivered, 1); db.close();
});
test('authentication failure backs off and account changes do not deliver another account queue', async () => {
    const { db, publisher } = setup(async () => ({ ok: false }));
    publisher.enqueue(post, url); await publisher.process();
    assert.equal(db.prepare('SELECT attempts FROM bluesky_queue').get().attempts, 1);
    await createPublisher({ db, config: { ...config, identifier: 'other.invalid' }, fetch: () => assert.fail('unexpected request') }).process();
    db.close();
});
test('tag count is bounded and Unicode byte limit is enforced', () => {
    assert.equal(buildRecord({ ...post, tags: Array.from({ length: 12 }, (_, i) => `tag${i}`) }, url).tags.length, 8);
    assert.deepEqual(buildRecord({ ...post, tags: ['a' + '\u0301'.repeat(400)] }, url).tags, []);
    assert.deepEqual(readConfig({ BLUESKY_ENABLED: 'false', BLUESKY_APP_PASSWORD: 'unused' }), { enabled: false });
});
test('invalid session and malformed write result remain pending with bounded retry delay', async () => {
    for (const session of [{}, { accessJwt: 'mock', did: 'did:plc:mock', active: false }, { accessJwt: 'mock', did: 'did:plc:mock' }]) {
        const { db, publisher } = setup(async endpoint => response(endpoint.endsWith('createSession') ? session : {}));
        publisher.enqueue(post, url);
        db.prepare('UPDATE bluesky_queue SET attempts = 100').run();
        const before = Date.now(); await publisher.process();
        const row = db.prepare('SELECT * FROM bluesky_queue').get();
        assert.equal(row.delivered, 0); assert.equal(row.attempts, 101);
        assert.ok(row.next_attempt >= before + 3600000 && row.next_attempt <= Date.now() + 3600000);
        db.close();
    }
});
test('same-timestamp key collisions are resolved while keeping distinct posts', () => {
    const crypto = require('crypto');
    const seen = new Map(); let pair;
    for (let i = 0; !pair; i++) {
        const candidate = `${url}-${i}`;
        const clock = crypto.createHash('sha256').update(candidate).digest().readUInt16BE() % 1024;
        if (seen.has(clock)) pair = [seen.get(clock), candidate]; else seen.set(clock, candidate);
    }
    const { db, publisher } = setup(() => assert.fail('unexpected request'));
    pair.forEach(u => publisher.enqueue(post, u));
    assert.equal(db.prepare('SELECT COUNT(DISTINCT rkey) AS n FROM bluesky_queue').get().n, 2);
    db.close();
});
