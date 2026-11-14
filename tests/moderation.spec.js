const { test, expect } = require('@playwright/test');
const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const createAdmin = require('../src/routes/admin');
let db, server, url;
const token = 'browser-test-only-token-32-characters';
test.beforeAll(async () => {
    db = new Database(':memory:');
    db.exec(`CREATE TABLE posts (id INTEGER PRIMARY KEY, slug TEXT, title TEXT);
        CREATE TABLE comments (id INTEGER PRIMARY KEY, post_id INTEGER, actor_name TEXT, content TEXT, created_at TEXT, hidden INTEGER DEFAULT 0);
        INSERT INTO posts VALUES (1, 'fixture', 'Local article');`);
    db.prepare('INSERT INTO comments (id, post_id, actor_name, content, created_at) VALUES (1, 1, ?, ?, ?)').run('RemoteAuthor'.repeat(30), '<img src=x onerror=alert(1)> ' + 'longword'.repeat(35), '2026-11-14');
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '../views'));
    app.use('/posts/static.css', express.static(path.join(__dirname, '../public/static.css')));
    app.use('/posts/admin', createAdmin(db, { token, username: 'owner', blogPath: '/posts' }));
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    url = `http://127.0.0.1:${server.address().port}/posts/admin/comments`;
});
test.afterAll(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
for (const width of [375, 1280]) {
    test(`moderation form works without JavaScript at ${width}px`, async ({ browser }, testInfo) => {
        db.prepare('UPDATE comments SET hidden=0').run();
        const context = await browser.newContext({ javaScriptEnabled: false, httpCredentials: { username: 'owner', password: token }, viewport: { width, height: 850 } });
        const page = await context.newPage();
        await page.goto(url);
        await expect(page.getByRole('heading', { name: 'Moderate comments', exact: true })).toBeVisible();
        await expect(page.locator('.moderation-content')).toContainText('<img src=x onerror=alert(1)>');
        expect(await page.locator('img, script').count()).toBe(0);
        const hide = page.getByRole('button', { name: 'Hide comment #1', exact: true });
        await hide.focus();
        await expect(hide).toBeFocused();
        const overflow = await page.locator('body').evaluate(element => element.scrollWidth > window.innerWidth);
        expect(overflow).toBe(false);
        await page.screenshot({ path: testInfo.outputPath(`moderation-${width}.png`), fullPage: true });
        await hide.click();
        await expect(page.getByRole('heading', { name: 'Comment #1 · Hidden', exact: true })).toBeVisible();
        expect(db.prepare('SELECT hidden FROM comments').get().hidden).toBe(1);
        await page.getByRole('button', { name: 'Restore comment #1', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Comment #1 · Visible', exact: true })).toBeVisible();
        expect(db.prepare('SELECT hidden FROM comments').get().hidden).toBe(0);
        await context.close();
    });
}
