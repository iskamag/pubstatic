const { ACTOR_URL, USER, AP_CONTENT_MODE, AP_INCLUDE_EXCERPT } = require('../config');
const { postUrl, postLikesUrl, postSharesUrl, tagUrl } = require('../urls');

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[character]));
}

function articleContent(post) {
    if (AP_CONTENT_MODE !== 'summary') return post.content;
    const title = `<p><strong>${escapeHtml(post.title)}</strong></p>`;
    const excerpt = AP_INCLUDE_EXCERPT && post.excerpt
        ? `<p>${escapeHtml(post.excerpt)}</p>` : '';
    const link = `<p><a href="${escapeHtml(postUrl(post.slug))}">Read article</a></p>`;
    return title + excerpt + link;
}

function buildArticleObject(post, counts = {}) {
    return {
        id: postUrl(post.slug),
        type: 'Article',
        attributedTo: ACTOR_URL,
        content: articleContent(post),
        name: post.title,
        published: post.published_at,
        updated: post.updated_at,
        url: postUrl(post.slug),
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        cc: [USER.followers],
        likes: {
            id: postLikesUrl(post.slug),
            type: 'OrderedCollection',
            totalItems: counts.likes ?? post.likes_count ?? 0
        },
        shares: {
            id: postSharesUrl(post.slug),
            type: 'OrderedCollection',
            totalItems: counts.shares ?? post.shares_count ?? 0
        },
        tag: post.tags.map(tag => ({
            type: 'Hashtag',
            name: `#${tag}`,
            href: tagUrl(tag)
        }))
    };
}

module.exports = { buildArticleObject };
