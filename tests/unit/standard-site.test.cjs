const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { readConfig, plainText, document } = require('../../src/standard-site/records');
const { createPublisher } = require('../../src/standard-site/publisher');
const did = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const env = { STANDARD_SITE_ENABLED: 'true', STANDARD_SITE_PDS: 'https://pds.invalid', STANDARD_SITE_DID: did, STANDARD_SITE_APP_PASSWORD: 'synthetic-test-only', STANDARD_SITE_NAME: 'Org Blog' };
const config = readConfig(env, 'https://blog.invalid/posts');
const post = { slug: 'hello', title: 'Hello &amp; Org', excerpt: '<p>A summary</p>', content: '<p>Full <b>article</b> &amp; more.</p>', tags: ['org', 'emacs'], published_at: '2026-01-01T00:00:00Z' };
function setup() {
    const db = new Database(':memory:');
    const calls = [], warnings = [];
    let clock = Date.parse('2026-01-02T00:00:00Z');
    let behavior = async (method, body) => {
        if (method === 'server.createSession') return { did, accessJwt: 'synthetic-session' };
        if (method === 'repo.deleteRecord') return {};
        return { uri: `at://${did}/${body.collection}/${body.rkey}`, cid: 'synthetic-cid' };
    };
    const options = { db, config, now: () => clock, logger: { warn: text => warnings.push(text) }, fetch: async (url, options) => {
        const method = url.split('/xrpc/com.atproto.')[1];
        const body = JSON.parse(options.body);
        calls.push({ method, body, options, url });
        return { ok: true, json: () => behavior(method, body) };
    } };
    return { db, calls, warnings, options, publisher: createPublisher(options), advance(ms) { clock += ms; }, behavior(fn) { behavior = fn; }, rows() { return db.prepare('SELECT * FROM standard_site_records ORDER BY slug').all(); } };
}
test('disabled configuration and publisher do not touch storage or network', async () => {
    assert.deepEqual(readConfig({}, 'http://localhost'), { enabled: false });
    const p = createPublisher({ config: { enabled: false } });
    p.reconcile([post]); await p.process(); assert.equal(p.publicationUri(), null); assert.equal(p.documentUri('hello'), null);
});
test('enabled configuration requires HTTPS, DID, password, and bounded publication metadata', () => {
    assert.equal(config.root, 'https://blog.invalid/posts');
    assert.equal(readConfig({ ...env, STANDARD_SITE_PDS: 'https://pds.invalid/' }, 'https://blog.invalid/').root, 'https://blog.invalid');
    for (const patch of [{ STANDARD_SITE_ENABLED: 'yes' }, { STANDARD_SITE_DID: 'noz.am' }, { STANDARD_SITE_APP_PASSWORD: '' }, { STANDARD_SITE_NAME: 'x'.repeat(501) }, ...['http://pds.invalid', 'https://user:pass@pds.invalid', 'https://pds.invalid/path', 'https://pds.invalid?x=1', 'https://pds.invalid#x'].map(STANDARD_SITE_PDS => ({ STANDARD_SITE_PDS }))]) {
        assert.throws(() => readConfig({ ...env, ...patch }, config.root));
    }
    assert.throws(() => readConfig(env, 'http://localhost'));
});
test('HTML conversion decodes entities, preserves paragraph separation and excludes executable/style content', () => {
    assert.equal(plainText('<head><title>Hidden</title></head><p>Caf&eacute; &amp; <em>tea</em></p><script>alert("secret")</script><style>.secret{}</style><p>&#x1F600; &lt;tag&gt;</p>'), 'Café & tea\n\n😀 <tag>');
    assert.equal(plainText('<p>A<!-- hidden -->B<br>C</p>'), 'AB\nC');
});
test('document contains full text, canonical relative path and normalized exact tags', () => {
    const record = document({ ...post, tags: ['#org', 'org', 'two words', '😀', ''] }, 'at://publication');
    assert.equal(record.$type, 'site.standard.document');
    assert.equal(record.path, '/hello'); assert.equal(record.title, 'Hello & Org');
    assert.equal(record.textContent, 'Full article & more.');
    assert.deepEqual(record.tags, ['org', 'two words', '😀']);
    assert.equal(record.publishedAt, '2026-01-01T00:00:00.000Z');
    assert.ok(!('bskyPostRef' in record));
    assert.throws(() => document({ ...post, tags: ['x'.repeat(129)] }, 'at://publication'));
    assert.throws(() => document({ ...post, content: 'a'.repeat(900001) }, 'at://publication'));
    assert.throws(() => document({ ...post, title: '😀'.repeat(501) }, 'at://publication'));
    assert.equal([...document({ ...post, title: '😀'.repeat(500) }, 'at://publication').title].length, 500);
});
test('publication is delivered before documents; verification waits for successful writes', async () => {
    const t = setup(); t.publisher.reconcile([post]);
    assert.equal(t.publisher.publicationUri(), null); assert.equal(t.publisher.documentUri('hello'), null);
    await Promise.all([t.publisher.process(), t.publisher.process()]);
    assert.deepEqual(t.calls.map(c => c.method), ['server.createSession', 'repo.putRecord', 'repo.putRecord']);
    const publication = t.calls[1].body, doc = t.calls[2].body;
    assert.equal(publication.collection, 'site.standard.publication'); assert.equal(publication.record.url, config.root);
    assert.equal(doc.collection, 'site.standard.document'); assert.equal(doc.record.site, t.publisher.publicationUri());
    assert.equal(config.root + doc.record.path, 'https://blog.invalid/posts/hello');
    assert.match(doc.rkey, /^[234567][234567a-z]{12}$/);
    assert.equal(t.publisher.documentUri('hello'), `at://${did}/site.standard.document/${doc.rkey}`);
    for (const call of t.calls) { assert.equal(call.options.redirect, 'error'); assert.ok(call.options.signal instanceof AbortSignal); assert.ok(!call.body.validate); }
    assert.equal(t.calls[2].options.headers.Authorization, 'Bearer synthetic-session');
    t.publisher.reconcile([post]); await t.publisher.process(); assert.equal(t.calls.length, 3);
    t.db.close();
});
test('edits including excerpt-only edits update same key and preserve publishedAt across restarts', async () => {
    const t = setup(); t.publisher.reconcile([post]); await t.publisher.process();
    const original = t.rows().find(r => r.slug === 'hello');
    t.advance(1000);
    const restarted = createPublisher(t.options);
    restarted.reconcile([{ ...post, excerpt: 'Changed summary', published_at: '2026-02-01T00:00:00Z' }]);
    await restarted.process();
    const record = t.calls.at(-1).body;
    assert.equal(record.rkey, original.rkey); assert.equal(record.record.publishedAt, JSON.parse(original.record).publishedAt);
    assert.equal(record.record.description, 'Changed summary'); assert.equal(record.record.updatedAt, '2026-01-02T00:00:01.000Z');
    const count = t.calls.length;
    restarted.reconcile([{ ...post, excerpt: 'Changed summary' }]); await restarted.process(); assert.equal(t.calls.length, count);
    t.db.close();
});
test('removal deletes only managed documents and re-creation reuses record identity', async () => {
    const t = setup(); t.publisher.reconcile([post]); await t.publisher.process();
    const uri = t.publisher.documentUri('hello');
    t.publisher.reconcile([]); assert.equal(t.publisher.documentUri('hello'), null); await t.publisher.process();
    assert.equal(t.calls.at(-1).method, 'repo.deleteRecord'); assert.equal(t.calls.at(-1).body.collection, 'site.standard.document');
    t.publisher.reconcile([post]); await t.publisher.process(); assert.equal(t.publisher.documentUri('hello'), uri);
    assert.ok(t.calls.every(c => !c.body.collection || c.body.collection.startsWith('site.standard.'))); t.db.close();
});
test('failed or mismatched authentication never writes, backs off and does not leak remote errors', async () => {
    for (const session of [{ did: 'did:plc:wrong', accessJwt: 'secret' }, { did, accessJwt: 'secret', active: false }, null]) {
        const t = setup(); t.publisher.reconcile([post]);
        t.behavior(() => { if (session === null) throw Error('remote-secret'); return session; });
        await t.publisher.process(); await t.publisher.process();
        assert.equal(t.calls.length, 1); assert.equal(t.publisher.publicationUri(), null);
        assert.ok(t.rows().every(r => r.attempts === 1 && r.next_attempt > 0));
        assert.ok(!t.warnings.join('').includes('secret')); t.db.close();
    }
});
test('ambiguous write retries identical payload/key after restart and publication failure blocks documents', async () => {
    const t = setup(); t.publisher.reconcile([post]);
    t.behavior((method) => { if (method === 'server.createSession') return { did, accessJwt: 'synthetic' }; throw Error('lost response'); });
    await t.publisher.process(); assert.equal(t.calls.length, 2);
    const failed = t.calls[1].body;
    t.advance(60000);
    t.behavior((method, body) => method === 'server.createSession' ? { did, accessJwt: 'synthetic' } : { uri: `at://${did}/${body.collection}/${body.rkey}`, cid: 'synthetic' });
    await createPublisher(t.options).process(); assert.deepEqual(t.calls[3].body, failed);
    assert.ok(t.publisher.documentUri('hello')); t.db.close();
});
test('new edits arriving during delivery remain pending until latest revision is delivered', async () => {
    const t = setup(); t.publisher.reconcile([post]);
    t.behavior((method, body) => {
        if (method === 'server.createSession') return { did, accessJwt: 'synthetic' };
        if (body.collection === 'site.standard.document' && body.record.title === 'Hello & Org') t.publisher.reconcile([{ ...post, title: 'Latest' }]);
        return { uri: `at://${did}/${body.collection}/${body.rkey}`, cid: 'synthetic' };
    });
    await t.publisher.process();
    const row = t.rows().find(r => r.slug === 'hello'); assert.notEqual(row.revision, row.delivered_revision);
    await t.publisher.process(); assert.equal(t.calls.at(-1).body.record.title, 'Latest'); assert.ok(t.publisher.documentUri('hello'));
    t.db.close();
});
test('invalid reconciliation rolls back all changes instead of deleting valid documents', async () => {
    const t = setup(); t.publisher.reconcile([post]); await t.publisher.process();
    const before = t.rows();
    assert.throws(() => t.publisher.reconcile([{ ...post, slug: 'other', title: 'x'.repeat(501) }]));
    assert.deepEqual(t.rows(), before); t.db.close();
});
test('changing DID, PDS or blog root isolates pending state and verification', async () => {
    const t = setup(); t.publisher.reconcile([post]);
    for (const patch of [{ did: 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb' }, { pds: 'https://other.invalid' }, { root: 'https://other-blog.invalid' }]) {
        const other = createPublisher({ ...t.options, config: { ...config, ...patch }, fetch: () => assert.fail('unexpected call') });
        await other.process(); assert.equal(other.publicationUri(), null); assert.equal(other.documentUri('hello'), null);
    }
    t.db.close();
});
test('publication metadata changes update the existing publication record', async () => {
    const t = setup(); t.publisher.reconcile([post]); await t.publisher.process();
    const uri = t.publisher.publicationUri();
    const changed = createPublisher({ ...t.options, config: { ...config, name: 'New blog name' } });
    changed.reconcile([post]); assert.equal(changed.publicationUri(), null); await changed.process();
    assert.equal(changed.publicationUri(), uri); assert.equal(t.calls.at(-1).body.record.name, 'New blog name');
    t.db.close();
});
test('failed deletion is retried and re-created documents stay unverified until written again', async () => {
    const t = setup(); t.publisher.reconcile([post]); await t.publisher.process();
    const uri = t.publisher.documentUri('hello');
    t.publisher.reconcile([]);
    t.behavior((method) => { if (method === 'server.createSession') return { did, accessJwt: 'synthetic' }; throw Error('offline'); });
    await t.publisher.process(); assert.equal(t.publisher.documentUri('hello'), null);
    assert.equal(t.rows().find(r => r.slug === 'hello').attempts, 1);
    t.advance(60000);
    t.behavior((method, body) => method === 'server.createSession' ? { did, accessJwt: 'synthetic' } : method === 'repo.deleteRecord' ? {} : { uri: `at://${did}/${body.collection}/${body.rkey}`, cid: 'synthetic' });
    await t.publisher.process();
    t.publisher.reconcile([post]); assert.equal(t.publisher.documentUri('hello'), null);
    await t.publisher.process(); assert.equal(t.publisher.documentUri('hello'), uri); t.db.close();
});
test('HTTP failures, timeouts, invalid JSON and incorrect write receipts remain pending', async () => {
    for (const mode of ['http', 'timeout', 'json', 'wrong-uri']) {
        const t = setup(); t.publisher.reconcile([post]);
        const p = createPublisher({ ...t.options, fetch: async (url, options) => {
            if (url.endsWith('createSession')) return { ok: true, json: async () => ({ did, accessJwt: 'synthetic' }) };
            if (mode === 'timeout') throw new DOMException('synthetic-sensitive-detail', 'TimeoutError');
            if (mode === 'http') return { ok: false, status: 429 };
            return { ok: true, json: async () => { if (mode === 'json') throw Error('synthetic-sensitive-detail'); return { uri: 'at://wrong', cid: 'synthetic' }; } };
        } });
        await p.process(); assert.equal(p.publicationUri(), null);
        assert.equal(t.rows().find(r => r.slug === '').attempts, 1);
        assert.ok(!t.warnings.join('').includes('sensitive')); t.db.close();
    }
});
test('backoff is capped at an hour and each cycle sends at most ten documents', async () => {
    const t = setup(); const posts = Array.from({ length: 11 }, (_, i) => ({ ...post, slug: 'post-' + i }));
    t.publisher.reconcile(posts); await t.publisher.process();
    assert.equal(t.calls.filter(c => c.body.collection === 'site.standard.document').length, 10);
    await t.publisher.process(); assert.equal(t.calls.filter(c => c.body.collection === 'site.standard.document').length, 11);
    t.publisher.reconcile([{ ...posts[0], title: 'Edited' }, ...posts.slice(1)]);
    t.db.prepare('UPDATE standard_site_records SET attempts = 100 WHERE slug = ?').run(posts[0].slug);
    t.behavior(() => { throw Error('offline'); });
    await t.publisher.process();
    const row = t.rows().find(r => r.slug === posts[0].slug);
    assert.equal(row.attempts, 101); assert.equal(row.next_attempt, t.options.now() + 3600000);
    t.db.close();
});
