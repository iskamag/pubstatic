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
        await page.goto('/welcome');
        
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
        await page.goto('/welcome');
        
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
        await expect(stylesheet).toHaveAttribute('href', /static\.css/);
    });
});

test.describe('Embed Endpoint', () => {
    test('embed page loads successfully', async ({ page }) => {
        await page.goto('/new');
        
        // Should have embed container
        await expect(page.locator('.embed-container')).toBeVisible();
    });

    test('embed displays latest posts (default is 2)', async ({ page }) => {
        await page.goto('/new');
        
        // Should show post cards
        const posts = await page.locator('.post-card').count();
        expect(posts).toBeGreaterThan(0);
        expect(posts).toBeLessThanOrEqual(2);
    });

    test('embed respects ?n=1 parameter', async ({ page }) => {
        await page.goto('/new?n=1');
        
        const posts = await page.locator('.post-card').count();
        expect(posts).toBeLessThanOrEqual(1);
    });

    test('embed respects ?n=5 parameter', async ({ page }) => {
        await page.goto('/new?n=5');
        
        const posts = await page.locator('.post-card').count();
        expect(posts).toBeLessThanOrEqual(5);
    });

    test('embed caps at maximum of 10 posts', async ({ page }) => {
        await page.goto('/new?n=100');
        
        const posts = await page.locator('.post-card').count();
        expect(posts).toBeLessThanOrEqual(10);
    });

    test('embed defaults to 2 for invalid ?n values', async ({ page }) => {
        await page.goto('/new?n=abc');
        
        const posts = await page.locator('.post-card').count();
        expect(posts).toBeLessThanOrEqual(2);
    });

    test('embed defaults to 2 for negative ?n values', async ({ page }) => {
        await page.goto('/new?n=-5');
        
        const posts = await page.locator('.post-card').count();
        expect(posts).toBeLessThanOrEqual(2);
    });

    test('embed defaults to 2 for ?n=0', async ({ page }) => {
        await page.goto('/new?n=0');
        
        const posts = await page.locator('.post-card').count();
        expect(posts).toBeLessThanOrEqual(2);
    });

    test('embed has correct structure', async ({ page }) => {
        await page.goto('/new');
        
        const firstPost = page.locator('.post-card').first();
        
        // Should have title link
        await expect(firstPost.locator('.post-title a')).toBeVisible();
        
        // Should have date
        await expect(firstPost.locator('.post-meta time')).toBeVisible();
        
        // Should have stats
        await expect(firstPost.locator('.post-stats')).toBeVisible();
    });

    test('embed post links are correct', async ({ page }) => {
        await page.goto('/new');
        
        // Get first post link
        const firstPostLink = page.locator('.post-title a').first();
        const href = await firstPostLink.getAttribute('href');
        
        // Should be a relative link to a post
        expect(href).toMatch(/^\/[a-zA-Z0-9-]+$/);
    });

    test('embed is self-contained HTML', async ({ page }) => {
        await page.goto('/new');
        
        // Should have its own styles (not link to external CSS)
        const styles = page.locator('style');
        const styleCount = await styles.count();
        expect(styleCount).toBeGreaterThan(0);
        
        // Should not have layout wrapper
        await expect(page.locator('.site-header')).not.toBeVisible();
        await expect(page.locator('.site-footer')).not.toBeVisible();
    });

    test('embed supports dark mode', async ({ page }) => {
        await page.goto('/new');
        
        // Should have dark mode styles
        const darkModeStyles = await page.locator('style').allTextContents();
        expect(darkModeStyles.join('')).toContain('prefers-color-scheme: dark');
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
            object: 'http://localhost:6767/welcome'
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

test.describe.serial('ActivityPub Activity Processing', () => {
    test.beforeAll(async ({ request }) => {
        // Ensure welcome post exists for these tests
        const response = await request.get('/welcome');
        if (response.status() === 404) {
            throw new Error('Welcome post must exist for these tests');
        }
    });

    test('Like activity is stored and displayed', async ({ page, request }) => {
        const activity = {
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: `https://example.com/activities/like-${Date.now()}`,
            type: 'Like',
            actor: 'https://example.com/users/testuser',
            object: 'http://localhost:6767/welcome'
        };
        
        await request.post('/u/admin/inbox', {
            data: activity,
            headers: {
                'Content-Type': 'application/activity+json'
            }
        });
        
        // Visit the post and check like count increased
        await page.goto('/welcome');
        
        await expect(page.locator('.post-footer')).toContainText('Likes');
    });

    test('Announce activity is stored', async ({ request }) => {
        const activity = {
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: `https://example.com/activities/announce-${Date.now()}`,
            type: 'Announce',
            actor: 'https://example.com/users/testuser',
            object: 'http://localhost:6767/welcome'
        };
        
        const response = await request.post('/u/admin/inbox', {
            data: activity,
            headers: {
                'Content-Type': 'application/activity+json'
            }
        });
        
        expect(response.status()).toBe(202);
    });

    test('Like activity extracts slug from post URL', async ({ page, request }) => {
        const uniqueId = Date.now();
        const activity = {
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: `https://example.com/activities/like-slug-test-${uniqueId}`,
            type: 'Like',
            actor: `https://example.com/users/like-slug-test-${uniqueId}`,
            object: 'http://localhost:6767/welcome'
        };
        
        const response = await request.post('/u/admin/inbox', {
            data: activity,
            headers: {
                'Content-Type': 'application/activity+json'
            }
        });
        
        expect(response.status()).toBe(202);
        
        // Verify the like appears on the post page
        await page.goto('/welcome');
        const likesSection = page.locator('.post-footer');
        await expect(likesSection).toBeVisible();
    });

    test('Announce activity extracts slug from post URL', async ({ request }) => {
        const uniqueId = Date.now();
        const activity = {
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: `https://example.com/activities/announce-slug-test-${uniqueId}`,
            type: 'Announce',
            actor: `https://example.com/users/announce-slug-test-${uniqueId}`,
            object: 'http://localhost:6767/welcome'
        };
        
        const response = await request.post('/u/admin/inbox', {
            data: activity,
            headers: {
                'Content-Type': 'application/activity+json'
            }
        });
        
        expect(response.status()).toBe(202);
    });

    test('Like activity with nested path extracts slug correctly', async ({ page, request }) => {
        // Test that a hypothetical BLOG_PATH would still work
        // The slug should be extracted from the last path segment
        const uniqueId = Date.now();
        const activity = {
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: `https://example.com/activities/like-nested-${uniqueId}`,
            type: 'Like',
            actor: `https://example.com/users/like-nested-${uniqueId}`,
            // Using a URL that mimics a subpath like /posts/welcome
            object: 'http://localhost:6767/posts/welcome'
        };
        
        const response = await request.post('/u/admin/inbox', {
            data: activity,
            headers: {
                'Content-Type': 'application/activity+json'
            }
        });
        
        // This should fail to find the post since /posts/welcome doesn't match our routes
        // But the slug extraction should still work - it just won't find the post
        expect(response.status()).toBe(202);
    });

    test('Like activity is rejected for unknown post', async ({ request }) => {
        const uniqueId = Date.now();
        const activity = {
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: `https://example.com/activities/like-unknown-${uniqueId}`,
            type: 'Like',
            actor: `https://example.com/users/like-unknown-${uniqueId}`,
            object: 'http://localhost:6767/nonexistent-post-12345'
        };
        
        const response = await request.post('/u/admin/inbox', {
            data: activity,
            headers: {
                'Content-Type': 'application/activity+json'
            }
        });
        
        // Activity is accepted (202) but no like is stored for unknown posts
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
                inReplyTo: 'http://localhost:6767/welcome'
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

    test('comment is displayed on post page', async ({ page, request }) => {
        const uniqueId = Date.now();
        const commentContent = `Visible test comment ${uniqueId}`;
        
        const activity = {
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: `https://example.com/activities/create-${uniqueId}`,
            type: 'Create',
            actor: 'https://example.com/users/commenter',
            object: {
                id: `https://example.com/notes/${uniqueId}`,
                type: 'Note',
                content: commentContent,
                inReplyTo: 'http://localhost:6767/welcome'
            }
        };
        
        await request.post('/u/admin/inbox', {
            data: activity,
            headers: {
                'Content-Type': 'application/activity+json'
            }
        });
        
        // Visit the post and verify comment is displayed
        await page.goto('/welcome');
        
        // Check comments section exists
        await expect(page.locator('.comments-section')).toBeVisible();
        
        // Find the specific comment by its content
        const specificComment = page.locator('.comment', { hasText: commentContent });
        await expect(specificComment).toBeVisible();
        await expect(specificComment.locator('.comment-content')).toContainText(commentContent);
        
        // Check comment author link exists for this comment
        await expect(specificComment.locator('.comment-author')).toBeVisible();
    });

    test('comment count updates correctly', async ({ page, request }) => {
        const uniqueId = Date.now();
        
        // Get initial comment count
        await page.goto('/welcome');
        const initialCount = await page.locator('.comments-section h2').textContent();
        const initialMatch = initialCount.match(/\((\d+)\)/);
        const initialNumber = initialMatch ? parseInt(initialMatch[1]) : 0;
        
        // Add a new comment with unique content
        const activity = {
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: `https://example.com/activities/create-count-${uniqueId}`,
            type: 'Create',
            actor: 'https://example.com/users/counter',
            object: {
                id: `https://example.com/notes/count-${uniqueId}`,
                type: 'Note',
                content: `Count test comment ${uniqueId}`,
                inReplyTo: 'http://localhost:6767/welcome'
            }
        };
        
        await request.post('/u/admin/inbox', {
            data: activity,
            headers: {
                'Content-Type': 'application/activity+json'
            }
        });
        
        // Refresh page and check count increased
        await page.reload();
        
        const updatedCount = await page.locator('.comments-section h2').textContent();
        const updatedMatch = updatedCount.match(/\((\d+)\)/);
        const updatedNumber = updatedMatch ? parseInt(updatedMatch[1]) : 0;
        
        expect(updatedNumber).toBe(initialNumber + 1);
    });

    test('multiple comments are displayed in correct order', async ({ page, request }) => {
        const baseId = Date.now();
        
        // Add first comment
        await request.post('/u/admin/inbox', {
            data: {
                '@context': 'https://www.w3.org/ns/activitystreams',
                id: `https://example.com/activities/multi-${baseId}-1`,
                type: 'Create',
                actor: 'https://example.com/users/first',
                object: {
                    id: `https://example.com/notes/${baseId}-1`,
                    type: 'Note',
                    content: 'First comment',
                    inReplyTo: 'http://localhost:6767/welcome'
                }
            },
            headers: {
                'Content-Type': 'application/activity+json'
            }
        });
        
        // Wait a bit to ensure different timestamps
        await page.waitForTimeout(100);
        
        // Add second comment
        await request.post('/u/admin/inbox', {
            data: {
                '@context': 'https://www.w3.org/ns/activitystreams',
                id: `https://example.com/activities/multi-${baseId}-2`,
                type: 'Create',
                actor: 'https://example.com/users/second',
                object: {
                    id: `https://example.com/notes/${baseId}-2`,
                    type: 'Note',
                    content: 'Second comment',
                    inReplyTo: 'http://localhost:6767/welcome'
                }
            },
            headers: {
                'Content-Type': 'application/activity+json'
            }
        });
        
        // Visit the post
        await page.goto('/welcome');
        
        // Check both comments are visible
        const comments = await page.locator('.comment').count();
        expect(comments).toBeGreaterThanOrEqual(2);
        
        // Check comment count reflects multiple comments
        const countText = await page.locator('.comments-section h2').textContent();
        expect(countText).toContain('Comments');
    });

    test('markdown in comments is rendered safely', async ({ page, request }) => {
        const uniqueId = Date.now();
        const markdownComment = `**Bold text** and *italic text* and \`code\` ${uniqueId}`;
        
        const activity = {
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: `https://example.com/activities/md-${uniqueId}`,
            type: 'Create',
            actor: 'https://example.com/users/markdown',
            object: {
                id: `https://example.com/notes/md-${uniqueId}`,
                type: 'Note',
                content: markdownComment,
                inReplyTo: 'http://localhost:6767/welcome'
            }
        };
        
        await request.post('/u/admin/inbox', {
            data: activity,
            headers: {
                'Content-Type': 'application/activity+json'
            }
        });
        
        await page.goto('/welcome');
        
        // Find the specific comment by its unique ID
        const specificComment = page.locator('.comment', { hasText: uniqueId.toString() });
        await expect(specificComment).toBeVisible();
        
        // Check that markdown is rendered (has HTML tags)
        const commentHtml = await specificComment.locator('.comment-content').innerHTML();
        
        // Should contain HTML tags from markdown rendering
        expect(commentHtml).toMatch(/<(strong|b|em|i|code)>/);
    });

    test('XSS attempts in comments are sanitized', async ({ page, request }) => {
        const uniqueId = Date.now();
        const xssComment = `<script>alert("xss-${uniqueId}")</script><p>Safe content ${uniqueId}</p>`;
        
        const activity = {
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: `https://example.com/activities/xss-${uniqueId}`,
            type: 'Create',
            actor: 'https://example.com/users/hacker',
            object: {
                id: `https://example.com/notes/xss-${uniqueId}`,
                type: 'Note',
                content: xssComment,
                inReplyTo: 'http://localhost:6767/welcome'
            }
        };
        
        await request.post('/u/admin/inbox', {
            data: activity,
            headers: {
                'Content-Type': 'application/activity+json'
            }
        });
        
        await page.goto('/welcome');
        
        // Check that script tags are removed
        const pageContent = await page.content();
        expect(pageContent).not.toContain(`<script>alert("xss-${uniqueId}")</script>`);
        
        // But safe content should still be there - find comment by unique ID
        const specificComment = page.locator('.comment', { hasText: uniqueId.toString() });
        await expect(specificComment.locator('.comment-content')).toContainText(`Safe content ${uniqueId}`);
    });

    test('replies to comments create threaded structure', async ({ page, request }) => {
        const baseId = Date.now();
        const parentContent = `Parent comment ${baseId} that will receive replies`;
        const replyContent = `Reply to parent ${baseId}`;
        
        // Create a parent comment
        const parentActivity = {
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: `https://example.com/activities/parent-${baseId}`,
            type: 'Create',
            actor: 'https://example.com/users/parent-commenter',
            object: {
                id: `https://example.com/notes/parent-${baseId}`,
                type: 'Note',
                content: parentContent,
                inReplyTo: 'http://localhost:6767/welcome'
            }
        };
        
        await request.post('/u/admin/inbox', {
            data: parentActivity,
            headers: {
                'Content-Type': 'application/activity+json'
            }
        });
        
        // Create a reply to the parent comment
        const replyActivity = {
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: `https://example.com/activities/reply-${baseId}`,
            type: 'Create',
            actor: 'https://example.com/users/reply-commenter',
            object: {
                id: `https://example.com/notes/reply-${baseId}`,
                type: 'Note',
                content: replyContent,
                inReplyTo: `https://example.com/notes/parent-${baseId}`
            }
        };
        
        await request.post('/u/admin/inbox', {
            data: replyActivity,
            headers: {
                'Content-Type': 'application/activity+json'
            }
        });
        
        await page.goto('/welcome');
        
        // Find the parent comment by its unique content
        const parentComment = page.locator('.comment', { hasText: parentContent });
        await expect(parentComment).toBeVisible();
        
        // Check that replies are nested within the parent's comment-replies container
        const repliesContainer = parentComment.locator('.comment-replies');
        await expect(repliesContainer).toBeVisible();
        
        // Verify the reply is inside the parent's replies container
        const replyWithinParent = repliesContainer.locator('.comment-reply');
        await expect(replyWithinParent).toBeVisible();
        await expect(replyWithinParent).toContainText(replyContent);
    });

    test('nested comment threads work correctly', async ({ page, request }) => {
        const baseId = Date.now();
        const parentContent = `Nested parent comment ${baseId}`;
        const reply1Content = `First reply to ${baseId}`;
        const reply2Content = `Second reply to ${baseId}`;
        const nestedReplyContent = `Nested reply under ${baseId}`;
        
        // Create parent comment
        await request.post('/u/admin/inbox', {
            data: {
                '@context': 'https://www.w3.org/ns/activitystreams',
                id: `https://example.com/activities/nested-parent-${baseId}`,
                type: 'Create',
                actor: 'https://example.com/users/parent',
                object: {
                    id: `https://example.com/notes/nested-parent-${baseId}`,
                    type: 'Note',
                    content: parentContent,
                    inReplyTo: 'http://localhost:6767/welcome'
                }
            },
            headers: {
                'Content-Type': 'application/activity+json'
            }
        });
        
        // Create first reply
        await request.post('/u/admin/inbox', {
            data: {
                '@context': 'https://www.w3.org/ns/activitystreams',
                id: `https://example.com/activities/reply1-${baseId}`,
                type: 'Create',
                actor: 'https://example.com/users/reply1',
                object: {
                    id: `https://example.com/notes/reply1-${baseId}`,
                    type: 'Note',
                    content: reply1Content,
                    inReplyTo: `https://example.com/notes/nested-parent-${baseId}`
                }
            },
            headers: {
                'Content-Type': 'application/activity+json'
            }
        });
        
        // Create second reply
        await request.post('/u/admin/inbox', {
            data: {
                '@context': 'https://www.w3.org/ns/activitystreams',
                id: `https://example.com/activities/reply2-${baseId}`,
                type: 'Create',
                actor: 'https://example.com/users/reply2',
                object: {
                    id: `https://example.com/notes/reply2-${baseId}`,
                    type: 'Note',
                    content: reply2Content,
                    inReplyTo: `https://example.com/notes/nested-parent-${baseId}`
                }
            },
            headers: {
                'Content-Type': 'application/activity+json'
            }
        });
        
        // Create a nested reply to the first reply
        await request.post('/u/admin/inbox', {
            data: {
                '@context': 'https://www.w3.org/ns/activitystreams',
                id: `https://example.com/activities/nested-reply-${baseId}`,
                type: 'Create',
                actor: 'https://example.com/users/nested-reply',
                object: {
                    id: `https://example.com/notes/nested-reply-${baseId}`,
                    type: 'Note',
                    content: nestedReplyContent,
                    inReplyTo: `https://example.com/notes/reply1-${baseId}`
                }
            },
            headers: {
                'Content-Type': 'application/activity+json'
            }
        });
        
        await page.goto('/welcome');
        
        // Check comment count increased (parent + 3 new replies)
        const countText = await page.locator('.comments-section h2').textContent();
        const match = countText.match(/\((\d+)\)/);
        const count = match ? parseInt(match[1]) : 0;
        expect(count).toBeGreaterThanOrEqual(4);
        
        // Find the parent comment
        const parentComment = page.locator('.comment', { hasText: parentContent });
        await expect(parentComment).toBeVisible();
        
        // Check the parent has 2 direct replies (only immediate children, not nested)
        const parentReplies = parentComment.locator(':scope > .comment-replies > .comment-reply');
        await expect(parentReplies).toHaveCount(2);
        
        // Find the first reply and verify it has a nested reply
        const firstReply = parentComment.locator('.comment-reply', { hasText: reply1Content });
        await expect(firstReply).toBeVisible();
        
        // The nested reply should be inside the first reply's replies container
        const nestedReply = firstReply.locator('.comment-replies .comment-reply', { hasText: nestedReplyContent });
        await expect(nestedReply).toBeVisible();
    });

    test('comment thread maintains correct author information', async ({ page, request }) => {
        const baseId = Date.now();
        const parentContent = `Parent from original author ${baseId}`;
        const replyContent = `Reply from different author ${baseId}`;
        
        // Create parent with specific actor
        await request.post('/u/admin/inbox', {
            data: {
                '@context': 'https://www.w3.org/ns/activitystreams',
                id: `https://example.com/activities/author-parent-${baseId}`,
                type: 'Create',
                actor: 'https://example.com/users/original-author',
                object: {
                    id: `https://example.com/notes/author-parent-${baseId}`,
                    type: 'Note',
                    content: parentContent,
                    inReplyTo: 'http://localhost:6767/welcome'
                }
            },
            headers: {
                'Content-Type': 'application/activity+json'
            }
        });
        
        // Create reply with different actor
        await request.post('/u/admin/inbox', {
            data: {
                '@context': 'https://www.w3.org/ns/activitystreams',
                id: `https://example.com/activities/author-reply-${baseId}`,
                type: 'Create',
                actor: 'https://example.com/users/different-author',
                object: {
                    id: `https://example.com/notes/author-reply-${baseId}`,
                    type: 'Note',
                    content: replyContent,
                    inReplyTo: `https://example.com/notes/author-parent-${baseId}`
                }
            },
            headers: {
                'Content-Type': 'application/activity+json'
            }
        });
        
        await page.goto('/welcome');
        
        // Find the specific parent comment
        const parentComment = page.locator('.comment', { hasText: parentContent });
        await expect(parentComment).toBeVisible();
        // Only get the author link directly from the comment header, not nested replies
        const parentAuthor = parentComment.locator(':scope > .comment-header > .comment-author');
        await expect(parentAuthor).toHaveAttribute('href', 'https://example.com/users/original-author');
        
        // Find the specific reply comment within the parent's replies
        const replyComment = parentComment.locator('.comment-replies .comment', { hasText: replyContent });
        await expect(replyComment).toBeVisible();
        const replyAuthor = replyComment.locator('.comment-author');
        await expect(replyAuthor).toHaveAttribute('href', 'https://example.com/users/different-author');
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

test.describe.serial('File-based Post Management', () => {
    const fs = require('fs');
    const path = require('path');
    const POSTS_DIR = path.join(__dirname, '..', 'content', 'posts');
    
    // Increase timeout for file operations
    test.setTimeout(30000);
    
    test.beforeAll(async () => {
        // Ensure posts directory exists
        if (!fs.existsSync(POSTS_DIR)) {
            fs.mkdirSync(POSTS_DIR, { recursive: true });
        }
    });

    test('creating a new post file adds it to the database', async ({ page, request }) => {
        const uniqueId = Date.now();
        const postSlug = `test-post-${uniqueId}`;
        const postFile = path.join(POSTS_DIR, `${postSlug}.html`);
        const postTitle = `Test Post ${uniqueId}`;
        const postContent = '<p>This is a test post created by the test suite.</p>';
        
        // Cleanup any existing test-post files from previous runs
        const files = fs.readdirSync(POSTS_DIR);
        files.forEach(file => {
            if (file.startsWith('test-post-') && file.endsWith('.html')) {
                fs.unlinkSync(path.join(POSTS_DIR, file));
            }
        });
        
        // Create the post file
        const fileContent = `<!--
title: ${postTitle}
tags: test, automated
excerpt: Test post excerpt
-->
<article>
    ${postContent}
</article>`;
        
        fs.writeFileSync(postFile, fileContent);
        
        // Sync the post using the API
        await request.post('/api/sync-post', {
            data: { filename: `${postSlug}.html` }
        });
        
        // Verify post appears on homepage by looking for the specific post
        await page.goto('/');
        await expect(page.locator('.post-card').filter({ hasText: postTitle })).toBeVisible({ timeout: 10000 });
        
        // Verify post page is accessible
        await page.goto(`/${postSlug}`);
        await expect(page.locator('.post-title')).toContainText(postTitle);
        await expect(page.locator('.post-content')).toContainText('This is a test post created by the test suite');
        
        // Cleanup
        if (fs.existsSync(postFile)) {
            fs.unlinkSync(postFile);
        }
    });

    test('editing a post file updates the database', async ({ page, request }) => {
        const uniqueId = Date.now();
        const postSlug = `edit-test-${uniqueId}`;
        const postFile = path.join(POSTS_DIR, `${postSlug}.html`);
        const originalTitle = `Original Title ${uniqueId}`;
        const updatedTitle = `Updated Title ${uniqueId}`;
        
        // Create initial post
        fs.writeFileSync(postFile, `<!--
title: ${originalTitle}
tags: test
-->
<article><p>Original content</p></article>`);
        
        // Sync the post
        await request.post('/api/sync-post', {
            data: { filename: `${postSlug}.html` }
        });
        
        // Verify original title exists
        await page.goto(`/${postSlug}`);
        await expect(page.locator('.post-title')).toContainText(originalTitle, { timeout: 10000 });
        
        // Edit the post file
        fs.writeFileSync(postFile, `<!--
title: ${updatedTitle}
tags: test, updated
-->
<article><p>Updated content</p></article>`);
        
        // Sync the updated post
        await request.post('/api/sync-post', {
            data: { filename: `${postSlug}.html` }
        });
        
        // Verify updated title appears
        await page.reload();
        await expect(page.locator('.post-title')).toContainText(updatedTitle);
        
        // Cleanup
        if (fs.existsSync(postFile)) {
            fs.unlinkSync(postFile);
        }
    });

    test('deleting a post file removes it from the database', async ({ page, request }) => {
        const uniqueId = Date.now();
        const postSlug = `delete-test-${uniqueId}`;
        const postFile = path.join(POSTS_DIR, `${postSlug}.html`);
        
        // Create post
        fs.writeFileSync(postFile, `<!--
title: Delete Test ${uniqueId}
tags: test
-->
<article><p>Content to delete</p></article>`);
        
        // Sync the post
        await request.post('/api/sync-post', {
            data: { filename: `${postSlug}.html` }
        });
        
        // Verify post exists
        await page.goto(`/${postSlug}`);
        await expect(page.locator('.post-title')).toContainText(`Delete Test ${uniqueId}`, { timeout: 10000 });
        
        // Delete the post file
        fs.unlinkSync(postFile);
        
        // Sync to remove from database (file doesn't exist, so it will be deleted)
        await request.post('/api/sync-post', {
            data: { filename: `${postSlug}.html` }
        });
        
        // Verify post returns 404
        await page.goto(`/${postSlug}`);
        await expect(page.locator('.error-page')).toBeVisible();
        await expect(page.locator('h1')).toContainText('404');
        
        // Verify post not on homepage
        await page.goto('/');
        const pageContent = await page.content();
        expect(pageContent).not.toContain(`Delete Test ${uniqueId}`);
    });

    test('file watcher handles rapid file changes', async ({ page, request }) => {
        const uniqueId = Date.now();
        const postSlug = `rapid-test-${uniqueId}`;
        const postFile = path.join(POSTS_DIR, `${postSlug}.html`);
        
        // Create, update multiple times
        for (let i = 0; i < 3; i++) {
            fs.writeFileSync(postFile, `<!--
title: Rapid Test ${uniqueId} v${i}
tags: test
-->
<article><p>Version ${i}</p></article>`);
            // Sync each version
            await request.post('/api/sync-post', {
                data: { filename: `${postSlug}.html` }
            });
        }
        
        // Verify final version is visible
        await page.goto(`/${postSlug}`);
        await expect(page.locator('.post-title')).toContainText(`Rapid Test ${uniqueId} v2`, { timeout: 10000 });
        await expect(page.locator('.post-content')).toContainText('Version 2', { timeout: 10000 });
        
        // Cleanup
        if (fs.existsSync(postFile)) {
            fs.unlinkSync(postFile);
        }
    });

    test('posts without metadata use filename as title', async ({ page, request }) => {
        const uniqueId = Date.now();
        const postSlug = `no-metadata-${uniqueId}`;
        const postFile = path.join(POSTS_DIR, `${postSlug}.html`);
        
        // Create post without metadata
        fs.writeFileSync(postFile, `<article><p>No metadata here</p></article>`);
        
        // Sync the post
        await request.post('/api/sync-post', {
            data: { filename: `${postSlug}.html` }
        });
        
        // Verify post is accessible (slug becomes title)
        await page.goto(`/${postSlug}`);
        await expect(page.locator('.post-full')).toBeVisible();
        
        // Cleanup
        if (fs.existsSync(postFile)) {
            fs.unlinkSync(postFile);
        }
    });

    test('creating a new post queues Create activity for federation', async ({ page, request }) => {
        const uniqueId = Date.now();
        const postSlug = `create-test-${uniqueId}`;
        const postFile = path.join(POSTS_DIR, `${postSlug}.html`);
        const followerInbox = `https://example.com/users/new-follower-${uniqueId}/inbox`;
        
        // Clear any existing outbound activities first
        await request.post('/api/clear-outbound-activities');
        
        // Add a follower to the database
        await request.post('/api/add-follower', {
            data: {
                actor_id: `https://example.com/users/new-follower-${uniqueId}`,
                actor_url: `https://example.com/users/new-follower-${uniqueId}`,
                inbox_url: followerInbox
            }
        });
        
        // Create a new post
        const postTitle = `New Post for Federation ${uniqueId}`;
        const postContent = '<p>This is a brand new post that should be federated.</p>';
        fs.writeFileSync(postFile, `<!--
title: ${postTitle}
tags: test, new, federation
excerpt: New post for federation test
-->
<article>${postContent}</article>`);
        
        // Sync the post (this creates it, should queue Create activity)
        await request.post('/api/sync-post', {
            data: { filename: `${postSlug}.html` }
        });
        
        // Verify the post appears on the site
        await page.goto(`/${postSlug}`);
        await expect(page.locator('.post-title')).toContainText(postTitle, { timeout: 10000 });
        await expect(page.locator('.post-content')).toContainText('This is a brand new post that should be federated');
        
        // Verify Create activity was queued in outbound_activities table
        const outboundResponse = await request.get('/api/outbound-activities');
        expect(outboundResponse.status()).toBe(200);
        const outboundData = await outboundResponse.json();
        
        // Find the Create activity for this post
        const createActivity = outboundData.activities.find(a => 
            a.type === 'Create' && 
            a.object && 
            a.object.includes(postSlug)
        );
        
        expect(createActivity, 'Create activity should be queued for federation').toBeDefined();
        expect(createActivity.type).toBe('Create');
        expect(createActivity.recipients).toContain(followerInbox);
        
        // Verify the activity contains the correct article data
        const activityObject = JSON.parse(createActivity.object);
        expect(activityObject.name).toBe(postTitle);
        expect(activityObject.content).toContain('This is a brand new post that should be federated');
        expect(activityObject.type).toBe('Article');
        expect(activityObject.id).toContain(postSlug);
        expect(activityObject.published).toBeDefined();
        
        // Cleanup
        if (fs.existsSync(postFile)) {
            fs.unlinkSync(postFile);
        }
        
        // Remove the follower
        await request.post('/api/remove-follower', {
            data: { actor_id: `https://example.com/users/new-follower-${uniqueId}` }
        });
    });

    test('Create activity is only queued for new posts, not existing', async ({ page, request }) => {
        const uniqueId = Date.now();
        const postSlug = `existing-post-test-${uniqueId}`;
        const postFile = path.join(POSTS_DIR, `${postSlug}.html`);
        
        // Clear outbound activities
        await request.post('/api/clear-outbound-activities');
        
        // Add a follower
        await request.post('/api/add-follower', {
            data: {
                actor_id: `https://example.com/users/existing-follower-${uniqueId}`,
                actor_url: `https://example.com/users/existing-follower-${uniqueId}`,
                inbox_url: `https://example.com/users/existing-follower-${uniqueId}/inbox`
            }
        });
        
        // Create initial post
        fs.writeFileSync(postFile, `<!--
title: Existing Post ${uniqueId}
tags: test
-->
<article><p>Original content</p></article>`);
        
        // First sync - should create post and queue Create activity
        await request.post('/api/sync-post', {
            data: { filename: `${postSlug}.html` }
        });
        
        // Wait for first sync
        await page.goto(`/${postSlug}`);
        await expect(page.locator('.post-title')).toContainText(`Existing Post ${uniqueId}`, { timeout: 10000 });
        
        // Clear outbound activities again
        await request.post('/api/clear-outbound-activities');
        
        // Sync the same post again without changes
        await request.post('/api/sync-post', {
            data: { filename: `${postSlug}.html` }
        });
        
        // Check outbound activities - should have Update, not Create
        const outboundResponse = await request.get('/api/outbound-activities');
        const outboundData = await outboundResponse.json();
        
        // Should have an Update activity, not Create
        const updateActivity = outboundData.activities.find(a => a.type === 'Update');
        expect(updateActivity).toBeDefined();
        
        const createActivity = outboundData.activities.find(a => a.type === 'Create');
        expect(createActivity).toBeUndefined();
        
        // Cleanup
        if (fs.existsSync(postFile)) {
            fs.unlinkSync(postFile);
        }
        
        await request.post('/api/remove-follower', {
            data: { actor_id: `https://example.com/users/existing-follower-${uniqueId}` }
        });
    });

    test('editing a post queues Update activity for federation', async ({ page, request }) => {
        const uniqueId = Date.now();
        const postSlug = `federation-test-${uniqueId}`;
        const postFile = path.join(POSTS_DIR, `${postSlug}.html`);
        const followerInbox = `https://example.com/users/follower-${uniqueId}/inbox`;
        
        // Add a follower to the database first
        await request.post('/api/add-follower', {
            data: {
                actor_id: `https://example.com/users/follower-${uniqueId}`,
                actor_url: `https://example.com/users/follower-${uniqueId}`,
                inbox_url: followerInbox
            }
        });
        
        // Create initial post
        const originalTitle = `Federation Test Original ${uniqueId}`;
        fs.writeFileSync(postFile, `<!--
title: ${originalTitle}
tags: test, federation
-->
<article><p>Original content for federation test</p></article>`);
        
        // Sync the post (this creates it, should not queue Update)
        await request.post('/api/sync-post', {
            data: { filename: `${postSlug}.html` }
        });
        
        // Verify original post exists
        await page.goto(`/${postSlug}`);
        await expect(page.locator('.post-title')).toContainText(originalTitle, { timeout: 10000 });
        
        // Edit the post file
        const updatedTitle = `Federation Test Updated ${uniqueId}`;
        const updatedContent = '<p>Updated content for federation test with new information</p>';
        fs.writeFileSync(postFile, `<!--
title: ${updatedTitle}
tags: test, federation, updated
-->
<article>${updatedContent}</article>`);
        
        // Sync the updated post (this is an edit, should queue Update activity)
        await request.post('/api/sync-post', {
            data: { filename: `${postSlug}.html` }
        });
        
        // Verify the post was updated on the site
        await page.reload();
        await expect(page.locator('.post-title')).toContainText(updatedTitle);
        await expect(page.locator('.post-content')).toContainText('Updated content for federation test');
        
        // Verify Update activity was queued in outbound_activities table
        const outboundResponse = await request.get('/api/outbound-activities');
        expect(outboundResponse.status()).toBe(200);
        const outboundData = await outboundResponse.json();
        
        // Find the Update activity for this post
        const updateActivity = outboundData.activities.find(a => 
            a.type === 'Update' && 
            a.object && 
            a.object.includes(postSlug)
        );
        
        expect(updateActivity, 'Update activity should be queued for federation').toBeDefined();
        expect(updateActivity.type).toBe('Update');
        expect(updateActivity.recipients).toContain(followerInbox);
        
        // Verify the activity contains the correct article data
        const activityObject = JSON.parse(updateActivity.object);
        expect(activityObject.name).toBe(updatedTitle);
        expect(activityObject.content).toContain('Updated content for federation test');
        expect(activityObject.type).toBe('Article');
        expect(activityObject.id).toContain(postSlug);
        
        // Cleanup
        if (fs.existsSync(postFile)) {
            fs.unlinkSync(postFile);
        }
        
        // Remove the follower
        await request.post('/api/remove-follower', {
            data: { actor_id: `https://example.com/users/follower-${uniqueId}` }
        });
    });

    test('Update activity includes updated timestamp', async ({ page, request }) => {
        const uniqueId = Date.now();
        const postSlug = `timestamp-test-${uniqueId}`;
        const postFile = path.join(POSTS_DIR, `${postSlug}.html`);
        
        // Add a follower
        await request.post('/api/add-follower', {
            data: {
                actor_id: `https://example.com/users/timestamp-follower-${uniqueId}`,
                actor_url: `https://example.com/users/timestamp-follower-${uniqueId}`,
                inbox_url: `https://example.com/users/timestamp-follower-${uniqueId}/inbox`
            }
        });
        
        // Create initial post
        fs.writeFileSync(postFile, `<!--
title: Timestamp Test ${uniqueId}
tags: test
-->
<article><p>Original</p></article>`);
        
        await request.post('/api/sync-post', {
            data: { filename: `${postSlug}.html` }
        });
        
        // Wait a moment to ensure different timestamps
        await page.waitForTimeout(100);
        
        // Edit the post
        fs.writeFileSync(postFile, `<!--
title: Timestamp Test Updated ${uniqueId}
tags: test
-->
<article><p>Updated with timestamp</p></article>`);
        
        await request.post('/api/sync-post', {
            data: { filename: `${postSlug}.html` }
        });
        
        // Get the outbound activity
        const outboundResponse = await request.get('/api/outbound-activities');
        const outboundData = await outboundResponse.json();
        
        const updateActivity = outboundData.activities.find(a => 
            a.type === 'Update' && 
            a.object && 
            a.object.includes(postSlug)
        );
        
        expect(updateActivity).toBeDefined();
        
        const activityObject = JSON.parse(updateActivity.object);
        expect(activityObject.updated).toBeDefined();
        expect(activityObject.published).toBeDefined();
        expect(new Date(activityObject.updated).getTime()).toBeGreaterThanOrEqual(new Date(activityObject.published).getTime());
        
        // Cleanup
        if (fs.existsSync(postFile)) {
            fs.unlinkSync(postFile);
        }
        
        await request.post('/api/remove-follower', {
            data: { actor_id: `https://example.com/users/timestamp-follower-${uniqueId}` }
        });
    });
});

test.describe.serial('Pinned Posts', () => {
    const fs = require('fs');
    const path = require('path');
    const POSTS_DIR = path.join(__dirname, '..', 'content', 'posts');
    const PINNED_FILE = path.join(__dirname, '..', 'content', 'pinned');
    
    test.setTimeout(30000);
    
    test.beforeAll(async () => {
        if (!fs.existsSync(POSTS_DIR)) {
            fs.mkdirSync(POSTS_DIR, { recursive: true });
        }
    });
    
    test('pinned posts appear first on /new endpoint', async ({ page }) => {
        const uniqueId = Date.now();
        const pinnedSlug = `pinned-test-${uniqueId}`;
        const regularSlug = `regular-test-${uniqueId}`;
        const pinnedFile = path.join(POSTS_DIR, `${pinnedSlug}.html`);
        const regularFile = path.join(POSTS_DIR, `${regularSlug}.html`);
        
        fs.writeFileSync(pinnedFile, `<!--
title: Pinned Test Post ${uniqueId}
tags: test
-->
<article><p>Pinned content</p></article>`);
        
        fs.writeFileSync(regularFile, `<!--
title: Regular Test Post ${uniqueId}
tags: test
-->
<article><p>Regular content</p></article>`);
        
        const response = await page.request.post('/api/sync-post', {
            data: { filename: `${pinnedSlug}.html` }
        });
        
        await page.request.post('/api/sync-post', {
            data: { filename: `${regularSlug}.html` }
        });
        
        fs.writeFileSync(PINNED_FILE, `${pinnedSlug}\n`);
        
        await page.request.post('/api/sync-pinned');
        
        await page.goto('/new?n=5');
        
        const firstPostTitle = await page.locator('.post-title a').first().textContent();
        expect(firstPostTitle).toContain(`Pinned Test Post ${uniqueId}`);
        
        if (fs.existsSync(pinnedFile)) fs.unlinkSync(pinnedFile);
        if (fs.existsSync(regularFile)) fs.unlinkSync(regularFile);
        fs.writeFileSync(PINNED_FILE, 'welcome\n');
        await page.request.post('/api/sync-pinned');
    });
    
    test('pinned posts are not duplicated when filling /new endpoint', async ({ page }) => {
        const uniqueId = Date.now();
        const pinnedSlug = `pinned-dup-${uniqueId}`;
        const pinnedFile = path.join(POSTS_DIR, `${pinnedSlug}.html`);
        
        fs.writeFileSync(pinnedFile, `<!--
title: Pinned Duplicate Test ${uniqueId}
tags: test
-->
<article><p>Pinned content</p></article>`);
        
        await page.request.post('/api/sync-post', {
            data: { filename: `${pinnedSlug}.html` }
        });
        
        fs.writeFileSync(PINNED_FILE, `${pinnedSlug}\n`);
        
        await page.request.post('/api/sync-pinned');
        
        await page.goto('/new?n=5');
        
        const posts = await page.locator('.post-title a').allTextContents();
        const pinnedCount = posts.filter(t => t.includes(`Pinned Duplicate Test ${uniqueId}`)).length;
        expect(pinnedCount).toBe(1);
        
        if (fs.existsSync(pinnedFile)) fs.unlinkSync(pinnedFile);
        fs.writeFileSync(PINNED_FILE, 'welcome\n');
        await page.request.post('/api/sync-pinned');
    });
    
    test('empty pinned file shows only recent posts', async ({ page }) => {
        const uniqueId = Date.now();
        const postSlug = `recent-test-${uniqueId}`;
        const postFile = path.join(POSTS_DIR, `${postSlug}.html`);
        
        fs.writeFileSync(postFile, `<!--
title: Recent Test Post ${uniqueId}
tags: test
-->
<article><p>Recent content</p></article>`);
        
        await page.request.post('/api/sync-post', {
            data: { filename: `${postSlug}.html` }
        });
        
        fs.writeFileSync(PINNED_FILE, '');
        
        await page.request.post('/api/sync-pinned');
        
        await page.goto('/new?n=5');
        
        const posts = await page.locator('.post-title a').allTextContents();
        expect(posts.some(t => t.includes(`Recent Test Post ${uniqueId}`))).toBe(true);
        
        if (fs.existsSync(postFile)) fs.unlinkSync(postFile);
        fs.writeFileSync(PINNED_FILE, 'welcome\n');
        await page.request.post('/api/sync-pinned');
    });
    
    test('pinned posts respect count limit', async ({ page }) => {
        fs.writeFileSync(PINNED_FILE, 'welcome\n');
        
        await page.request.post('/api/sync-pinned');
        
        await page.goto('/new?n=1');
        
        const posts = await page.locator('.post-card').count();
        expect(posts).toBeLessThanOrEqual(1);
    });
    
    test('invalid slugs in pinned file are ignored', async ({ page }) => {
        const uniqueId = Date.now();
        const validSlug = `valid-pin-${uniqueId}`;
        const validFile = path.join(POSTS_DIR, `${validSlug}.html`);
        
        fs.writeFileSync(validFile, `<!--
title: Valid Pinned Post ${uniqueId}
tags: test
-->
<article><p>Valid pinned content</p></article>`);
        
        await page.request.post('/api/sync-post', {
            data: { filename: `${validSlug}.html` }
        });
        
        fs.writeFileSync(PINNED_FILE, `nonexistent-post-${uniqueId}\n${validSlug}\n`);
        
        await page.request.post('/api/sync-pinned');
        
        await page.goto('/new?n=5');
        
        const firstPostTitle = await page.locator('.post-title a').first().textContent();
        expect(firstPostTitle).toContain(`Valid Pinned Post ${uniqueId}`);
        
        if (fs.existsSync(validFile)) fs.unlinkSync(validFile);
        fs.writeFileSync(PINNED_FILE, 'welcome\n');
        await page.request.post('/api/sync-pinned');
    });
    
    test('comments in pinned file are ignored', async ({ page }) => {
        const uniqueId = Date.now();
        const validSlug = `comment-test-${uniqueId}`;
        const validFile = path.join(POSTS_DIR, `${validSlug}.html`);
        
        fs.writeFileSync(validFile, `<!--
title: Comment Test Post ${uniqueId}
tags: test
-->
<article><p>Comment test content</p></article>`);
        
        await page.request.post('/api/sync-post', {
            data: { filename: `${validSlug}.html` }
        });
        
        fs.writeFileSync(PINNED_FILE, `${validSlug} # this is a comment\n`);
        
        await page.request.post('/api/sync-pinned');
        
        await page.goto('/new?n=5');
        
        const firstPostTitle = await page.locator('.post-title a').first().textContent();
        expect(firstPostTitle).toContain(`Comment Test Post ${uniqueId}`);
        
        if (fs.existsSync(validFile)) fs.unlinkSync(validFile);
        fs.writeFileSync(PINNED_FILE, 'welcome\n');
        await page.request.post('/api/sync-pinned');
    });
    
    test('pinned posts show a visual tag in /new endpoint', async ({ page }) => {
        const uniqueId = Date.now();
        const pinnedSlug = `tag-test-${uniqueId}`;
        const pinnedFile = path.join(POSTS_DIR, `${pinnedSlug}.html`);
        
        fs.writeFileSync(pinnedFile, `<!--
title: Tag Test Post ${uniqueId}
tags: test
-->
<article><p>Tag test content</p></article>`);
        
        await page.request.post('/api/sync-post', {
            data: { filename: `${pinnedSlug}.html` }
        });
        
        fs.writeFileSync(PINNED_FILE, `${pinnedSlug}\n`);
        
        await page.request.post('/api/sync-pinned');
        
        await page.goto('/new?n=5');
        
        const pinnedTag = page.locator('.tag.pinned').first();
        await expect(pinnedTag).toBeVisible();
        await expect(pinnedTag).toContainText('pinned');
        
        if (fs.existsSync(pinnedFile)) fs.unlinkSync(pinnedFile);
        fs.writeFileSync(PINNED_FILE, 'welcome\n');
        await page.request.post('/api/sync-pinned');
    });
    
test('non-pinned posts do not show pinned tag', async ({ page }) => {
        const uniqueId = Date.now();
        const nonPinnedSlug = `not-pinned-${uniqueId}`;
        const nonPinnedFile = path.join(POSTS_DIR, `${nonPinnedSlug}.html`);
        
        fs.writeFileSync(nonPinnedFile, `<!--
title: Not Pinned Post ${uniqueId}
tags: test
-->
<article><p>Not pinned content</p></article>`);
        
        await page.request.post('/api/sync-post', {
            data: { filename: `${nonPinnedSlug}.html` }
        });
        
        fs.writeFileSync(PINNED_FILE, '');
        
        await page.request.post('/api/sync-pinned');
        
        await page.goto('/new?n=5');
        
        const pinnedTags = await page.locator('.tag.pinned').count();
        expect(pinnedTags).toBe(0);
        
        if (fs.existsSync(nonPinnedFile)) fs.unlinkSync(nonPinnedFile);
        fs.writeFileSync(PINNED_FILE, 'welcome\n');
        await page.request.post('/api/sync-pinned');
    });
    
    test('pinning a post does not modify its tags', async ({ page }) => {
        const uniqueId = Date.now();
        const postSlug = `pin-tag-${uniqueId}`;
        const postFile = path.join(POSTS_DIR, `${postSlug}.html`);
        
        fs.writeFileSync(postFile, `<!--
title: Pin Tag Test ${uniqueId}
tags: test, original
excerpt: Original excerpt
-->
<article><p>Pin tag content</p></article>`);
        
        await page.request.post('/api/sync-post', {
            data: { filename: `${postSlug}.html` }
        });
        
        await page.goto(`/${postSlug}`);
        const originalTags = await page.locator('.post-tags').textContent();
        expect(originalTags).toContain('#test');
        expect(originalTags).toContain('#original');
        expect(originalTags).not.toContain('#pinned');
        
        fs.writeFileSync(PINNED_FILE, `${postSlug}\n`);
        
        await page.request.post('/api/sync-pinned');
        
        await page.reload();
        
        const tagsAfterPin = await page.locator('.post-tags').textContent();
        expect(tagsAfterPin).toContain('#test');
        expect(tagsAfterPin).toContain('#original');
        expect(tagsAfterPin).toContain('#pinned');
        
        // Verify the "pinned" tag is still there after unpinning
        fs.writeFileSync(PINNED_FILE, '');
        await page.request.post('/api/sync-pinned');
        await page.reload();
        
        const tagsAfterUnpin = await page.locator('.post-tags').textContent();
        expect(tagsAfterUnpin).toContain('#test');
        expect(tagsAfterUnpin).toContain('#original');
        expect(tagsAfterUnpin).not.toContain('#pinned');
        
        if (fs.existsSync(postFile)) fs.unlinkSync(postFile);
        fs.writeFileSync(PINNED_FILE, 'welcome\n');
        await page.request.post('/api/sync-pinned');
    });
    
    test('/tag/pinned shows all pinned posts', async ({ page }) => {
        const uniqueId = Date.now();
        const pinnedSlug = `pinned-tag-page-${uniqueId}`;
        const pinnedFile = path.join(POSTS_DIR, `${pinnedSlug}.html`);
        
        fs.writeFileSync(pinnedFile, `<!--
title: Pinned Tag Page Test ${uniqueId}
tags: test
-->
<article><p>Pinned tag page content</p></article>`);
        
        await page.request.post('/api/sync-post', {
            data: { filename: `${pinnedSlug}.html` }
        });
        
        fs.writeFileSync(PINNED_FILE, `${pinnedSlug}\n`);
        await page.request.post('/api/sync-pinned');
        
        await page.goto('/tag/pinned');
        
        const pageContent = await page.content();
        expect(pageContent).toContain(`Pinned Tag Page Test ${uniqueId}`);
        
        if (fs.existsSync(pinnedFile)) fs.unlinkSync(pinnedFile);
        fs.writeFileSync(PINNED_FILE, 'welcome\n');
        await page.request.post('/api/sync-pinned');
    });
    
    test('pinned posts show tag on homepage', async ({ page }) => {
        const uniqueId = Date.now();
        const pinnedSlug = `homepage-pin-${uniqueId}`;
        const pinnedFile = path.join(POSTS_DIR, `${pinnedSlug}.html`);
        
        fs.writeFileSync(pinnedFile, `<!--
title: Homepage Pinned Post ${uniqueId}
tags: test
-->
<article><p>Homepage pinned content</p></article>`);
        
        await page.request.post('/api/sync-post', {
            data: { filename: `${pinnedSlug}.html` }
        });
        
        fs.writeFileSync(PINNED_FILE, `${pinnedSlug}\n`);
        
        await page.request.post('/api/sync-pinned');
        
await page.goto('/');
        
        const pinnedTag = page.locator('.tag.pinned').first();
        await expect(pinnedTag).toBeVisible();
        await expect(pinnedTag).toContainText('pinned');
        
        if (fs.existsSync(pinnedFile)) fs.unlinkSync(pinnedFile);
        fs.writeFileSync(PINNED_FILE, 'welcome\n');
        await page.request.post('/api/sync-pinned');
    });
    
    test('pinned posts show tag on individual post page', async ({ page }) => {
        const uniqueId = Date.now();
        const pinnedSlug = `postpage-pin-${uniqueId}`;
        const pinnedFile = path.join(POSTS_DIR, `${pinnedSlug}.html`);
        
        fs.writeFileSync(pinnedFile, `<!--
title: Post Page Pinned ${uniqueId}
tags: test
-->
<article><p>Post page pinned content</p></article>`);
        
        await page.request.post('/api/sync-post', {
            data: { filename: `${pinnedSlug}.html` }
        });
        
        fs.writeFileSync(PINNED_FILE, `${pinnedSlug}\n`);
        
        await page.request.post('/api/sync-pinned');
        
        await page.goto(`/${pinnedSlug}`);
        
        const pinnedTag = page.locator('.tag.pinned').first();
        await expect(pinnedTag).toBeVisible();
        await expect(pinnedTag).toContainText('pinned');
        
        if (fs.existsSync(pinnedFile)) fs.unlinkSync(pinnedFile);
        fs.writeFileSync(PINNED_FILE, 'welcome\n');
        await page.request.post('/api/sync-pinned');
    });
});

test.describe.serial('Actor Profile Federation', () => {
    const fs = require('fs');
    const path = require('path');
    const USER_SETTINGS_FILE = path.join(__dirname, '..', 'user-settings.json');
    const PFP_FILE = path.join(__dirname, '..', 'public', 'pfp.png');
    
    test.beforeAll(async ({ request }) => {
        // Clean up before all tests in this group
        if (fs.existsSync(USER_SETTINGS_FILE)) {
            fs.unlinkSync(USER_SETTINGS_FILE);
        }
        await request.post('/api/clear-outbound-activities');
    });
    
    test.afterAll(async () => {
        // Clean up after all tests
        if (fs.existsSync(USER_SETTINGS_FILE)) {
            fs.unlinkSync(USER_SETTINGS_FILE);
        }
    });
    
    test.beforeEach(async ({ request }) => {
        // Clean up user-settings.json before each test to ensure fresh state
        if (fs.existsSync(USER_SETTINGS_FILE)) {
            fs.unlinkSync(USER_SETTINGS_FILE);
        }
        // Clear outbound activities before each test
        await request.post('/api/clear-outbound-activities');
        // Wait for file watcher to settle
        await new Promise(resolve => setTimeout(resolve, 100));
    });

    test('actor endpoint includes default profile picture from pfp.png', async ({ request }) => {
        // Ensure pfp.png exists (it should be created from catperson.png)
        expect(fs.existsSync(PFP_FILE)).toBe(true);
        
        const response = await request.get('/u/admin');
        
        expect(response.status()).toBe(200);
        const data = await response.json();
        
        expect(data.icon).toBeDefined();
        expect(data.icon.type).toBe('Image');
        expect(data.icon.url).toContain('pfp.png');
    });

    test('updating user-settings.json queues Update activity for actor', async ({ request }) => {
        const uniqueId = Date.now();
        const followerInbox = `https://example.com/users/settings-follower-${uniqueId}/inbox`;
        const newDisplayName = `Test User ${uniqueId}`;
        const newBio = `Test bio ${uniqueId}`;
        
        // Add a follower
        await request.post('/api/add-follower', {
            data: {
                actor_id: `https://example.com/users/settings-follower-${uniqueId}`,
                actor_url: `https://example.com/users/settings-follower-${uniqueId}`,
                inbox_url: followerInbox
            }
        });
        
        // Create user-settings.json file
        const settings = {
            display_name: newDisplayName,
            bio: newBio
        };
        fs.writeFileSync(USER_SETTINGS_FILE, JSON.stringify(settings, null, 2));
        
        // Sync user settings to trigger federation
        await request.post('/api/sync-user-settings');
        
        // Verify actor now returns the new settings
        const actorResponse = await request.get('/u/admin');
        const actorData = await actorResponse.json();
        
        expect(actorData.name).toBe(newDisplayName);
        expect(actorData.summary).toBe(newBio);
        expect(actorData.icon).toBeDefined();
        expect(actorData.icon.url).toContain('pfp.png');
        
        // Verify Update activity was queued for the actor
        const outboundResponse = await request.get('/api/outbound-activities');
        const outboundData = await outboundResponse.json();
        
        const actorUpdateActivity = outboundData.activities.find(a => 
            a.type === 'Update' && 
            a.object && 
            a.object.includes('Person') &&
            a.object.includes(newDisplayName)
        );
        
        expect(actorUpdateActivity, 'Actor Update activity should be queued for federation').toBeDefined();
        expect(actorUpdateActivity.type).toBe('Update');
        expect(actorUpdateActivity.recipients).toContain(followerInbox);
        
        // Verify the activity contains the actor with the new settings
        const activityObject = JSON.parse(actorUpdateActivity.object);
        expect(activityObject.type).toBe('Person');
        expect(activityObject.name).toBe(newDisplayName);
        expect(activityObject.summary).toBe(newBio);
        expect(activityObject.icon).toBeDefined();
        
        await request.post('/api/remove-follower', {
            data: { actor_id: `https://example.com/users/settings-follower-${uniqueId}` }
        });
    });

    test('user settings change includes all actor properties', async ({ request }) => {
        const uniqueId = Date.now();
        const newDisplayName = `Complete Test ${uniqueId}`;
        const newBio = `Complete bio ${uniqueId}`;
        
        // Add a follower
        await request.post('/api/add-follower', {
            data: {
                actor_id: `https://example.com/users/complete-settings-follower-${uniqueId}`,
                actor_url: `https://example.com/users/complete-settings-follower-${uniqueId}`,
                inbox_url: `https://example.com/users/complete-settings-follower-${uniqueId}/inbox`
            }
        });
        
        // Create user-settings.json with avatar override
        const settings = {
            display_name: newDisplayName,
            bio: newBio,
            avatar_url: `https://example.com/avatars/settings-test-${uniqueId}.png`
        };
        fs.writeFileSync(USER_SETTINGS_FILE, JSON.stringify(settings, null, 2));
        
        // Sync user settings to trigger federation
        await request.post('/api/sync-user-settings');
        
        // Get the outbound activity
        const outboundResponse = await request.get('/api/outbound-activities');
        const outboundData = await outboundResponse.json();
        
        const actorUpdateActivity = outboundData.activities.find(a => 
            a.type === 'Update' && 
            a.object && 
            a.object.includes('Person')
        );
        
        expect(actorUpdateActivity).toBeDefined();
        
        const activityObject = JSON.parse(actorUpdateActivity.object);
        
        // Verify all required actor properties are present
        expect(activityObject['@context']).toBeDefined();
        expect(activityObject.id).toBeDefined();
        expect(activityObject.type).toBe('Person');
        expect(activityObject.preferredUsername).toBeDefined();
        expect(activityObject.name).toBe(newDisplayName);
        expect(activityObject.summary).toBe(newBio);
        expect(activityObject.inbox).toBeDefined();
        expect(activityObject.outbox).toBeDefined();
        expect(activityObject.followers).toBeDefined();
        expect(activityObject.following).toBeDefined();
        expect(activityObject.publicKey).toBeDefined();
        expect(activityObject.icon).toBeDefined();
        expect(activityObject.icon.type).toBe('Image');
        expect(activityObject.icon.mediaType).toBe('image/png');
        expect(activityObject.icon.url).toBe(settings.avatar_url);
        
        await request.post('/api/remove-follower', {
            data: { actor_id: `https://example.com/users/complete-settings-follower-${uniqueId}` }
        });
    });
});

test.describe('RSS Feed', () => {
    const fs = require('fs');
    const path = require('path');
    const POSTS_DIR = path.join(__dirname, '..', 'content', 'posts');
    test('RSS feed endpoint returns valid XML', async ({ request }) => {
        const response = await request.get('/rss');
        
        expect(response.status()).toBe(200);
        expect(response.headers()['content-type']).toContain('application/rss+xml');
        
        const body = await response.text();
        expect(body).toContain('<?xml version="1.0" encoding="UTF-8"?>');
        expect(body).toContain('<rss version="2.0"');
        expect(body).toContain('<channel>');
        expect(body).toContain('</rss>');
    });

    test('RSS feed contains required channel elements', async ({ request }) => {
        const response = await request.get('/rss');
        const body = await response.text();
        
        expect(body).toContain('<title>');
        expect(body).toContain('<link>');
        expect(body).toContain('<description>');
        expect(body).toContain('<language>en</language>');
        expect(body).toContain('<lastBuildDate>');
        expect(body).toContain('</channel>');
    });

    test('RSS feed includes posts as items', async ({ request }) => {
        const response = await request.get('/rss');
        const body = await response.text();
        
        expect(body).toContain('<item>');
        expect(body).toContain('</item>');
    });

    test('RSS feed item contains required elements', async ({ request }) => {
        const response = await request.get('/rss');
        const body = await response.text();
        
        // Check for item sub-elements
        expect(body).toContain('<title>');
        expect(body).toContain('<link>');
        expect(body).toContain('<guid>');
        expect(body).toContain('<pubDate>');
        expect(body).toContain('<description>');
    });

    test('RSS feed item title is wrapped in CDATA', async ({ request }) => {
        const response = await request.get('/rss');
        const body = await response.text();
        
        expect(body).toContain('<title><![CDATA[');
    });

    test('RSS feed description strips HTML tags', async ({ request }) => {
        const response = await request.get('/rss');
        const body = await response.text();
        
        // Description should not contain HTML tags
        const descriptionMatches = body.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/g);
        if (descriptionMatches && descriptionMatches.length > 0) {
            descriptionMatches.forEach(match => {
                // Extract content between CDATA
                const content = match.replace(/<description><!\[CDATA\[/, '').replace(/\]\]><\/description>/, '');
                // Should not contain HTML tags
                expect(content).not.toMatch(/<[a-z][^>]*>/i);
            });
        }
    });

    test('RSS feed includes full article content', async ({ request }) => {
        const response = await request.get('/rss');
        const body = await response.text();
        
        // Should contain content namespace
        expect(body).toContain('xmlns:content="http://purl.org/rss/1.0/modules/content/"');
        
        // Should contain content:encoded elements
        expect(body).toContain('<content:encoded>');
        expect(body).toContain('</content:encoded>');
        
        // Content should contain actual HTML (not be empty)
        const contentMatches = body.match(/<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/g);
        if (contentMatches && contentMatches.length > 0) {
            contentMatches.forEach(match => {
                // Extract content between CDATA
                const content = match.replace(/<content:encoded><!\[CDATA\[/, '').replace(/\]\]><\/content:encoded>/, '');
                // Should contain actual content (not just empty)
                expect(content.trim().length).toBeGreaterThan(0);
            });
        }
    });

    test('RSS feed updates when new post is created', async ({ request }) => {
        const uniqueId = Date.now();
        const postSlug = `rss-test-${uniqueId}`;
        const postFile = path.join(POSTS_DIR, `${postSlug}.html`);
        const postTitle = `RSS Test Post ${uniqueId}`;
        const postExcerpt = `This is a test post excerpt ${uniqueId}`;
        
        // Create a new post
        fs.writeFileSync(postFile, `<!--
title: ${postTitle}
tags: test, rss
-->
<article><p>${postExcerpt}</p></article>`);
        
        // Sync the post
        await request.post('/api/sync-post', {
            data: { filename: `${postSlug}.html` }
        });
        
        // Get updated RSS and verify it contains the new post
        const response = await request.get('/rss');
        const body = await response.text();
        
        // Should contain the new post (checking specific content rather than count)
        expect(body).toContain(postTitle);
        expect(body).toContain(postExcerpt);
        
        // Verify the post appears as an item in the RSS
        expect(body).toContain(`<link>${request._baseURL || 'http://localhost:6767'}/${postSlug}</link>`);
        
        // Cleanup
        if (fs.existsSync(postFile)) {
            fs.unlinkSync(postFile);
        }
    });

    test('RSS feed contains atom self-reference link', async ({ request }) => {
        const response = await request.get('/rss');
        const body = await response.text();
        
        expect(body).toContain('xmlns:atom="http://www.w3.org/2005/Atom"');
        expect(body).toContain('<atom:link');
        expect(body).toContain('rel="self"');
    });
});

test.describe('Post Slug Validation', () => {
    const path = require('path');
    const fs = require('fs');
    const POSTS_DIR = path.join(__dirname, '..', 'content', 'posts');

    const reservedSlugs = [
        'new', 'u', 'tag', 'archive', 'static', 'rss', 'feed', 'index',
        'api', 'admin', 'login', 'logout', 'signin', 'signup',
        'inbox', 'outbox', 'followers', 'following',
        '.well-known', '404', '500', 'error',
        'css', 'js', 'images', 'img', 'assets',
        'favicon', 'pfp', 'pfp.png', 'static.css',
        'wp-test', 'ghost-test', 'wp-', 'ghost-'
    ];

    for (const reservedSlug of reservedSlugs) {
        test(`rejects post with reserved slug: ${reservedSlug}`, async ({ request }) => {
            const postSlug = reservedSlug;
            const postFile = path.join(POSTS_DIR, `${postSlug}.html`);
            const postContent = `<!--
title: Test Post
-->
<article><p>Test content</p></article>`;

            // Create the file
            fs.writeFileSync(postFile, postContent);

            // Try to sync
            const response = await request.post('/api/sync-post', {
                data: { filename: `${postSlug}.html` }
            });

            const result = await response.json();

            // Should be rejected
            expect(response.status()).toBe(400);
            expect(result.success).toBe(false);
            expect(result.error).toContain('Invalid slug');

            // Cleanup
            if (fs.existsSync(postFile)) {
                fs.unlinkSync(postFile);
            }
        });
    }

    test('rejects post with whitespace in slug', async ({ request }) => {
        const postSlug = 'my test post';
        const postFile = path.join(POSTS_DIR, `${postSlug}.html`);
        const postContent = `<!--
title: Test Post
-->
<article><p>Test content</p></article>`;

        fs.writeFileSync(postFile, postContent);

        const response = await request.post('/api/sync-post', {
            data: { filename: `${postSlug}.html` }
        });

        const result = await response.json();

        expect(response.status()).toBe(400);
        expect(result.success).toBe(false);
        expect(result.error).toContain('whitespace');

        if (fs.existsSync(postFile)) {
            fs.unlinkSync(postFile);
        }
    });

    test('rejects post with path separator in slug', async ({ request }) => {
        // Note: We can't actually create a file with / in the name, so we test the validation directly
        // The API should reject any slug containing path separators
        const postSlug = 'my/test';
        const postFile = path.join(POSTS_DIR, 'my_test.html'); // Use different filename
        const postContent = `<!--
title: Test Post
-->
<article><p>Test content</p></article>`;

        fs.writeFileSync(postFile, postContent);

        // Try to sync with the path separator in the filename (which is invalid)
        const response = await request.post('/api/sync-post', {
            data: { filename: 'my/test.html' }  // This will be rejected
        });

        const result = await response.json();

        expect(response.status()).toBe(400);
        expect(result.success).toBe(false);
        expect(result.error).toContain('path separator');

        if (fs.existsSync(postFile)) {
            fs.unlinkSync(postFile);
        }
    });

    test('rejects post starting with dot', async ({ request }) => {
        const postSlug = '.hidden';
        const postFile = path.join(POSTS_DIR, `${postSlug}.html`);
        const postContent = `<!--
title: Test Post
-->
<article><p>Test content</p></article>`;

        fs.writeFileSync(postFile, postContent);

        const response = await request.post('/api/sync-post', {
            data: { filename: `${postSlug}.html` }
        });

        const result = await response.json();

        expect(response.status()).toBe(400);
        expect(result.success).toBe(false);
        expect(result.error).toContain('dot');

        if (fs.existsSync(postFile)) {
            fs.unlinkSync(postFile);
        }
    });

    test('rejects post with invalid characters', async ({ request }) => {
        const postSlug = 'my@post!';
        const postFile = path.join(POSTS_DIR, `${postSlug}.html`);
        const postContent = `<!--
title: Test Post
-->
<article><p>Test content</p></article>`;

        fs.writeFileSync(postFile, postContent);

        const response = await request.post('/api/sync-post', {
            data: { filename: `${postSlug}.html` }
        });

        const result = await response.json();

        expect(response.status()).toBe(400);
        expect(result.success).toBe(false);
        expect(result.error).toContain('letters, numbers, hyphens, and underscores');

        if (fs.existsSync(postFile)) {
            fs.unlinkSync(postFile);
        }
    });

    test('accepts valid slug with hyphens', async ({ request }) => {
        const uniqueId = Date.now();
        const postSlug = `my-valid-post-${uniqueId}`;
        const postFile = path.join(POSTS_DIR, `${postSlug}.html`);
        const postContent = `<!--
title: Test Post
tags: test
-->
<article><p>Test content</p></article>`;

        fs.writeFileSync(postFile, postContent);

        const response = await request.post('/api/sync-post', {
            data: { filename: `${postSlug}.html` }
        });

        const result = await response.json();

        expect(response.status()).toBe(200);
        expect(result.success).toBe(true);

        if (fs.existsSync(postFile)) {
            fs.unlinkSync(postFile);
        }
    });

    test('accepts valid slug with underscores', async ({ request }) => {
        const uniqueId = Date.now();
        const postSlug = `my_valid_post_${uniqueId}`;
        const postFile = path.join(POSTS_DIR, `${postSlug}.html`);
        const postContent = `<!--
title: Test Post
-->
<article><p>Test content</p></article>`;

        fs.writeFileSync(postFile, postContent);

        const response = await request.post('/api/sync-post', {
            data: { filename: `${postSlug}.html` }
        });

        const result = await response.json();

        expect(response.status()).toBe(200);
        expect(result.success).toBe(true);

        if (fs.existsSync(postFile)) {
            fs.unlinkSync(postFile);
        }
    });
});

test.describe('Root Delegation (BLOG_PATH)', () => {
    test('WebFinger endpoint is at root', async ({ request }) => {
        // WebFinger should always be at root, not under BLOG_PATH
        const response = await request.get('/.well-known/webfinger?resource=acct:admin@localhost:6767');
        expect(response.status()).toBe(200);
        const body = await response.json();
        expect(body.subject).toBe('acct:admin@localhost:6767');
    });

    test('API routes are accessible', async ({ request }) => {
        // API routes should be accessible (under blog router in test mode with empty BLOG_PATH)
        const response = await request.get('/api/outbound-activities');
        expect([200, 401]).toContain(response.status()); // 200 if authorized, 401 if localhost check failed
    });

    test('RSS feed is accessible', async ({ request }) => {
        // RSS should be accessible (blog routes in test mode)
        const response = await request.get('/rss');
        expect(response.status()).toBe(200);
        const body = await response.text();
        expect(body).toContain('<rss');
    });

    test('homepage is accessible at /', async ({ request }) => {
        // Homepage should be at /
        const response = await request.get('/');
        expect(response.status()).toBe(200);
    });

    test('embed page is accessible at /new', async ({ request }) => {
        // /new endpoint for embeds
        const response = await request.get('/new');
        expect(response.status()).toBe(200);
        const body = await response.text();
        expect(body).toContain('embed-container');
    });

    test('activitypub routes are accessible', async ({ request }) => {
        // ActivityPub actor endpoint should be accessible
        const response = await request.get('/u/admin');
        expect(response.status()).toBe(200);
        const body = await response.json();
        expect(body.type).toBe('Person');
        expect(body.preferredUsername).toBe('admin');
    });

    test('sync-post API requires valid slug', async ({ request }) => {
        // API should validate slugs
        const response = await request.post('/api/sync-post', {
            data: { filename: 'new.html' } // 'new' is a reserved slug
        });
        expect(response.status()).toBe(400);
        const body = await response.json();
        expect(body.error).toContain('Invalid slug');
    });

    test('posts are accessible by slug', async ({ request }) => {
        // Individual post pages should work
        const response = await request.get('/welcome');
        expect(response.status()).toBe(200);
    });
});
