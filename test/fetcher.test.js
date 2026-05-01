import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fetchPage, fetchText } from '../src/fetcher.js';

let server;
let baseUrl;

// Stand up a tiny local HTTP server bound to 127.0.0.1.
// Run this test suite with FORGECRAWL_BLOCK_PRIVATE unset so loopback is allowed.
delete process.env.FORGECRAWL_BLOCK_PRIVATE;

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/page') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><html><body><h1>Hello</h1></body></html>');
    } else if (req.url === '/redirect-to-page') {
      res.writeHead(302, { location: '/page' });
      res.end();
    } else if (req.url === '/redirect-loop') {
      res.writeHead(302, { location: '/redirect-loop' });
      res.end();
    } else if (req.url === '/redirect-to-imds') {
      // Cross-host redirect → AWS IMDS. Per-hop SSRF re-validation must catch this.
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
      res.end();
    } else if (req.url === '/redirect-sitemap-to-imds') {
      res.writeHead(302, { location: 'http://169.254.169.254/sitemap.xml' });
      res.end();
    } else if (req.url === '/no-content-type') {
      res.writeHead(200);
      res.end('<html></html>');
    } else if (req.url === '/png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end('not-actually-a-png');
    } else if (req.url === '/sitemap.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      res.end('<?xml version="1.0"?><urlset><url><loc>http://x/a</loc></url></urlset>');
    } else if (req.url === '/sitemap-404') {
      res.writeHead(404);
      res.end();
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(() => server.close());

test('fetchPage returns HTML on 200', async () => {
  const { html, finalUrl } = await fetchPage(`${baseUrl}/page`);
  assert.match(html, /<h1>Hello<\/h1>/);
  assert.equal(finalUrl, `${baseUrl}/page`);
});

test('fetchPage follows redirects and reports final URL', async () => {
  const { html, finalUrl } = await fetchPage(`${baseUrl}/redirect-to-page`);
  assert.match(html, /<h1>Hello<\/h1>/);
  assert.equal(finalUrl, `${baseUrl}/page`);
});

test('fetchPage rejects redirect loops', async () => {
  await assert.rejects(() => fetchPage(`${baseUrl}/redirect-loop`), /Too many redirects/);
});

test('fetchPage rejects non-html content types', async () => {
  await assert.rejects(() => fetchPage(`${baseUrl}/png`), /Unsupported content type/);
});

test('fetchText loads a sitemap', async () => {
  const { text } = await fetchText(`${baseUrl}/sitemap.xml`);
  assert.match(text, /<urlset>/);
  assert.match(text, /<loc>http:\/\/x\/a<\/loc>/);
});

test('fetchText reports 404 as Sitemap not found', async () => {
  await assert.rejects(() => fetchText(`${baseUrl}/sitemap-404`), /Sitemap not found/);
});

test('fetchPage blocks redirect into link-local IMDS', async () => {
  // The local server 302s to http://169.254.169.254/... — fetcher must
  // re-validate the redirect target and reject it with "Blocked URL".
  await assert.rejects(() => fetchPage(`${baseUrl}/redirect-to-imds`), /Blocked URL/);
});

test('fetchText blocks intermediate redirect into link-local IMDS', async () => {
  // Same regression for the sitemap path. Before the fix, this would have
  // followed the redirect natively and only re-checked the final URL.
  await assert.rejects(() => fetchText(`${baseUrl}/redirect-sitemap-to-imds`), /Blocked URL/);
});
