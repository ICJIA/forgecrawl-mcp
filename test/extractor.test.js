import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractContent } from '../src/extractor.js';

test('extracts a well-structured article via Readability', () => {
  const html = `
    <!doctype html>
    <html lang="en">
      <head>
        <title>Hello World</title>
        <meta name="description" content="A test page">
        <link rel="canonical" href="https://example.com/article">
        <meta property="article:published_time" content="2026-01-01T00:00:00Z">
      </head>
      <body>
        <header><nav>Top nav</nav></header>
        <article>
          <h1>Hello World</h1>
          <p>${'This is a substantial paragraph about something. '.repeat(20)}</p>
          <p>${'Another paragraph with meaningful content. '.repeat(20)}</p>
          <p>${'Yet another paragraph to clear the threshold. '.repeat(20)}</p>
        </article>
        <footer>Site footer</footer>
      </body>
    </html>`;
  const out = extractContent(html, 'https://example.com/article');
  assert.equal(out.title, 'Hello World');
  assert.match(out.content, /<p>/);
  assert.match(out.content, /This is a substantial paragraph/);
  assert.equal(out.pageMeta.canonical, 'https://example.com/article');
  assert.equal(out.pageMeta.language, 'en');
  assert.equal(out.pageMeta.publishedTime, '2026-01-01T00:00:00Z');
});

test('extracts metadata even from sparse pages', () => {
  const html = `
    <html>
      <head>
        <title>Sparse Landing</title>
        <meta property="og:image" content="https://example.com/og.png">
        <meta property="og:site_name" content="Example Site">
        <meta property="og:type" content="website">
      </head>
      <body><h1>Welcome</h1><p>Tiny.</p></body>
    </html>`;
  const out = extractContent(html, 'https://example.com/');
  assert.equal(out.pageMeta.ogImage, 'https://example.com/og.png');
  assert.equal(out.pageMeta.siteName, 'Example Site');
  assert.equal(out.pageMeta.ogType, 'website');
  // Title should fall through to <h1> or <title>.
  assert.ok(out.title === 'Welcome' || out.title === 'Sparse Landing');
});

test('honors selectors.include to trim DOM before extraction', () => {
  const html = `
    <html><body>
      <article><h1>Wanted</h1><p>${'Important content. '.repeat(20)}</p></article>
      <aside><p>${'Sidebar that should NOT appear. '.repeat(20)}</p></aside>
    </body></html>`;
  const out = extractContent(html, 'https://example.com/', {
    selectors: { include: 'article' },
  });
  assert.match(out.content, /Important content/);
  assert.ok(!/Sidebar that should NOT/.test(out.content), `sidebar leaked: ${out.content}`);
});

test('honors selectors.exclude to drop DOM nodes', () => {
  const html = `
    <html><body>
      <article><h1>Title</h1><p>${'Important content. '.repeat(20)}</p></article>
      <div class="ads"><p>Buy stuff</p></div>
    </body></html>`;
  const out = extractContent(html, 'https://example.com/', {
    selectors: { exclude: '.ads' },
  });
  assert.ok(!/Buy stuff/.test(out.content), `excluded selector leaked: ${out.content}`);
});

test('strips scripts/styles in the fallback path', () => {
  const html = `
    <html><body>
      <h1>Tiny</h1>
      <script>alert('xss')</script>
      <style>body { background: red }</style>
    </body></html>`;
  const out = extractContent(html, 'https://example.com/');
  assert.ok(!/alert\(/.test(out.content), `script leaked: ${out.content}`);
  assert.ok(!/background: red/.test(out.content), `style leaked: ${out.content}`);
});

test('throws on empty/missing HTML', () => {
  assert.throws(() => extractContent('', 'https://example.com/'), /No HTML content provided/);
  assert.throws(() => extractContent(null, 'https://example.com/'), /No HTML content provided/);
});
