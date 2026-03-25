const express = require('express');
const crypto = require('crypto');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');
const { DOMAIN, USERNAME, ACTOR_URL, BASE_URL, BLOG_ROOT, USER, RATE_LIMIT } = require('../config');
const { postUrl, postLikesUrl, postSharesUrl, postRepliesUrl, tagUrl } = require('../urls');
const Posts = require('../models/posts');
const db = require('../db');
const { marked } = require('marked');

const router = express.Router();

const DEBUG_AP = process.env.DEBUG_AP === 'true' || process.env.DEBUG_AP === '1';

const FETCH_TIMEOUT = 10000; // 10 seconds

async function fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timeout);
    }
}

// Rate limiting for inbox endpoint
const inboxRateLimits = new Map(); // IP -> { count, resetTime }

function checkInboxRateLimit(req) {
    // Skip rate limiting if disabled
    if (!RATE_LIMIT.enabled) {
        return { allowed: true, remaining: Infinity };
    }
    
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = inboxRateLimits.get(ip);
    
    if (!entry || now > entry.resetTime) {
        inboxRateLimits.set(ip, { count: 1, resetTime: now + RATE_LIMIT.windowMs });
        return { allowed: true, remaining: RATE_LIMIT.maxRequests - 1 };
    }
    
    if (entry.count >= RATE_LIMIT.maxRequests) {
        return { 
            allowed: false, 
            remaining: 0,
            resetTime: entry.resetTime 
        };
    }
    
    entry.count++;
    return { allowed: true, remaining: RATE_LIMIT.maxRequests - entry.count };
}

// Clean up expired rate limit entries periodically
if (RATE_LIMIT.enabled) {
    setInterval(() => {
        const now = Date.now();
        for (const [ip, entry] of inboxRateLimits) {
            if (now > entry.resetTime) {
                inboxRateLimits.delete(ip);
            }
        }
    }, RATE_LIMIT.windowMs * 5); // Clean up every 5 windows
}

const KEYS_FILE = path.join(__dirname, '..', '..', 'data', 'keys.json');
const USER_SETTINGS_FILE = path.join(__dirname, '..', '..', 'user-settings.json');
const PFP_FILE = path.join(__dirname, '..', '..', 'public', 'pfp.png');

// Load user settings from JSON file
function loadUserSettings() {
    try {
        if (fs.existsSync(USER_SETTINGS_FILE)) {
            const settings = JSON.parse(fs.readFileSync(USER_SETTINGS_FILE, 'utf8'));
            return settings;
        }
    } catch (err) {
        console.error('[ActivityPub] Error loading user settings:', err.message);
    }
    return {};
}

// Escape string for use in regex
function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildArticleObject(post, counts = {}) {
    return {
        id: postUrl(post.slug),
        type: 'Article',
        attributedTo: ACTOR_URL,
        content: post.content,
        name: post.title,
        published: post.published_at,
        updated: post.updated_at,
        url: postUrl(post.slug),
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        cc: [USER.followers],
        likes: {
            id: postLikesUrl(post.slug),
            type: 'OrderedCollection',
            totalItems: counts.likes ?? post.likes_count ?? 0
        },
        shares: {
            id: postSharesUrl(post.slug),
            type: 'OrderedCollection',
            totalItems: counts.shares ?? post.shares_count ?? 0
        },
        tag: post.tags.map(tag => ({
            type: 'Hashtag',
            name: `#${tag}`,
            href: tagUrl(tag)
        }))
    };
}

const SKIP_PATHS = new Set(['u', 'tag', 'archive', 'static', 'rss', 'new', 'likes', 'shares', 'replies']);

function extractSlugFromUrl(objectUrl) {
    try {
        const urlObj = new URL(objectUrl);
        const pathParts = urlObj.pathname.split('/').filter(p => p);
        for (let i = pathParts.length - 1; i >= 0; i--) {
            const segment = pathParts[i];
            if (segment && !SKIP_PATHS.has(segment) && !segment.match(/^\d{4}$/)) {
                const post = Posts.getBySlug(segment);
                if (post) return { slug: segment, post };
            }
        }
    } catch (e) {
        console.error('[ActivityPub] Invalid object URL:', objectUrl);
    }
    return null;
}

// Load or generate keys
function loadOrGenerateKeys() {
    // Try to load existing keys
    if (fs.existsSync(KEYS_FILE)) {
        try {
            const saved = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
            console.log('[ActivityPub] Loaded existing keys');
            return {
                publicKey: saved.publicKey,
                privateKey: saved.privateKey
            };
        } catch (err) {
            console.error('[ActivityPub] Error loading keys:', err.message);
        }
    }
    
    // Generate new keys
    const keys = crypto.generateKeyPairSync('rsa', {
        modulusLength: 4096,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    
    // Save keys
    try {
        fs.writeFileSync(KEYS_FILE, JSON.stringify({
            publicKey: keys.publicKey,
            privateKey: keys.privateKey
        }));
        console.log('[ActivityPub] Generated and saved new keys');
    } catch (err) {
        console.error('[ActivityPub] Error saving keys:', err.message);
    }
    
    return keys;
}

const keys = loadOrGenerateKeys();

// Sanitize HTML to prevent XSS
function sanitizeHtml(html) {
    return html
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;');
}

// Convert markdown to safe HTML
function processActivityPubContent(note) {
    let content = note.content || note.name || '';
    
    // If content looks like markdown (no HTML tags), convert it
    if (content && !/<[a-z][\s\S]*>/i.test(content)) {
        content = marked.parse(content);
    }
    
    // Sanitize HTML - remove dangerous elements but allow media
    content = content
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/on\w+\s*=\s*"[^"]*"/gi, '')
        .replace(/on\w+\s*=\s*'[^']*'/gi, '')
        .replace(/javascript:/gi, '');
    
    // Process attachments (images, videos, audio)
    if (note.attachment && Array.isArray(note.attachment)) {
        for (const attachment of note.attachment) {
            const url = typeof attachment.url === 'string' ? attachment.url : (attachment.url?.href || attachment.href);
            if (!url) continue;
            
            const mediaType = attachment.mediaType || '';
            const name = attachment.name || attachment.summary || '';
            
            if (attachment.type === 'Image' || mediaType.startsWith('image/') || url.match(/\.(jpg|jpeg|png|gif|webp|svg|avif)/i)) {
                content += `<img src="${escapeHtml(url)}" alt="${escapeHtml(name)}" class="ap-image">`;
            } else if (attachment.type === 'Video' || mediaType.startsWith('video/') || url.match(/\.(mp4|webm|ogg|mov)/i)) {
                content += `<video controls class="ap-video"><source src="${escapeHtml(url)}"></video>`;
            } else if (attachment.type === 'Audio' || mediaType.startsWith('audio/') || url.match(/\.(mp3|ogg|wav|flac|m4a)/i)) {
                content += `<audio controls class="ap-audio"><source src="${escapeHtml(url)}"></audio>`;
            }
        }
    }
    
    return content;
}

function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}

