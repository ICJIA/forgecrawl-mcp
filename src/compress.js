import { CONFIG } from './config.js';

// Prompt-injection sanitization.
//
// Strip characters that do not render visibly to a human but ARE part of
// the byte stream the model sees. These have been used in published
// LLM-jailbreak attacks and can hide adversarial instructions inside
// page content. Categories covered:
//   - C0 / DEL / C1 control ranges
//   - soft hyphen (U+00AD), combining grapheme joiner (U+034F),
//     Arabic letter mark (U+061C)
//   - zero-width chars and LTR/RTL marks (U+200B-U+200F)
//   - line and paragraph separators (U+2028, U+2029)
//   - bidi embedding/override (U+202A-U+202E) -- "Trojan Source" range
//   - bidi isolates / word joiner / function-app (U+2060-U+206F)
//   - variation selectors (U+FE00-U+FE0F)
//   - byte-order mark (U+FEFF)
//   - Unicode tag characters (U+E0000-U+E007F) -- LLM-smuggling channel
//
// Two variants:
//   PROMPT_INJECTION_CHARS      strips ALL the above (used for short metadata
//                               strings; tabs/newlines also dropped via C0)
//   PROMPT_INJECTION_CHARS_BODY same set but keeps \t (U+0009), \n (U+000A),
//                               \r (U+000D) so markdown structure survives

const PROMPT_INJECTION_CHARS =
  /[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u206f\ufe00-\ufe0f\ufeff]|[\u{e0000}-\u{e007f}]/gu;

const PROMPT_INJECTION_CHARS_BODY =
  /[\u0000-\u0008\u000b-\u000c\u000e-\u001f\u007f-\u009f\u00ad\u034f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u206f\ufe00-\ufe0f\ufeff]|[\u{e0000}-\u{e007f}]/gu;

export function sanitize(str) {
  if (!str || typeof str !== 'string') return '';
  return str.replace(PROMPT_INJECTION_CHARS, '').trim();
}

export function sanitizeBody(str) {
  if (!str || typeof str !== 'string') return '';
  return str.replace(PROMPT_INJECTION_CHARS_BODY, '');
}

function truncateString(str, max) {
  if (!str) return str;
  if (str.length <= max) return str;
  return str.slice(0, max) + '…';
}

export function truncateBody(body, maxChars = CONFIG.MAX_OUTPUT_CHARS) {
  if (!body) return { body: '', truncated: false };
  if (body.length <= maxChars) return { body, truncated: false };
  return { body: body.slice(0, maxChars), truncated: true };
}

export function buildMetadata(extracted, finalUrl) {
  const m = extracted.pageMeta || {};
  return cleanNulls({
    url:         sanitize(finalUrl),
    canonical:   sanitize(m.canonical) || null,
    description: sanitize(extracted.excerpt || m.description) || null,
    author:      sanitize(extracted.byline) || null,
    site:        sanitize(extracted.siteName || m.siteName) || null,
    language:    sanitize(m.language) || null,
    type:        sanitize(m.ogType) || null,
    image:       sanitize(m.ogImage) || null,
    published:   sanitize(m.publishedTime) || null,
    modified:    sanitize(m.modifiedTime) || null,
  });
}

function cleanNulls(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined && v !== '') out[k] = v;
  }
  return out;
}

export function applyMode(result, mode = CONFIG.DEFAULT_MODE, opts = {}) {
  const title = sanitize(result.title);
  const description = result.metadata?.description || null;
  const excerpt = description ? truncateString(description, 280) : null;

  const base = {
    url: result.finalUrl,
    title,
    excerpt,
    wordCount: result.wordCount,
    metadata: result.metadata,
    cached: !!result.cached,
    renderedWith: result.renderedWith,
  };

  if (mode === 'summary') return base;

  const previewChars = opts.previewChars ?? CONFIG.DEFAULT_PREVIEW_CHARS;
  const maxBodyChars = Math.min(opts.maxBodyChars ?? CONFIG.MAX_OUTPUT_CHARS, CONFIG.MAX_OUTPUT_CHARS);

  if (mode === 'preview') {
    const cap = Math.min(previewChars, maxBodyChars, CONFIG.MAX_OUTPUT_CHARS);
    const { body, truncated } = truncateBody(sanitizeBody(result.body), cap);
    return { ...base, bodyPreview: body, truncated };
  }

  if (mode === 'markdown') {
    const { body, truncated } = truncateBody(sanitizeBody(result.body), maxBodyChars);
    return { ...base, body, truncated };
  }

  return base;
}

export const _test = { sanitize, sanitizeBody, truncateString, truncateBody, cleanNulls, PROMPT_INJECTION_CHARS, PROMPT_INJECTION_CHARS_BODY };
