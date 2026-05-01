import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import * as cheerio from 'cheerio';
import { CONFIG } from './config.js';

/**
 * Strip non-content nodes from a Cheerio-loaded document and return both
 * the cleaned body HTML and its plain-text representation. Used for the
 * "fallback" path when Readability extracts too little content.
 */
function getCleanBody($) {
  $('script, style, noscript, iframe, svg').remove();
  $('[role="navigation"], [aria-hidden="true"]').remove();
  $('nav, header, footer, aside').filter((_, el) => {
    // Only strip nav/header/footer/aside if there's body content elsewhere.
    return $(el).text().trim().length > 0;
  });
  return {
    $,
    html: $('body').html() || $.html(),
    text: $('body').text().replace(/\s+/g, ' ').trim(),
  };
}

function extractPageMeta($) {
  return {
    canonical: $('link[rel="canonical"]').attr('href') || $('meta[property="og:url"]').attr('content') || null,
    description: $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || null,
    language: $('html').attr('lang') || $('meta[property="og:locale"]').attr('content') || null,
    ogImage: $('meta[property="og:image"]').attr('content') || null,
    ogType: $('meta[property="og:type"]').attr('content') || null,
    publishedTime: $('meta[property="article:published_time"]').attr('content') || $('meta[name="date"]').attr('content') || null,
    modifiedTime: $('meta[property="article:modified_time"]').attr('content') || null,
    siteName: $('meta[property="og:site_name"]').attr('content') || null,
  };
}

/**
 * Extract main content + metadata from raw HTML.
 *
 * @param {string} html  raw HTML document
 * @param {string} url   the URL it came from (used by Readability for relative-link resolution)
 * @param {object} opts
 * @param {{include?: string, exclude?: string}} [opts.selectors]
 * @returns {{title, content, excerpt, byline, siteName, pageMeta, fullBodyText}}
 */
export function extractContent(html, url, opts = {}) {
  if (!html || typeof html !== 'string') {
    throw new Error('No HTML content provided');
  }

  const $ = cheerio.load(html);
  const pageMeta = extractPageMeta($);

  // Apply caller-provided selector trimming first.
  if (opts.selectors?.exclude) {
    try { $(opts.selectors.exclude).remove(); } catch { /* invalid selector → ignore */ }
  }

  let processedHtml;
  if (opts.selectors?.include) {
    let selected = '';
    try { selected = $(opts.selectors.include).html(); } catch { /* invalid selector → ignore */ }
    processedHtml = selected || $.html();
  } else {
    processedHtml = $.html();
  }

  // Compare Readability's output against the cleaned full body to decide
  // whether to use it. Sparse content pages (landing pages, gov sites) often
  // confuse Readability — fall back to the full body in that case.
  const fullBody = getCleanBody(cheerio.load(processedHtml));

  // Readability needs a real DOM. linkedom is lighter than jsdom and works.
  let article = null;
  try {
    const { document } = parseHTML(processedHtml);
    // Readability mutates its input document — clone happens internally.
    article = new Readability(document).parse();
  } catch {
    article = null;
  }

  const readabilityTextLen = article?.textContent?.trim().length || 0;
  const fullBodyTextLen = fullBody.text.length || 1;
  const captureRatio = readabilityTextLen / fullBodyTextLen;

  if (article && article.content && readabilityTextLen >= CONFIG.READABILITY_MIN_CHARS && captureRatio >= CONFIG.READABILITY_MIN_RATIO) {
    return {
      title: article.title || $('title').text().trim() || $('h1').first().text().trim() || '',
      content: article.content,
      excerpt: article.excerpt || pageMeta.description || null,
      byline: article.byline || null,
      siteName: article.siteName || pageMeta.siteName || null,
      pageMeta,
      fullBodyText: fullBody.text,
      readabilityRatio: captureRatio,
    };
  }

  // Fallback: use the cleaned body content.
  const content = fullBody.html;
  if (!content) {
    throw new Error('Could not extract content from page');
  }

  const $meta = cheerio.load(processedHtml);
  const title =
    $meta('h1').first().text().trim() ||
    $meta('title').text().trim() ||
    article?.title ||
    '';

  return {
    title,
    content,
    excerpt: article?.excerpt || pageMeta.description || null,
    byline: article?.byline || null,
    siteName: article?.siteName || pageMeta.siteName || null,
    pageMeta,
    fullBodyText: fullBody.text,
    readabilityRatio: captureRatio,
  };
}
