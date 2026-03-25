const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const path = require('path');
const fs = require('fs');
const { DOMAIN, USERNAME, PORT, BASE_URL, BLOG_PATH, BLOG_ROOT, ACTOR_URL, USER } = require('./config');
const Posts = require('./models/posts');
const { startWatcher, syncPostFile, scanExistingFiles } = require('./watcher');
const activitypubRoutes = require('./routes/activitypub');
const { getRSS } = require('./rss');
const { postUrl, postLikesUrl, postSharesUrl, postRepliesUrl, tagUrl } = require('./urls');
const db = require('./db');

const DEBUG_AP = process.env.DEBUG_AP === 'true' || process.env.DEBUG_AP === '1';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

const app = express();

// Setup view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

// Body parsing - for ActivityPub we need raw body for signature verification
app.use(express.json({
    type: req => {
        const ct = req.headers['content-type'] || '';
        return ct.includes('application/json') ||
               ct.includes('application/activity+json') ||
               ct.includes('application/ld+json');
    },
    verify: (req, res, buf) => {
        req.rawBody = buf;
    }
}));

app.use(express.urlencoded({ extended: true }));

// Debug logging for ActivityPub requests
if (DEBUG_AP) {
    app.use((req, res, next) => {
        console.log('\n[Server] ========== REQUEST START ==========');
        console.log('[Server] Time:', new Date().toISOString());
        console.log('[Server] Method:', req.method);
        console.log('[Server] URL:', req.originalUrl);
        console.log('[Server] Path:', req.path);
        console.log('[Server] Host:', req.get('Host'));
        console.log('[Server] Content-Type:', req.get('Content-Type'));
        console.log('[Server] Content-Length:', req.get('Content-Length'));
        console.log('[Server] User-Agent:', req.get('User-Agent'));
        console.log('[Server] =========================================');
        next();
    });
}

// WebFinger - MUST be at root for federation discovery
function localhostOnly(req, res, next) {
    // In test mode, allow all requests (for Playwright tests)
    if (process.env.NODE_ENV === 'test') {
        return next();
    }
    
    const remoteAddress = req.connection.remoteAddress || 
                          req.socket.remoteAddress || 
                          req.ip;
    
    // Check if request is from localhost
    const isLocalhost = remoteAddress === '127.0.0.1' || 
                        remoteAddress === '::1' || 
                        remoteAddress === '::ffff:127.0.0.1' ||
                        remoteAddress === 'localhost';
    
    if (!isLocalhost) {
        console.warn(`[Security] Blocked request from non-localhost IP: ${remoteAddress}`);
        return res.status(403).json({ error: 'Forbidden - Localhost only' });
    }
    
    next();
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
        links: [
            {
                rel: 'self',
                type: 'application/activity+json',
                href: ACTOR_URL
            },
            {
                rel: 'http://webfinger.net/rel/profile-page',
                type: 'text/html',
                href: ACTOR_URL
            }
        ]
    });
});

// Frontend routes - mounted at BLOG_PATH
// All ActivityPub endpoints are also under BLOG_PATH
const blog = express.Router();

// Static files under BLOG_PATH
blog.use('/static', express.static(path.join(__dirname, '..', 'public')));
blog.use('/pfp.png', express.static(path.join(__dirname, '..', 'public', 'pfp.png')));
blog.use('/static.css', express.static(path.join(__dirname, '..', 'public', 'static.css')));

