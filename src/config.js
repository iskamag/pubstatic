require('dotenv').config();

const DOMAIN = process.env.DOMAIN || 'localhost:6767';
const USERNAME = process.env.USERNAME || 'admin';
const PORT = process.env.PORT || 6767;
const PROTOCOL = process.env.PROTOCOL || 'http';

module.exports = {
    DOMAIN,
    USERNAME,
    PORT,
    PROTOCOL,
    BASE_URL: `${PROTOCOL}://${DOMAIN}`,
    ACTOR_URL: `${PROTOCOL}://${DOMAIN}/u/${USERNAME}`,
    USER: {
        preferredUsername: USERNAME,
        name: process.env.DISPLAY_NAME || 'Blog Admin',
        summary: process.env.BIO || 'A minimalist ActivityPub blog',
        icon: process.env.AVATAR_URL || null,
        inbox: `${PROTOCOL}://${DOMAIN}/u/${USERNAME}/inbox`,
        outbox: `${PROTOCOL}://${DOMAIN}/u/${USERNAME}/outbox`,
        followers: `${PROTOCOL}://${DOMAIN}/u/${USERNAME}/followers`,
        following: `${PROTOCOL}://${DOMAIN}/u/${USERNAME}/following`
    }
};
