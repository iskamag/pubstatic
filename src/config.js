require('dotenv').config();

const DOMAIN = process.env.DOMAIN || 'localhost:6767';
const USERNAME = process.env.USERNAME || 'admin';
const PORT = process.env.PORT || 6767;
const PROTOCOL = process.env.PROTOCOL || 'http';
const BASE_URL = `${PROTOCOL}://${DOMAIN}`;

module.exports = {
    DOMAIN,
    USERNAME,
    PORT,
    PROTOCOL,
    BASE_URL,
    ACTOR_URL: `${PROTOCOL}://${DOMAIN}/u/${USERNAME}`,
    USER: {
        preferredUsername: USERNAME,
        name: process.env.DISPLAY_NAME || 'Blog Admin',
        summary: process.env.BIO || 'A minimalist ActivityPub blog',
        icon: process.env.AVATAR_URL || `${BASE_URL}/pfp.png`,
        inbox: `${PROTOCOL}://${DOMAIN}/u/${USERNAME}/inbox`,
        outbox: `${PROTOCOL}://${DOMAIN}/u/${USERNAME}/outbox`,
        followers: `${PROTOCOL}://${DOMAIN}/u/${USERNAME}/followers`,
        following: `${PROTOCOL}://${DOMAIN}/u/${USERNAME}/following`,
        published: process.env.ACCOUNT_PUBLISHED || new Date().toISOString()
    }
};