function isValidActorUrl(url) {
    try {
        const parsed = new URL(url);
        // Only allow HTTP/HTTPS
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return false;
        }
        // Block internal hostnames
        const hostname = parsed.hostname.toLowerCase();
        // Block localhost variants
        if (hostname === 'localhost' || hostname === 'localhost.localdomain' || hostname === '127.0.0.1' || hostname === '::1') {
            return false;
        }
        // Block .local, .internal, .localhost TLDs and subdomains
        if (hostname.endsWith('.local') || hostname.endsWith('.internal') || hostname.endsWith('.localhost')) {
            return false;
        }
        // Block internal domain names
        if (hostname.includes('.internal.') || hostname.startsWith('internal.') || hostname === 'internal') {
            return false;
        }
        // Block IP-based URLs that could point to internal resources
        const ipMatch = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
        if (ipMatch) {
            const octets = [parseInt(ipMatch[1]), parseInt(ipMatch[2]), parseInt(ipMatch[3]), parseInt(ipMatch[4])];
            // Block loopback (127.x.x.x)
            if (octets[0] === 127) return false;
            // Block private ranges
            if (octets[0] === 10) return false; // 10.0.0.0/8
            if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return false; // 172.16.0.0/12
            if (octets[0] === 192 && octets[1] === 168) return false; // 192.168.0.0/16
            // Block link-local (169.254.0.0/16 - AWS/Azure/GCP metadata)
            if (octets[0] === 169 && octets[1] === 254) return false;
            // Block broadcast
            if (octets[0] === 0 || (octets[0] === 255 && octets[1] === 255 && octets[2] === 255 && octets[3] === 255)) return false;
        }
        // Block IPv6 addresses (bracket notation like [::1] or [fe80::1])
        if (hostname.startsWith('[') && hostname.endsWith(']')) {
            return false; // Block all IPv6 addresses for simplicity
        }
        // Block plain IPv6 addresses
        if (hostname.includes(':')) {
            return false;
        }
        return true;
    } catch (e) {
        return false;
    }
}

// Actor endpoint
router.get('/u/:username', (req, res) => {
    if (req.params.username !== USERNAME) {
        return res.status(404).json({ error: 'Actor not found' });
    }
    
    // Load user settings from JSON file
    const userSettings = loadUserSettings();
    
    // Determine avatar URL: use settings override, or USER.icon (which includes BLOG_PATH)
    let avatarUrl = userSettings.avatar_url || USER.icon;
    
    const actor = {
        '@context': [
            'https://www.w3.org/ns/activitystreams',
            'https://w3id.org/security/v1'
        ],
        id: ACTOR_URL,
        type: 'Person',
        preferredUsername: USER.preferredUsername,
        name: userSettings.display_name || USER.name,
        summary: userSettings.bio || USER.summary,
        url: ACTOR_URL,
        inbox: USER.inbox,
        outbox: USER.outbox,
        followers: USER.followers,
        following: USER.following,
        published: USER.published || new Date().toISOString(),
        publicKey: {
            id: `${ACTOR_URL}#main-key`,
            owner: ACTOR_URL,
            publicKeyPem: keys.publicKey
        }
    };
    
    if (avatarUrl) {
        actor.icon = {
            type: 'Image',
            mediaType: 'image/png',
            url: avatarUrl
        };
    }
    
    res.set('Content-Type', 'application/activity+json');
    res.json(actor);
});

// Outbox - list of posts
router.get('/u/:username/outbox', (req, res) => {
    if (req.params.username !== USERNAME) {
        return res.status(404).json({ error: 'Actor not found' });
    }
    
    const posts = Posts.getAll(20, 0);
    const orderedItems = posts.map(post => ({
        id: `${postUrl(post.slug)}#activity`,
        type: 'Create',
        actor: ACTOR_URL,
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        cc: [USER.followers],
        object: buildArticleObject(post)
    }));
    
    res.set('Content-Type', 'application/activity+json');
    res.json({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: USER.outbox,
        type: 'OrderedCollection',
        totalItems: orderedItems.length,
        orderedItems
    });
});

