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
    
    const actor = {
        '@context': ['https://www.w3.org/ns/activitystreams', 'https://w3id.org/security/v1'],
        id: ACTOR_URL,
        type: 'Person',
        preferredUsername: USER.preferredUsername,
        name: USER.name,
        summary: USER.summary,
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
    
    if (USER.icon) {
        actor.icon = {
            type: 'Image',
            mediaType: 'image/png',
            url: USER.icon
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
    }
}

// Followers endpoint
router.get('/u/:username/followers', (req, res) => {
    if (req.params.username !== USERNAME) {
        return res.status(404).json({ error: 'Actor not found' });
    }
    
    res.set('Content-Type', 'application/activity+json');
    res.json({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: USER.followers,
        type: 'OrderedCollection',
        totalItems: 0,
        orderedItems: []
    });
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

module.exports = router;
