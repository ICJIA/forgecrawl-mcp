import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeError } from '../src/sanitizeError.js';

test('passes known errors through unchanged', () => {
  assert.equal(sanitizeError(new Error('Blocked URL')), 'Blocked URL');
  assert.equal(sanitizeError(new Error('Blocked URL scheme')), 'Blocked URL scheme');
  assert.equal(sanitizeError(new Error('Invalid URL')), 'Invalid URL');
  assert.equal(sanitizeError(new Error('Too many redirects')), 'Too many redirects');
  assert.equal(sanitizeError(new Error('Unsupported content type: image/png')), 'Unsupported content type: image/png');
  assert.equal(sanitizeError(new Error('Sitemap not found')), 'Sitemap not found');
});

test('maps connection refused', () => {
  assert.equal(sanitizeError(new Error('connect ECONNREFUSED 127.0.0.1:8080')), 'Could not connect to URL');
  assert.equal(sanitizeError(new Error('net::ERR_CONNECTION_REFUSED at https://x')), 'Could not connect to URL');
});

test('maps timeouts', () => {
  assert.equal(sanitizeError(new Error('connect ETIMEDOUT 10.0.0.1:443')), 'Connection timed out');
  assert.equal(sanitizeError(new Error('ETIMEOUT something')), 'Connection timed out');
  assert.equal(sanitizeError(new Error('AbortError: signal aborted')), 'Connection timed out');
});

test('maps DNS failures', () => {
  assert.equal(sanitizeError(new Error('getaddrinfo ENOTFOUND nope.example')), 'Could not resolve hostname');
  assert.equal(sanitizeError(new Error('net::ERR_NAME_NOT_RESOLVED at https://nope')), 'Could not resolve hostname');
});

test('maps generic chromium net errors', () => {
  assert.equal(sanitizeError(new Error('net::ERR_FAILED at https://x')), 'Network error');
});

test('returns generic message for unknown errors and does not leak stack traces', () => {
  const result = sanitizeError(new Error('Something /Users/me/secret/path/file.js failed at line 42'));
  assert.equal(result, 'Scrape failed');
  assert.ok(!result.includes('/Users/me'));
});

test('handles missing/null errors safely', () => {
  assert.equal(sanitizeError(null), 'Scrape failed');
  assert.equal(sanitizeError(undefined), 'Scrape failed');
  assert.equal(sanitizeError({}), 'Scrape failed');
});
