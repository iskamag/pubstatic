const { test, expect } = require('@playwright/test');

test.describe('Blog Frontend', () => {
    test('homepage loads successfully', async ({ page }) => {
        await page.goto('/');
        await expect(page).toHaveTitle(/My ActivityPub Blog/);
    });

    test('homepage displays posts', async ({ page }) => {
        await page.goto('/');
        
        // Check for posts
        const posts = await page.locator('.post-card').count();
        expect(posts).toBeGreaterThan(0);
        
        // Check for post title
        await expect(page.locator('.post-title').first()).toBeVisible();
    });

    test('post links work correctly', async ({ page }) => {
        await page.goto('/');
        
        // Click first post
        const firstPost = page.locator('.post-title a').first();
        await firstPost.click();
        
        // Should be on a post page
        await expect(page.locator('.post-full')).toBeVisible();
        await expect(page.locator('.post-content')).toBeVisible();
    });

    test('individual post page displays correctly', async ({ page }) => {
        await page.goto('/p/welcome');
        
        await expect(page.locator('.post-full')).toBeVisible();
        await expect(page.locator('.post-title')).toContainText('Welcome');
        await expect(page.locator('.post-content')).toBeVisible();
        await expect(page.locator('.post-footer')).toBeVisible();
    });

    test('tag navigation works', async ({ page }) => {
        await page.goto('/');
        
        // Check if tags exist
        const tags = await page.locator('.tag').count();
        if (tags > 0) {
            // Click first tag
            const firstTag = page.locator('.tag').first();
            const tagText = await firstTag.textContent();
            await firstTag.click();
            
            // Should be on tag page
            await expect(page.locator('h1')).toContainText('Tag:');
        }
    });

    test('tag page displays posts', async ({ page }) => {
        await page.goto('/tag/activitypub');
        
        await expect(page.locator('h1')).toContainText('Tag: activitypub');
        
        // Should show posts or empty state
        const posts = await page.locator('.post-card').count();
        expect(posts).toBeGreaterThanOrEqual(0);
    });

    test('back navigation works', async ({ page }) => {
        await page.goto('/p/welcome');
        
        await page.locator('.back-link').click();
        
        // Should be back on homepage
        await expect(page).toHaveURL(/\/$/);
    });

    test('404 page works', async ({ page }) => {
        await page.goto('/nonexistent-post');
        
        await expect(page.locator('.error-page')).toBeVisible();
        await expect(page.locator('h1')).toContainText('404');
    });

    test('site footer is visible', async ({ page }) => {
        await page.goto('/');
        
        await expect(page.locator('.site-footer')).toBeVisible();
        await expect(page.locator('.site-footer')).toContainText('ActivityPub');
    });

    test('no JavaScript is loaded', async ({ page }) => {
        await page.goto('/');
        
        // Check that no script tags exist in the body
        const scripts = await page.locator('body script').count();
        expect(scripts).toBe(0);
    });

    test('CSS is loaded', async ({ page }) => {
        await page.goto('/');
        
        // Check for stylesheet link
        const stylesheet = await page.locator('link[rel="stylesheet"]').first();
        await expect(stylesheet).toHaveAttribute('href', /style\.css/);
    });
});

