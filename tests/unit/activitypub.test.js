const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Every application dependency is explicit: tests never load config/dotenv,
// real signing keys, a persistent database, watchers, or a network service.
function load(relative, mocks, globals = {}) {
    const filename = path.resolve(__dirname, '../../', relative);
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
        module, exports: module.exports, __dirname: path.dirname(filename),
        require(name) {
            if (!(name in mocks)) throw new Error(`Unexpected dependency: ${name}`);
            return mocks[name];
        }, console: { log() {}, error() {} }, ...globals
    }, { filename });
    return module.exports;
}

function fixture(mode, includeExcerpt = true) {
    const config = {
        USERNAME: 'admin', ACTOR_URL: 'https://blog.example/posts/u/admin',
        USER: { followers: 'https://blog.example/posts/u/admin/followers' },
        BLOG_ROOT: 'https://blog.example/posts', AP_CONTENT_MODE: mode,
        AP_INCLUDE_EXCERPT: includeExcerpt, RATE_LIMIT: { enabled: false }
    };
    const urls = load('src/urls.js', { './config': config });
    const article = load('src/activitypub/article.js', { '../config': config, '../urls': urls });
    const post = {
        slug: 'org-article', title: 'Title <script> & "quote"',
        content: '<p>Private full article body</p>', excerpt: '<img src=x onerror=alert(1)> & abstract',
        tags: ['org', 'C++ & emacs'], published_at: '2026-11-14T00:00:00Z',
        updated_at: '2026-11-14T01:00:00Z', likes_count: 3, shares_count: 4
    };
    return { config, urls, article, post };
}

test('full mode and unspecified mode preserve complete HTML content', () => {
    for (const mode of [undefined, 'full']) {
        const { article, post } = fixture(mode);
        assert.equal(article.buildArticleObject(post).content, post.content);
    }
});

test('summary escapes title and abstract, links article, and omits full body', () => {
    const { article, post } = fixture('summary');
    const object = article.buildArticleObject(post);
    assert.equal(object.content, '<p><strong>Title &lt;script&gt; &amp; &quot;quote&quot;</strong></p><p>&lt;img src=x onerror=alert(1)&gt; &amp; abstract</p><p><a href="https://blog.example/posts/org-article">Read article</a></p>');
    assert.equal(object.name, post.title);
    assert.equal(object.type, 'Article');
    assert.equal(object.id, object.url);
    assert.equal(object.attributedTo, 'https://blog.example/posts/u/admin');
    assert.equal(object.likes.totalItems, 3);
    assert.equal(object.shares.totalItems, 4);
    assert.equal(object.tag[1].href, 'https://blog.example/posts/tag/C%2B%2B%20%26%20emacs');
});

test('title/link mode and absent abstract do not expose article or preview', () => {
    for (const includeExcerpt of [false, true]) {
        const { article, post } = fixture('summary', includeExcerpt);
        if (includeExcerpt) post.excerpt = '';
        const object = article.buildArticleObject(post);
        assert.equal(object.content, '<p><strong>Title &lt;script&gt; &amp; &quot;quote&quot;</strong></p><p><a href="https://blog.example/posts/org-article">Read article</a></p>');
    }
});