// Inbox - receive activities
router.post('/u/:username/inbox', async (req, res) => {
    if (DEBUG_AP) {
        console.log('\n[ActivityPub] ========== INCOMING REQUEST ==========');
        console.log('[ActivityPub] Timestamp:', new Date().toISOString());
        console.log('[ActivityPub] Method:', req.method);
        console.log('[ActivityPub] URL:', req.originalUrl);
        console.log('[ActivityPub] Content-Type:', req.get('Content-Type'));
        console.log('[ActivityPub] Body:', JSON.stringify(req.body).substring(0, 500));
    }
    
    // Check username
    if (req.params.username !== USERNAME) {
        console.log('[ActivityPub] REJECTED: Username mismatch. Expected:', USERNAME, 'Got:', req.params.username);
        return res.status(404).json({ error: 'Actor not found' });
    }
    
    // Rate limiting
    const rateLimit = checkInboxRateLimit(req);
    if (!rateLimit.allowed) {
        console.warn('[ActivityPub] Rate limit exceeded for IP:', req.ip || req.connection.remoteAddress);
        return res.status(429).json({ error: 'Too many requests' });
    }
    
    try {
        const activity = req.body;
        
        if (!activity || !activity.type) {
            console.log('[ActivityPub] ERROR: Invalid activity - missing type');
            return res.status(400).json({ error: 'Invalid activity: missing type' });
        }
        
        if (DEBUG_AP) {
            console.log('[ActivityPub] Activity type:', activity.type);
            console.log('[ActivityPub] Actor:', typeof activity.actor === 'string' ? activity.actor : JSON.stringify(activity.actor));
        }
        
        // Verify HTTP Signature for all activities (skip rejection in test mode)
        let verifiedActorId = null;
        if (process.env.NODE_ENV !== 'test') {
            try {
                const sigVerify = await verifyHttpSignature(req);
                if (!sigVerify.valid) {
                    console.warn('[ActivityPub] Signature verification failed:', sigVerify.error);
                    return res.status(401).json({ error: 'Invalid signature' });
                }
                verifiedActorId = sigVerify.actor?.id;
            } catch (sigErr) {
                console.warn('[ActivityPub] Signature verification error:', sigErr.message);
                return res.status(401).json({ error: 'Signature verification failed' });
            }
        } else {
            // Test mode: verify but only warn on failure
            try {
                const sigVerify = await verifyHttpSignature(req);
                if (!sigVerify.valid) {
                    console.warn('[ActivityPub] TEST MODE: Signature verification failed (not rejecting):', sigVerify.error);
                } else {
                    verifiedActorId = sigVerify.actor?.id;
                }
            } catch (sigErr) {
                console.warn('[ActivityPub] TEST MODE: Signature verification error (not rejecting):', sigErr.message);
            }
        }
        
        // Verify actor matches signature (in production)
        if (verifiedActorId) {
            const activityActorId = typeof activity.actor === 'string' ? activity.actor : activity.actor?.id;
            if (activityActorId && activityActorId !== verifiedActorId) {
                console.warn(`[ActivityPub] Actor mismatch: activity claims ${activityActorId}, signature verified ${verifiedActorId}`);
                if (process.env.NODE_ENV !== 'test') {
                    return res.status(401).json({ error: 'Actor does not match signature' });
                }
            }
        }
        
        // Handle Follow requests after signature verification
        if (activity.type === 'Follow') {
            console.log('[ActivityPub] Processing Follow request');
            try {
                await handleFollow(activity);
                return res.status(202).json({ status: 'accepted' });
            } catch (followErr) {
                console.error('[ActivityPub] Error handling Follow:', followErr.message);
                return res.status(500).json({ error: 'Internal server error' });
            }
        }
        
        // Store activity
        const activityId = activity.id || `${BLOG_ROOT}/activities/${Date.now()}`;
        const existingActivity = db.prepare('SELECT id FROM activities WHERE activity_id = ?').get(activityId);
        
        if (existingActivity) {
            if (DEBUG_AP) console.log('[ActivityPub] Activity already processed, skipping');
            return res.status(202).json({ status: 'accepted' });
        }
        
        const stmt = db.prepare(`
            INSERT INTO activities (activity_id, type, actor, object, target, received_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        stmt.run(
            activityId,
            activity.type,
            typeof activity.actor === 'string' ? activity.actor : JSON.stringify(activity.actor),
            typeof activity.object === 'string' ? activity.object : JSON.stringify(activity.object),
            activity.target ? JSON.stringify(activity.target) : null,
            new Date().toISOString()
        );
        if (DEBUG_AP) console.log('[ActivityPub] Activity stored');
        
        // Process activity
        switch (activity.type) {
            case 'Like':
                if (DEBUG_AP) console.log('[ActivityPub] Handling Like');
                await handleLike(activity);
                break;
            case 'Announce':
                if (DEBUG_AP) console.log('[ActivityPub] Handling Announce');
                await handleAnnounce(activity);
                break;
            case 'Create':
                if (DEBUG_AP) console.log('[ActivityPub] Handling Create');
                if (activity.object && activity.object.type === 'Note') {
                    await handleComment(activity);
                }
                break;
            case 'Undo':
                if (DEBUG_AP) console.log('[ActivityPub] Handling Undo');
                await handleUndo(activity);
                break;
            default:
                if (DEBUG_AP) console.log('[ActivityPub] Unknown activity type:', activity.type);
        }
        
        res.status(202).json({ status: 'accepted' });
    } catch (err) {
        console.error('[ActivityPub] Error processing inbox:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

async function handleReaction(activity, tableName) {
    const objectUrl = typeof activity.object === 'string' ? activity.object : activity.object.id;
    const result = extractSlugFromUrl(objectUrl);
    if (!result) return;

    const actorId = typeof activity.actor === 'string' ? activity.actor : activity.actor.id;

    try {
        const stmt = db.prepare(`
            INSERT OR IGNORE INTO ${tableName} (post_id, actor_id, actor_url, created_at, activity_id)
            VALUES (?, ?, ?, ?, ?)
        `);
        stmt.run(result.post.id, actorId, actorId, new Date().toISOString(), activity.id);
        console.log(`[ActivityPub] Added ${tableName} from ${actorId} on ${result.slug}`);
    } catch (err) {
        console.error(`[ActivityPub] Error handling ${tableName}:`, err.message);
    }
}

async function handleLike(activity) {
    await handleReaction(activity, 'likes');
}

async function handleAnnounce(activity) {
    await handleReaction(activity, 'shares');
}

async function handleComment(activity) {
    const note = activity.object;
    if (!note.inReplyTo) {
        console.log('[ActivityPub] Comment missing inReplyTo, skipping');
        return;
    }
    
    // Log the Note ID we're storing (for replies to match against)
    const noteId = note.id || activity.id;
    console.log('[ActivityPub] Received comment:', noteId, 'inReplyTo:', note.inReplyTo);
    
    let postId = null;
    let parentId = null;
    
    // Check if replying to a post - extract slug from URL
    if (!postId) {
        const result = extractSlugFromUrl(note.inReplyTo);
        if (result) {
            if (DEBUG_AP) console.log('[ActivityPub] Comment is reply to post:', result.slug);
            postId = result.post.id;
        }
    }
    
    // If not a post reply, try to find the parent comment
    if (!postId) {
        // Try exact match on activity_id first
        let parentComment = db.prepare('SELECT id, post_id FROM comments WHERE activity_id = ?').get(note.inReplyTo);
        
        if (parentComment) {
            console.log('[ActivityPub] Found parent comment by exact activity_id:', note.inReplyTo);
            postId = parentComment.post_id;
            parentId = parentComment.id;
        } else {
            // Log all comments in database for debugging
            if (DEBUG_AP) {
                const allComments = db.prepare('SELECT id, activity_id FROM comments').all();
                console.log('[ActivityPub] Looking for:', note.inReplyTo);
                console.log('[ActivityPub] All comments:', allComments.map(c => ({ id: c.id, activity_id: c.activity_id })));
            }
            
            // Try to match by extracting ID from URL
            const idPatterns = [
                /\/statuses\/([^\/\?#]+)/,
                /\/objects\/([^\/\?#]+)/,
                /\/notes\/([^\/\?#]+)/,
                /\/activities\/([^\/\?#]+)/,
                /\/@[^\/]+\/(\d+)/,
                /#([^\/]+)$/,
            ];
            
            for (const pattern of idPatterns) {
                const match = note.inReplyTo.match(pattern);
                if (match) {
                    const extractedId = match[1];
                    parentComment = db.prepare(`
                        SELECT id, post_id, activity_id FROM comments 
                        WHERE activity_id = ? OR activity_id LIKE ?
                    `).get(note.inReplyTo, `%${extractedId}%`);
                    
                    if (parentComment) {
                        console.log('[ActivityPub] Found parent comment by pattern:', pattern);
                        postId = parentComment.post_id;
                        parentId = parentComment.id;
                        break;
                    }
                }
            }
        }
        
        // Last resort: try to find any comment that might be related by URL similarity
        if (!postId && note.inReplyTo) {
            const lastSegment = note.inReplyTo.split('/').pop().split('#').pop().split('?')[0];
            if (lastSegment && lastSegment.length > 0) {
                parentComment = db.prepare(`
                    SELECT id, post_id FROM comments WHERE activity_id LIKE ?
                `).get(`%${lastSegment}%`);
                
                if (parentComment) {
                    console.log('[ActivityPub] Found parent comment by last segment:', lastSegment);
                    postId = parentComment.post_id;
                    parentId = parentComment.id;
                }
            }
        }
    }
    
    if (!postId) {
        console.log('[ActivityPub] Could not find post for comment, inReplyTo:', note.inReplyTo);
        return;
    }
    
    if (DEBUG_AP) console.log('[ActivityPub] Comment will be added to post:', postId, 'parent:', parentId);
    
    const actorId = typeof activity.actor === 'string' ? activity.actor : activity.actor.id;
    
    // Process content including attachments
    const htmlContent = processActivityPubContent(note);
    
    // Try to get actor info
    let actorName = actorId;
    try {
        if (isValidActorUrl(actorId)) {
            const actorResponse = await fetchWithTimeout(actorId, {
                headers: { 'Accept': 'application/activity+json' }
            });
            if (actorResponse.ok) {
                const actor = await actorResponse.json();
                actorName = actor.name || actor.preferredUsername || actorId;
            }
        } else {
            console.warn('[ActivityPub] Skipping actor fetch for comment: invalid URL (SSSRF protection)');
        }
    } catch (err) {
        console.error('[ActivityPub] Could not fetch actor info:', err.message);
    }
    
    try {
        // Store the Note ID (not Create activity ID) so replies can find this comment
        const noteId = note.id || activity.id;
        
        const stmt = db.prepare(`
            INSERT INTO comments (post_id, parent_id, actor_id, actor_url, actor_name, content, created_at, activity_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(postId, parentId, actorId, actorId, actorName, htmlContent, new Date().toISOString(), noteId);
        console.log(`[ActivityPub] Added comment from ${actorName} on post ${postId}${parentId ? ` (reply to comment ${parentId})` : ''}`);
    } catch (err) {
        console.error('[ActivityPub] Error handling comment:', err.message);
    }
}

async function handleUndo(activity) {
    const object = activity.object;
    const objectType = typeof object === 'string' ? null : object.type;
    const activityId = typeof object === 'string' ? object : object.id;
    const actorId = typeof activity.actor === 'string' ? activity.actor : activity.actor.id;
    
    if (objectType === 'Like' || (typeof object === 'string' && object.includes('like'))) {
        const existingLike = db.prepare('SELECT actor_id FROM likes WHERE activity_id = ?').get(activityId);
        if (existingLike) {
            if (existingLike.actor_id !== actorId) {
                console.warn(`[ActivityPub] Undo Like rejected: actor mismatch. Requested by ${actorId}, owned by ${existingLike.actor_id}`);
                return;
            }
            const stmt = db.prepare('DELETE FROM likes WHERE activity_id = ?');
            stmt.run(activityId);
            console.log(`[ActivityPub] Undid like: ${activityId}`);
        } else {
            console.warn(`[ActivityPub] Undo Like: activity not found ${activityId}`);
        }
    } else if (objectType === 'Announce') {
        const existingShare = db.prepare('SELECT actor_id FROM shares WHERE activity_id = ?').get(activityId);
        if (existingShare) {
            if (existingShare.actor_id !== actorId) {
                console.warn(`[ActivityPub] Undo Announce rejected: actor mismatch. Requested by ${actorId}, owned by ${existingShare.actor_id}`);
                return;
            }
            const stmt = db.prepare('DELETE FROM shares WHERE activity_id = ?');
            stmt.run(activityId);
            console.log(`[ActivityPub] Undid announce: ${activityId}`);
        } else {
            console.warn(`[ActivityPub] Undo Announce: activity not found ${activityId}`);
        }
    } else if (objectType === 'Follow') {
        const existingFollower = db.prepare('SELECT actor_id FROM followers WHERE actor_id = ?').get(actorId);
        if (existingFollower) {
            const stmt = db.prepare('DELETE FROM followers WHERE actor_id = ?');
            stmt.run(actorId);
            console.log(`[ActivityPub] Undid follow: ${actorId}`);
        } else {
            console.warn(`[ActivityPub] Undo Follow: follower not found ${actorId}`);
        }
    }
}

async function handleFollow(activity) {
    const actorId = typeof activity.actor === 'string' ? activity.actor : activity.actor.id;
    const actorUrl = typeof activity.actor === 'string' ? activity.actor : (activity.actor.id || activity.actor.url);
    
    // SSRF protection: validate actor URL
    if (!isValidActorUrl(actorId)) {
        console.error(`[ActivityPub] Invalid actor URL (SSRF blocked): ${actorId}`);
        return;
    }
    
    try {
        // Fetch actor info to get their inbox
        const actorResponse = await fetchWithTimeout(actorId, {
            headers: { 'Accept': 'application/activity+json' }
        });
        
        if (!actorResponse.ok) {
            console.error(`[ActivityPub] Could not fetch actor info for follow: ${actorResponse.status}`);
            return;
        }
        
        const actor = await actorResponse.json();
        const inboxUrl = actor.inbox;
        
        if (!inboxUrl) {
            console.error('[ActivityPub] Actor has no inbox');
            return;
        }
        
        // SSRF protection: validate inbox URL
        if (!isValidActorUrl(inboxUrl)) {
            console.error(`[ActivityPub] Invalid inbox URL (SSRF blocked): ${inboxUrl}`);
            return;
        }
        
        // Store follower
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO followers (actor_id, actor_url, inbox_url, followed_at)
            VALUES (?, ?, ?, ?)
        `);
        stmt.run(actorId, actorUrl, inboxUrl, new Date().toISOString());
        console.log(`[ActivityPub] Added follower: ${actorId}`);
        
        // Send Accept activity
        const acceptActivity = {
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: `${BLOG_ROOT}/activities/${Date.now()}`,
            type: 'Accept',
            actor: ACTOR_URL,
            to: [actorId],
            object: activity.id
        };
        
        console.log('[ActivityPub] Sending Accept activity:', JSON.stringify(acceptActivity));
        
        const body = JSON.stringify(acceptActivity);
        const headers = signRequest(inboxUrl, 'POST', body, keys.privateKey, `${ACTOR_URL}#main-key`);
        
        const response = await fetchWithTimeout(inboxUrl, {
            method: 'POST',
            headers: headers,
            body: body
        });
        
        if (response.ok) {
            console.log(`[ActivityPub] Sent Accept to ${inboxUrl} - Status: ${response.status}`);
        } else {
            const errorText = await response.text();
            console.error(`[ActivityPub] Failed to send Accept to ${inboxUrl} - Status: ${response.status}`);
            console.error(`[ActivityPub] Accept error response: ${errorText}`);
        }
        
    } catch (err) {
        console.error('[ActivityPub] Error handling follow:', err.message);
    }
}

// Followers endpoint
router.get('/u/:username/followers', (req, res) => {
    if (req.params.username !== USERNAME) {
        return res.status(404).json({ error: 'Actor not found' });
    }
    
    try {
        const stmt = db.prepare('SELECT actor_id, followed_at FROM followers ORDER BY followed_at DESC');
        const followers = stmt.all();
        
        const orderedItems = followers.map(f => f.actor_id);
        
        res.set('Content-Type', 'application/activity+json');
        res.json({
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: USER.followers,
            type: 'OrderedCollection',
            totalItems: followers.length,
            orderedItems: orderedItems
        });
    } catch (err) {
        console.error('[ActivityPub] Error fetching followers:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Following endpoint
router.get('/u/:username/following', (req, res) => {
    if (req.params.username !== USERNAME) {
        return res.status(404).json({ error: 'Actor not found' });
    }
    
    res.set('Content-Type', 'application/activity+json');
    res.json({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: USER.following,
        type: 'OrderedCollection',
        totalItems: 0,
        orderedItems: []
    });
});

// Likes collection endpoint for posts
router.get('/:slug/likes', (req, res) => {
    const post = Posts.getBySlug(req.params.slug);
    
    if (!post) {
        return res.status(404).json({ error: 'Post not found' });
    }
    
    const likes = Posts.getLikes(post.id);
    const orderedItems = likes.map(like => ({
        type: 'Like',
        id: like.activity_id || `${postLikesUrl(post.slug)}/${like.id}`,
        actor: like.actor_url || like.actor_id,
        object: postUrl(post.slug),
        published: like.created_at
    }));
    
    res.set('Content-Type', 'application/activity+json');
    res.json({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: postLikesUrl(post.slug),
        type: 'OrderedCollection',
        totalItems: likes.length,
        orderedItems
    });
});

// Shares collection endpoint for posts
router.get('/:slug/shares', (req, res) => {
    const post = Posts.getBySlug(req.params.slug);
    
    if (!post) {
        return res.status(404).json({ error: 'Post not found' });
    }
    
    const shares = Posts.getShares(post.id);
    const orderedItems = shares.map(share => ({
        type: 'Announce',
        id: share.activity_id || `${postSharesUrl(post.slug)}/${share.id}`,
        actor: share.actor_url || share.actor_id,
        object: postUrl(post.slug),
        published: share.created_at
    }));
    
    res.set('Content-Type', 'application/activity+json');
    res.json({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: postSharesUrl(post.slug),
        type: 'OrderedCollection',
        totalItems: shares.length,
        orderedItems
    });
});

// Parse HTTP Signature header
function parseSignatureHeader(signatureHeader) {
    const parts = {};
    const regex = /(\w+)="([^"]+)"/g;
    let match;
    while ((match = regex.exec(signatureHeader)) !== null) {
        parts[match[1]] = match[2];
    }
    return parts;
}

function normalizeToKeyObject(keyData) {
    if (!keyData) return null;
    
    const trimmedKey = keyData.trim();
    
    if (trimmedKey.includes('-----BEGIN PUBLIC KEY-----') || 
        trimmedKey.includes('-----BEGIN RSA PUBLIC KEY-----')) {
        try {
            return crypto.createPublicKey(trimmedKey);
        } catch (e) {
            console.warn('[ActivityPub] Failed to create key from PEM:', e.message);
        }
    }
    
    if (trimmedKey.includes('-----BEGIN CERTIFICATE-----')) {
        const certMatch = trimmedKey.match(/-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/);
        if (certMatch) {
            try {
                return crypto.createPublicKey(certMatch[0]);
            } catch (e) {
                console.warn('[ActivityPub] Failed to create key from certificate:', e.message);
            }
        }
    }
    
    if (trimmedKey.includes('-----BEGIN EC PUBLIC KEY-----') ||
        trimmedKey.includes('-----BEGIN ED25519 PUBLIC KEY-----')) {
        try {
            return crypto.createPublicKey(trimmedKey);
        } catch (e) {
            console.warn('[ActivityPub] Failed to create key from ECPEM:', e.message);
        }
    }
    
    const base64Key = trimmedKey.replace(/\s/g, '');
    if (/^[A-Za-z0-9+/\-_]+=*$/.test(base64Key)) {
        // RSA keys start with MII
        if (base64Key.startsWith('MII') || base64Key.startsWith('MIIBIjANBg')) {
            const pem = `-----BEGIN PUBLIC KEY-----\n${base64Key}\n-----END PUBLIC KEY-----`;
            try {
                return crypto.createPublicKey(pem);
            } catch (e) {
                console.warn('[ActivityPub] Failed to create key from PEM:', e.message);
            }
        }
        // Ed25519 and EC keys have shorter base64 (32-66 bytes depending on curve)
        // Try creating a SPKI key
        const pem = `-----BEGIN PUBLIC KEY-----\n${base64Key}\n-----END PUBLIC KEY-----`;
        try {
            const key = crypto.createPublicKey(pem);
            return key;
        } catch (e) {
            // Not a valid key, will be caught below
        }
    }
    
    try {
        const jwk = JSON.parse(keyData);
        if (jwk.kty) {
            return crypto.createPublicKey({ key: jwk, format: 'jwk' });
        }
    } catch (e) {
    }
    
    return null;
}

const SIG_ALG_MAP = {
    'ed25519': [null], 'ed25519-sha512': [null],
    'ecdsa-sha256': ['sha256'], 'ecdsa-sha384': ['sha384'], 'ecdsa-sha512': ['sha512']
};

const KEY_TYPE_ALG_MAP = {
    'ed25519': [null], 'ed448': [null], 'ec': ['sha256', 'sha384', 'sha512'], 'rsa': ['RSA-SHA256', 'RSA-SHA512']
};

function getVerifyAlgorithms(keyType, sigAlgorithm) {
    if (sigAlgorithm && SIG_ALG_MAP[sigAlgorithm]) return SIG_ALG_MAP[sigAlgorithm];
    if (!sigAlgorithm && keyType && KEY_TYPE_ALG_MAP[keyType]) return KEY_TYPE_ALG_MAP[keyType];
    if (sigAlgorithm === 'rsa-sha256' || sigAlgorithm === 'hs2019') {
        if (keyType === 'ed25519') return [null];
        if (keyType === 'ec') return ['sha256', 'sha384', 'sha512'];
        return ['RSA-SHA256', 'RSA-SHA512'];
    }
    return ['RSA-SHA256', 'sha256', 'sha512', null];
}

// Verify HTTP Signature for incoming requests
async function verifyHttpSignature(req) {
    const signatureHeader = req.headers['signature'];
    const digestHeader = req.headers['digest'];
    const dateHeader = req.headers['date'];
    
    if (!signatureHeader) {
        return { valid: false, error: 'Missing Signature header' };
    }
    
    const sigParts = parseSignatureHeader(signatureHeader);
    
    if (!sigParts.keyId || !sigParts.signature) {
        return { valid: false, error: 'Invalid Signature header format' };
    }
    
    // Validate date header freshness (prevent replay attacks)
    if (dateHeader) {
        try {
            const signatureTime = new Date(dateHeader);
            const now = new Date();
            const skewMinutes = Math.abs(now - signatureTime) / 1000 / 60;
            if (skewMinutes > 5) {
                console.warn('[ActivityPub] Signature timestamp too old:', dateHeader);
                return { valid: false, error: 'Signature timestamp too old' };
            }
        } catch (e) {
            console.warn('[ActivityPub] Invalid date header:', dateHeader);
        }
    }
    
    let actorUrl = sigParts.keyId;
    
    // If keyId includes a fragment, extract the base URL
    if (actorUrl.includes('#')) {
        actorUrl = actorUrl.split('#')[0];
    }
    
    // If keyId is just a fragment (like "#main-key"), use actor from body
    if (sigParts.keyId.startsWith('#') || !sigParts.keyId.includes('://')) {
        if (req.body && req.body.actor) {
            actorUrl = typeof req.body.actor === 'string' ? req.body.actor : req.body.actor.id;
        } else {
            return { valid: false, error: 'Cannot resolve actor URL from keyId' };
        }
    }
    
    // Fetch the actor's public key
    try {
        // SSRF protection: validate URL before fetching
        if (!isValidActorUrl(actorUrl)) {
            return { valid: false, error: 'Invalid actor URL (SSRF blocked)' };
        }
        
        if (DEBUG_AP) console.log('[ActivityPub] Fetching actor from:', actorUrl);
        const actorResponse = await fetchWithTimeout(actorUrl, {
            headers: { 'Accept': 'application/activity+json' }
        });
        
        if (!actorResponse.ok) {
            return { valid: false, error: `Failed to fetch actor: ${actorResponse.status}` };
        }
        
        const actor = await actorResponse.json();
        
        let publicKeyObject = null;
        
        if (actor.publicKey) {
            if (typeof actor.publicKey === 'object' && actor.publicKey.publicKeyJwk) {
                try {
                    publicKeyObject = crypto.createPublicKey({ key: actor.publicKey.publicKeyJwk, format: 'jwk' });
                } catch (e) {
                    console.warn('[ActivityPub] Failed to create key from JWK:', e.message);
                }
            }
            if (!publicKeyObject) {
                let publicKeyPem = null;
                if (typeof actor.publicKey === 'string') {
                    publicKeyPem = actor.publicKey;
                } else if (actor.publicKey.publicKeyPem) {
                    publicKeyPem = actor.publicKey.publicKeyPem;
                } else if (actor.publicKey.publicKeyBase64) {
                    publicKeyPem = actor.publicKey.publicKeyBase64;
                }
                
                if (publicKeyPem) {
                    publicKeyObject = normalizeToKeyObject(publicKeyPem);
                }
            }
        }
        
        // Also check for direct publicKeyPem property
        if (!publicKeyObject && actor.publicKeyPem) {
            publicKeyObject = normalizeToKeyObject(actor.publicKeyPem);
        }
        
        // Also check for direct publicKeyJwk property
        if (!publicKeyObject && actor.publicKeyJwk) {
            try {
                publicKeyObject = crypto.createPublicKey({ key: actor.publicKeyJwk, format: 'jwk' });
            } catch (e) {
                console.warn('[ActivityPub] Failed to create key from direct publicKeyJwk:', e.message);
            }
        }
        
        if (!publicKeyObject) {
            console.error('[ActivityPub] Actor public key not found. Actor keys:', Object.keys(actor).filter(k => k.toLowerCase().includes('key')));
            return { valid: false, error: 'Actor has no public key' };
        }
        
        if (DEBUG_AP) console.log('[ActivityPub] Key object created - type:', publicKeyObject.type, 'algorithm:', publicKeyObject.asymmetricKeyType);
        
        // Verify digest if present (required for POST requests with body)
        if (digestHeader) {
            const digestMatch = digestHeader.match(/^(SHA-256|sha-256)=(.+)$/i);
            if (digestMatch) {
                const bodyBuffer = req.rawBody || Buffer.from(JSON.stringify(req.body));
                const expectedDigest = crypto.createHash('sha256')
                    .update(bodyBuffer)
                    .digest('base64');
                const providedDigest = digestMatch[2];
                
                if (expectedDigest !== providedDigest) {
                    console.warn('[ActivityPub] Digest mismatch. Expected:', expectedDigest, 'Got:', providedDigest);
                    return { valid: false, error: 'Digest mismatch' };
                }
            }
        }
        
        // Build signing string dynamically from headers listed in signature
        const headers = sigParts.headers || '(request-target) host date digest';
        // Handle both space and comma-separated headers
        const headersList = headers.split(/[\s,]+/).filter(h => h.length > 0);
        
        const proto = req.get('x-forwarded-proto') || req.protocol;
        const host = req.get('host');
        const urlObj = new URL(`${proto}://${host}${req.originalUrl}`);
        const requestTarget = `${req.method.toLowerCase()} ${urlObj.pathname}`;
        
        if (DEBUG_AP) console.log('[ActivityPub] Protocol:', proto, 'Host:', host, 'Path:', urlObj.pathname);
        
        const signingParts = [];
        for (const header of headersList) {
            const h = header.toLowerCase();
            if (h === '(request-target)') {
                signingParts.push(`(request-target): ${requestTarget}`);
            } else {
                // Get header value from request headers
                const headerValue = req.headers[h];
                if (headerValue === undefined) {
                    console.warn(`[ActivityPub] Missing header in signature: ${h}`);
                    signingParts.push(`${h}: `);
                } else {
                    signingParts.push(`${h}: ${headerValue}`);
                }
            }
        }
        
        const signingString = signingParts.join('\n');
        if (DEBUG_AP) console.log('[ActivityPub] Signing string:', signingString);
        
        const signatureBuffer = Buffer.from(sigParts.signature, 'base64');
        const keyType = publicKeyObject.asymmetricKeyType || 'rsa';
        const sigAlgorithm = (sigParts.algorithm || '').toLowerCase();
        
        const verifyAlgorithms = getVerifyAlgorithms(keyType, sigAlgorithm);
        
        let isValid = false;
        let lastError = null;
        
        for (const algo of verifyAlgorithms) {
            try {
                if (algo === null) {
                    isValid = crypto.verify(null, Buffer.from(signingString), publicKeyObject, signatureBuffer);
                } else {
                    isValid = crypto.verify(algo, Buffer.from(signingString), publicKeyObject, signatureBuffer);
                }
                if (isValid) {
                    if (DEBUG_AP) console.log('[ActivityPub] Signature verified with algorithm:', algo || 'ed25519');
                    break;
                }
            } catch (e) {
                lastError = e;
            }
        }
        
        if (!isValid) {
            console.warn('[ActivityPub] Signature verification failed for keyId:', sigParts.keyId);
            console.warn('[ActivityPub] Signing string was:', signingString);
            return { valid: false, error: 'Signature verification failed' };
        }
        
        return { valid: true, actor: actor };
        
    } catch (err) {
        console.error('[ActivityPub] Signature verification error:', err.message);
        return { valid: false, error: err.message };
    }
}

// HTTP Signature functions for outbound federation
function generateHttpSignature(requestTarget, headers, privateKey) {
    const now = new Date().toUTCString();
    const digest = crypto.createHash('sha256').update(headers.body || '').digest('base64');
    
    const signatureParts = [
        `(request-target): ${requestTarget}`,
        `host: ${headers.host}`,
        `date: ${now}`,
        `digest: SHA-256=${digest}`
    ];
    
    const signingString = signatureParts.join('\n');
    const signer = crypto.createSign('rsa-sha256');
    signer.update(signingString);
    const signature = signer.sign(privateKey, 'base64');
    
    return {
        signature: signature,
        date: now,
        digest: digest
    };
}

function signRequest(url, method, body, privateKey, keyId) {
    const urlObj = new URL(url);
    const requestTarget = `${method.toLowerCase()} ${urlObj.pathname}`;
    
    // body should already be a string (JSON.stringify'd)
    const bodyString = typeof body === 'string' ? body : JSON.stringify(body);
    
    const sigData = generateHttpSignature(requestTarget, {
        host: urlObj.host,
        body: bodyString
    }, privateKey);
    
    const signatureHeader = `keyId="${keyId}",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="${sigData.signature}"`;
    
    return {
        'Date': sigData.date,
        'Digest': `SHA-256=${sigData.digest}`,
        'Signature': signatureHeader,
        'Content-Type': 'application/activity+json',
        'Accept': 'application/activity+json'
    };
}

// Get followers for federation
function getFollowers() {
    const stmt = db.prepare('SELECT actor_id, actor_url, inbox_url FROM followers');
    return stmt.all();
}

// Queue an outbound activity for delivery
function queueOutboundActivity(type, object, recipients = null) {
    const activityId = `${BLOG_ROOT}/activities/${Date.now()}`;
    const now = new Date().toISOString();
    
    // If no recipients specified, get all followers
    let targetRecipients = recipients;
    if (!targetRecipients) {
        const followers = getFollowers();
        targetRecipients = followers.map(f => f.inbox_url);
    }
    
    if (targetRecipients.length === 0) {
        console.log(`[ActivityPub] No recipients for ${type} activity, skipping queue`);
        return null;
    }
    
    const activity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: activityId,
        type: type,
        actor: ACTOR_URL,
        object: object,
        published: now
    };
    
    const stmt = db.prepare(`
        INSERT INTO outbound_activities (activity_id, type, actor, object, recipients, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
        activityId,
        type,
        ACTOR_URL,
        JSON.stringify(object),
        JSON.stringify(targetRecipients),
        now
    );
    
    console.log(`[ActivityPub] Queued ${type} activity ${activityId} for ${targetRecipients.length} recipients`);
    
    setImmediate(() => {
        processOutboundActivities().catch(err => {
            console.error('[ActivityPub] Error processing outbound activities:', err.message);
        });
    });
    
    return activityId;
}

// Deliver a single activity to an inbox
async function deliverToInbox(inboxUrl, activity, privateKey, keyId) {
    const body = JSON.stringify(activity);
    const headers = signRequest(inboxUrl, 'POST', body, privateKey, keyId);
    
    try {
        const response = await fetchWithTimeout(inboxUrl, {
            method: 'POST',
            headers: headers,
            body: body
        });
        
        if (response.ok) {
            console.log(`[ActivityPub] Delivered to ${inboxUrl}: ${response.status}`);
            return { success: true, status: response.status };
        } else {
            const errorText = await response.text();
            console.error(`[ActivityPub] Failed to deliver to ${inboxUrl}: ${response.status} ${errorText}`);
            return { success: false, status: response.status, error: errorText };
        }
    } catch (err) {
        console.error(`[ActivityPub] Error delivering to ${inboxUrl}:`, err.message);
        return { success: false, error: err.message };
    }
}

// Process and deliver queued outbound activities
async function processOutboundActivities() {
    const stmt = db.prepare(`
        SELECT * FROM outbound_activities 
        WHERE delivered_at IS NULL AND delivery_attempts < 5
        ORDER BY created_at ASC
        LIMIT 10
    `);
    
    const pending = stmt.all();
    
    if (pending.length > 0) {
        console.log(`[ActivityPub] Processing ${pending.length} pending activities...`);
    }
    
    const keyId = `${ACTOR_URL}#main-key`;
    
    for (const activity of pending) {
        const recipients = JSON.parse(activity.recipients);
        const activityData = {
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: activity.activity_id,
            type: activity.type,
            actor: activity.actor,
            to: ['https://www.w3.org/ns/activitystreams#Public'],
            cc: [USER.followers],
            object: JSON.parse(activity.object),
            published: activity.created_at
        };
        
        let deliveredCount = 0;
        let lastError = null;
        
        for (const inboxUrl of recipients) {
            const result = await deliverToInbox(inboxUrl, activityData, keys.privateKey, keyId);
            if (result.success) {
                deliveredCount++;
            } else {
                lastError = result.error || `HTTP ${result.status}`;
            }
        }
        
        // Update activity record
        const updateStmt = db.prepare(`
            UPDATE outbound_activities 
            SET delivery_attempts = delivery_attempts + 1,
                last_error = ?,
                delivered_at = CASE WHEN ? = ? THEN ? ELSE NULL END
            WHERE id = ?
        `);
        
        const now = new Date().toISOString();
        const allDelivered = deliveredCount === recipients.length;
        updateStmt.run(
            lastError,
            deliveredCount,
            recipients.length,
            allDelivered ? now : null,
            activity.id
        );
        
        console.log(`[ActivityPub] Processed ${activity.type} to ${deliveredCount}/${recipients.length} recipients`);
    }
}

// Queue an Update activity for a post
function queuePostUpdate(post) {
    return queueOutboundActivity('Update', buildArticleObject(post));
}

// Queue a Create activity for a new post
function queuePostCreate(post) {
    return queueOutboundActivity('Create', buildArticleObject(post, { likes: 0, shares: 0 }));
}

// Queue an Update activity for the actor (profile changes)
function queueActorUpdate(actorData) {
    const actor = {
        '@context': ['https://www.w3.org/ns/activitystreams', 'https://w3id.org/security/v1'],
        id: ACTOR_URL,
        type: 'Person',
        preferredUsername: actorData.preferredUsername || USERNAME,
        name: actorData.name,
        summary: actorData.summary,
        inbox: `${BLOG_ROOT}/u/${USERNAME}/inbox`,
        outbox: `${BLOG_ROOT}/u/${USERNAME}/outbox`,
        followers: `${BLOG_ROOT}/u/${USERNAME}/followers`,
        following: `${BLOG_ROOT}/u/${USERNAME}/following`,
        publicKey: {
            id: `${ACTOR_URL}#main-key`,
            owner: ACTOR_URL,
            publicKeyPem: keys.publicKey
        }
    };
    
    if (actorData.icon) {
        actor.icon = {
            type: 'Image',
            mediaType: 'image/png',
            url: actorData.icon
        };
    }
    
    return queueOutboundActivity('Update', actor);
}

// Start background delivery processor (every 60 seconds)
setInterval(() => {
    processOutboundActivities().catch(err => {
        console.error('[ActivityPub] Error processing outbound activities:', err.message);
    });
}, 60000);

module.exports = router;
module.exports.queueOutboundActivity = queueOutboundActivity;
module.exports.queuePostUpdate = queuePostUpdate;
module.exports.queuePostCreate = queuePostCreate;
module.exports.queueActorUpdate = queueActorUpdate;
module.exports.processOutboundActivities = processOutboundActivities;
module.exports.verifyHttpSignature = verifyHttpSignature;
module.exports.isValidActorUrl = isValidActorUrl;
module.exports.normalizeToKeyObject = normalizeToKeyObject;
module.exports.checkInboxRateLimit = checkInboxRateLimit;
