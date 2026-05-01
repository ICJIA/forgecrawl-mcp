import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMarkdown } from '../src/converter.js';

test('basic HTML to Markdown', () => {
  const md = toMarkdown('<h1>Title</h1><p>Hello <strong>world</strong>.</p>');
  assert.match(md, /^# Title/);
  assert.match(md, /Hello \*\*world\*\*\./);
});

test('strips links by default but keeps text', () => {
  const md = toMarkdown('<p>See <a href="https://example.com">the docs</a> for more.</p>');
  assert.ok(!md.includes('https://example.com'), `expected no link target, got: ${md}`);
  assert.match(md, /the docs/);
});

test('keeps links when includeLinks: true', () => {
  const md = toMarkdown('<p>See <a href="https://example.com">the docs</a>.</p>', { includeLinks: true });
  assert.match(md, /\[the docs\]\(https:\/\/example\.com\)/);
});

test('strips images by default', () => {
  const md = toMarkdown('<p>before<img src="https://example.com/a.png" alt="alt"/>after</p>');
  assert.ok(!md.includes('https://example.com'), `expected no img src, got: ${md}`);
  assert.match(md, /before\s*after/);
});

test('keeps images when includeImages: true', () => {
  const md = toMarkdown('<p><img src="https://example.com/a.png" alt="alt"/></p>', { includeImages: true });
  assert.match(md, /!\[alt\]\(https:\/\/example\.com\/a\.png\)/);
});

test('GFM tables', () => {
  const html = '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>';
  const md = toMarkdown(html);
  assert.match(md, /\| A \| B \|/);
  assert.match(md, /\| 1 \| 2 \|/);
});

test('fenced code blocks', () => {
  const md = toMarkdown('<pre><code class="language-js">const x = 1;</code></pre>');
  assert.match(md, /```/);
  assert.match(md, /const x = 1;/);
});

test('collapses excessive blank lines', () => {
  const html = '<p>a</p><p></p><p></p><p></p><p>b</p>';
  const md = toMarkdown(html);
  // No more than two consecutive newlines anywhere.
  assert.ok(!/\n{3,}/.test(md), `expected no triple newlines, got: ${JSON.stringify(md)}`);
});

test('handles empty and null input', () => {
  assert.equal(toMarkdown(''), '');
  assert.equal(toMarkdown(null), '');
});
