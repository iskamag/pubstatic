require('dotenv').config();

const DOMAIN = process.env.DOMAIN || 'localhost:6767';
const USERNAME = process.env.USERNAME || 'admin';
const PORT = process.env.PORT || 6767;
const PROTOCOL = process.env.PROTOCOL || 'http';
const BLOG_PATH = (process.env.BLOG_PATH || '').replace(/\/$/, '');
const BASE_URL = `${PROTOCOL}://${DOMAIN}`;

function pfpUrl() {
    if (process.env.AVATAR_URL) return process.env.AVATAR_URL;
    return BLOG_PATH ? `${BASE_URL}${BLOG_PATH}/pfp.png` : `${BASE_URL}/pfp.png`;
}

module.exports = {
    DOMAIN,
    USERNAME,
    PORT,
    PROTOCOL,
    BASE_URL,
    BLOG_PATH,
    ACTOR_URL: `${PROTOCOL}://${DOMAIN}/u/${USERNAME}`,
    USER: {
        preferredUsername: USERNAME,
        name: process.env.DISPLAY_NAME || 'Blog Admin',
        summary: process.env.BIO || 'A minimalist ActivityPub blog',
        icon: pfpUrl(),
        inbox: `${PROTOCOL}://${DOMAIN}/u/${USERNAME}/inbox`,
        outbox: `${PROTOCOL}://${DOMAIN}/u/${USERNAME}/outbox`,
        followers: `${PROTOCOL}://${DOMAIN}/u/${USERNAME}/followers`,
        following: `${PROTOCOL}://${DOMAIN}/u/${USERNAME}/following`,
        published: process.env.ACCOUNT_PUBLISHED || new Date().toISOString()
    }
};
