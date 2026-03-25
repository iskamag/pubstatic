const db = require('../db');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const COUNTS_JOIN = `
    LEFT JOIN (SELECT post_id, COUNT(*) as likes_count FROM likes GROUP BY post_id) l ON p.id = l.post_id
    LEFT JOIN (SELECT post_id, COUNT(*) as comments_count FROM comments GROUP BY post_id) c ON p.id = c.post_id
    LEFT JOIN (SELECT post_id, COUNT(*) as shares_count FROM shares GROUP BY post_id) s ON p.id = s.post_id`;

function parsePost(post) {
    if (post) {
        post.tags = JSON.parse(post.tags || '[]');
    }
    return post;
}

class Posts {
    static getAll(limit = 10, offset = 0) {
        const stmt = db.prepare(`
            SELECT p.id, p.slug, p.title, p.content, p.excerpt, p.published_at, p.updated_at, p.tags,
                COALESCE(l.likes_count, 0) as likes_count,
                COALESCE(c.comments_count, 0) as comments_count,
                COALESCE(s.shares_count, 0) as shares_count
            FROM posts p ${COUNTS_JOIN}
            ORDER BY p.published_at DESC
            LIMIT ? OFFSET ?
        `);
        return stmt.all(limit, offset).map(parsePost);
    }

    static getBySlug(slug) {
        const stmt = db.prepare(`
            SELECT p.*,
                COALESCE(l.likes_count, 0) as likes_count,
                COALESCE(c.comments_count, 0) as comments_count,
                COALESCE(s.shares_count, 0) as shares_count
            FROM posts p ${COUNTS_JOIN}
            WHERE p.slug = ?
        `);
        return parsePost(stmt.get(slug));
    }

    static RESERVED_SLUGS = new Set([
        // Blog routes
        'new', 'u', 'tag', 'archive', 'static', 'rss', 'feed', 'index',
        // API routes
        'api', 'admin', 'login', 'logout', 'signin', 'signup', 'register',
        // ActivityPub routes
        'inbox', 'outbox', 'followers', 'following', 'oauth', 'actor',
        // Well-known
        '.well-known',
        // Error pages
        '404', '500', 'error', 'errors',
        // Common static assets/folders
        'css', 'js', 'images', 'img', 'assets', 'fonts', 'media', 'static',
        'favicon', 'favicon.ico', 'robots.txt', 'humans.txt', 'manifest.json',
        'pfp', 'pfp.png', 'static.css',
        // CMS prefixes
        'wp-', 'ghost-', 'ghost', 'wordpress',
        // Security
        'security', 'auth', 'password', 'reset', 'confirm',
        // General reserved
        'page', 'pages', 'post', 'posts', 'comment', 'comments',
        'search', 'sitemap', 'sitemap.xml', 'feed.xml', 'atom.xml',
        'robots', 'favicon.png', 'apple-touch-icon', 'apple-touch-icon.png'
    ]);

    static isValidSlug(slug) {
        if (!slug || typeof slug !== 'string') {
            return { valid: false, error: 'Slug is required' };
        }

        // Check for empty or whitespace-only
        const trimmedSlug = slug.trim();
        if (!trimmedSlug) {
            return { valid: false, error: 'Slug cannot be empty or whitespace' };
        }

        // Check for whitespace in slug
        if (slug !== trimmedSlug || /\s/.test(slug)) {
            return { valid: false, error: 'Slug cannot contain whitespace' };
        }

        // Check for path separators
        if (slug.includes('/') || slug.includes('\\')) {
            return { valid: false, error: 'Slug cannot contain path separators' };
        }

        // Check for hidden files (starting with .)
        if (slug.startsWith('.')) {
            return { valid: false, error: 'Slug cannot start with a dot' };
        }

        // Check for reserved slugs (exact match)
        if (this.RESERVED_SLUGS.has(slug.toLowerCase())) {
            return { valid: false, error: `Slug '${slug}' is reserved` };
        }

        // Check for reserved prefix matches
        const lowerSlug = slug.toLowerCase();
        if (lowerSlug.startsWith('wp-') || lowerSlug.startsWith('ghost-') ||
            lowerSlug.startsWith('admin') || lowerSlug.startsWith('api/')) {
            return { valid: false, error: `Slug '${slug}' uses a reserved prefix` };
        }

        // Check length (reasonable limit)
        if (slug.length > 100) {
            return { valid: false, error: 'Slug is too long (max 100 characters)' };
        }

        // Check for invalid characters
        if (!/^[a-zA-Z0-9_-]+$/.test(slug)) {
            return { valid: false, error: 'Slug can only contain letters, numbers, hyphens, and underscores' };
        }

        return { valid: true };
    }

