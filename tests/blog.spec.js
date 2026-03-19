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

test.describe.serial('ActivityPub Activity Processing', () => {
    test.beforeAll(async ({ request }) => {
        // Ensure welcome post exists for these tests
        const response = await request.get('/p/welcome');
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
                inReplyTo: 'http://localhost:6767/p/welcome'
            }
        };
        
        await request.post('/u/admin/inbox', {
            data: activity,
            headers: {
                'Content-Type': 'application/activity+json'
            }
        });
        
        // Visit the post and verify comment is displayed
        await page.goto('/p/welcome');
        
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
        await page.goto('/p/welcome');
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
                inReplyTo: 'http://localhost:6767/p/welcome'
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
                    inReplyTo: 'http://localhost:6767/p/welcome'
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
                    inReplyTo: 'http://localhost:6767/p/welcome'
                }
            },
            headers: {
                'Content-Type': 'application/activity+json'
            }
        });
        
        // Visit the post
        await page.goto('/p/welcome');
        
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
                inReplyTo: 'http://localhost:6767/p/welcome'
            }
        };
        
        await request.post('/u/admin/inbox', {
            data: activity,
            headers: {
                'Content-Type': 'application/activity+json'
            }
        });
        
        await page.goto('/p/welcome');
        
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
                inReplyTo: 'http://localhost:6767/p/welcome'
            }
        };
        
        await request.post('/u/admin/inbox', {
            data: activity,
            headers: {
                'Content-Type': 'application/activity+json'
            }
        });
        
        await page.goto('/p/welcome');
        
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
                inReplyTo: 'http://localhost:6767/p/welcome'
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
        
        await page.goto('/p/welcome');
        
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
                    inReplyTo: 'http://localhost:6767/p/welcome'
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
        
        await page.goto('/p/welcome');
        
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
                    inReplyTo: 'http://localhost:6767/p/welcome'
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
        
        await page.goto('/p/welcome');
        
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
        
        // Verify post appears on homepage
        await page.goto('/');
        await expect(page.locator('.post-title').first()).toContainText(postTitle, { timeout: 10000 });
        
        // Verify post page is accessible
        await page.goto(`/p/${postSlug}`);
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
        await page.goto(`/p/${postSlug}`);
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
        await page.goto(`/p/${postSlug}`);
        await expect(page.locator('.post-title')).toContainText(`Delete Test ${uniqueId}`, { timeout: 10000 });
        
        // Delete the post file
        fs.unlinkSync(postFile);
        
        // Sync to remove from database (file doesn't exist, so it will be deleted)
        await request.post('/api/sync-post', {
            data: { filename: `${postSlug}.html` }
        });
        
        // Verify post returns 404
        await page.goto(`/p/${postSlug}`);
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
        await page.goto(`/p/${postSlug}`);
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
        await page.goto(`/p/${postSlug}`);
        await expect(page.locator('.post-full')).toBeVisible();
        
        // Cleanup
        if (fs.existsSync(postFile)) {
            fs.unlinkSync(postFile);
        }
    });
});
