const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs');
const Posts = require('./models/posts');

const POSTS_DIR = path.join(__dirname, '..', 'content', 'posts');

// Ensure posts directory exists
if (!fs.existsSync(POSTS_DIR)) {
    fs.mkdirSync(POSTS_DIR, { recursive: true });
}

// Lazy load activitypub to avoid circular dependency issues
function getActivityPub() {
    return require('./routes/activitypub');
}

function parsePostFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const stats = fs.statSync(filePath);

    // Extract metadata from HTML comments or frontmatter
    // Format: <!--
    // title: My Post Title
    // tags: tag1, tag2, tag3
    // -->
    // <article>...</article>

    let title = '';
    let tags = [];
    let excerpt = '';
    let htmlContent = content;

    const metadataMatch = content.match(/^<!--\s*\n?([\s\S]*?)\n?-->\s*/);
    if (metadataMatch) {
        const metadata = metadataMatch[1];

        const titleMatch = metadata.match(/^title:\s*(.+)$/m);
        if (titleMatch) title = titleMatch[1].trim();

        const tagsMatch = metadata.match(/^tags:\s*(.+)$/m);
        if (tagsMatch) {
            tags = tagsMatch[1].split(',').map(t => t.trim()).filter(t => t);
        }

        const excerptMatch = metadata.match(/^excerpt:\s*(.+)$/m);
        if (excerptMatch) excerpt = excerptMatch[1].trim();

        htmlContent = content.slice(metadataMatch[0].length).trim();
    }

    // If no title from comments, try to extract from HTML <title> tag
    if (!title) {
        const titleTagMatch = content.match(/<title>([^<]+)<\/title>/i);
        if (titleTagMatch) title = titleTagMatch[1].trim();
    }

    // If no excerpt from comments, try to extract from <div class="abstract">
    if (!excerpt) {
        const abstractMatch = content.match(/<div[^>]*class="abstract"[^>]*>([\s\S]*?)<\/div>/i);
        if (abstractMatch) {
            excerpt = abstractMatch[1].replace(/<[^>]+>/g, ' ').trim().slice(0, 200);
            if (abstractMatch[1].length > 200) excerpt += '...';
        }
    }

    // If no tags from comments, try to extract from <meta name="keywords">
    if (tags.length === 0) {
        const keywordsMatch = content.match(/<meta[^>]*name="keywords"[^>]*content="([^"]*)"[^>]*>/i);
        if (keywordsMatch) {
            tags = keywordsMatch[1].split(',').map(t => t.trim()).filter(t => t);
        }
    }

    // Derive slug from filename
    const slug = path.basename(filePath, '.html');

    // If no title, use slug
    if (!title) title = slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

    // If no excerpt, generate from content (first 200 chars)
    if (!excerpt) {
        const textContent = htmlContent.replace(/<[^>]+>/g, ' ').trim();
        excerpt = textContent.slice(0, 200);
        if (textContent.length > 200) excerpt += '...';
    }

    return {
        slug,
        title,
        content: htmlContent,
        excerpt,
        tags,
        filePath,
        fileMtime: stats.mtimeMs
    };
}

function scanExistingFiles() {
    console.log('[Watcher] Scanning existing files...');
    const files = fs.readdirSync(POSTS_DIR);
    files.forEach(file => {
        if (file.endsWith('.html')) {
            const filePath = path.join(POSTS_DIR, file);
            try {
                const post = parsePostFile(filePath);
                Posts.createOrUpdate(post);
                console.log(`[Watcher] Loaded existing post: ${post.slug}`);
            } catch (err) {
                console.error(`[Watcher] Error parsing ${filePath}:`, err.message);
            }
        }
    });
}

