import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMode, buildMetadata, _test } from '../src/compress.js';
const { sanitize, truncateBody, cleanNulls } = _test;

const sampleResult = {
  title: 'Hello',
  body: '# Hello\n\nLong body content here. '.repeat(200),
  wordCount: 800,
  metadata: { url: 'https://example.com', description: 'A test page' },
  cached: false,
  renderedWith: 'static',
  finalUrl: 'https://example.com',
};

test('summary mode omits body', () => {
  const out = applyMode(sampleResult, 'summary');
  assert.equal(out.title, 'Hello');
  assert.equal(out.wordCount, 800);
  assert.equal(out.cached, false);
  assert.equal(out.renderedWith, 'static');
  assert.equal(out.body, undefined);
  assert.equal(out.bodyPreview, undefined);
});

test('preview mode includes truncated body', () => {
  const out = applyMode(sampleResult, 'preview', { previewChars: 100 });
  assert.equal(typeof out.bodyPreview, 'string');
  assert.ok(out.bodyPreview.length <= 100);
  assert.equal(out.truncated, true);
});

test('markdown mode includes full body up to MAX_OUTPUT_CHARS', () => {
  const out = applyMode(sampleResult, 'markdown');
  assert.equal(typeof out.body, 'string');
  assert.ok(out.body.length > 100);
  // sample body is < MAX_OUTPUT_CHARS
  assert.equal(out.truncated, false);
});

test('markdown mode caps body at MAX_OUTPUT_CHARS', () => {
  const big = { ...sampleResult, body: 'x'.repeat(60_000) };
  const out = applyMode(big, 'markdown');
  assert.equal(out.body.length, 50_000);
  assert.equal(out.truncated, true);
});

test('excerpt is truncated to 280 chars', () => {
  const long = 'a'.repeat(500);
  const r = { ...sampleResult, metadata: { url: '...', description: long } };
  const out = applyMode(r, 'summary');
  assert.ok(out.excerpt.length <= 281); // 280 + ellipsis
});

test('cached and renderedWith pass through', () => {
  const r = { ...sampleResult, cached: true, renderedWith: 'js' };
  const out = applyMode(r, 'summary');
  assert.equal(out.cached, true);
  assert.equal(out.renderedWith, 'js');
});

test('truncateBody handles empty input', () => {
  assert.deepEqual(truncateBody(''), { body: '', truncated: false });
  assert.deepEqual(truncateBody(null), { body: '', truncated: false });
});

test('sanitize strips control chars', () => {
  assert.equal(sanitize('hello\x00world'), 'helloworld');
  assert.equal(sanitize('a\u200bb\u200cc'), 'abc');
  assert.equal(sanitize('hi\nthere'), 'hithere');
});

test('sanitize strips bidi overrides (Trojan Source)', () => {
  // U+202E RIGHT-TO-LEFT OVERRIDE \u2014 the classic prompt-injection smuggling vector.
  assert.equal(sanitize('safe\u202etext'), 'safetext');
  assert.equal(sanitize('a\u202ab\u202bc\u202cd\u202de\u202ef'), 'abcdef');
});

test('sanitize strips Unicode tag characters (LLM-smuggling)', () => {
  // U+E0049 = TAG LATIN CAPITAL LETTER I \u2014 invisible to humans, decoded by LLMs.
  assert.equal(sanitize('hi\u{e0049}\u{e006e}\u{e0073}truct'), 'hitruct');
});

test('sanitize strips variation selectors and word joiner', () => {
  assert.equal(sanitize('a\ufe0fb\u2060c'), 'abc');
});

test('sanitize strips soft hyphen, CGJ, ALM', () => {
  assert.equal(sanitize('a\u00adb\u034fc\u061cd'), 'abcd');
});

test('sanitizeBody preserves newlines and tabs but strips smuggling chars', () => {
  const { sanitizeBody } = _test;
  assert.equal(sanitizeBody('line1\nline2\n\ttab'), 'line1\nline2\n\ttab');
  assert.equal(sanitizeBody('safe\u202etext'), 'safetext');
  assert.equal(sanitizeBody('a\u{e0049}b'), 'ab');
});

test('cleanNulls drops null/empty/undefined', () => {
  const out = cleanNulls({ a: 'x', b: null, c: '', d: undefined, e: 0 });
  assert.deepEqual(out, { a: 'x', e: 0 });
});

test('buildMetadata constructs clean object from extracted fields', () => {
  const extracted = {
    excerpt: 'hello',
    byline: 'Alice',
    siteName: 'Example',
    pageMeta: {
      canonical: 'https://example.com',
      language: 'en',
      ogType: 'article',
      ogImage: 'https://example.com/og.png',
      publishedTime: '2026-01-01',
    },
  };
  const m = buildMetadata(extracted, 'https://example.com');
  assert.equal(m.url, 'https://example.com');
  assert.equal(m.author, 'Alice');
  assert.equal(m.site, 'Example');
  assert.equal(m.language, 'en');
  assert.equal(m.type, 'article');
  assert.equal(m.image, 'https://example.com/og.png');
  assert.equal(m.published, '2026-01-01');
  // No null fields:
  assert.ok(!('modified' in m));
});
