#!/usr/bin/env node

import { program } from 'commander';
import { readFileSync } from 'fs';
import { createRequire } from 'node:module';
import { execFile } from 'child_process';
import { CONFIG, setVerbosity } from './config.js';
import { scrape, extractFromHtml, checkSitemap } from './scraper.js';
import { applyMode } from './compress.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
const require = createRequire(import.meta.url);

program
  .name('forgecrawl')
  .description('Web scraper that returns clean Markdown — runs as an MCP server (default) or standalone CLI')
  .version(pkg.version);

program
  .option('--verbose', 'Verbose logging')
  .option('--quiet', 'Errors only');

function applyGlobalOptions() {
  const opts = program.opts();
  if (opts.verbose) setVerbosity('verbose');
  if (opts.quiet) setVerbosity('quiet');
}

function parseSelectors(opts) {
  const sel = {};
  if (opts.selectorsInclude) sel.include = opts.selectorsInclude;
  if (opts.selectorsExclude) sel.exclude = opts.selectorsExclude;
  return Object.keys(sel).length > 0 ? sel : undefined;
}

function depVersion(name) {
  try { return require(`${name}/package.json`).version || 'unknown'; }
  catch { return 'unknown'; }
}

program
  .command('scrape <url>')
  .description('Scrape a URL and print the result as JSON')
  .option('-m, --mode <mode>', 'summary | preview | markdown', 'summary')
  .option('--max-body-chars <n>', 'Cap body length (markdown/preview mode)')
  .option('--preview-chars <n>', 'Preview length in chars (preview mode)')
  .option('-r, --render <mode>', 'auto | static | js', 'auto')
  .option('--wait-until <event>', 'load | domcontentloaded | networkidle')
  .option('--wait-for <selector>', 'CSS selector to wait for after navigation (JS render only)')
  .option('--wait-ms <n>', 'Extra delay after page load in ms (JS render only)')
  .option('--selectors-include <css>', 'Narrow the DOM to this selector before extraction')
  .option('--selectors-exclude <css>', 'Drop nodes matching this selector')
  .option('--include-links', 'Keep <a> hrefs in markdown')
  .option('--include-images', 'Keep <img> in markdown')
  .option('--bypass-cache', 'Skip the in-memory cache and force a fresh fetch')
  .action(async (url, opts) => {
    applyGlobalOptions();
    try {
      const result = await scrape({
        url,
        render: opts.render,
        waitUntil: opts.waitUntil,
        waitFor: opts.waitFor,
        waitMs: opts.waitMs ? parseInt(opts.waitMs, 10) : undefined,
        selectors: parseSelectors(opts),
        includeLinks: !!opts.includeLinks,
        includeImages: !!opts.includeImages,
        bypassCache: !!opts.bypassCache,
      });
      const shaped = applyMode(result, opts.mode, {
        previewChars: opts.previewChars ? parseInt(opts.previewChars, 10) : undefined,
        maxBodyChars: opts.maxBodyChars ? parseInt(opts.maxBodyChars, 10) : undefined,
      });
      console.log(JSON.stringify(shaped, null, 2));
    } catch (err) {
      console.error(`Error: ${err?.message || 'unknown'}`);
      process.exitCode = 1;
    }
  });

program
  .command('extract-html')
  .description('Convert HTML from stdin to Markdown (no fetch)')
  .option('-m, --mode <mode>', 'summary | preview | markdown', 'summary')
  .option('-u, --url <url>', 'Source URL (used for metadata + relative links only)')
  .option('--max-body-chars <n>')
  .option('--preview-chars <n>')
  .option('--selectors-include <css>')
  .option('--selectors-exclude <css>')
  .option('--include-links')
  .option('--include-images')
  .action(async (opts) => {
    applyGlobalOptions();
    try {
      const html = await readStdin();
      const result = extractFromHtml({
        html,
        url: opts.url,
        selectors: parseSelectors(opts),
        includeLinks: !!opts.includeLinks,
        includeImages: !!opts.includeImages,
      });
      const shaped = applyMode({ ...result, cached: false }, opts.mode, {
        previewChars: opts.previewChars ? parseInt(opts.previewChars, 10) : undefined,
        maxBodyChars: opts.maxBodyChars ? parseInt(opts.maxBodyChars, 10) : undefined,
      });
      console.log(JSON.stringify(shaped, null, 2));
    } catch (err) {
      console.error(`Error: ${err?.message || 'unknown'}`);
      process.exitCode = 1;
    }
  });

program
  .command('sitemap <url>')
  .description('Detect /sitemap.xml on a domain and report URL count')
  .action(async (url) => {
    applyGlobalOptions();
    try {
      const out = await checkSitemap(url);
      console.log(JSON.stringify(out, null, 2));
    } catch (err) {
      console.error(`Error: ${err?.message || 'unknown'}`);
      process.exitCode = 1;
    }
  });

program
  .command('status')
  .description('Show server + dependency versions and update availability')
  .action(async () => {
    applyGlobalOptions();
    const readabilityVersion = depVersion('@mozilla/readability');
    const turndownVersion = depVersion('turndown');
    const playwrightVersion = depVersion('playwright');
    const linkedomVersion = depVersion('linkedom');
    const cheerioVersion = depVersion('cheerio');

    let latestVersion = 'unknown';
    try {
      latestVersion = await new Promise((resolve, reject) => {
        execFile('npm', ['view', '@icjia/forgecrawl', 'version'], { timeout: 5000 }, (err, stdout) => {
          if (err) reject(err);
          else {
            const raw = stdout.trim();
            resolve(/^\d+\.\d+\.\d+/.test(raw) ? raw : 'unknown');
          }
        });
      });
    } catch { /* ignore */ }

    const updateNote = (latestVersion === 'unknown' || latestVersion === pkg.version)
      ? '(latest)'
      : `(latest: v${latestVersion} — update available)`;

    console.log('forgecrawl status');
    console.log(`  Server:      @icjia/forgecrawl v${pkg.version} ${updateNote}`);
    console.log(`  Readability: v${readabilityVersion}`);
    console.log(`  Turndown:    v${turndownVersion}`);
    console.log(`  Playwright:  v${playwrightVersion}`);
    console.log(`  linkedom:    v${linkedomVersion}`);
    console.log(`  cheerio:     v${cheerioVersion}`);
    console.log(`  Node:        v${process.versions.node}`);
    console.log(`  Platform:    ${process.platform} ${process.arch}`);
    console.log(`  Default mode:${CONFIG.DEFAULT_MODE}`);
  });

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

// Default: start MCP server (when no subcommand given)
const subcommands = ['scrape', 'extract-html', 'sitemap', 'status', 'help'];
const arg2 = process.argv[2];
const isSubcommand = arg2 && (subcommands.includes(arg2) || arg2 === '--help' || arg2 === '-h' || arg2 === '--version' || arg2 === '-V');

if (!arg2 || (!isSubcommand && arg2.startsWith('-'))) {
  await import('./server.js');
} else {
  program.parse();
}