    static createOrUpdate({ slug, title, content, excerpt, tags = [], filePath, fileMtime }) {
        // Validate slug
        const validation = this.isValidSlug(slug);
        if (!validation.valid) {
            throw new Error(`Invalid slug: ${validation.error}`);
        }

        // Calculate content hash to detect actual changes
        const contentHash = crypto.createHash('md5')
            .update(JSON.stringify({ title, content, tags }))
            .digest('hex');
        
        const now = new Date().toISOString();
        const existing = db.prepare('SELECT id, content_hash FROM posts WHERE slug = ?').get(slug);
        
        if (existing) {
            // Only update if content hash changed
            if (existing.content_hash && existing.content_hash === contentHash) {
                // Content unchanged, just update file metadata
                db.prepare(`
                    UPDATE posts SET file_path = ?, file_mtime = ? WHERE slug = ?
                `).run(filePath, fileMtime, slug);
                return existing.id;
            }
            
            // Content changed (or no previous hash), full update
            const stmt = db.prepare(`
                UPDATE posts 
                SET title = ?, content = ?, excerpt = ?, tags = ?, 
                    updated_at = ?, file_path = ?, file_mtime = ?, content_hash = ?
                WHERE slug = ?
            `);
            stmt.run(title, content, excerpt, JSON.stringify(tags), now, filePath, fileMtime, contentHash, slug);
            return existing.id;
        } else {
            const stmt = db.prepare(`
                INSERT INTO posts (slug, title, content, excerpt, published_at, tags, file_path, file_mtime, content_hash)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            const result = stmt.run(slug, title, content, excerpt, now, JSON.stringify(tags), filePath, fileMtime, contentHash);
            return result.lastInsertRowid;
        }
    }

    static deleteBySlug(slug) {
        db.prepare('DELETE FROM posts WHERE slug = ?').run(slug);
    }

    static getTags() {
        const stmt = db.prepare(`
            SELECT DISTINCT j.value as tag
            FROM posts
            JOIN json_each(posts.tags) AS j
            WHERE j.value IS NOT NULL AND j.value != ''
            ORDER BY j.value
        `);
        return stmt.all().map(row => row.tag);
    }

    static getByTag(tag, limit = 10, offset = 0) {
        const stmt = db.prepare(`
            SELECT DISTINCT p.id, p.slug, p.title, p.excerpt, p.published_at, p.updated_at, p.tags,
                COALESCE(l.likes_count, 0) as likes_count,
                COALESCE(c.comments_count, 0) as comments_count,
                COALESCE(s.shares_count, 0) as shares_count
            FROM posts p
            JOIN json_each(p.tags) AS j
            ${COUNTS_JOIN}
            WHERE j.value = ?
            ORDER BY p.published_at DESC
            LIMIT ? OFFSET ?
        `);
        return stmt.all(tag, limit, offset).map(parsePost);
    }
    
    static count() {
        const stmt = db.prepare('SELECT COUNT(*) as count FROM posts');
        return stmt.get().count;
    }
    
    static countByTag(tag) {
        const stmt = db.prepare(`
            SELECT COUNT(DISTINCT p.id) as count
            FROM posts p
            JOIN json_each(p.tags) AS j
            WHERE j.value = ?
        `);
        return stmt.get(tag).count;
    }
    
    static getByMonth(year, month, limit = 10, offset = 0) {
        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const endDate = month === 12 
            ? `${year + 1}-01-01` 
            : `${year}-${String(month + 1).padStart(2, '0')}-01`;
        
        const stmt = db.prepare(`
            SELECT p.id, p.slug, p.title, p.content, p.excerpt, p.published_at, p.updated_at, p.tags,
                COALESCE(l.likes_count, 0) as likes_count,
                COALESCE(c.comments_count, 0) as comments_count,
                COALESCE(s.shares_count, 0) as shares_count
            FROM posts p ${COUNTS_JOIN}
            WHERE p.published_at >= ? AND p.published_at < ?
            ORDER BY p.published_at DESC
            LIMIT ? OFFSET ?
        `);
        return stmt.all(startDate, endDate, limit, offset).map(parsePost);
    }
    
    static countByMonth(year, month) {
        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const endDate = month === 12 
            ? `${year + 1}-01-01` 
            : `${year}-${String(month + 1).padStart(2, '0')}-01`;
        
        const stmt = db.prepare(`
            SELECT COUNT(*) as count
            FROM posts
            WHERE published_at >= ? AND published_at < ?
        `);
        return stmt.get(startDate, endDate).count;
    }
    
    static getMonths() {
        const stmt = db.prepare(`
            SELECT DISTINCT 
                strftime('%Y', published_at) as year,
                strftime('%m', published_at) as month,
                COUNT(*) as count
            FROM posts
            GROUP BY year, month
            ORDER BY year DESC, month DESC
        `);
        return stmt.all().map(row => ({
            year: parseInt(row.year),
            month: parseInt(row.month),
            count: row.count
        }));
    }

    static getComments(postId) {
        const stmt = db.prepare(`
            SELECT * FROM comments 
            WHERE post_id = ? 
            ORDER BY created_at ASC
        `);
        const comments = stmt.all(postId);
        
        // Organize into threaded structure
        const commentMap = new Map();
        const rootComments = [];
        
        // First pass: create map and identify roots
        comments.forEach(comment => {
            comment.replies = [];
            commentMap.set(comment.id, comment);
            if (!comment.parent_id) {
                rootComments.push(comment);
            }
        });
        
        // Second pass: organize into tree
        comments.forEach(comment => {
            if (comment.parent_id && commentMap.has(comment.parent_id)) {
                const parent = commentMap.get(comment.parent_id);
                parent.replies.push(comment);
            }
        });
        
        return rootComments;
    }

    static getLikes(postId) {
        const stmt = db.prepare(`
            SELECT * FROM likes 
            WHERE post_id = ?
        `);
        return stmt.all(postId);
    }

    static getShares(postId) {
        const stmt = db.prepare(`
            SELECT * FROM shares 
            WHERE post_id = ?
        `);
        return stmt.all(postId);
    }

    static getPinned() {
        const stmt = db.prepare(`
            SELECT p.id, p.slug, p.title, p.content, p.excerpt, p.published_at, p.updated_at, p.tags,
                COALESCE(l.likes_count, 0) as likes_count,
                COALESCE(c.comments_count, 0) as comments_count,
                COALESCE(s.shares_count, 0) as shares_count
            FROM posts p ${COUNTS_JOIN}
            WHERE p.pinned = 1
            ORDER BY p.published_at DESC
        `);
        return stmt.all().map(parsePost);
    }

    static setPinned(slugs) {
        db.prepare('UPDATE posts SET pinned = 0').run();
        
        if (slugs && slugs.length > 0) {
            const placeholders = slugs.map(() => '?').join(',');
            const stmt = db.prepare(`UPDATE posts SET pinned = 1 WHERE slug IN (${placeholders})`);
            stmt.run(...slugs);
        }
    }
}

module.exports = Posts;
