module.exports = {
    testDir: './tests',
    timeout: 30000,
    expect: {
        timeout: 5000
    },
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: 'list',
    use: {
        actionTimeout: 0,
        baseURL: 'http://localhost:6767',
        trace: 'on-first-retry',
        headless: true
    },
    projects: [
        {
            name: 'chromium',
            use: {
                browserName: 'chromium'
            }
        }
    ],
    webServer: {
        command: 'NODE_ENV=test npm start',
        url: 'http://localhost:6767',
        reuseExistingServer: !process.env.CI,
        timeout: 120000
    }
};
