module.exports = {
    testDir: './tests',
    testMatch: 'subpath-attachments.spec.js',
    timeout: 30000,
    reporter: 'list',
    use: {
        baseURL: 'http://127.0.0.1:6768',
        headless: true
    },
    projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
    webServer: {
        command: 'DOMAIN=blog.example.test BLOG_PATH=/posts PORT=6768 NODE_ENV=test node src/server.js',
        url: 'http://127.0.0.1:6768/posts/',
        reuseExistingServer: false,
        timeout: 120000
    }
};
