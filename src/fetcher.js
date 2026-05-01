import { CONFIG, log } from './config.js';
import { validateUrl } from './urlValidate.js';

/**
 * Fetch a URL via Node's built-in fetch with manual redirect handling.
 * Every redirect hop is re-validated against the SSRF blocklist (with
 * fresh DNS resolution) so a public host cannot redirect to a private one.
 *
 * @param {string} url            initial URL (already validated by caller is OK; we re-check anyway)
 * @param {object} [opts]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{html: string, finalUrl: string}>}
 */
export async function fetchPage(url, opts = {}) {
  let currentUrl = url;
  let redirectCount = 0;

  // Per-call timeout.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);
  // Allow caller to cancel too.
  const externalSignal = opts.signal;
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    while (true) {
      // SSRF re-validation on every hop (initial + every redirect target).
      await validateUrl(currentUrl);

      const res = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': CONFIG.USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });

      // Handle redirects.
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) throw new Error('Redirect with no Location header');
        redirectCount += 1;
        if (redirectCount > CONFIG.MAX_REDIRECTS) throw new Error('Too many redirects');
        const next = new URL(location, currentUrl).href;
        log('debug', `redirect ${currentUrl} -> ${next}`);
        currentUrl = next;
        // Drain body so the connection can be reused.
        try { await res.arrayBuffer(); } catch { /* ignore */ }
        continue;
      }

      if (res.status >= 400) {
        throw new Error(`HTTP ${res.status}`);
      }

      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml') && !contentType.includes('text/xml') && !contentType.includes('application/xml')) {
        throw new Error(`Unsupported content type: ${contentType || 'unknown'}`);
      }

      // Read body with byte cap to prevent OOM on huge pages.
      const reader = res.body?.getReader();
      if (!reader) {
        const txt = await res.text();
        if (txt.length > CONFIG.MAX_HTML_BYTES) throw new Error('Response body too large');
        return { html: txt, finalUrl: currentUrl };
      }

      const chunks = [];
      let received = 0;
      const decoder = new TextDecoder('utf-8', { fatal: false });
      let html = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > CONFIG.MAX_HTML_BYTES) {
          try { await reader.cancel(); } catch { /* ignore */ }
          throw new Error('Response body too large');
        }
        chunks.push(value);
      }
      html = decoder.decode(Buffer.concat(chunks.map(c => Buffer.from(c))));
      return { html, finalUrl: currentUrl };
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch the HTML of a sitemap.xml. Returns text — caller parses.
 *
 * Manual redirect handling: every hop is re-validated. `redirect: 'follow'`
 * was unsafe — the native fetch silently followed up to 20 redirects without
 * the caller seeing intermediate URLs, so an attacker-hosted sitemap that
 * 302s to an internal address would have fired the internal request even
 * if the final URL came back to a public host.
 */
export async function fetchText(url, opts = {}) {
  let currentUrl = url;
  let redirectCount = 0;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeout ?? CONFIG.SITEMAP_TIMEOUT);

  try {
    while (true) {
      await validateUrl(currentUrl);

      const res = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': CONFIG.USER_AGENT,
          'Accept': 'application/xml, text/xml, text/plain',
        },
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) throw new Error('Redirect with no Location header');
        redirectCount += 1;
        if (redirectCount > CONFIG.MAX_REDIRECTS) throw new Error('Too many redirects');
        const next = new URL(location, currentUrl).href;
        currentUrl = next;
        try { await res.arrayBuffer(); } catch { /* ignore */ }
        continue;
      }

      if (res.status === 404) throw new Error('Sitemap not found');
      if (res.status >= 400) throw new Error(`HTTP ${res.status}`);

      const txt = await res.text();
      if (txt.length > CONFIG.MAX_HTML_BYTES) throw new Error('Response body too large');
      return { text: txt, finalUrl: currentUrl };
    }
  } finally {
    clearTimeout(timer);
  }
}
