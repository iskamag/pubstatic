const { BASE_URL, BLOG_PATH, BLOG_ROOT } = require('./config');

// Post URLs - no /p/ prefix, posts are directly under BLOG_ROOT
function postUrl(slug) {
    return `${BLOG_ROOT}/${slug}`;
}

function postLikesUrl(slug) {
    return `${BLOG_ROOT}/${slug}/likes`;
}

function postSharesUrl(slug) {
    return `${BLOG_ROOT}/${slug}/shares`;
}

function postRepliesUrl(slug) {
    return `${BLOG_ROOT}/${slug}/replies`;
}

function tagUrl(tag) {
    return `${BLOG_ROOT}/tag/${tag}`;
}

function archiveUrl(year, month) {
    return `${BLOG_ROOT}/archive/${year}/${String(month).padStart(2, '0')}`;
}

function staticUrl(path) {
    return `${BLOG_ROOT}${path}`;
}

function actorUrl(username) {
    return `${BLOG_ROOT}/u/${username}`;
}

function inboxUrl(username) {
    return `${BLOG_ROOT}/u/${username}/inbox`;
}

function outboxUrl(username) {
    return `${BLOG_ROOT}/u/${username}/outbox`;
}

function followersUrl(username) {
    return `${BLOG_ROOT}/u/${username}/followers`;
}

function followingUrl(username) {
    return `${BLOG_ROOT}/u/${username}/following`;
}

module.exports = {
    postUrl,
    postLikesUrl,
    postSharesUrl,
    postRepliesUrl,
    tagUrl,
    archiveUrl,
    staticUrl,
    actorUrl,
    inboxUrl,
    outboxUrl,
    followersUrl,
    followingUrl,
    BLOG_ROOT
};