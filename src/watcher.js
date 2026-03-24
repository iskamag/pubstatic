const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs');
const Posts = require('./models/posts');
const { updateRSSFile } = require('./rss');

const POSTS_DIR = path.join(__dirname, '..', 'content', 'posts');
const USER_SETTINGS_FILE = path.join(__dirname, '..', 'user-settings.json');
const PFP_FILE = path.join(__dirname, '..', 'public', 'pfp.png');

// Ensure posts directory exists
if (!fs.existsSync(POSTS_DIR)) {
    fs.mkdirSync(POSTS_DIR, { recursive: true });
}

// Escape string for use in regex
function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Update RSS feed - now uses shared rss module with caching
function updateRSS() {
    updateRSSFile();
}

// Lazy load activitypub to avoid circular dependency issues
function getActivityPub() {
    return require('./routes/activitypub');
}

// Load user settings from JSON file
function loadUserSettings() {
    try {
        if (fs.existsSync(USER_SETTINGS_FILE)) {
            return JSON.parse(fs.readFileSync(USER_SETTINGS_FILE, 'utf8'));
        }
    } catch (err) {
        console.error('[Watcher] Error loading user settings:', err.message);
    }
    return {};
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

    // For complete HTML documents (like rc.html), extract just the body content
    // and remove duplicate title elements
    if (htmlContent.includes('<html') || htmlContent.includes('<!DOCTYPE')) {
        // Extract body content
        const bodyMatch = htmlContent.match(/<body[^>]*>([\s\S]*)<\/body>/i);
        if (bodyMatch) {
            htmlContent = bodyMatch[1].trim();
        }
        
        // Remove <h1 class="title"> or the first <h1> if it matches the post title
        if (title) {
            // Remove h1 with class="title" that contains the title text
            const h1TitleRegex = new RegExp(`<h1[^>]*class=["']title["'][^>]*>[\\s\\S]*?${escapeRegex(title)}[\\s\\S]*?<\\/h1>`, 'i');
            htmlContent = htmlContent.replace(h1TitleRegex, '');
            
            // Also remove any h1 that exactly matches the title
            const exactH1Regex = new RegExp(`<h1[^>]*>\\s*${escapeRegex(title)}\\s*<\\/h1>`, 'i');
            htmlContent = htmlContent.replace(exactH1Regex, '');
        }
        
        // Clean up any empty lines left behind
        htmlContent = htmlContent.replace(/\n\s*\n/g, '\n').trim();
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
    // Update RSS feed after scanning all files
    updateRSS();
}

function handleUserSettingsChange() {
    console.log('[Watcher] User settings or profile picture changed');
    try {
        const userSettings = loadUserSettings();
        
        // Determine avatar URL - use USER.icon which already handles BLOG_PATH
        const { USERNAME, USER } = require('./config');
        let avatarUrl = userSettings.avatar_url || USER.icon;
        
        // Queue actor update for federation
        const activitypub = getActivityPub();
        if (activitypub.queueActorUpdate) {
            activitypub.queueActorUpdate({
                preferredUsername: USERNAME,
                name: userSettings.display_name || USER.name,
                summary: userSettings.bio || USER.summary,
                icon: avatarUrl
            });
            console.log('[Watcher] Queued actor Update activity for profile change');
        }
    } catch (err) {
        console.error('[Watcher] Error handling user settings change:', err.message);
    }
}

function startWatcher() {
    // First, scan existing files
    scanExistingFiles();

    // Watch the posts directory
    const postsWatcher = chokidar.watch(POSTS_DIR, {
        ignored: /(^|[\\/])\../,  // Ignore dotfiles
        persistent: true,
        ignoreInitial: true,
        depth: 0,  // Only watch the posts directory, not subdirectories
        awaitWriteFinish: {
            stabilityThreshold: 300,
            pollInterval: 100
        }
    });

    // Watch user settings file (which may not exist initially)
    const settingsWatcher = chokidar.watch(USER_SETTINGS_FILE, {
        persistent: true,
        ignoreInitial: false,  // Process existing file on startup
        awaitWriteFinish: {
            stabilityThreshold: 300,
            pollInterval: 100
        }
    });

    postsWatcher
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
                
                // If post didn't exist, this is a new post - queue Create activity and update RSS
                if (!existing) {
                    const activitypub = getActivityPub();
                    if (activitypub.queuePostCreate) {
                        const newPost = Posts.getBySlug(post.slug);
                        if (newPost) {
                            activitypub.queuePostCreate(newPost);
                            console.log(`[Watcher] Queued Create activity for: ${post.slug}`);
                        }
                    }
                    // Update RSS feed
                    updateRSS();
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
                
                // If post already existed, this is an edit - queue Update activity and update RSS
                if (existing) {
                    const activitypub = getActivityPub();
                    if (activitypub.queuePostUpdate) {
                        const updatedPost = Posts.getBySlug(post.slug);
                        if (updatedPost) {
                            activitypub.queuePostUpdate(updatedPost);
                            console.log(`[Watcher] Queued Update activity for: ${post.slug}`);
                        }
                    }
                    // Update RSS feed
                    updateRSS();
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
            // Update RSS feed after deletion
            updateRSS();
        })
        .on('ready', () => {
            console.log('[Watcher] Initial scan complete. Ready for changes...');
        })
        .on('error', error => console.error('[Watcher] Error:', error));

    // Handle user settings changes (only add and change, not unlink)
    settingsWatcher
        .on('add', filePath => {
            if (filePath === USER_SETTINGS_FILE) {
                handleUserSettingsChange();
            }
        })
        .on('change', filePath => {
            if (filePath === USER_SETTINGS_FILE) {
                handleUserSettingsChange();
            }
        })
        .on('error', error => console.error('[Watcher] Settings watcher error:', error));

    return { postsWatcher, settingsWatcher };
}

// Manual sync function for user settings (for testing)
function syncUserSettings() {
    console.log('[Watcher] Manual sync of user settings');
    handleUserSettingsChange();
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

            // Update RSS feed
            updateRSS();

            return post;
        } else {
            const slug = path.basename(filePath, '.html');
            Posts.deleteBySlug(slug);
            console.log(`[Watcher] Deleted post (file not found): ${slug}`);
            // Update RSS feed after deletion
            updateRSS();
        }
    } catch (err) {
        console.error(`[Watcher] Error syncing ${filePath}:`, err.message);
    }
}

module.exports = { startWatcher, parsePostFile, syncPostFile, scanExistingFiles, syncUserSettings };
