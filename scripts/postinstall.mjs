// Resolve Playwright's CLI through Node's module resolver (not $PATH) and
// invoke it directly. Failure is reported but does not abort the parent
// install — Chromium download can fail for legitimate reasons (offline CI,
// air-gapped network, restricted egress). Users who hit that get a clear
// error pointing to the manual fix instead of a silent broken install at
// scrape time.
//
// Skip download entirely:
//   PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
// Use a private mirror:
//   PLAYWRIGHT_DOWNLOAD_HOST=https://mirror.example.com

import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

if (process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === '1') {
  console.error('[forgecrawl] PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 — skipping Chromium install.');
  process.exit(0);
}

const require = createRequire(import.meta.url);

let cliPath;
try {
  cliPath = require.resolve('playwright/cli.js');
} catch {
  try {
    cliPath = require.resolve('playwright-core/cli.js');
  } catch (err) {
    console.error('[forgecrawl] could not resolve Playwright CLI:', err.message);
    console.error('[forgecrawl] run `npx playwright install chromium` manually before first JS-rendered scrape.');
    process.exit(0);
  }
}

const result = spawnSync(process.execPath, [cliPath, 'install', 'chromium'], {
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  console.error('[forgecrawl] playwright install chromium failed to spawn:', result.error.message);
  console.error('[forgecrawl] run `npx playwright install chromium` manually before first JS-rendered scrape.');
  process.exit(0);
}

if (result.status !== 0) {
  console.error(`[forgecrawl] playwright install chromium exited with status ${result.status}.`);
  console.error('[forgecrawl] run `npx playwright install chromium` manually before first JS-rendered scrape.');
  process.exit(0);
}
