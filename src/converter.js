import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

// Only http/https URLs are allowed through. javascript:, data:, file:,
// and any other scheme is dropped — the model is the caller; if a
// downstream renderer ever clicks one of these, the page authored it,
// not the user.
const SAFE_URL = /^https?:\/\//i;

/**
 * Convert HTML to Markdown using Turndown + GFM. Optionally strips images
 * and/or links. When kept, link/image URLs are scheme-filtered.
 *
 * @param {string} html
 * @param {object} opts
 * @param {boolean} opts.includeLinks   - keep <a> hrefs (default false)
 * @param {boolean} opts.includeImages  - keep <img> (default false)
 * @returns {string} markdown
 */
export function toMarkdown(html, opts = {}) {
  const includeLinks = opts.includeLinks === true;
  const includeImages = opts.includeImages === true;

  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
  });

  turndown.use(gfm);

  // Image rule: when not keeping images, drop entirely. When keeping, only
  // emit if the src is http(s).
  turndown.addRule('safeImages', {
    filter: 'img',
    replacement: (_content, node) => {
      if (!includeImages) return '';
      const src = node.getAttribute && node.getAttribute('src') || '';
      if (!SAFE_URL.test(src)) return '';
      const alt = (node.getAttribute && node.getAttribute('alt')) || '';
      return `![${alt}](${src})`;
    },
  });

  // Link rule: when not keeping links, replace with anchor text. When keeping,
  // emit `[text](href)` only if href is http(s); otherwise emit text alone.
  turndown.addRule('safeLinks', {
    filter: 'a',
    replacement: (content, node) => {
      if (!includeLinks) return content;
      const href = (node.getAttribute && node.getAttribute('href')) || '';
      return SAFE_URL.test(href) ? `[${content}](${href})` : content;
    },
  });

  let markdown = turndown.turndown(html || '');

  markdown = markdown
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+|\s+$/g, '');

  return markdown;
}
