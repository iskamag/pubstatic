const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

test('attachments are served below BLOG_PATH on a subpath installation', async ({ request }) => {
    const relativePath = 'uploads/__test-subpath-attachment/subpath-attachment-test.svg';
    const filePath = path.join(__dirname, '..', 'public', relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '<svg xmlns="http://www.w3.org/2000/svg"/>');

    try {
        const response = await request.get(`/posts/static/${relativePath}`);
        expect(response.status()).toBe(200);
        expect(response.headers()['content-type']).toContain('image/svg+xml');
        expect(await response.text()).toContain('<svg');

        const rootResponse = await request.get(`/static/${relativePath}`);
        expect(rootResponse.status()).toBe(404);
    } finally {
        fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
    }
});
