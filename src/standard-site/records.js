const { Parser } = require('htmlparser2');
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
const blocks = new Set(['p', 'div', 'article', 'section', 'br', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'blockquote', 'tr', 'td', 'hr']);

function plainText(html) {
    let text = '';
    let hidden = 0;
    const parser = new Parser({
        onopentag(name) {
            if (['script', 'style', 'head'].includes(name)) hidden++;
            if (!hidden && blocks.has(name)) text += '\n';
        },
        ontext(value) { if (!hidden) text += value; },
        onclosetag(name) {
            if (['script', 'style', 'head'].includes(name)) hidden--;
            if (!hidden && blocks.has(name) && !['br', 'hr'].includes(name)) text += '\n';
        }
    }, { decodeEntities: true });
    parser.end(String(html || ''));
    return text.replace(/[^\S\n]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function bounded(value, graphemes, bytes, field) {
    if (Buffer.byteLength(value) > bytes || Array.from(segmenter.segment(value)).length > graphemes) {
        throw new Error(`${field} exceeds Standard.site limits`);
    }
    return value;
}

function readConfig(env, blogRoot, defaults = {}) {
    if (env.STANDARD_SITE_ENABLED === undefined || env.STANDARD_SITE_ENABLED === 'false') return { enabled: false };
    if (env.STANDARD_SITE_ENABLED !== 'true') throw new Error('STANDARD_SITE_ENABLED must be true or false');
    function httpsUrl(value, originOnly) {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (originOnly && url.pathname !== '/')) throw new Error('Expected HTTPS URL');
        return url.href.replace(/\/$/, '');
    }
    const pds = httpsUrl(env.STANDARD_SITE_PDS, true);
    const root = httpsUrl(blogRoot, false);
    const did = env.STANDARD_SITE_DID || '';
    if (!/^did:(plc:[a-z2-7]{24}|web:[A-Za-z0-9._:%-]+)$/.test(did)) throw new Error('STANDARD_SITE_DID must be an account DID');
    if (!env.STANDARD_SITE_APP_PASSWORD?.trim()) throw new Error('STANDARD_SITE_APP_PASSWORD is required');
    const name = env.STANDARD_SITE_NAME || defaults.name;
    if (!name?.trim()) throw new Error('Publication name is required');
    return { enabled: true, pds, root, did, password: env.STANDARD_SITE_APP_PASSWORD,
        name: bounded(name, 500, 5000, 'name'),
        description: bounded(env.STANDARD_SITE_DESCRIPTION ?? defaults.description ?? '', 3000, 30000, 'description') };
}

function publication(config) {
    return { $type: 'site.standard.publication', url: config.root, name: config.name, description: config.description };
}
function document(post, site, publishedAt) {
    const title = plainText(post.title);
    if (!title) throw new Error('Document title is required');
    const tags = [...new Set((post.tags || []).map(tag => String(tag).replace(/^#+/, '').trim()).filter(Boolean))];
    const record = {
        $type: 'site.standard.document', site, path: `/${post.slug}`,
        title: bounded(title, 500, 5000, 'title'),
        description: bounded(plainText(post.excerpt), 3000, 30000, 'description'),
        textContent: plainText(post.content),
        tags: tags.map(tag => bounded(tag, 128, 1280, 'tag')),
        publishedAt: new Date(publishedAt || post.published_at).toISOString()
    };
    if (Buffer.byteLength(JSON.stringify(record)) > 900000) throw new Error('Document exceeds publisher size limit');
    return record;
}
module.exports = { plainText, readConfig, publication, document };
