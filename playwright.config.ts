import { defineConfig } from '@playwright/test';
import { availableParallelism } from 'node:os';
import process from 'node:process';
export default defineConfig({
  testDir: 'tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  // One worker per CPU core, at least two: the map's software WebGL keeps
  // each worker busy, so more workers than cores gain nothing. Tests must
  // stay independent.
  workers: Math.max(2, availableParallelism()),
  // CI shards write blob reports that the merge-reports job combines.
  reporter: process.env.CI ? 'blob' : 'list',
  use: {
    browserName: 'chromium',
    launchOptions: { args: ['--no-sandbox'] },
    // Fixtures use UTC times; keep results independent of the machine's time zone.
    timezoneId: 'UTC',
    // English without a country: Automatic units resolve to km and °C (from
    // the UTC zone), while the initial map view still follows "en".
    locale: 'en-150',
  },
  webServer: [
    {
      command: 'npm run dev -- --host 127.0.0.1',
      url: 'http://127.0.0.1:5173/',
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
    {
      // A production build for the offline tests (offline.spec.ts), with the
      // retired service worker the development server lacks. Built fresh every
      // run into an ignored folder, so it always matches the checkout.
      command:
        'npx vite build --outDir .preview-test.local --emptyOutDir && npx vite preview --outDir .preview-test.local --host 127.0.0.1 --port 4175 --strictPort',
      url: 'http://127.0.0.1:4175/',
      reuseExistingServer: false,
      timeout: 120000,
    },
  ],
});