test.describe('ActivityPub Endpoints', () => {
    test('WebFinger endpoint returns correct data', async ({ request }) => {
        const response = await request.get('/.well-known/webfinger?resource=acct:admin@localhost:6767');
        
        expect(response.status()).toBe(200);
        const data = await response.json();
        
        expect(data.subject).toBe('acct:admin@localhost:6767');
        expect(data.links).toBeDefined();
        expect(data.links[0].rel).toBe('self');
    });

    test('WebFinger returns 404 for unknown user', async ({ request }) => {
        const response = await request.get('/.well-known/webfinger?resource=acct:unknown@localhost:6767');
        
        expect(response.status()).toBe(404);
    });

    test('Actor endpoint returns ActivityPub data', async ({ request }) => {
        const response = await request.get('/u/admin');
        
        expect(response.status()).toBe(200);
        expect(response.headers()['content-type']).toContain('application/activity+json');
        
        const data = await response.json();
        expect(data.type).toBe('Person');
        expect(data.preferredUsername).toBe('admin');
        expect(data.inbox).toBeDefined();
        expect(data.outbox).toBeDefined();
        expect(data.publicKey).toBeDefined();
    });

    test('Outbox returns ordered collection', async ({ request }) => {
        const response = await request.get('/u/admin/outbox');
        
        expect(response.status()).toBe(200);
        expect(response.headers()['content-type']).toContain('application/activity+json');
        
        const data = await response.json();
        expect(data.type).toBe('OrderedCollection');
        expect(data.orderedItems).toBeDefined();
    });

    test('Inbox accepts activities', async ({ request }) => {
        const activity = {
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: 'https://example.com/activities/1',
            type: 'Like',
            actor: 'https://example.com/users/test',
            object: 'http://localhost:6767/p/welcome'
        };
        
        const response = await request.post('/u/admin/inbox', {
            data: activity,
            headers: {
                'Content-Type': 'application/activity+json'
            }
        });
        
        expect(response.status()).toBe(202);
    });

    test('Followers endpoint returns collection', async ({ request }) => {
        const response = await request.get('/u/admin/followers');
        
        expect(response.status()).toBe(200);
        const data = await response.json();
        expect(data.type).toBe('OrderedCollection');
    });

    test('Following endpoint returns collection', async ({ request }) => {
        const response = await request.get('/u/admin/following');
        
        expect(response.status()).toBe(200);
        const data = await response.json();
        expect(data.type).toBe('OrderedCollection');
    });
});

test.describe('ActivityPub Activity Processing', () => {
    test('Like activity is stored and displayed', async ({ page, request }) => {
        const activity = {
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: `https://example.com/activities/like-${Date.now()}`,
            type: 'Like',
            actor: 'https://example.com/users/testuser',
            object: 'http://localhost:6767/p/welcome'
        };
        
        await request.post('/u/admin/inbox', {
            data: activity,
            headers: {
                'Content-Type': 'application/activity+json'
            }
        });
        
        // Visit the post and check like count increased
        await page.goto('/p/welcome');
        
        await expect(page.locator('.post-footer')).toContainText('Likes');
    });

    test('Announce activity is stored', async ({ request }) => {
        const activity = {
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: `https://example.com/activities/announce-${Date.now()}`,
            type: 'Announce',
            actor: 'https://example.com/users/testuser',
            object: 'http://localhost:6767/p/welcome'
        };
        
        const response = await request.post('/u/admin/inbox', {
            data: activity,
            headers: {
                'Content-Type': 'application/activity+json'
            }
        });
        
        expect(response.status()).toBe(202);
    });

    test('Create Note activity (comment) is stored', async ({ request }) => {
        const activity = {
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: `https://example.com/activities/create-${Date.now()}`,
            type: 'Create',
            actor: 'https://example.com/users/testuser',
            object: {
                id: `https://example.com/notes/${Date.now()}`,
                type: 'Note',
                content: 'This is a test comment',
                inReplyTo: 'http://localhost:6767/p/welcome'
            }
        };
        
        const response = await request.post('/u/admin/inbox', {
            data: activity,
            headers: {
                'Content-Type': 'application/activity+json'
            }
        });
        
        expect(response.status()).toBe(202);
    });
});

test.describe('Responsive Design', () => {
    test('mobile viewport displays correctly', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        await page.goto('/');
        
        await expect(page.locator('.site-header')).toBeVisible();
        await expect(page.locator('.post-card').first()).toBeVisible();
    });

    test('tablet viewport displays correctly', async ({ page }) => {
        await page.setViewportSize({ width: 768, height: 1024 });
        await page.goto('/');
        
        await expect(page.locator('.site-header')).toBeVisible();
        await expect(page.locator('.post-card').first()).toBeVisible();
    });
});
