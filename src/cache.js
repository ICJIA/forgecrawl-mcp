import { CONFIG } from './config.js';

// In-memory LRU with TTL. Map preserves insertion order — re-insert on access
// to bump to most-recent. On size overflow, evict the oldest entry.

const _store = new Map(); // key -> { value, expiresAt }

// Stable JSON serializer: keys at every nesting level are sorted, so
// `{a, b: {c, d}}` and `{b: {d, c}, a}` produce the same key.
function sortedStringify(value) {
  if (Array.isArray(value)) return `[${value.map(sortedStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${sortedStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// Canonicalize a URL for cache keying: lowercase scheme/host, drop fragment,
// drop trailing `?`. Same fetch should land in the same slot regardless of
// `https://Example.com/`, `https://example.com/#a`, or `https://example.com/?`.
export function canonicalizeUrl(input) {
  if (typeof input !== 'string') return input;
  try {
    const u = new URL(input);
    u.hash = '';
    if (u.search === '?') u.search = '';
    u.protocol = u.protocol.toLowerCase();
    u.hostname = u.hostname.toLowerCase();
    return u.toString();
  } catch {
    return input;
  }
}

export function makeKey(parts) {
  if (parts && typeof parts === 'object' && !Array.isArray(parts)) {
    // Strip behavior-only fields (don't change identity).
    const { bypassCache: _ignored, ...identity } = parts;
    if (typeof identity.url === 'string') {
      identity.url = canonicalizeUrl(identity.url);
    }
    return sortedStringify(identity);
  }
  return sortedStringify(parts);
}

export function get(key) {
  const entry = _store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    _store.delete(key);
    return null;
  }
  // Bump to most-recent by re-inserting.
  _store.delete(key);
  _store.set(key, entry);
  return entry.value;
}

export function set(key, value, ttlMs = CONFIG.CACHE_TTL_MS) {
  if (_store.has(key)) _store.delete(key);
  _store.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
  while (_store.size > CONFIG.CACHE_MAX_ENTRIES) {
    const oldestKey = _store.keys().next().value;
    if (oldestKey === undefined) break;
    _store.delete(oldestKey);
  }
}

export function clear() {
  _store.clear();
}

export function size() {
  return _store.size;
}
