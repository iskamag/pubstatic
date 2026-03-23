const Posts = require('./models/posts');
const fs = require('fs');
const path = require('path');

const RSS_FILE = path.join(__dirname, '..', 'public', 'feed.xml');

let rssCache = null;

function generateRSS() {
    const posts = Posts.getAll(20, 0);
    const { BASE_URL, USER } = require('./config');
    const lastBuildDate = posts.length > 0
        ? new Date(posts[0].published_at).toUTCString()
        : new Date().toUTCString();

    let items = '';
    posts.forEach(post => {
        const pubDate = new Date(post.published_at).toUTCString();
        const link = `${BASE_URL}/p/${post.slug}`;
        const summary = post.excerpt
            ? post.excerpt.replace(/<[^>]+>/g, '').substring(0, 500) + (post.excerpt.length > 500 ? '...' : '')
            : (post.content ? post.content.replace(/<[^>]+>/g, '').substring(0, 500) + (post.content.length > 500 ? '...' : '') : '');
        const content = (post.content || '').replace(/<a[^>]*href=["']#[^"']*["'][^>]*>(.*?)<\/a>/gi, '$1');

        items += `
        <item>
            <title><![CDATA[${post.title}]]></title>
            <link>${link}</link>
            <guid>${link}</guid>
            <pubDate>${pubDate}</pubDate>
            <description><![CDATA[${summary}]]></description>
            <content:encoded><![CDATA[${content}]]></content:encoded>
        </item>`;
    });

    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
    <channel>
        <title><![CDATA[${USER.name}]]></title>
        <link>${BASE_URL}</link>
        <description><![CDATA[${USER.summary}]]></description>
        <language>en</language>
        <lastBuildDate>${lastBuildDate}</lastBuildDate>
        <atom:link href="${BASE_URL}/rss" rel="self" type="application/rss+xml" />${items}
    </channel>
</rss>`;
}

function getRSS() {
    if (!rssCache) {
        rssCache = generateRSS();
    }
    return rssCache;
}

function invalidateRSS() {
    rssCache = null;
}

function updateRSSFile() {
    const rss = generateRSS();
    rssCache = rss;
    try {
        fs.writeFileSync(RSS_FILE, rss);
        console.log('[RSS] Feed updated and cached');
    } catch (err) {
        console.error('[RSS] Error writing feed file:', err.message);
    }
}

module.exports = { getRSS, invalidateRSS, updateRSSFile };