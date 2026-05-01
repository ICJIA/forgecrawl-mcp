import { CONFIG, log } from './config.js';
import { validateUrl } from './urlValidate.js';
import { fetchPage, fetchText } from './fetcher.js';
import { extractContent } from './extractor.js';
import { toMarkdown } from './converter.js';
import { buildMetadata } from './compress.js';
import * as cache from './cache.js';

// Lazy-load browser only when JS rendering is requested.
let _withPage = null;
async function getWithPage() {
  if (_withPage) return _withPage;
  const mod = await import('./browser.js');
  _withPage = mod.withPage;
  return _withPage;
}

function countWords(s) {
  if (!s) return 0;
  return s.split(/\s+/).filter(Boolean).length;
}

function shouldFallbackToJs(extracted, body) {
  const words = countWords(body);
  if (words < CONFIG.AUTO_FALLBACK_MIN_WORDS) return true;
  const textChars = (extracted?.fullBodyText || '').length;
  if (textChars < CONFIG.AUTO_FALLBACK_MIN_CHARS) return true;
  return false;
}

async function fetchWithJs(url, opts) {
  const withPage = await getWithPage();
  return withPage(async (page) => {
    page.setDefaultNavigationTimeout(CONFIG.BROWSER_NAV_TIMEOUT);
    const waitUntil = opts.waitUntil || 'domcontentloaded';
    let finalUrl = url;
    try {
      const response = await page.goto(url, { waitUntil });
      if (response) finalUrl = response.url();
    } catch (err) {
      throw new Error(`Page navigation timed out: ${err?.message || 'unknown'}`);
    }

    // Re-validate the final URL (after JS-driven redirects).
    await validateUrl(finalUrl);

    if (opts.waitFor) {
      try {
        await page.waitForSelector(opts.waitFor, { timeout: CONFIG.BROWSER_WAITFOR_MAX });
      } catch {
        log('debug', `waitFor selector "${opts.waitFor}" timed out — continuing`);
      }
    }
    if (opts.waitMs) {
      const ms = Math.min(Math.max(opts.waitMs, 0), CONFIG.BROWSER_WAITFOR_MAX);
      await page.waitForTimeout(ms);
    }

    const html = await page.content();
    if (html.length > CONFIG.MAX_HTML_BYTES) throw new Error('Response body too large');
    return { html, finalUrl };
  });
}

/**
 * Convert extracted+rendered HTML into a normalized result object.
 */
function finalizePipeline({ extracted, finalUrl, includeLinks, includeImages, renderedWith }) {
  const body = toMarkdown(extracted.content, { includeLinks, includeImages });
  const metadata = buildMetadata(extracted, finalUrl);
  return {
    title: extracted.title || '',
    body,
    wordCount: countWords(body),
    metadata,
    finalUrl,
    renderedWith,
    extracted,
  };
}

/**
 * Main scrape orchestration. Returns a normalized result; the caller
 * (server.js or cli.js) applies mode tiers via compress.applyMode.
 *
 * @param {object} params
 *   - url:           string (required)
 *   - render:        'auto'|'static'|'js'
 *   - waitUntil, waitFor, waitMs    (JS render only)
 *   - selectors:     {include?, exclude?}
 *   - includeLinks:  boolean
 *   - includeImages: boolean
 *   - bypassCache:   boolean
 */