// API routes under BLOG_PATH (localhost only in production, always available in test)
if (process.env.NODE_ENV === 'test' || process.env.ENABLE_TEST_API) {
    blog.use('/api', localhostOnly);

    blog.post('/api/sync-post', express.json(), (req, res) => {
    const { filename } = req.body;
    if (!filename) {
        return res.status(400).json({ error: 'Filename required' });
    }
    
    // Extract and validate slug from filename
    const slug = filename.replace(/\.html$/, '');
    const Posts = require('./models/posts');
    const slugValidation = Posts.isValidSlug(slug);
    if (!slugValidation.valid) {
        return res.status(400).json({ success: false, error: `Invalid slug: ${slugValidation.error}` });
    }
    
    const filePath = path.join(__dirname, '..', 'content', 'posts', filename);
    try {
        const post = syncPostFile(filePath);
        if (post) {
            res.json({ success: true, post });
        } else {
            res.status(404).json({ success: false, error: 'File not found' });
        }
    } catch (err) {
        if (err.message.startsWith('Invalid slug:')) {
            return res.status(400).json({ success: false, error: err.message });
        }
        console.error('[API] Error syncing post:', err.message);
        res.status(500).json({ success: false, error: 'Internal error' });
    }
});

blog.post('/api/scan-posts', (req, res) => {
    scanExistingFiles();
    res.json({ success: true });
});

blog.post('/api/add-follower', (req, res) => {
    const { actor_id, actor_url, inbox_url } = req.body;
    if (!actor_id || !inbox_url) {
        return res.status(400).json({ error: 'actor_id and inbox_url required' });
    }

    try {
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO followers (actor_id, actor_url, inbox_url, followed_at)
            VALUES (?, ?, ?, ?)
        `);
        stmt.run(actor_id, actor_url || actor_id, inbox_url, new Date().toISOString());
        res.json({ success: true, message: 'Follower added' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

blog.post('/api/remove-follower', (req, res) => {
    const { actor_id } = req.body;
    if (!actor_id) {
        return res.status(400).json({ error: 'actor_id required' });
    }

    try {
        const stmt = db.prepare('DELETE FROM followers WHERE actor_id = ?');
        stmt.run(actor_id);
        res.json({ success: true, message: 'Follower removed' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

blog.get('/api/outbound-activities', (req, res) => {
    try {
        const stmt = db.prepare(`
            SELECT * FROM outbound_activities
            ORDER BY created_at DESC
            LIMIT 50
        `);
        const activities = stmt.all();
        res.json({ activities });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

blog.post('/api/clear-outbound-activities', (req, res) => {
    try {
        db.prepare('DELETE FROM outbound_activities').run();
        res.json({ success: true, message: 'Outbound activities cleared' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

blog.post('/api/sync-user-settings', (req, res) => {
    try {
        const watcher = require('./watcher');
        if (watcher.syncUserSettings) {
            watcher.syncUserSettings();
            res.json({ success: true, message: 'User settings synced' });
        } else {
            res.status(500).json({ error: 'syncUserSettings not available' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

blog.post('/api/sync-pinned', (req, res) => {
    try {
        const watcher = require('./watcher');
        if (watcher.syncPinnedFile) {
            watcher.syncPinnedFile();
            res.json({ success: true, message: 'Pinned file synced' });
        } else {
            res.status(500).json({ error: 'syncPinnedFile not available' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
} // end of API routes conditional

// RSS feed under BLOG_PATH
blog.get('/rss', (req, res) => {
    res.set('Content-Type', 'application/rss+xml; charset=utf-8');
    res.send(getRSS());
});

// Home page
blog.get('/', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const offset = (page - 1) * limit;
    
    const posts = Posts.getAll(limit, offset);
    const totalPosts = Posts.count();
    const totalPages = Math.ceil(totalPosts / limit);
    const tags = Posts.getTags();
    const months = Posts.getMonths();
    
    const pinned = Posts.getPinned();
    const pinnedSlugs = new Set(pinned.map(p => p.slug));
    
    res.render('index', {
        title: USER.name,
        posts,
        tags,
        months,
        pinnedSlugs: [...pinnedSlugs],
        blogPath: BLOG_PATH,
        blogRoot: BLOG_ROOT,
        user: USER,
        pagination: {
            current: page,
            total: totalPages,
            hasNext: page < totalPages,
            hasPrev: page > 1
        }
    });
});

// Embeddable "new posts" endpoint - MUST be before /:slug
blog.get('/new', (req, res) => {
    const requestedCount = parseInt(req.query.n) || 2;
    const count = Math.max(1, Math.min(requestedCount, 10)); // Clamp between 1 and 10
    
    const pinned = Posts.getPinned();
    const pinnedSlugs = new Set(pinned.map(p => p.slug));
    
    const recent = Posts.getAll(count + pinned.length, 0);
    const nonPinned = recent.filter(p => !pinnedSlugs.has(p.slug));
    
    const posts = [...pinned, ...nonPinned].slice(0, count);
    
    res.render('embed', {
        title: `${USER.name} - Latest Posts`,
        posts,
        pinnedSlugs: [...pinnedSlugs],
        blogPath: BLOG_PATH,
        blogRoot: BLOG_ROOT,
        user: USER,
        layout: false
    });
});

// Archive - MUST be before /:slug
blog.get('/archive/:year/:month', (req, res) => {
    const year = parseInt(req.params.year);
    const month = parseInt(req.params.month);
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const offset = (page - 1) * limit;
    
    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
        return res.status(400).render('error', {
            title: 'Invalid Date',
            message: 'Invalid year or month'
        });
    }
    
    const posts = Posts.getByMonth(year, month, limit, offset);
    const totalPosts = Posts.countByMonth(year, month);
    const totalPages = Math.ceil(totalPosts / limit);
    const tags = Posts.getTags();
    const months = Posts.getMonths();
    
    const pinned = Posts.getPinned();
    const pinnedSlugs = pinned.map(p => p.slug);
    
    res.render('archive', {
        title: `${MONTH_NAMES[month - 1]} ${year} - ${USER.name}`,
        posts,
        tags,
        months,
        pinnedSlugs,
        currentYear: year,
        currentMonth: month,
        monthName: MONTH_NAMES[month - 1],
        blogPath: BLOG_PATH,
        blogRoot: BLOG_ROOT,
        user: USER,
        pagination: {
            current: page,
            total: totalPages,
            hasNext: page < totalPages,
            hasPrev: page > 1
        }
    });
});

// Tag page - MUST be before /:slug
blog.get('/tag/:tag', (req, res) => {
    const tag = req.params.tag;
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const offset = (page - 1) * limit;
    
    let posts, totalPosts;
    
    if (tag === 'pinned') {
        const pinned = Posts.getPinned();
        posts = pinned.slice(offset, offset + limit);
        totalPosts = pinned.length;
    } else {
        posts = Posts.getByTag(tag, limit, offset);
        totalPosts = Posts.countByTag(tag);
    }
    
    const totalPages = Math.ceil(totalPosts / limit);
    const allTags = Posts.getTags();
    const months = Posts.getMonths();
    const pinnedSlugs = Posts.getPinned().map(p => p.slug);
    
    res.render('tag', {
        title: `Tag: ${tag} - ${USER.name}`,
        posts,
        tags: allTags,
        months,
        currentTag: tag,
        pinnedSlugs,
        blogPath: BLOG_PATH,
        blogRoot: BLOG_ROOT,
        user: USER,
        pagination: {
            current: page,
            total: totalPages,
            hasNext: page < totalPages,
            hasPrev: page > 1
        }
    });
});

// Mount ActivityPub routes (u/:username, etc.) BEFORE /:slug
blog.use(activitypubRoutes);

// Post page (HTML or ActivityPub JSON) - MUST be last (catch-all for single segment paths)
blog.get('/:slug', (req, res, next) => {
    const post = Posts.getBySlug(req.params.slug);
    
    if (!post) {
        // Check if request wants ActivityPub JSON
        const accept = req.headers.accept || '';
        if (accept.includes('application/activity+json') || accept.includes('application/ld+json')) {
            return res.status(404).json({ error: 'Post not found' });
        }
        return res.status(404).render('404', {
            title: 'Not Found',
            blogPath: BLOG_PATH,
            blogRoot: BLOG_ROOT,
            user: USER
        });
    }
    
    // Check if request wants ActivityPub JSON
    const accept = req.headers.accept || '';
    if (accept.includes('application/activity+json') || accept.includes('application/ld+json')) {
        // Return ActivityPub JSON representation
        const article = {
            '@context': ['https://www.w3.org/ns/activitystreams', 'https://w3id.org/security/v1'],
            id: postUrl(post.slug),
            type: 'Article',
            attributedTo: ACTOR_URL,
            name: post.title,
            content: post.content,
            published: post.published_at,
            updated: post.updated_at,
            url: postUrl(post.slug),
            to: ['https://www.w3.org/ns/activitystreams#Public'],
            cc: [USER.followers],
            tag: post.tags.map(tag => ({
                type: 'Hashtag',
                name: `#${tag}`,
                href: tagUrl(tag)
            })),
            likes: {
                id: postLikesUrl(post.slug),
                type: 'OrderedCollection',
                totalItems: post.likes_count || 0
            },
            shares: {
                id: postSharesUrl(post.slug),
                type: 'OrderedCollection',
                totalItems: post.shares_count || 0
            },
            replies: {
                id: postRepliesUrl(post.slug),
                type: 'Collection',
                totalItems: post.comments_count || 0
            }
        };
        
        res.set('Content-Type', 'application/activity+json');
        return res.json(article);
    }
    
    // Return HTML page
    const comments = Posts.getComments(post.id);
    const likes = Posts.getLikes(post.id);
    const shares = Posts.getShares(post.id);
    const pinned = Posts.getPinned();
    const isPinned = pinned.some(p => p.slug === post.slug);
    
    res.render('post', {
        title: `${post.title} - ${USER.name}`,
        post,
        comments,
        likes,
        shares,
        isPinned: isPinned,
        blogPath: BLOG_PATH,
        blogRoot: BLOG_ROOT,
        user: USER,
        activityPubId: postUrl(post.slug)
    });
});

// Mount blog router at BLOG_PATH
app.use(BLOG_PATH || '/', blog);

// Error handler
app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).render('500', {
        title: 'Server Error',
        blogRoot: BLOG_ROOT,
        user: USER
    });
});

//404 handler
app.use((req, res) => {
    res.status(404).render('404', {
        title: 'Not Found',
        blogPath: BLOG_PATH,
        blogRoot: BLOG_ROOT,
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
