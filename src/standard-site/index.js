const fs = require('fs');
const path = require('path');
const { readConfig } = require('./records');
const { createPublisher } = require('./publisher');
const { mountVerification } = require('./web');

function readPosts(directory, Posts, parsePostFile) {
    // Abort an incomplete scan, rather than treating unreadable posts as deletions.
    return fs.readdirSync(directory).filter(file => file.endsWith('.html')).sort().map(file => {
        const slug = path.basename(file, '.html');
        if (!Posts.isValidSlug(slug).valid) throw new Error('Invalid source filename');
        const stored = Posts.getBySlug(slug);
        if (!stored) throw new Error('Waiting for local post ingestion');
        return { ...parsePostFile(path.join(directory, file)), published_at: stored.published_at };
    });
}

function install(app) {
    const { BLOG_ROOT, USER } = require('../config');
    let publisher;
    let enabled = false;
    try {
        const config = readConfig(process.env, BLOG_ROOT, { name: USER.name, description: USER.summary });
        enabled = config.enabled;
        publisher = createPublisher({ config, ...(enabled ? { db: require('../db') } : {}) });
    } catch {
        console.warn('[Standard.site] Disabled: invalid configuration or unavailable queue');
        publisher = createPublisher({ config: { enabled: false } });
        enabled = false;
    }
    mountVerification(app, publisher, BLOG_ROOT);
    return {
        start() {
            if (!enabled) return;
            let running = false;
            async function cycle() {
                if (running) return;
                running = true;
                try {
                    const posts = readPosts(path.join(__dirname, '../../content/posts'), require('../models/posts'), require('../watcher').parsePostFile);
                    publisher.reconcile(posts);
                    await publisher.process();
                } catch {
                    console.warn('[Standard.site] Sync deferred; check source files and configuration');
                } finally { running = false; }
            }
            void cycle();
            const timer = setInterval(() => void cycle(), 60000);
            timer.unref();
        }
    };
}
module.exports = { install, readPosts };