export async function scrape(params) {
  if (!params || typeof params.url !== 'string') {
    throw new Error('Invalid URL');
  }
  const render = params.render || 'auto';
  const includeLinks = params.includeLinks === true;
  const includeImages = params.includeImages === true;
  const selectors = params.selectors || undefined;

  // Cache key — same shape, same render, same selector trim, same flags = same cache slot.
  const cacheKey = cache.makeKey({
    url: params.url,
    render,
    waitUntil: params.waitUntil || null,
    waitFor: params.waitFor || null,
    waitMs: params.waitMs || null,
    selectors: selectors || null,
    includeLinks,
    includeImages,
  });

  if (!params.bypassCache) {
    const hit = cache.get(cacheKey);
    if (hit) return { ...hit, cached: true };
  }

  // Validate URL up front (cheap, also catches obvious garbage).
  const safeUrl = await validateUrl(params.url);

  let result;
  if (render === 'static') {
    const { html, finalUrl } = await fetchPage(safeUrl);
    const extracted = extractContent(html, finalUrl, { selectors });
    result = finalizePipeline({ extracted, finalUrl, includeLinks, includeImages, renderedWith: 'static' });
  } else if (render === 'js') {
    const { html, finalUrl } = await fetchWithJs(safeUrl, params);
    const extracted = extractContent(html, finalUrl, { selectors });
    result = finalizePipeline({ extracted, finalUrl, includeLinks, includeImages, renderedWith: 'js' });
  } else {
    // 'auto' — try static first, fall back to JS if extraction is too thin.
    const { html, finalUrl } = await fetchPage(safeUrl);
    const extracted = extractContent(html, finalUrl, { selectors });
    const staticResult = finalizePipeline({ extracted, finalUrl, includeLinks, includeImages, renderedWith: 'static' });
    if (shouldFallbackToJs(extracted, staticResult.body)) {
      log('debug', `auto-fallback to JS render for ${safeUrl}`);
      try {
        const js = await fetchWithJs(safeUrl, params);
        const ex2 = extractContent(js.html, js.finalUrl, { selectors });
        result = finalizePipeline({ extracted: ex2, finalUrl: js.finalUrl, includeLinks, includeImages, renderedWith: 'js' });
      } catch (err) {
        // If the JS path fails (e.g. Chromium not installed), return the static result with a note.
        log('debug', `JS fallback failed: ${err?.message || 'unknown'} — returning static result`);
        result = staticResult;
      }
    } else {
      result = staticResult;
    }
  }

  // Strip the bulky `extracted` field before caching/returning to caller.
  const { extracted: _, ...cacheable } = result;
  cache.set(cacheKey, cacheable);
  return { ...cacheable, cached: false };
}

/**
 * Extract markdown directly from caller-provided HTML — skips fetch.
 * The optional `url` is recorded in the response metadata only; nothing
 * fetches it. We still scheme-allowlist it (http/https) so a hostile
 * caller can't smuggle `file:///etc/passwd` into the model's view as the
 * "source URL" of the content.
 */
export function extractFromHtml({ html, url, selectors, includeLinks, includeImages }) {
  if (!html || typeof html !== 'string') throw new Error('No HTML content provided');
  let finalUrl = '';
  if (typeof url === 'string' && url.length > 0) {
    let parsed;
    try { parsed = new URL(url); } catch { throw new Error('Invalid URL'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Blocked URL scheme');
    finalUrl = parsed.href;
  }
  const extracted = extractContent(html, finalUrl, { selectors });
  return finalizePipeline({
    extracted,
    finalUrl,
    includeLinks: includeLinks === true,
    includeImages: includeImages === true,
    renderedWith: 'static',
  });
}

/**
 * Detect a sitemap.xml at the given origin; return URL count + sample.
 */
export async function checkSitemap(originUrl) {
  await validateUrl(originUrl);
  const u = new URL(originUrl);
  const sitemapUrl = `${u.origin}/sitemap.xml`;
  const { text, finalUrl } = await fetchText(sitemapUrl);

  // Match all <loc>…</loc> entries. Cheap, sufficient for a count + sample.
  const locRegex = /<loc>\s*([^<\s][^<]*?)\s*<\/loc>/gi;
  const urls = [];
  let m;
  let total = 0;
  while ((m = locRegex.exec(text)) !== null) {
    total += 1;
    if (urls.length < 20) urls.push(m[1]);
    if (total >= CONFIG.SITEMAP_MAX_URLS) break;
  }

  return {
    sitemapUrl: finalUrl,
    urlCount: total,
    sample: urls,
  };
}
