const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const Database = require('better-sqlite3');
const createAdmin = require('../../src/routes/admin');
const token = 'test-only-admin-token-with-32-characters';
let db, server, base, Posts;
const authorization = 'Basic ' + Buffer.from(`owner:${token}`).toString('base64');

before(async () => {
    // Execute the real schema/migrations against an old database, in memory only.
    db = new Database(':memory:');
    db.exec(`CREATE TABLE comments (id INTEGER PRIMARY KEY, post_id INTEGER NOT NULL, parent_id INTEGER, actor_id TEXT NOT NULL, actor_url TEXT, actor_name TEXT, content TEXT NOT NULL, created_at TEXT NOT NULL, activity_id TEXT UNIQUE)`);
    const source = fs.readFileSync(path.join(__dirname, '../../src/db.js'), 'utf8');
    const initialize = () => vm.runInNewContext(source, {
        require: name => name === 'better-sqlite3' ? function () { return db; } : name === 'fs' ? { existsSync: () => true } : require(name),
        __dirname: path.join(__dirname, '../../src'), module: { exports: {} }, console
    });
    db.prepare('INSERT INTO comments (id, post_id, actor_id, content, created_at) VALUES (99, 999, ?, ?, ?)').run('old-actor', 'Old comment', '2020-01-01');
    initialize();
    assert.equal(db.prepare('SELECT hidden FROM comments WHERE id=99').get().hidden, 0);
    db.prepare('DELETE FROM comments WHERE id=99').run();
    initialize(); // Migration must be safe on every startup.
    require.cache[require.resolve('../../src/db')] = { exports: db };
    Posts = require('../../src/models/posts');
    Posts.createOrUpdate({ slug: 'moderation-test', title: 'Title', content: '<p>Article</p>', filePath: 'fixture', fileMtime: 1 });
    const insert = db.prepare('INSERT INTO comments (id, post_id, parent_id, actor_id, actor_name, content, created_at) VALUES (?, 1, ?, ?, ?, ?, ?)');
    insert.run(1, null, 'https://example.invalid/actor', '<img src=x onerror=alert(1)>', '<script>alert(1)</script>', '2026-11-14');
    insert.run(2, 1, 'https://example.invalid/actor', 'Reply author', 'Visible reply', '2026-11-14');
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '../../views'));
    app.use('/disabled', createAdmin(db, { token: '', username: 'owner' }));
    app.use('/short', createAdmin(db, { token: 'short', username: 'owner' }));
    app.use('/blog/admin', createAdmin(db, { token, username: 'owner', blogPath: '/blog' }));
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
const request = (route, options = {}) => fetch(base + route, { redirect: 'manual', ...options });
const post = (id, body, headers = {}) => request(`/blog/admin/comments/${id}`, { method: 'POST', headers: { authorization, 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(body) });
async function formToken() {
    const res = await request('/blog/admin/comments', { headers: { authorization } });
    return (await res.text()).match(/name="csrf" value="([a-f0-9]+)"/)[1];
}

test('admin disabled without a sufficiently long token', async () => {
    for (const route of ['/disabled/comments', '/short/comments']) assert.equal((await request(route)).status, 404);
});
test('all moderation reads and writes require correct credentials, including from localhost', async () => {
    for (const auth of ['', 'Bearer fake', 'Basic !!!', 'Basic ' + Buffer.from('owner:wrong').toString('base64')]) {
        for (const method of ['GET', 'POST']) {
            const res = await request('/blog/admin/comments', { method, headers: { authorization: auth } });
            assert.equal(res.status, 401);
            assert.match(res.headers.get('www-authenticate'), /Basic/);
        }
    }
    assert.equal(db.prepare('SELECT hidden FROM comments WHERE id=1').get().hidden, 0);
});
test('queue safely escapes remote content and supplies privacy and framing headers', async () => {
    const res = await request('/blog/admin/comments', { headers: { authorization } });
    const html = await res.text();
    assert.equal(res.status, 200);
    assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(html.includes('&lt;img'));
    assert.ok(!html.includes('<script>'));
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.match(res.headers.get('content-security-policy'), /form-action 'self'/);
    assert.ok(html.includes('/blog/admin/comments/1'));
});
test('CSRF and malformed inputs cannot mutate comments', async () => {
    const csrf = await formToken();
    for (const body of [{ action: 'hide' }, { action: 'hide', csrf: 'bad' }]) assert.equal((await post('1', body)).status, 403);
    assert.equal((await post('1', { action: 'hide', csrf }, { 'sec-fetch-site': 'cross-site' })).status, 403);
    for (const id of ['0', '-1', '1 OR 1=1', '1.0', '999999999999999999']) assert.equal((await post(encodeURIComponent(id), { action: 'hide', csrf })).status, 400);
    for (const action of ['delete', '<script>', 'hide,restore']) assert.equal((await post('1', { action, csrf })).status, 400);
    assert.equal((await post('99999', { action: 'hide', csrf })).status, 404);
    assert.equal(db.prepare('SELECT hidden FROM comments WHERE id=1').get().hidden, 0);
});
test('hide is idempotent, public counts exclude hidden content, replies survive, restore recovers original', async () => {
    const csrf = await formToken();
    for (let i = 0; i < 2; i++) {
        const res = await post('1', { action: 'hide', csrf });
        assert.equal(res.status, 303);
        assert.equal(res.headers.get('location'), '/blog/admin/comments');
    }
    assert.equal(Posts.getBySlug('moderation-test').comments_count, 1);
    const [parent] = Posts.getComments(1);
    assert.equal(parent.actor_name, 'Hidden comment');
    assert.equal(parent.content, 'This comment has been hidden by the blog owner.');
    assert.equal(parent.activity_id, null);
    assert.equal(parent.replies[0].content, 'Visible reply');
    const html = await require('ejs').renderFile(path.join(__dirname, '../../views/post.ejs'), {
        post: Posts.getBySlug('moderation-test'), comments: [parent], likes: [], shares: [],
        isPinned: false, blogPath: '/blog', activityPubId: 'local-fixture'
    });
    assert.ok(html.includes('Comments (1)'));
    assert.ok(html.includes('Visible reply'));
    assert.ok(!html.includes('<script>'));
    assert.ok(!html.includes('onerror'));
    assert.ok(html.includes('<span class="comment-author">Hidden comment</span>'));

    assert.equal(Posts.getAll()[0].comments_count, 1);
    assert.equal((await post('1', { action: 'restore', csrf })).status, 303);
    assert.equal(Posts.getBySlug('moderation-test').comments_count, 2);
    assert.equal(Posts.getComments(1)[0].content, '<script>alert(1)</script>');
});
test('pagination is bounded and handles unsafe query values', async () => {
    for (const query of ['page=-1', 'page[]=1', 'page=999999999999', 'page=%3Cscript%3E']) {
        assert.equal((await request('/blog/admin/comments?' + query, { headers: { authorization } })).status, 200);
    }
});

test('queue paginates fifty comments without losing hidden rows', async () => {
    const insert = db.prepare('INSERT INTO comments (id, post_id, actor_id, content, created_at, hidden) VALUES (?, 1, ?, ?, ?, ?)');
    for (let id = 100; id < 155; id++) insert.run(id, 'local', 'Pagination fixture', '2026-11-14', 1);
    const first = await (await request('/blog/admin/comments', { headers: { authorization } })).text();
    const second = await (await request('/blog/admin/comments?page=2', { headers: { authorization } })).text();
    assert.equal((first.match(/<article /g) || []).length, 50);
    assert.equal((second.match(/<article /g) || []).length, 7);
    assert.ok(first.includes('Older comments'));
    assert.ok(second.includes('Newer comments'));
    db.prepare('DELETE FROM comments WHERE id >= 100').run();
});
