import { defineConfig } from '@playwright/test';

// The end-to-end test builds the interface and starts the API on a separate port, with data in a temporary folder.
export default defineConfig({
  testDir: 'e2e',
  timeout: 300_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: 'http://localhost:3101',
    viewport: { width: 1600, height: 950 },
    channel: process.env.PW_CHANNEL, // e.g. PW_CHANNEL=chrome to use the installed Chrome
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  webServer: {
    // E2E_AGENT=1 → the AI agent uses the simulated Ollama server (packages/backend/test/mock-ollama.ts, port 4011)
    command: `npm run build && npx cross-env NODE_ENV=production PORT=3101 ORBITAL_DATA_DIR=.e2e-data HR_STALE_SECONDS=12 SIM_INTERVAL_SECONDS=2 LIVE_EPISODES=off ALERT_RECOVERED_SHOW_SECONDS=8 ALERT_RECHECK_SECONDS=3600 OLLAMA_BASE_URL=${process.env.E2E_AGENT ? 'http://localhost:4011' : 'http://localhost:4999'} npx tsx packages/backend/src/server.ts`,
    url: 'http://localhost:3101/api/bootstrap',
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
