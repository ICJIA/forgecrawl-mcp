#!/usr/bin/env node

import { readFileSync } from 'fs';
import { createRequire } from 'node:module';
import { execFile } from 'child_process';
import { McpServer, StdioServerTransport } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { CONFIG, setVerbosity, log } from './config.js';
import { sanitizeError } from './sanitizeError.js';
import { scrape, extractFromHtml, checkSitemap } from './scraper.js';
import { applyMode } from './compress.js';

if (process.argv.includes('--verbose')) setVerbosity('verbose');
if (process.argv.includes('--quiet')) setVerbosity('quiet');

// ─── Version tracking ─────────────────────────────────────────────

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
const serverVersion = pkg.version;
const require = createRequire(import.meta.url);

function depVersion(pkgName) {
  try {
    const meta = require(`${pkgName}/package.json`);
    return meta.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

const readabilityVersion = depVersion('@mozilla/readability');
const turndownVersion = depVersion('turndown');
const playwrightVersion = depVersion('playwright');
const linkedomVersion = depVersion('linkedom');
const cheerioVersion = depVersion('cheerio');

// Non-blocking npm registry check at startup.
let _latestVersion = null;
const _latestPromise = new Promise((resolve) => {
  execFile('npm', ['view', '@icjia/forgecrawl', 'version'], { timeout: 5000 }, (err, stdout) => {
    const raw = err ? 'unknown' : stdout.trim();
    _latestVersion = /^\d+\.\d+\.\d+/.test(raw) ? raw : 'unknown';
    resolve(_latestVersion);
  });
});

async function getLatestVersion() {
  if (_latestVersion) return _latestVersion;
  return _latestPromise;
}

log('info', `Server v${serverVersion} | Readability v${readabilityVersion} | Turndown v${turndownVersion} | Playwright v${playwrightVersion}`);

// ─── MCP Server ────────────────────────────────────────────────────

const server = new McpServer({
  name: 'forgecrawl',
  version: serverVersion,
});

const selectorsSchema = z.object({
  include: z.string().max(500).optional().describe('CSS selector to narrow the DOM before extraction (e.g. "main article")'),
  exclude: z.string().max(500).optional().describe('CSS selector(s) to remove before extraction (e.g. ".ads, .sidebar")'),
}).optional();

// ─── scrape_url ───────────────────────────────────────────────────

server.registerTool(
  'scrape_url',
  {
    description:
      'Fetch a URL and return clean Markdown with structured metadata. Default mode is "summary" (title + excerpt + metadata, no body). ' +
      'Use mode="markdown" only when the body is needed. SPA support: render="auto" (default) tries static fetch first and falls back to headless Chromium if extraction is sparse.',
    inputSchema: z.object({
      url: z.url().max(CONFIG.MAX_URL_LENGTH).describe('HTTP or HTTPS URL to scrape'),
      mode: z.enum(['summary', 'preview', 'markdown']).optional().describe('Output verbosity tier (default: summary)'),
      maxBodyChars: z.number().int().min(500).max(200_000).optional().describe('Cap body length in characters (markdown/preview mode)'),
      previewChars: z.number().int().min(100).max(20_000).optional().describe('Preview length in chars (preview mode only; default 1000)'),
      selectors: selectorsSchema,
      includeLinks: z.boolean().optional().describe('Keep <a> hrefs in markdown output (default false)'),
      includeImages: z.boolean().optional().describe('Keep <img> in markdown output (default false)'),
      bypassCache: z.boolean().optional().describe('Skip the in-memory cache and force a fresh fetch'),
      render: z.enum(['auto', 'static', 'js']).optional().describe('Rendering mode. "auto" (default) tries static then falls back to JS. "static" is HTTP fetch only. "js" forces headless Chromium (needed for SPAs).'),
      waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).optional().describe('JS render only — page-load event to wait for'),
      waitFor: z.string().max(200).optional().describe('JS render only — CSS selector to wait for after navigation'),
      waitMs: z.number().int().min(0).max(15_000).optional().describe('JS render only — additional delay in ms after page load'),
    }),
  },
  async (params) => {
    try {
      const result = await scrape(params);
      const shaped = applyMode(result, params.mode || CONFIG.DEFAULT_MODE, {
        previewChars: params.previewChars,
        maxBodyChars: params.maxBodyChars,
      });
      return { content: [{ type: 'text', text: JSON.stringify(shaped, null, 2) }] };
    } catch (err) {
      log('error', err?.message || 'unknown');
      return { content: [{ type: 'text', text: `Error: ${sanitizeError(err)}` }] };
    }
  }
);

// ─── extract_html ─────────────────────────────────────────────────

server.registerTool(
  'extract_html',
  {
    description:
      'Convert raw HTML to clean Markdown without making a network request. Useful when you already have HTML on hand (saved page, fixture, screenshot of a feed, etc.).',
    inputSchema: z.object({
      html: z.string().min(1).max(CONFIG.MAX_HTML_BYTES).describe('Raw HTML content to extract'),
      url: z.url().max(CONFIG.MAX_URL_LENGTH).optional().describe('Optional source URL — used for relative-link resolution and metadata only; no fetch is made'),
      mode: z.enum(['summary', 'preview', 'markdown']).optional().describe('Output verbosity tier (default: summary)'),
      maxBodyChars: z.number().int().min(500).max(200_000).optional(),
      previewChars: z.number().int().min(100).max(20_000).optional(),
      selectors: selectorsSchema,
      includeLinks: z.boolean().optional(),
      includeImages: z.boolean().optional(),
    }),
  },
  async (params) => {
    try {
      const result = extractFromHtml({
        html: params.html,
        url: params.url,
        selectors: params.selectors,
        includeLinks: params.includeLinks,
        includeImages: params.includeImages,
      });
      const shaped = applyMode({ ...result, cached: false }, params.mode || CONFIG.DEFAULT_MODE, {
        previewChars: params.previewChars,
        maxBodyChars: params.maxBodyChars,
      });
      return { content: [{ type: 'text', text: JSON.stringify(shaped, null, 2) }] };
    } catch (err) {
      log('error', err?.message || 'unknown');
      return { content: [{ type: 'text', text: `Error: ${sanitizeError(err)}` }] };
    }
  }
);

// ─── check_sitemap ────────────────────────────────────────────────

server.registerTool(
  'check_sitemap',
  {
    description:
      'Detect /sitemap.xml at a domain and return URL count + a sample of up to 20 URLs. Useful for scoping a crawl: count first, then call scrape_url on the URLs that matter.',
    inputSchema: z.object({
      url: z.url().max(CONFIG.MAX_URL_LENGTH).describe('Any HTTP/HTTPS URL on the target domain — only the origin is used'),
    }),
  },
  async (params) => {
    try {
      const out = await checkSitemap(params.url);
      return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
    } catch (err) {
      log('error', err?.message || 'unknown');
      return { content: [{ type: 'text', text: `Error: ${sanitizeError(err)}` }] };
    }
  }
);

// ─── get_status ───────────────────────────────────────────────────

server.registerTool(
  'get_status',
  {
    description: 'Returns forgecrawl server version, key dependency versions (Readability, Turndown, Playwright), Node version, platform, and whether a newer @icjia/forgecrawl is available on npm.',
    inputSchema: z.object({}),
  },
  async () => {
    try {
      const latest = await getLatestVersion();
      const updateNote = (latest === 'unknown' || latest === serverVersion)
        ? '(latest)'
        : `(latest: v${latest} — update available)`;

      const text = [
        'forgecrawl status',
        `  Server:      @icjia/forgecrawl v${serverVersion} ${updateNote}`,
        `  Readability: v${readabilityVersion}`,
        `  Turndown:    v${turndownVersion}`,
        `  Playwright:  v${playwrightVersion}`,
        `  linkedom:    v${linkedomVersion}`,
        `  cheerio:     v${cheerioVersion}`,
        `  Node:        v${process.versions.node}`,
        `  Platform:    ${process.platform} ${process.arch}`,
        `  Default mode:${CONFIG.DEFAULT_MODE}`,
      ].join('\n');

      return { content: [{ type: 'text', text }] };
    } catch (err) {
      log('error', err?.message || 'unknown');
      return { content: [{ type: 'text', text: `Error: ${sanitizeError(err)}` }] };
    }
  }
);

// ─── Start ─────────────────────────────────────────────────────────

console.error('[forgecrawl] Server started — tools: scrape_url, extract_html, check_sitemap, get_status');
const transport = new StdioServerTransport();
await server.connect(transport);
