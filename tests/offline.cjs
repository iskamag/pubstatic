// Preloaded by the Playwright server only. Federation is entirely mocked.
// Do not use this in production: it deliberately replaces HTTP delivery.
const fetchPath = require.resolve('node-fetch');
require.cache[fetchPath] = {
    id: fetchPath, filename: fetchPath, loaded: true,
    exports: async (url, options = {}) => {
        if (options.method === 'POST') return { ok: true, status: 202, text: async () => '' };
        return {
            ok: true, status: 200,
            json: async () => ({ id: String(url), preferredUsername: String(url).split('/').pop(), inbox: String(url) + '/inbox' })
        };
    }
};
