const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
// Isolate all persistence and social services while exercising the real watcher/parser.
const posts = new Map();
const ap = [], bsky = [];
function stub(module, exports) { require.cache[require.resolve(module)] = { exports }; }
stub('../../src/models/posts', {
    getBySlug: slug => posts.get(slug),
    createOrUpdate: post => posts.set(post.slug, { ...post, published_at: '2026-01-01T00:00:00Z' }),
    setPinned() {},
    deleteBySlug: slug => posts.delete(slug)
});
stub('../../src/rss', { updateRSSFile() {} });
stub('../../src/routes/activitypub', { queuePostCreate: p => ap.push(['Create', p]), queuePostUpdate: p => ap.push(['Update', p]) });
stub('../../src/bluesky', { queuePost: p => bsky.push(p) });
const watchers = [];
stub('chokidar', { watch() { const events = {}; const watcher = { on(event, callback) { events[event] = callback; return watcher; }, events }; watchers.push(watcher); return watcher; } });
const { syncPostFile, scanExistingFiles, startWatcher } = require('../../src/watcher');
test('Org export publication queues both services once; edits/deletes retain AP behavior', () => {
    const file = path.join(__dirname, '../../content/posts/bluesky-unit.html');
    try {
        fs.writeFileSync(file, '<html><head><title>Org title</title><meta name="keywords" content="org, emacs"></head><body><p>Hello</p></body></html>');
        // A startup scan must not backfill social posts.
        scanExistingFiles(); assert.equal(bsky.length, 0); assert.equal(ap.length, 0);
        posts.clear();
        syncPostFile(file);
        assert.equal(bsky.length, 1); assert.deepEqual(bsky[0].tags, ['org', 'emacs']);
        assert.equal(bsky[0].title, 'Org title'); assert.equal(ap[0][0], 'Create');
        syncPostFile(file); assert.equal(bsky.length, 1); assert.equal(ap[1][0], 'Update');
        fs.unlinkSync(file); syncPostFile(file); assert.equal(bsky.length, 1);
    } finally { if (fs.existsSync(file)) fs.unlinkSync(file); }
});

test('watcher add event announces only new files and leaves changes on ActivityPub', () => {
    const file = path.join(__dirname, '../../content/posts/bluesky-event.html');
    const previous = bsky.length;
    try {
        startWatcher();
        fs.writeFileSync(file, '<!--\ntitle: Event post\ntags: org\n-->Hello');
        watchers[0].events.add(file);
        assert.equal(bsky.length, previous + 1);
        watchers[0].events.add(file);
        watchers[0].events.change(file);
        assert.equal(bsky.length, previous + 1);
        assert.equal(ap.at(-1)[0], 'Update');
        fs.unlinkSync(file); watchers[0].events.unlink(file);
        assert.equal(bsky.length, previous + 1);
    } finally { if (fs.existsSync(file)) fs.unlinkSync(file); }
});
