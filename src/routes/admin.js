const express = require('express');
const crypto = require('crypto');

// Separate from the localhost test API: proxy requests must always authenticate.
module.exports = function adminRouter(db, { token = process.env.ADMIN_TOKEN, username = 'admin', blogPath = '' } = {}) {
    const router = express.Router();
    const enabled = typeof token === 'string' && token.length >= 32;
    const csrf = enabled ? crypto.createHmac('sha256', token).update('pubstatic-comment-moderation').digest('hex') : '';
    const equal = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(), crypto.createHash('sha256').update(b).digest());
    router.use((req, res, next) => {
        res.set({ 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" });
        if (!enabled) return res.sendStatus(404);
        const header = req.get('authorization') || '';
        const credentials = /^Basic [A-Za-z0-9+/]+=*$/.test(header) ? Buffer.from(header.slice(6), 'base64').toString('utf8') : '';
        if (!equal(credentials, `${username}:${token}`)) {
            res.set('WWW-Authenticate', 'Basic realm="Pubstatic moderation", charset="UTF-8"');
            return res.status(401).send('Administrator credentials required.');
        }
        next();
    });
    router.get('/comments', (req, res) => {
        const page = /^\d{1,6}$/.test(req.query.page || '') ? Math.max(1, Number(req.query.page)) : 1;
        const comments = db.prepare(`SELECT c.*, p.slug, p.title FROM comments c JOIN posts p ON p.id = c.post_id ORDER BY c.id DESC LIMIT 50 OFFSET ?`).all((page - 1) * 50);
        res.render('admin-comments', { title: 'Moderate comments', comments, csrf, page, blogPath, layout: false });
    });
    router.post('/comments/:id', express.urlencoded({ extended: false, limit: '2kb' }), (req, res) => {
        // The form token protects even browsers that automatically resend Basic auth.
        if (req.get('sec-fetch-site') === 'cross-site' || typeof req.body?.csrf !== 'string' || !equal(req.body.csrf, csrf)) return res.status(403).send('Invalid moderation form. Reload the comments page and try again.');
        if (!/^[1-9]\d{0,14}$/.test(req.params.id) || !['hide', 'restore'].includes(req.body.action)) return res.status(400).send('Invalid comment or moderation action.');
        const result = db.prepare('UPDATE comments SET hidden = ? WHERE id = ?').run(req.body.action === 'hide' ? 1 : 0, req.params.id);
        if (!result.changes) return res.status(404).send('Comment not found.');
        res.redirect(303, `${blogPath}/admin/comments`);
    });
    return router;
};
