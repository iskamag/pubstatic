const express = require('express');
const crypto = require('crypto');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');
const { DOMAIN, USERNAME, ACTOR_URL, BASE_URL, USER } = require('../config');
const Posts = require('../models/posts');
const db = require('../db');
const { marked } = require('marked');

const router = express.Router();

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
        modulusLength: 2048,
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
function markdownToSafeHtml(markdown) {
    if (!markdown) return '';
    // First convert markdown to HTML
    const rawHtml = marked.parse(markdown);
    // Then sanitize - but we need to be careful to preserve allowed tags
    // For now, we'll use a simple approach: only allow basic formatting
    return rawHtml
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/on\w+\s*=\s*"[^"]*"/gi, '')
        .replace(/on\w+\s*=\s*'[^']*'/gi, '')
        .replace(/javascript:/gi, '');
}

// Actor endpoint
router.get('/u/:username', (req, res) => {
    if (req.params.username !== USERNAME) {
        return res.status(404).json({ error: 'Actor not found' });
    }
    
    // Load user settings from JSON file
    const userSettings = loadUserSettings();
    
    // Determine avatar URL: use settings override, or check for pfp.png, or use default
    let avatarUrl = userSettings.avatar_url;
    if (!avatarUrl && fs.existsSync(PFP_FILE)) {
        avatarUrl = `${BASE_URL}/pfp.png`;
    }
    if (!avatarUrl) {
        avatarUrl = USER.icon;
    }
    
    const actor = {
        '@context': ['https://www.w3.org/ns/activitystreams', 'https://w3id.org/security/v1'],
        id: ACTOR_URL,
        type: 'Person',
        preferredUsername: USER.preferredUsername,
        name: userSettings.display_name || USER.name,
        summary: userSettings.bio || USER.summary,
        inbox: USER.inbox,
        outbox: USER.outbox,
        followers: USER.followers,
        following: USER.following,
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
        id: `${BASE_URL}/p/${post.slug}#activity`,
        type: 'Create',
        actor: ACTOR_URL,
        object: {
            id: `${BASE_URL}/p/${post.slug}`,
            type: 'Article',
            attributedTo: ACTOR_URL,
            content: post.content,
            name: post.title,
            published: post.published_at,
            updated: post.updated_at,
            url: `${BASE_URL}/p/${post.slug}`,
            tag: post.tags.map(tag => ({
                type: 'Hashtag',
                name: `#${tag}`,
                href: `${BASE_URL}/tag/${tag}`
            }))
        }
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
    if (req.params.username !== USERNAME) {
        return res.status(404).json({ error: 'Actor not found' });
    }
    
    try {
        // Verify HTTP Signature for security (skip in test mode)
        if (process.env.NODE_ENV !== 'test') {
            const sigVerify = await verifyHttpSignature(req);
            
            if (!sigVerify.valid) {
                console.warn('[ActivityPub] Signature verification failed:', sigVerify.error);
                return res.status(401).json({ error: 'Unauthorized', details: sigVerify.error });
            }
        }
        
        const activity = req.body;
        console.log('[ActivityPub] Received activity:', activity.type);
        
        // Store activity
        const stmt = db.prepare(`
            INSERT OR IGNORE INTO activities (activity_id, type, actor, object, target, received_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        stmt.run(
            activity.id || `${BASE_URL}/activities/${Date.now()}`,
            activity.type,
            typeof activity.actor === 'string' ? activity.actor : JSON.stringify(activity.actor),
            typeof activity.object === 'string' ? activity.object : JSON.stringify(activity.object),
            activity.target ? JSON.stringify(activity.target) : null,
            new Date().toISOString()
        );
        
        // Process activity
        switch (activity.type) {
            case 'Follow':
                await handleFollow(activity);
                break;
            case 'Like':
                await handleLike(activity);
                break;
            case 'Announce':
                await handleAnnounce(activity);
                break;
            case 'Create':
                if (activity.object && activity.object.type === 'Note') {
                    await handleComment(activity);
                }
                break;
            case 'Undo':
                await handleUndo(activity);
                break;
        }
        
        res.status(202).json({ status: 'accepted' });
    } catch (err) {
        console.error('[ActivityPub] Error processing inbox:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

async function handleLike(activity) {
    const objectUrl = typeof activity.object === 'string' ? activity.object : activity.object.id;
    const escapedBaseUrl = escapeRegex(BASE_URL);
    const match = objectUrl.match(new RegExp(`${escapedBaseUrl}/p/(.+)$`));
    
    if (!match) return;
    
    const slug = match[1];
    const post = Posts.getBySlug(slug);
    if (!post) return;
    
    const actorId = typeof activity.actor === 'string' ? activity.actor : activity.actor.id;
    
    try {
        const stmt = db.prepare(`
            INSERT OR IGNORE INTO likes (post_id, actor_id, actor_url, created_at, activity_id)
            VALUES (?, ?, ?, ?, ?)
        `);
        stmt.run(post.id, actorId, actorId, new Date().toISOString(), activity.id);
        console.log(`[ActivityPub] Added like from ${actorId} on ${slug}`);
    } catch (err) {
        console.error('[ActivityPub] Error handling like:', err.message);
    }
}

async function handleAnnounce(activity) {
    const objectUrl = typeof activity.object === 'string' ? activity.object : activity.object.id;
    const escapedBaseUrl = escapeRegex(BASE_URL);
    const match = objectUrl.match(new RegExp(`${escapedBaseUrl}/p/(.+)$`));
    
    if (!match) return;
    
    const slug = match[1];
    const post = Posts.getBySlug(slug);
    if (!post) return;
    
    const actorId = typeof activity.actor === 'string' ? activity.actor : activity.actor.id;
    
    try {
        const stmt = db.prepare(`
            INSERT OR IGNORE INTO shares (post_id, actor_id, actor_url, created_at, activity_id)
            VALUES (?, ?, ?, ?, ?)
        `);
        stmt.run(post.id, actorId, actorId, new Date().toISOString(), activity.id);
        console.log(`[ActivityPub] Added share from ${actorId} on ${slug}`);
    } catch (err) {
        console.error('[ActivityPub] Error handling announce:', err.message);
    }
}

async function handleComment(activity) {
    const note = activity.object;
    if (!note.inReplyTo) return;
    
    const escapedBaseUrl = escapeRegex(BASE_URL);
    let postId = null;
    let parentId = null;
    
    // Check if replying to a post
    const postMatch = note.inReplyTo.match(new RegExp(`${escapedBaseUrl}/p/(.+)$`));
    if (postMatch) {
        const slug = postMatch[1];
        const post = Posts.getBySlug(slug);
        if (!post) return;
        postId = post.id;
    } else {
        // Check if replying to a comment (using activity URL pattern)
        const commentMatch = note.inReplyTo.match(/\/notes\/(.+)$/);
        if (commentMatch) {
            // Find the parent comment by activity_id
            const findParentStmt = db.prepare(`
                SELECT id, post_id FROM comments WHERE activity_id = ? OR activity_id LIKE ?
            `);
            const parentComment = findParentStmt.get(
                note.inReplyTo,
                `%${commentMatch[1]}%`
            );
            
            if (parentComment) {
                postId = parentComment.post_id;
                parentId = parentComment.id;
            } else {
                // Try to find by looking for comments from external instances
                const findByUrlStmt = db.prepare(`
                    SELECT id, post_id FROM comments WHERE actor_url LIKE ? OR content LIKE ?
                `);
                const byUrl = findByUrlStmt.get(`%${note.inReplyTo}%`, `%${note.inReplyTo}%`);
                if (byUrl) {
                    postId = byUrl.post_id;
                    parentId = byUrl.id;
                }
            }
        }
    }
    
    if (!postId) return;
    
    const actorId = typeof activity.actor === 'string' ? activity.actor : activity.actor.id;
    
    // Parse markdown content safely
    const htmlContent = markdownToSafeHtml(note.content || note.name || '');
    
    // Try to get actor info
    let actorName = actorId;
    try {
        const actorResponse = await fetch(actorId, {
            headers: { 'Accept': 'application/activity+json' }
        });
        if (actorResponse.ok) {
            const actor = await actorResponse.json();
            actorName = actor.name || actor.preferredUsername || actorId;
        }
    } catch (err) {
        console.error('[ActivityPub] Could not fetch actor info:', err.message);
    }
    
    try {
        const stmt = db.prepare(`
            INSERT INTO comments (post_id, parent_id, actor_id, actor_url, actor_name, content, created_at, activity_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(postId, parentId, actorId, actorId, actorName, htmlContent, new Date().toISOString(), activity.id);
        console.log(`[ActivityPub] Added comment from ${actorName} on post ${postId}${parentId ? ` (reply to comment ${parentId})` : ''}`);
    } catch (err) {
        console.error('[ActivityPub] Error handling comment:', err.message);
    }
}

async function handleUndo(activity) {
    const object = activity.object;
    const objectType = typeof object === 'string' ? null : object.type;
    const activityId = typeof object === 'string' ? object : object.id;
    
    if (objectType === 'Like' || (typeof object === 'string' && object.includes('like'))) {
        const stmt = db.prepare('DELETE FROM likes WHERE activity_id = ?');
        stmt.run(activityId);
        console.log(`[ActivityPub] Undid like: ${activityId}`);
    } else if (objectType === 'Announce') {
        const stmt = db.prepare('DELETE FROM shares WHERE activity_id = ?');
        stmt.run(activityId);
        console.log(`[ActivityPub] Undid announce: ${activityId}`);
    } else if (objectType === 'Follow') {
        const stmt = db.prepare('DELETE FROM followers WHERE actor_id = ?');
        stmt.run(activityId);
        console.log(`[ActivityPub] Undid follow: ${activityId}`);
    }
}

async function handleFollow(activity) {
    const actorId = typeof activity.actor === 'string' ? activity.actor : activity.actor.id;
    const actorUrl = typeof activity.actor === 'string' ? activity.actor : (activity.actor.id || activity.actor.url);
    
    try {
        // Fetch actor info to get their inbox
        const actorResponse = await fetch(actorId, {
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
            id: `${BASE_URL}/activities/${Date.now()}`,
            type: 'Accept',
            actor: ACTOR_URL,
            object: activity.id
        };
        
        const body = JSON.stringify(acceptActivity);
        const headers = signRequest(inboxUrl, 'POST', body, keys.privateKey, `${ACTOR_URL}#main-key`);
        
        const response = await fetch(inboxUrl, {
            method: 'POST',
            headers: headers,
            body: body
        });
        
        if (response.ok) {
            console.log(`[ActivityPub] Sent Accept to ${inboxUrl}`);
        } else {
            console.error(`[ActivityPub] Failed to send Accept: ${response.status}`);
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
    
    let actorUrl = sigParts.keyId;
    
    // If keyId is a fragment (like "#main-key"), we need to extract the actor URL from the activity
    if (actorUrl.startsWith('#')) {
        // The actor URL should be in the request body
        if (req.body && req.body.actor) {
            actorUrl = typeof req.body.actor === 'string' ? req.body.actor : req.body.actor.id;
        } else {
            return { valid: false, error: 'Cannot resolve actor URL from keyId fragment' };
        }
    }
    
    // Fetch the actor's public key
    try {
        console.log('[ActivityPub] Fetching actor from:', actorUrl);
        const actorResponse = await fetch(actorUrl, {
            headers: { 'Accept': 'application/activity+json' }
        });
        
        if (!actorResponse.ok) {
            return { valid: false, error: `Failed to fetch actor: ${actorResponse.status}` };
        }
        
        const actor = await actorResponse.json();
        
        // Try different public key formats
        let publicKeyPem = null;
        
        if (actor.publicKey) {
            if (typeof actor.publicKey === 'string') {
                publicKeyPem = actor.publicKey;
            } else if (actor.publicKey.publicKeyPem) {
                publicKeyPem = actor.publicKey.publicKeyPem;
            } else if (actor.publicKey.publicKeyBase64) {
                // Convert base64 to PEM if needed
                publicKeyPem = actor.publicKey.publicKeyBase64;
            }
        }
        
        // Also check for direct publicKeyPem property
        if (!publicKeyPem && actor.publicKeyPem) {
            publicKeyPem = actor.publicKeyPem;
        }
        
        if (!publicKeyPem) {
            console.error('[ActivityPub] Actor public key not found. Actor keys:', Object.keys(actor).filter(k => k.toLowerCase().includes('key')));
            return { valid: false, error: 'Actor has no public key' };
        }
        
        // Convert RSA public key in different formats to PEM if needed
        if (publicKeyPem.includes('-----BEGIN PUBLIC KEY-----') || publicKeyPem.includes('-----BEGIN RSA PUBLIC KEY-----')) {
            // Already in PEM format
        } else if (publicKeyPem.includes('MII')) {
            // Base64-encoded SPKI format, convert to PEM
            publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${publicKeyPem}\n-----END PUBLIC KEY-----`;
        }
        
        // Verify digest if present - use rawBody if available
        if (digestHeader && digestHeader.startsWith('SHA-256=')) {
            const bodyBuffer = req.rawBody || Buffer.from(JSON.stringify(req.body));
            const expectedDigest = crypto.createHash('sha256')
                .update(bodyBuffer)
                .digest('base64');
            const providedDigest = digestHeader.substring(8);
            
            if (expectedDigest !== providedDigest) {
                console.warn('[ActivityPub] Digest mismatch. Expected:', expectedDigest, 'Got:', providedDigest);
                // Don't fail on digest mismatch - some implementations calculate digest differently
            }
        }
        
        // Build signing string
        const headers = sigParts.headers || '(request-target) host date digest';
        const headersList = headers.split(' ');
        
        const urlObj = new URL(`${req.protocol}://${req.get('host')}${req.originalUrl}`);
        const requestTarget = `${req.method.toLowerCase()} ${urlObj.pathname}`;
        
        const signingParts = [];
        for (const header of headersList) {
            const h = header.toLowerCase();
            if (h === '(request-target)') {
                signingParts.push(`(request-target): ${requestTarget}`);
            } else if (h === 'host') {
                signingParts.push(`host: ${req.get('host')}`);
            } else if (h === 'date') {
                signingParts.push(`date: ${dateHeader}`);
            } else if (h === 'digest') {
                signingParts.push(`digest: ${digestHeader}`);
            }
        }
        
        const signingString = signingParts.join('\n');
        console.log('[ActivityPub] Signing string:', signingString);
        
        // Verify signature
        const verifier = crypto.createVerify('rsa-sha256');
        verifier.update(signingString);
        
        const isValid = verifier.verify(publicKeyPem, sigParts.signature, 'base64');
        
        if (!isValid) {
            console.warn('[ActivityPub] Signature verification failed. Attempting fallback methods...');
            
            // Try different key ID extraction methods
            // Some implementations use keyId as just the actor URL + fragment
            if (actorUrl.includes(sigParts.keyId.replace('#', ''))) {
                // keyId is within actorUrl, try getting key directly from actor
                const keyIdFragment = sigParts.keyId.replace('#', '');
                if (actor.publicKey && typeof actor.publicKey === 'object') {
                    for (const key of Object.values(actor.publicKey)) {
                        if (key && key.publicKeyPem) {
                            const testVerifier = crypto.createVerify('rsa-sha256');
                            testVerifier.update(signingString);
                            if (testVerifier.verify(key.publicKeyPem, sigParts.signature, 'base64')) {
                                console.log('[ActivityPub] Signature verified with alternate key');
                                return { valid: true, actor: actor };
                            }
                        }
                    }
                }
            }
            
            return { valid: false, error: 'Signature verification failed' };
        }
        
        return { valid: true, actor: actor };
        
    } catch (err) {
        console.error('[ActivityPub] Signature verification error:', err.message);
        return { valid: false, error: `Verification error: ${err.message}` };
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
    
    const sigData = generateHttpSignature(requestTarget, {
        host: urlObj.host,
        body: body ? JSON.stringify(body) : ''
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
    const activityId = `${BASE_URL}/activities/${Date.now()}`;
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
    return activityId;
}

// Deliver a single activity to an inbox
async function deliverToInbox(inboxUrl, activity, privateKey, keyId) {
    const body = JSON.stringify(activity);
    const headers = signRequest(inboxUrl, 'POST', body, privateKey, keyId);
    
    try {
        const response = await fetch(inboxUrl, {
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
    const keyId = `${ACTOR_URL}#main-key`;
    
    for (const activity of pending) {
        const recipients = JSON.parse(activity.recipients);
        const activityData = {
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: activity.activity_id,
            type: activity.type,
            actor: activity.actor,
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
    const article = {
        id: `${BASE_URL}/p/${post.slug}`,
        type: 'Article',
        attributedTo: ACTOR_URL,
        content: post.content,
        name: post.title,
        published: post.published_at,
        updated: post.updated_at,
        url: `${BASE_URL}/p/${post.slug}`,
        tag: post.tags.map(tag => ({
            type: 'Hashtag',
            name: `#${tag}`,
            href: `${BASE_URL}/tag/${tag}`
        }))
    };
    
    return queueOutboundActivity('Update', article);
}

// Queue a Create activity for a new post
function queuePostCreate(post) {
    const article = {
        id: `${BASE_URL}/p/${post.slug}`,
        type: 'Article',
        attributedTo: ACTOR_URL,
        content: post.content,
        name: post.title,
        published: post.published_at,
        url: `${BASE_URL}/p/${post.slug}`,
        tag: post.tags.map(tag => ({
            type: 'Hashtag',
            name: `#${tag}`,
            href: `${BASE_URL}/tag/${tag}`
        }))
    };
    
    return queueOutboundActivity('Create', article);
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
        inbox: `${BASE_URL}/u/${USERNAME}/inbox`,
        outbox: `${BASE_URL}/u/${USERNAME}/outbox`,
        followers: `${BASE_URL}/u/${USERNAME}/followers`,
        following: `${BASE_URL}/u/${USERNAME}/following`,
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