function startWatcher() {
    // First, scan existing files
    scanExistingFiles();

    // Watch the directory itself, not just specific files
    const watcher = chokidar.watch(POSTS_DIR, {
        ignored: /(^|[\/\\])\../,  // Ignore dotfiles
        persistent: true,
        ignoreInitial: true,
        depth: 0,  // Only watch the posts directory, not subdirectories
        awaitWriteFinish: {
            stabilityThreshold: 300,
            pollInterval: 100
        }
    });

    watcher
        .on('add', filePath => {
            // Only process .html files
            if (!filePath.endsWith('.html')) return;
            console.log(`[Watcher] Added: ${filePath}`);
            try {
                const post = parsePostFile(filePath);
                const slug = path.basename(filePath, '.html');
                const existing = Posts.getBySlug(slug);
                Posts.createOrUpdate(post);
                console.log(`[Watcher] Created/updated post: ${post.slug}`);
                
                // If post didn't exist, this is a new post - queue Create activity
                if (!existing) {
                    const activitypub = getActivityPub();
                    if (activitypub.queuePostCreate) {
                        const newPost = Posts.getBySlug(post.slug);
                        if (newPost) {
                            activitypub.queuePostCreate(newPost);
                            console.log(`[Watcher] Queued Create activity for: ${post.slug}`);
                        }
                    }
                }
            } catch (err) {
                console.error(`[Watcher] Error parsing ${filePath}:`, err.message);
            }
        })
        .on('change', filePath => {
            // Only process .html files
            if (!filePath.endsWith('.html')) return;
            console.log(`[Watcher] Changed: ${filePath}`);
            try {
                const post = parsePostFile(filePath);
                const slug = path.basename(filePath, '.html');
                const existing = Posts.getBySlug(slug);
                Posts.createOrUpdate(post);
                console.log(`[Watcher] Updated post: ${post.slug}`);
                
                // If post already existed, this is an edit - queue Update activity
                if (existing) {
                    const activitypub = getActivityPub();
                    if (activitypub.queuePostUpdate) {
                        const updatedPost = Posts.getBySlug(post.slug);
                        if (updatedPost) {
                            activitypub.queuePostUpdate(updatedPost);
                            console.log(`[Watcher] Queued Update activity for: ${post.slug}`);
                        }
                    }
                }
            } catch (err) {
                console.error(`[Watcher] Error parsing ${filePath}:`, err.message);
            }
        })
        .on('unlink', filePath => {
            // Only process .html files
            if (!filePath.endsWith('.html')) return;
            console.log(`[Watcher] Removed: ${filePath}`);
            const slug = path.basename(filePath, '.html');
            Posts.deleteBySlug(slug);
            console.log(`[Watcher] Deleted post: ${slug}`);
        })
        .on('ready', () => {
            console.log('[Watcher] Initial scan complete. Ready for changes...');
        })
        .on('error', error => console.error('[Watcher] Error:', error));

    return watcher;
}

// Manual sync function for testing
function syncPostFile(filePath) {
    console.log(`[Watcher] Manual sync: ${filePath}`);
    try {
        if (fs.existsSync(filePath)) {
            const post = parsePostFile(filePath);
            const slug = path.basename(filePath, '.html');
            const existing = Posts.getBySlug(slug);
            Posts.createOrUpdate(post);
            console.log(`[Watcher] Synced post: ${post.slug}`);
            
            if (existing) {
                // Post already existed, this is an edit - queue Update activity
                const activitypub = getActivityPub();
                if (activitypub.queuePostUpdate) {
                    const updatedPost = Posts.getBySlug(post.slug);
                    if (updatedPost) {
                        activitypub.queuePostUpdate(updatedPost);
                        console.log(`[Watcher] Queued Update activity for: ${post.slug}`);
                    }
                }
            } else {
                // Post didn't exist, this is new - queue Create activity
                const activitypub = getActivityPub();
                if (activitypub.queuePostCreate) {
                    const newPost = Posts.getBySlug(post.slug);
                    if (newPost) {
                        activitypub.queuePostCreate(newPost);
                        console.log(`[Watcher] Queued Create activity for: ${post.slug}`);
                    }
                }
            }
            
            return post;
        } else {
            const slug = path.basename(filePath, '.html');
            Posts.deleteBySlug(slug);
            console.log(`[Watcher] Deleted post (file not found): ${slug}`);
        }
    } catch (err) {
        console.error(`[Watcher] Error syncing ${filePath}:`, err.message);
    }
}

module.exports = { startWatcher, parsePostFile, syncPostFile, scanExistingFiles };
