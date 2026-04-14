function normalizeIndexHtmlPath(pathname) {
    if (typeof pathname !== 'string' || pathname.length === 0) {
        return pathname;
    }

    if (pathname === '/index.html') {
        return '/';
    }

    if (pathname.endsWith('/index.html')) {
        return pathname.slice(0, -'index.html'.length);
    }

    return pathname;
}

module.exports = {
    normalizeIndexHtmlPath
};
