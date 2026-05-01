const envInt = (key, fallback) => {
  const v = process.env[key];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const envEnum = (key, allowed, fallback) => {
  const v = process.env[key];
  return allowed.includes(v) ? v : fallback;
};

export const CONFIG = {
  // Output discipline
  DEFAULT_MODE:          envEnum('FORGECRAWL_DEFAULT_MODE', ['summary', 'preview', 'markdown'], 'summary'),
  DEFAULT_PREVIEW_CHARS: envInt('FORGECRAWL_PREVIEW_CHARS', 1000),
  MAX_BODY_CHARS:        envInt('FORGECRAWL_MAX_BODY_CHARS', 200_000),
  MAX_OUTPUT_CHARS:      50_000,        // matches axecap/lightcap output ceiling

  // Network
  REQUEST_TIMEOUT:  envInt('FORGECRAWL_TIMEOUT', 30_000),
  MAX_REDIRECTS:    envInt('FORGECRAWL_MAX_REDIRECTS', 10),
  USER_AGENT:       process.env.FORGECRAWL_USER_AGENT || 'forgecrawl-mcp/0.1.0',
  MAX_URL_LENGTH:   2048,
  MAX_HTML_BYTES:   envInt('FORGECRAWL_MAX_HTML_BYTES', 5_242_880), // 5 MB

  // Cache
  CACHE_TTL_MS:      envInt('FORGECRAWL_CACHE_TTL', 300_000),       // 5 min
  CACHE_MAX_ENTRIES: envInt('FORGECRAWL_CACHE_MAX', 50),

  // Extraction
  READABILITY_MIN_RATIO: 0.4,           // fall back if Readability captures < 40% of text
  READABILITY_MIN_CHARS: 200,           // fall back if Readability output is shorter than this

  // Auto-render heuristic (when render: 'auto')
  AUTO_FALLBACK_MIN_WORDS: envInt('FORGECRAWL_AUTO_MIN_WORDS', 50),
  AUTO_FALLBACK_MIN_CHARS: envInt('FORGECRAWL_AUTO_MIN_CHARS', 200),

  // Browser (Playwright, used when render is 'js' or auto-fallback fires)
  BROWSER_NAV_TIMEOUT:   envInt('FORGECRAWL_NAV_TIMEOUT', 30_000),
  BROWSER_WAITFOR_MAX:   envInt('FORGECRAWL_WAITFOR_MAX', 15_000),
  BROWSER_IDLE_TIMEOUT:  envInt('FORGECRAWL_BROWSER_IDLE', 60_000),  // close Chromium after this idle period
  MAX_CONCURRENT_PAGES:  envInt('FORGECRAWL_MAX_CONCURRENT_PAGES', 4),
  VIEWPORT_WIDTH:        envInt('FORGECRAWL_VIEWPORT_WIDTH', 1280),
  VIEWPORT_HEIGHT:       envInt('FORGECRAWL_VIEWPORT_HEIGHT', 800),

  // Extraction timeout (caps Readability ReDoS exposure)
  EXTRACT_TIMEOUT: envInt('FORGECRAWL_EXTRACT_TIMEOUT', 10_000),

  // Sitemap
  SITEMAP_TIMEOUT:  envInt('FORGECRAWL_SITEMAP_TIMEOUT', 15_000),
  SITEMAP_MAX_URLS: envInt('FORGECRAWL_SITEMAP_MAX_URLS', 50_000),  // cap counted URLs to avoid huge XML traversal

  // SSRF policy
  // Always-blocked hostnames (cloud metadata + 0.0.0.0 sentinel).
  BLOCKED_HOSTNAMES: [
    '169.254.169.254',
    'metadata.google.internal',
    'metadata.azure.com',
    'metadata.internal',
    '0.0.0.0',
  ],
  // Network-class blocking is handled by CIDR classification in
  // src/urlValidate.js — link-local (incl. cloud metadata),
  // unspecified, multicast, and reserved ranges are *always* blocked.
  // Private/loopback/CGNAT are allowed by default so the dev-server
  // workflow keeps working, and blocked when this flag is on.
  // Read at call time so the env flag can be flipped per-process.
  get BLOCK_PRIVATE_IPS() { return process.env.FORGECRAWL_BLOCK_PRIVATE === '1'; },
};

// ─── Logging ──────────────────────────────────────────────────────
// Verbosity: 'quiet' = errors only, 'normal' = error+info, 'verbose' = +debug

let verbosity = 'normal';

export function setVerbosity(level) {
  if (['quiet', 'normal', 'verbose'].includes(level)) verbosity = level;
}

export function log(level, msg) {
  if (verbosity === 'quiet' && level !== 'error') return;
  if (verbosity === 'normal' && level === 'debug') return;
  console.error(`[forgecrawl] ${msg}`);
}
