require('dotenv').config();

const DOMAIN = process.env.DOMAIN || 'localhost:6767';
const USERNAME = process.env.USERNAME || 'admin';
const PORT = process.env.PORT || 6767;
const PROTOCOL = process.env.PROTOCOL || 'http';
const BLOG_PATH = (process.env.BLOG_PATH || '').replace(/\/$/, '');
const BASE_URL = `${PROTOCOL}://${DOMAIN}`;

// All URLs are under BLOG_PATH (e.g., /posts/u/admin, /posts/test)
const BLOG_ROOT = BLOG_PATH ? `${BASE_URL}${BLOG_PATH}` : BASE_URL;

function pfpUrl() {
    if (process.env.AVATAR_URL) return process.env.AVATAR_URL;
    return `${BLOG_ROOT}/pfp.png`;
}

module.exports = {
    DOMAIN,
    USERNAME,
    PORT,
    PROTOCOL,
    BASE_URL,
    BLOG_PATH,
    BLOG_ROOT,
    ACTOR_URL: `${BLOG_ROOT}/u/${USERNAME}`,
    USER: {
        preferredUsername: USERNAME,
        name: process.env.DISPLAY_NAME || 'Blog Admin',
        summary: process.env.BIO || 'A minimalist ActivityPub blog',
        icon: pfpUrl(),
        inbox: `${BLOG_ROOT}/u/${USERNAME}/inbox`,
        outbox: `${BLOG_ROOT}/u/${USERNAME}/outbox`,
        followers: `${BLOG_ROOT}/u/${USERNAME}/followers`,
        following: `${BLOG_ROOT}/u/${USERNAME}/following`,
        published: process.env.ACCOUNT_PUBLISHED || new Date().toISOString()
    }
};