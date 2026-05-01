import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { CONFIG } from './config.js';

// Normalize compressed IPv4-mapped IPv6 addresses. Node's URL parser
// canonicalizes `[::ffff:127.0.0.1]` to `[::ffff:7f00:1]` (compressed
// hex form). Without this the IP would not parse as v4 and `classifyIp`
// would return 'invalid' — currently fail-closed by accident, but we
// want correct categorization so future loosening can't bypass.
function normalizeMappedV4(addr) {
  if (typeof addr !== 'string') return addr;
  const m = addr.toLowerCase().match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (m) {
    const hi = parseInt(m[1], 16);
    const lo = parseInt(m[2], 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  // dotted-quad form: ::ffff:127.0.0.1
  if (/^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(addr)) {
    return addr.slice(7);
  }
  return addr;
}

// Classify an IP address into a network category. Returns one of:
//   'loopback'   – 127.0.0.0/8, ::1
//   'private'    – RFC1918 (10/8, 172.16/12, 192.168/16), IPv6 ULA (fc00::/7)
//   'cgnat'      – 100.64.0.0/10
//   'link-local' – 169.254.0.0/16 (incl. cloud metadata), fe80::/10
//   'unspecified'– 0.0.0.0, ::
//   'reserved'   – multicast / class E / other non-routable
//   'public'     – everything else
//   'invalid'    – not parseable
export function classifyIp(address) {
  if (typeof address !== 'string') return 'invalid';
  const ip = normalizeMappedV4(address);
  const v = isIP(ip);

  if (v === 4) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) {
      return 'invalid';
    }
    const [a, b] = parts;
    if (a === 0) return 'unspecified';
    if (a === 127) return 'loopback';
    if (a === 169 && b === 254) return 'link-local';
    if (a === 10) return 'private';
    if (a === 172 && b >= 16 && b <= 31) return 'private';
    if (a === 192 && b === 168) return 'private';
    if (a === 100 && b >= 64 && b <= 127) return 'cgnat';
    if (a >= 224) return 'reserved';
    return 'public';
  }

  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::') return 'unspecified';
    if (lower === '::1') return 'loopback';
    if (/^fe[89ab][0-9a-f]?:/.test(lower)) return 'link-local';
    if (/^f[cd][0-9a-f]{2}:/.test(lower)) return 'private';
    if (lower.startsWith('ff')) return 'reserved';
    return 'public';
  }

  return 'invalid';
}

function isAllowedClass(category) {
  switch (category) {
    case 'public':
      return true;
    case 'loopback':
    case 'private':
    case 'cgnat':
      return !CONFIG.BLOCK_PRIVATE_IPS;
    default:
      return false;
  }
}

export async function isBlockedHost(hostname) {
  if (!hostname) return true;
  if (isIP(hostname)) return !isAllowedClass(classifyIp(hostname));
  const stripped = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  if (isIP(stripped)) return !isAllowedClass(classifyIp(stripped));

  try {
    // Resolve EVERY record. Single-record lookup created a TOCTOU window
    // (and a real-rebinding window) where the validator saw the public IP
    // but the subsequent fetch could pick the private one.
    const records = await lookup(hostname, { all: true });
    if (!records || records.length === 0) return true;
    return records.some((r) => !isAllowedClass(classifyIp(r.address)));
  } catch {
    return true; // DNS failure → fail closed
  }
}

export async function validateUrl(url) {
  if (typeof url !== 'string' || url.length === 0 || url.length > CONFIG.MAX_URL_LENGTH) {
    throw new Error('Invalid URL');
  }

  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('Invalid URL'); }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Blocked URL scheme');
  }
  const hostname = parsed.hostname.toLowerCase();
  if (CONFIG.BLOCKED_HOSTNAMES.includes(hostname)) {
    throw new Error('Blocked URL');
  }
  if (await isBlockedHost(hostname)) {
    throw new Error('Blocked URL');
  }
  return parsed.href;
}

export const _test = { isBlockedHost, classifyIp };
