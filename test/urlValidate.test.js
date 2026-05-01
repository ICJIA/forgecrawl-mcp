import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyIp } from '../src/urlValidate.js';

test('classifyIp: IPv4 categories', () => {
  assert.equal(classifyIp('8.8.8.8'), 'public');
  assert.equal(classifyIp('1.1.1.1'), 'public');
  assert.equal(classifyIp('127.0.0.1'), 'loopback');
  assert.equal(classifyIp('127.255.255.255'), 'loopback');
  assert.equal(classifyIp('10.0.0.1'), 'private');
  assert.equal(classifyIp('192.168.1.1'), 'private');
  assert.equal(classifyIp('172.16.0.1'), 'private');
  assert.equal(classifyIp('172.31.255.255'), 'private');
  assert.equal(classifyIp('172.15.0.1'), 'public');     // boundary
  assert.equal(classifyIp('172.32.0.1'), 'public');     // boundary
  assert.equal(classifyIp('169.254.169.254'), 'link-local');  // AWS IMDS
  assert.equal(classifyIp('100.64.0.1'), 'cgnat');
  assert.equal(classifyIp('100.127.255.255'), 'cgnat');
  assert.equal(classifyIp('100.128.0.1'), 'public');    // boundary
  assert.equal(classifyIp('0.0.0.0'), 'unspecified');
  assert.equal(classifyIp('224.0.0.1'), 'reserved');    // multicast
  assert.equal(classifyIp('255.255.255.255'), 'reserved');
});

test('classifyIp: IPv6 categories', () => {
  assert.equal(classifyIp('2606:4700:4700::1111'), 'public'); // Cloudflare
  assert.equal(classifyIp('::1'), 'loopback');
  assert.equal(classifyIp('::'), 'unspecified');
  assert.equal(classifyIp('fe80::1'), 'link-local');
  assert.equal(classifyIp('fc00::1'), 'private');
  assert.equal(classifyIp('fd00::1'), 'private');
  assert.equal(classifyIp('ff00::1'), 'reserved');      // multicast
});

test('classifyIp: IPv4-mapped IPv6 unwraps (dotted form)', () => {
  assert.equal(classifyIp('::ffff:127.0.0.1'), 'loopback');
  assert.equal(classifyIp('::ffff:10.0.0.1'), 'private');
  assert.equal(classifyIp('::ffff:169.254.169.254'), 'link-local');
  assert.equal(classifyIp('::ffff:8.8.8.8'), 'public');
});

test('classifyIp: IPv4-mapped IPv6 unwraps (compressed hex form)', () => {
  // Node's URL parser canonicalizes these to compressed hex words.
  // Without normalization, classifyIp would have returned 'invalid' for these.
  assert.equal(classifyIp('::ffff:7f00:1'), 'loopback');                   // 127.0.0.1
  assert.equal(classifyIp('::ffff:a00:1'), 'private');                     // 10.0.0.1
  assert.equal(classifyIp('::ffff:a9fe:a9fe'), 'link-local');              // 169.254.169.254 (AWS IMDS)
  assert.equal(classifyIp('::ffff:808:808'), 'public');                    // 8.8.8.8
});

test('classifyIp: invalid input', () => {
  assert.equal(classifyIp(''), 'invalid');
  assert.equal(classifyIp('not-an-ip'), 'invalid');
  assert.equal(classifyIp(null), 'invalid');
  assert.equal(classifyIp(undefined), 'invalid');
  assert.equal(classifyIp(42), 'invalid');
});

test('validateUrl: rejects non-http schemes', async () => {
  const { validateUrl } = await import('../src/urlValidate.js');
  await assert.rejects(() => validateUrl('file:///etc/passwd'), /Blocked URL scheme/);
  await assert.rejects(() => validateUrl('javascript:alert(1)'), /Blocked URL scheme/);
  await assert.rejects(() => validateUrl('data:text/html,<h1>x</h1>'), /Blocked URL scheme/);
  await assert.rejects(() => validateUrl('ftp://example.com/'), /Blocked URL scheme/);
});

test('validateUrl: rejects malformed input', async () => {
  const { validateUrl } = await import('../src/urlValidate.js');
  await assert.rejects(() => validateUrl(''), /Invalid URL/);
  await assert.rejects(() => validateUrl('not a url'), /Invalid URL/);
  await assert.rejects(() => validateUrl('a'.repeat(3000)), /Invalid URL/);
  await assert.rejects(() => validateUrl(null), /Invalid URL/);
});

test('validateUrl: rejects metadata endpoints', async () => {
  const { validateUrl } = await import('../src/urlValidate.js');
  await assert.rejects(() => validateUrl('http://169.254.169.254/'), /Blocked URL/);
  await assert.rejects(() => validateUrl('http://metadata.google.internal/'), /Blocked URL/);
});

test('validateUrl: rejects link-local IPs in URL hostnames', async () => {
  const { validateUrl } = await import('../src/urlValidate.js');
  await assert.rejects(() => validateUrl('http://169.254.0.1/'), /Blocked URL/);
});

test('validateUrl: rejects unspecified IPs', async () => {
  const { validateUrl } = await import('../src/urlValidate.js');
  await assert.rejects(() => validateUrl('http://0.0.0.0/'), /Blocked URL/);
  await assert.rejects(() => validateUrl('http://[::]/'), /Blocked URL/);
});
