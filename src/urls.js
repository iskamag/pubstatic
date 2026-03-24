const { BASE_URL, BLOG_PATH } = require('./config');

const BLOG_ROOT = BLOG_PATH ? `${BASE_URL}${BLOG_PATH}` : BASE_URL;

function postUrl(slug) {
    return `${BLOG_ROOT}/p/${slug}`;
}

function postLikesUrl(slug) {
    return `${BLOG_ROOT}/p/${slug}/likes`;
}

function postSharesUrl(slug) {
    return `${BLOG_ROOT}/p/${slug}/shares`;
}

function postRepliesUrl(slug) {
    return `${BLOG_ROOT}/p/${slug}/replies`;
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

module.exports = {
    postUrl,
    postLikesUrl,
    postSharesUrl,
    postRepliesUrl,
    tagUrl,
    archiveUrl,
    staticUrl,
    BLOG_ROOT
};