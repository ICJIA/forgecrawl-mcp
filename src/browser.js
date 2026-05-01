import { chromium } from 'playwright';
import { CONFIG, log } from './config.js';
import { validateUrl } from './urlValidate.js';

let _browser = null;
let _launching = null;
let _idleTimer = null;

// ─── Concurrency semaphore ────────────────────────────────────────
// Cap inflight Chromium contexts. Without this, the model could fan out
// 50 parallel scrape_url calls and exhaust host memory (each context
// is real Chrome). FORGECRAWL_MAX_CONCURRENT_PAGES tunes the limit.

let _inflight = 0;
const _waiters = [];

async function acquire() {
  if (_inflight >= CONFIG.MAX_CONCURRENT_PAGES) {
    await new Promise((resolve) => _waiters.push(resolve));
  }
  _inflight += 1;
}

function release() {
  _inflight -= 1;
  const next = _waiters.shift();
  if (next) next();
}

function bumpIdleTimer() {
  if (_idleTimer) clearTimeout(_idleTimer);
  _idleTimer = setTimeout(() => {
    log('debug', 'Chromium idle — closing');
    closeBrowser().catch(() => { /* ignore */ });
  }, CONFIG.BROWSER_IDLE_TIMEOUT);
}

export async function getBrowser() {
  if (_browser) {
    bumpIdleTimer();
    return _browser;
  }
  if (_launching) return _launching;

  _launching = chromium.launch({
    headless: true,
    args: [
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-networking',
      '--no-first-run',
      '--no-default-browser-check',
      ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
    ],
  }).then((b) => {
    _browser = b;
    _launching = null;
    log('info', 'Chromium launched');
    bumpIdleTimer();
    return b;
  }).catch((err) => {
    _launching = null;
    if (/Executable doesn't exist|browserType\.launch/i.test(err?.message || '')) {
      throw new Error(
        'Browser launch failed: Chromium is not installed. ' +
        'Run `npx playwright install chromium` to download it (~200 MB), ' +
        'or set PLAYWRIGHT_DOWNLOAD_HOST to a mirror.'
      );
    }
    throw new Error(`Browser launch failed: ${err?.message || 'unknown'}`);
  });

  return _launching;
}

export async function closeBrowser() {
  if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null; }
  if (!_browser) return;
  const b = _browser;
  _browser = null;
  try { await b.close(); } catch { /* ignore */ }
}

/**
 * Open a fresh context + page, run `fn`, then tear it down.
 * Context is disposable per call to avoid state leaks between scrapes.
 *
 * Every request the page makes — including subresources — is re-validated
 * against the SSRF blocklist before it leaves Chromium. Non-essential
 * resource types (images, fonts, media, stylesheets) are blocked outright;
 * the scraper only needs the document tree, not the rendering pipeline.
 */
export async function withPage(fn) {
  await acquire();
  let context = null;
  try {
    const browser = await getBrowser();
    context = await browser.newContext({
      viewport: { width: CONFIG.VIEWPORT_WIDTH, height: CONFIG.VIEWPORT_HEIGHT },
      userAgent: CONFIG.USER_AGENT,
    });
    const page = await context.newPage();

    // SSRF + cost discipline at the request layer.
    await page.route('**/*', async (route) => {
      const request = route.request();
      const reqUrl = request.url();

      // Drop non-essential resource types — scraper only consumes the DOM.
      const allowedTypes = new Set(['document', 'xhr', 'fetch', 'script']);
      if (!allowedTypes.has(request.resourceType())) {
        return route.abort();
      }

      // Re-validate every URL against the full classifier (DNS-resolved).
      try {
        await validateUrl(reqUrl);
      } catch {
        return route.abort();
      }
      return route.continue();
    });

    return await fn(page);
  } finally {
    bumpIdleTimer();
    if (context) await context.close().catch(() => { /* ignore */ });
    release();
  }
}
