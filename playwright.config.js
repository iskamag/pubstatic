require('./tests/offline.cjs');

module.exports = {
    testDir: './tests',
    testMatch: '**/*.spec.js',
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
        headless: true,
        launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined }
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
        command: 'NODE_ENV=test NODE_OPTIONS="--require ./tests/offline.cjs" npm start',
        url: 'http://localhost:6767',
        reuseExistingServer: false,
        timeout: 120000
    }
};
