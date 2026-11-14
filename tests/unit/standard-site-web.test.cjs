const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const path = require('path');
const fs = require('fs');
const { mountVerification } = require('../../src/standard-site/web');
const { readPosts } = require('../../src/standard-site');
const publicationUri = 'at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/site.standard.publication/3abc';
const documentUri = 'at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/site.standard.document/3def';
test('verification endpoints and rendered head use exact URIs at root and under BLOG_PATH', async () => {
    for (const prefix of ['', '/posts', '/writing/blog']) {
        let delivered = true;
        const publisher = { publicationUri: () => delivered ? publicationUri : null, documentUri: slug => delivered && slug === 'hello' ? documentUri : null };
        const app = express();
        mountVerification(app, publisher, 'https://blog.invalid' + prefix);
        app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '../../views'));
        app.get(`${prefix}/hello`, (req, res) => res.render('layout', { title: 'Hello', blogPath: prefix, blogRoot: 'https://blog.invalid' + prefix, user: { preferredUsername: 'admin', name: 'Blog', summary: '' }, body: '<article>Full article</article>' }));
        app.get(`${prefix}/`, (req, res) => res.json(res.locals));
        const server = app.listen(0, '127.0.0.1');
        await new Promise(resolve => server.once('listening', resolve));
        const base = `http://127.0.0.1:${server.address().port}`;
        try {
            const endpoint = '/.well-known/site.standard.publication' + prefix;
            let result = await fetch(base + endpoint);
            assert.equal(result.status, 200); assert.match(result.headers.get('content-type'), /text\/plain/); assert.equal(await result.text(), publicationUri);
            result = await fetch(base + prefix + '/hello'); const html = await result.text();
            assert.ok(html.includes(`<link rel="site.standard.document" href="${documentUri}">`));
            assert.ok(html.includes(`<link rel="site.standard.publication" href="${publicationUri}">`));
            const home = await (await fetch(base + prefix + '/')).json(); assert.equal(home.standardDocumentUri, null);
            delivered = false;
            assert.equal((await fetch(base + endpoint)).status, 404);
            const pendingHtml = await (await fetch(base + prefix + '/hello')).text(); assert.ok(!pendingHtml.includes('rel="site.standard.'));
            if (prefix) assert.equal((await fetch(base + '/.well-known/site.standard.publication')).status, 404);
        } finally { await new Promise(resolve => server.close(resolve)); }
    }
});
test('source snapshot reads current Org HTML including excerpt-only changes, excludes removed files, and aborts on missing metadata', () => {
    const directory = fs.mkdtempSync(path.join(__dirname, 'source-'));
    // Exercise the real Org/HTML parser with persistence and social modules isolated.
    require.cache[require.resolve('../../src/models/posts')] = { exports: {} };
    require.cache[require.resolve('../../src/rss')] = { exports: { updateRSSFile() {} } };
    const { parsePostFile } = require('../../src/watcher');
    const Posts = { isValidSlug: slug => ({ valid: /^[a-z-]+$/.test(slug) }), getBySlug: () => ({ published_at: '2026-01-01T00:00:00Z' }) };
    const file = path.join(directory, 'org-post.html');
    try {
        fs.writeFileSync(file, '<html><head><title>Org title</title><meta name="keywords" content="org, emacs"></head><body><div class="abstract">First summary</div><p>Full text</p></body></html>');
        let posts = readPosts(directory, Posts, parsePostFile);
        assert.equal(posts.length, 1); assert.deepEqual(posts[0].tags, ['org', 'emacs']); assert.equal(posts[0].title, 'Org title');
        fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('First summary', 'New summary'));
        posts = readPosts(directory, Posts, parsePostFile); assert.equal(posts[0].excerpt, 'New summary');
        assert.throws(() => readPosts(directory, { ...Posts, getBySlug: () => null }, parsePostFile));
        fs.unlinkSync(file); assert.deepEqual(readPosts(directory, Posts, parsePostFile), []);
        fs.writeFileSync(path.join(directory, 'invalid slug.html'), 'invalid'); assert.throws(() => readPosts(directory, Posts, parsePostFile));
    } finally { fs.rmSync(directory, { recursive: true }); }
});
test('runtime install defaults off and invalid opt-in configuration leaves a usable app', async () => {
    require.cache[require.resolve('../../src/config')] = { exports: { BLOG_ROOT: 'https://blog.invalid', USER: { name: 'Blog', summary: '' } } };
    const { install } = require('../../src/standard-site');
    const before = process.env.STANDARD_SITE_ENABLED;
    const originalWarn = console.warn;
    const warnings = [];
    console.warn = message => warnings.push(message);
    try {
        for (const enabled of ['false', 'invalid']) {
            process.env.STANDARD_SITE_ENABLED = enabled;
            const app = express(); install(app).start();
            app.get('/', (req, res) => res.send('Blog still works'));
            const server = app.listen(0, '127.0.0.1');
            await new Promise(resolve => server.once('listening', resolve));
            const base = `http://127.0.0.1:${server.address().port}`;
            try {
                assert.equal(await (await fetch(base)).text(), 'Blog still works');
                assert.equal((await fetch(base + '/.well-known/site.standard.publication')).status, 404);
            } finally { await new Promise(resolve => server.close(resolve)); }
        }
        assert.equal(warnings.length, 1);
    } finally {
        console.warn = originalWarn;
        if (before === undefined) delete process.env.STANDARD_SITE_ENABLED; else process.env.STANDARD_SITE_ENABLED = before;
    }
});
test('enabled runtime backfills at startup and reconciles edits/deletions on its scheduled cycle', async () => {
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    const did = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
    const directory = path.join(__dirname, '../../content/posts');
    const file = path.join(directory, 'standard-runtime-test.html');
    assert.ok(!fs.existsSync(file), 'test fixture must not overwrite an existing post');
    const original = { fetch: global.fetch, setInterval: global.setInterval, readdir: fs.readdirSync };
    const variables = { STANDARD_SITE_ENABLED: 'true', STANDARD_SITE_PDS: 'https://pds.invalid', STANDARD_SITE_DID: did, STANDARD_SITE_APP_PASSWORD: 'synthetic-only' };
    const saved = Object.fromEntries(Object.keys(variables).map(key => [key, process.env[key]]));
    const dbModule = require.resolve('../../src/db');
    const previousDb = require.cache[dbModule];
    require.cache[dbModule] = { exports: db };
    require.cache[require.resolve('../../src/models/posts')] = { exports: { isValidSlug: () => ({ valid: true }), getBySlug: () => ({ published_at: '2026-01-01T00:00:00Z' }) } };
    let tick;
    const calls = [];
    try {
        Object.assign(process.env, variables);
        fs.writeFileSync(file, '<!--\ntitle: Runtime post\ntags: org, emacs\n-->First version');
        fs.readdirSync = (target, ...args) => path.resolve(target) === path.resolve(directory) ? (fs.existsSync(file) ? [path.basename(file)] : []) : original.readdir(target, ...args);
        global.fetch = async (url, options) => {
            const body = JSON.parse(options.body); calls.push({ url, body });
            return { ok: true, json: async () => url.endsWith('createSession') ? { did, accessJwt: 'synthetic' } : url.endsWith('deleteRecord') ? {} : { uri: `at://${did}/${body.collection}/${body.rkey}`, cid: 'synthetic' } };
        };
        global.setInterval = (callback, ms) => { assert.equal(ms, 60000); tick = callback; return { unref() {} }; };
        const app = express(); require('../../src/standard-site').install(app).start();
        await new Promise(setImmediate);
        assert.equal(calls.filter(call => call.body.collection === 'site.standard.document').length, 1);
        assert.equal(calls.at(-1).body.record.textContent, 'First version');
        fs.writeFileSync(file, '<!--\ntitle: Runtime post\ntags: org, emacs\n-->Edited version');
        tick(); await new Promise(setImmediate);
        assert.equal(calls.at(-1).body.record.textContent, 'Edited version');
        fs.unlinkSync(file); tick(); await new Promise(setImmediate);
        assert.ok(calls.at(-1).url.endsWith('deleteRecord'));
    } finally {
        global.fetch = original.fetch; global.setInterval = original.setInterval; fs.readdirSync = original.readdir;
        for (const key of Object.keys(variables)) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
        if (previousDb) require.cache[dbModule] = previousDb; else delete require.cache[dbModule];
        if (fs.existsSync(file)) fs.unlinkSync(file);
        db.close();
    }
});
