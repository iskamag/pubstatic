const db = require('../db');
const fs = require('fs');
const path = require('path');

class Posts {
    static getAll(limit = 10, offset = 0) {
        const stmt = db.prepare(`
            SELECT id, slug, title, content, excerpt, published_at, updated_at, tags,
                (SELECT COUNT(*) FROM likes WHERE post_id = posts.id) as likes_count,
                (SELECT COUNT(*) FROM comments WHERE post_id = posts.id) as comments_count,
                (SELECT COUNT(*) FROM shares WHERE post_id = posts.id) as shares_count
            FROM posts
            ORDER BY published_at DESC
            LIMIT ? OFFSET ?
        `);
        return stmt.all(limit, offset).map(post => ({
            ...post,
            tags: JSON.parse(post.tags || '[]')
        }));
    }

    static getBySlug(slug) {
        const stmt = db.prepare(`
            SELECT posts.*,
                (SELECT COUNT(*) FROM likes WHERE post_id = posts.id) as likes_count,
                (SELECT COUNT(*) FROM comments WHERE post_id = posts.id) as comments_count,
                (SELECT COUNT(*) FROM shares WHERE post_id = posts.id) as shares_count
            FROM posts
            WHERE slug = ?
        `);
        const post = stmt.get(slug);
        if (post) {
            post.tags = JSON.parse(post.tags || '[]');
        }
        return post;
    }

    static getById(id) {
        const stmt = db.prepare(`
            SELECT posts.*,
                (SELECT COUNT(*) FROM likes WHERE post_id = posts.id) as likes_count,
                (SELECT COUNT(*) FROM comments WHERE post_id = posts.id) as comments_count,
                (SELECT COUNT(*) FROM shares WHERE post_id = posts.id) as shares_count
            FROM posts
            WHERE id = ?
        `);
        const post = stmt.get(id);
        if (post) {
            post.tags = JSON.parse(post.tags || '[]');
        }
        return post;
    }

    static createOrUpdate({ slug, title, content, excerpt, tags = [], filePath, fileMtime }) {
        const now = new Date().toISOString();
        const existing = db.prepare('SELECT id FROM posts WHERE slug = ?').get(slug);
        
        if (existing) {
            const stmt = db.prepare(`
                UPDATE posts 
                SET title = ?, content = ?, excerpt = ?, tags = ?, 
                    updated_at = ?, file_path = ?, file_mtime = ?
                WHERE slug = ?
            `);
            stmt.run(title, content, excerpt, JSON.stringify(tags), now, filePath, fileMtime, slug);
            return existing.id;
        } else {
            const stmt = db.prepare(`
                INSERT INTO posts (slug, title, content, excerpt, published_at, tags, file_path, file_mtime)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);
            const result = stmt.run(slug, title, content, excerpt, now, JSON.stringify(tags), filePath, fileMtime);
            return result.lastInsertRowid;
        }
    }

    static deleteBySlug(slug) {
        db.prepare('DELETE FROM posts WHERE slug = ?').run(slug);
    }

    static getTags() {
        const stmt = db.prepare('SELECT tags FROM posts');
        const allTags = stmt.all();
        const tagSet = new Set();
        allTags.forEach(row => {
            const tags = JSON.parse(row.tags || '[]');
            tags.forEach(tag => tagSet.add(tag));
        });
        return Array.from(tagSet).sort();
    }

    static getByTag(tag, limit = 10, offset = 0) {
        // Use json_each to properly match exact tag in JSON array
        const stmt = db.prepare(`
            SELECT DISTINCT p.id, p.slug, p.title, p.excerpt, p.published_at, p.updated_at, p.tags,
                (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as likes_count,
                (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comments_count,
                (SELECT COUNT(*) FROM shares WHERE post_id = p.id) as shares_count
            FROM posts p
            JOIN json_each(p.tags) AS j
            WHERE j.value = ?
            ORDER BY p.published_at DESC
            LIMIT ? OFFSET ?
        `);
        return stmt.all(tag, limit, offset).map(post => ({
            ...post,
            tags: JSON.parse(post.tags || '[]')
        }));
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

    static getCommentsCount(postId) {
        const stmt = db.prepare(`
            SELECT COUNT(*) as count FROM comments 
            WHERE post_id = ?
        `);
        return stmt.get(postId).count;
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
}

module.exports = Posts;
