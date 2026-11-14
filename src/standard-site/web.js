// Verification is public read-only metadata; it never triggers a remote write.
function mountVerification(app, publisher, root) {
    const basePath = new URL(root).pathname.replace(/\/$/, '');
    app.get(`/.well-known/site.standard.publication${basePath}`, (req, res) => {
        const uri = publisher.publicationUri();
        if (!uri) return res.status(404).end();
        res.type('text/plain').send(uri);
    });
    app.use((req, res, next) => {
        res.locals.standardPublicationUri = publisher.publicationUri();
        res.locals.standardDocumentUri = null;
        if (req.path.startsWith(`${basePath}/`)) {
            const slug = req.path.slice(basePath.length + 1).replace(/\/$/, '');
            if (/^[A-Za-z0-9_-]{1,100}$/.test(slug)) res.locals.standardDocumentUri = publisher.documentUri(slug);
        }
        next();
    });
}
module.exports = { mountVerification };
