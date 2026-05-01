import { log } from './config.js';

const KNOWN = [
  'Blocked URL scheme',
  'Blocked URL',
  'Invalid URL',
  'Too many redirects',
  'Unsupported content type',
  'Response body too large',
  'Page navigation timed out',
  'Scrape timed out',
  'JS rendering not yet supported',  // future-proof
  'Browser launch failed',
  'Could not extract content',
  'No HTML content provided',
  'Sitemap not found',
];

export function sanitizeError(err) {
  const msg = err?.message || 'Unknown error';

  if (KNOWN.some(k => msg.startsWith(k))) return msg;

  if (msg.includes('ECONNREFUSED') || msg.includes('ERR_CONNECTION_REFUSED')) {
    return 'Could not connect to URL';
  }
  if (msg.includes('ETIMEDOUT') || msg.includes('ETIMEOUT') || msg.includes('ERR_TIMED_OUT')) {
    return 'Connection timed out';
  }
  if (msg.includes('ERR_NAME_NOT_RESOLVED') || msg.includes('ENOTFOUND')) {
    return 'Could not resolve hostname';
  }
  if (msg.includes('net::ERR_')) {
    return 'Network error';
  }
  if (msg.toLowerCase().startsWith('invalid url')) {
    return 'Invalid URL';
  }
  if (msg.includes('AbortError') || msg.includes('aborted')) {
    return 'Connection timed out';
  }

  log('error', `Unhandled error: ${msg}`);
  return 'Scrape failed';
}
