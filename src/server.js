const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const path = require('path');
const fs = require('fs');
const { DOMAIN, USERNAME, PORT, BASE_URL, ACTOR_URL, USER } = require('./config');
const Posts = require('./models/posts');
const { startWatcher, syncPostFile, scanExistingFiles } = require('./watcher');
const activitypubRoutes = require('./routes/activitypub');

const app = express();

// Setup view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

// Static files
app.use('/static', express.static(path.join(__dirname, '..', 'public')));

// Body parsing
app.use(express.json({ type: ['application/json', 'application/activity+json', 'application/ld+json'] }));
app.use(express.urlencoded({ extended: true }));

// ActivityPub routes
app.use(activitypubRoutes);

// Test/sync endpoints (only available in test mode)
if (process.env.NODE_ENV === 'test' || process.env.ENABLE_TEST_API) {
    app.post('/api/sync-post', express.json(), (req, res) => {
        const { filename } = req.body;
        if (!filename) {
            return res.status(400).json({ error: 'Filename required' });
        }
        const filePath = path.join(__dirname, '..', 'content', 'posts', filename);
        const post = syncPostFile(filePath);
        if (post) {
            res.json({ success: true, post });
        } else {
            res.status(404).json({ success: false, error: 'File not found' });
        }
    });
    
    app.post('/api/scan-posts', (req, res) => {
        scanExistingFiles();
        res.json({ success: true });
    });
}

// WebFinger endpoint
app.get('/.well-known/webfinger', (req, res) => {
    const resource = req.query.resource;
    if (!resource) {
        return res.status(400).json({ error: 'Missing resource parameter' });
    }
    
    const expected = `acct:${USERNAME}@${DOMAIN}`;
    if (resource !== expected) {
        return res.status(404).json({ error: 'Resource not found' });
    }
    
    res.json({
        subject: resource,
        aliases: [ACTOR_URL],
        links: [{
            rel: 'self',
            type: 'application/activity+json',
            href: ACTOR_URL
        }]
    });
});

// Frontend routes
app.get('/', async (req, res) => {
    const posts = Posts.getAll(10, 0);
    const tags = Posts.getTags();
    
    res.render('index', {
        title: USER.name,
        posts,
        tags,
        baseUrl: BASE_URL,
        user: USER
    });
});

app.get('/tag/:tag', (req, res) => {
    const tag = req.params.tag;
    const posts = Posts.getByTag(tag);
    const allTags = Posts.getTags();
    
    res.render('tag', {
        title: `Tag: ${tag} - ${USER.name}`,
        posts,
        tags: allTags,
        currentTag: tag,
        baseUrl: BASE_URL,
        user: USER
    });
});

app.get('/p/:slug', (req, res) => {
    const post = Posts.getBySlug(req.params.slug);
    
    if (!post) {
        return res.status(404).render('404', {
            title: 'Not Found',
            baseUrl: BASE_URL,
            user: USER
        });
    }
    
    const comments = Posts.getComments(post.id);
    const likes = Posts.getLikes(post.id);
    const shares = Posts.getShares(post.id);
    
    res.render('post', {
        title: `${post.title} - ${USER.name}`,
        post,
        comments,
        likes,
        shares,
        baseUrl: BASE_URL,
        user: USER,
        activityPubId: `${BASE_URL}/p/${post.slug}`
    });
});

// Error handler
app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).render('500', {
        title: 'Server Error',
        baseUrl: BASE_URL,
        user: USER
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).render('404', {
        title: 'Not Found',
        baseUrl: BASE_URL,
        user: USER
    });
});

// Start server
const server = app.listen(PORT, () => {
    console.log(`🚀 Server running on ${BASE_URL}`);
    console.log(`📁 Actor: ${ACTOR_URL}`);
    
    // Start file watcher
    startWatcher();
    console.log(`👁️  Watching content/posts/ folder...`);
});

module.exports = { app, server };