test('Create and Update queue the selected representation without contacting followers', () => {
    for (const mode of ['full', 'summary']) {
        const { config, urls, article, post } = fixture(mode);
        const rows = [];
        const handlers = {};
        const router = { get(route, handler) { handlers[route] = handler; }, post() {} };
        const routes = load('src/routes/activitypub.js', {
            express: { Router: () => router }, crypto: require('node:crypto'),
            'node-fetch': () => { throw new Error('Network access forbidden'); },
            path, fs: { existsSync: () => true, readFileSync: () => '{"publicKey":"mock","privateKey":"mock"}' },
            '../config': config, '../urls': urls, '../activitypub/article': article,
            '../models/posts': { getAll: () => [post] }, marked: {},
            '../db': { prepare(sql) {
                if (sql.includes('FROM followers')) return { all: () => [{ inbox_url: 'https://mock.example/inbox' }] };
                if (sql.includes('INSERT INTO outbound_activities')) return { run: (...args) => rows.push(args) };
                throw new Error(`Unexpected SQL: ${sql}`);
            } }
        }, { process: { env: {} }, setInterval() {}, setImmediate() {}, URL, Date });
        const created = routes.queuePostCreate(post);
        const updated = routes.queuePostUpdate(post);
        assert.equal(created.type, 'Create');
        assert.equal(updated.type, 'Update');
        assert.equal(created.object.content, article.buildArticleObject(post).content);
        assert.equal(updated.object.content, created.object.content);
        assert.equal(created.object.likes.totalItems, 0);
        assert.equal(updated.object.likes.totalItems, 3);
        let outbox;
        handlers['/u/:username/outbox']({ params: { username: config.USERNAME } }, {
            set() {}, json(value) { outbox = value; }
        });
        assert.equal(outbox.orderedItems[0].object.content, created.object.content);
        assert.equal(rows.length, 2);
        assert.equal(JSON.parse(rows[1][3]).tag[1].name, '#C++ & emacs');
    }
});

test('Org-exported title, FILETAGS keywords and abstract survive parsing into summary', () => {
    const html = '<!DOCTYPE html><html><head><title>Org post</title><meta name="keywords" content="org, emacs, activitypub" /></head><body><h1 class="title">Org post</h1><div class="abstract"><p>Short abstract</p></div><p>Long body</p></body></html>';
    const watcher = load('src/watcher.js', {
        chokidar: {}, path, fs: { existsSync: () => true, readFileSync: () => html, statSync: () => ({ mtimeMs: 42 }) },
        './models/posts': {}, './rss': { updateRSSFile() {} }
    });
    const parsed = watcher.parsePostFile('/mock/org-post.html');
    assert.equal(parsed.title, 'Org post');
    assert.deepEqual(Array.from(parsed.tags), ['org', 'emacs', 'activitypub']);
    assert.equal(parsed.excerpt, 'Short abstract');
    assert.ok(!parsed.content.includes('<h1'));
    const { article } = fixture('summary');
    const object = article.buildArticleObject(parsed);
    assert.ok(object.content.includes('Short abstract'));
    assert.ok(!object.content.includes('Long body'));
    assert.equal(object.tag.length, 3);
});

test('editing only excerpt persists instead of being discarded by the content hash', () => {
    let existing;
    const writes = [];
    const Posts = load('src/models/posts.js', {
        fs: {}, path, crypto: require('node:crypto'), '../db': { prepare(sql) {
            if (sql.startsWith('SELECT id, content_hash')) return { get: () => existing };
            return { run(...args) {
                writes.push({ sql, args });
                if (sql.includes('INSERT INTO posts')) existing = { id: 1, content_hash: args[8] };
                if (sql.includes('SET title')) existing.content_hash = args[7];
                return { lastInsertRowid: 1 };
            } };
        } }
    });
    const data = { slug: 'test-post', title: 'Title', content: '<p>Body</p>', excerpt: 'First', tags: ['org'], filePath: '/mock/test-post.html', fileMtime: 1 };
    Posts.createOrUpdate(data);
    Posts.createOrUpdate({ ...data, excerpt: 'Edited abstract', fileMtime: 2 });
    assert.ok(writes[1].sql.includes('SET title'));
    assert.equal(writes[1].args[2], 'Edited abstract');
    Posts.createOrUpdate({ ...data, excerpt: 'Edited abstract', fileMtime: 3 });
    assert.ok(writes[2].sql.includes('SET file_path'));
});


test('configuration defaults to full content and supports explicit summary/title settings', () => {
    for (const [env, mode, excerpt] of [
        [{}, 'full', true],
        [{ AP_CONTENT_MODE: 'summary' }, 'summary', true],
        [{ AP_CONTENT_MODE: 'summary', AP_INCLUDE_EXCERPT: 'false' }, 'summary', false],
        [{ AP_CONTENT_MODE: 'typo' }, 'full', true]
    ]) {
        const config = load('src/config.js', { dotenv: { config() {} } }, { process: { env } });
        assert.equal(config.AP_CONTENT_MODE, mode);
        assert.equal(config.AP_INCLUDE_EXCERPT, excerpt);
    }
});
