# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] — 2026-05-01

Documentation only. No runtime change.

### Changed

- README expanded with worked use cases by role: developers (multi-doc triage, changelog migration sections, GitHub READMEs without `git clone`, SPA scraping, local HTML conversion), designers / content people (competitor pricing-page audits, content-model extraction), technical writers / researchers (literature reviews with citation metadata, statute / policy diffs across jurisdictions), and accessibility auditors (forgecrawl + axecap pairing).
- New "Why an MCP server, not just have Claude fetch the URL" comparison table — calls out the four levers (token economy via summary mode, SPA support via auto-fallback, local-only fetch, SSRF + prompt-injection prevention).
- CLI examples block: added `cat saved-page.html | forgecrawl extract-html -m markdown` to surface the local-HTML path.

## [0.1.1] — 2026-05-01

First-time npm publish (no functional change vs. 0.1.0; published via `./publish.sh` which bumps before pushing). The 0.1.0 entry below documents the substantive initial release.

## [0.1.0] — 2026-05-01

Initial release. Pre-publish red/blue team security audit completed; the findings catalog and resulting fixes are listed under **Security** below.

### Added

- **`scrape_url`** — fetch a URL and return Markdown with three verbosity tiers (`summary` / `preview` / `markdown`). Supports `selectors.include` / `selectors.exclude` pre-fetch DOM trimming, optional `includeLinks` / `includeImages`, and `bypassCache`.
- **`extract_html`** — convert raw HTML to Markdown without making a network request. Optional source `url` is recorded in metadata only (no fetch).
- **`check_sitemap`** — detect `/sitemap.xml` on a domain and return URL count + a sample of up to 20 URLs.
- **`get_status`** — server version, dependency versions (Readability, Turndown, Playwright, linkedom, cheerio), Node, platform, and npm update check.
- **SPA support** — `render: "auto"` (default) tries static fetch first and falls back to headless Chromium when extraction is sparse (default thresholds: < 50 words or < 200 body chars). `render: "static"` and `render: "js"` force a single mode.
- **Browser lifecycle** — single lazy-launched Chromium instance, reused across calls, closed after `FORGECRAWL_BROWSER_IDLE` ms of inactivity. `waitUntil`, `waitFor` selector, and `waitMs` parameters for tricky pages.
- **Token discipline** — three mode tiers, `MAX_OUTPUT_CHARS: 50_000` ceiling matching axecap/lightcap, structured metadata returned out-of-band, `cached: true` flag on cache hits.
- **In-memory LRU cache** — Map-based, 5-minute TTL, 50-entry size cap, keyed on the canonicalized URL + render + selectors + flags.
- **CLI** — `scrape`, `extract-html`, `sitemap`, `status` subcommands. Defaults to MCP server mode when invoked with no subcommand.

### Security

A pre-publish red/blue team audit identified 0 critical, 3 high, 4 medium, 5 low, 2 info findings. Highs and mediums are all fixed below; lows L-1, L-3, L-4, L-5 are fixed; lows L-2, info I-1 / I-2 are tracked but unmodified (notes inline). The hardening below brings the server up to the same bar `contrastcap-mcp@0.1.4` set after its own audit.

#### High

- **(H-1) JS-render path now re-validates every Chromium request and blocks non-essential subresources.**
  Before the fix, `await page.goto(url)` followed redirects natively and Chromium loaded every `<img>`, `<script>`, `<iframe>`, etc. the page referenced — only the *final* document URL was re-validated. A hostile page rendered via `render: 'js'` (or auto-fallback) could embed `<img src="http://169.254.169.254/...">` and the metadata fetch would fire. `browser.js` now installs a `page.route('**/*')` handler that runs `validateUrl()` on every request URL and aborts non-document/xhr/fetch/script resource types entirely.
- **(H-2) `check_sitemap` (`fetchText`) now uses manual redirect handling.**
  `redirect: 'follow'` silently followed up to 20 redirects; only the final URL was validated. Now matches `fetchPage`'s per-hop validation: every `Location:` header is re-run through the full SSRF classifier with fresh DNS before the next fetch.
- **(H-3) Concurrency cap on Chromium contexts.**
  New `FORGECRAWL_MAX_CONCURRENT_PAGES` env var (default 4). Without it the model could open unbounded parallel contexts. `browser.js` now has a Promise-based semaphore around `withPage()`.

#### Medium

- **(M-1) Prompt-injection sanitizer covers bidi overrides, Unicode tag characters, variation selectors.**
  The sanitizer regex now covers U+202A–U+202E ("Trojan Source" bidi override range), U+2060–U+206F (word joiner / function-application / bidi isolates), U+FE00–U+FE0F (variation selectors), U+E0000–U+E007F (Unicode tag characters — an active LLM-jailbreak smuggling channel), plus U+00AD (soft hyphen), U+034F (combining grapheme joiner), U+061C (Arabic letter mark) on top of the original C0/C1/zero-width/BOM coverage.
  A second variant `sanitizeBody` is now applied to the body markdown in all `preview`/`markdown` mode responses, so smuggling chars in page body content are stripped before Claude sees them. Previously only metadata strings were sanitized.
- **(M-2) Dangerous URL schemes are filtered in Markdown output.**
  Even with `includeLinks: true` / `includeImages: true`, links/images whose href/src is not `http:` or `https:` are stripped. Previously `[click](javascript:alert(1))` and `![alt](file:///etc/passwd)` could land in the response body verbatim.
- **(M-3) DNS lookup resolves all records, not one.**
  `dns.lookup(host, { all: true })` — if any returned address is non-public the host is blocked. Closes a TOCTOU window where the validator could see a public A-record while the subsequent fetch picked a private one (multi-A-record rebinding-style bypass).
- **(M-4) `@mozilla/readability` bumped to `^0.6.0`.**
  Clears low-severity ReDoS advisory `GHSA-3p6v-hrg8-8qj7`. `npm audit`: 0 vulnerabilities. Worker-thread extraction timeout (to bound extraction even when a future advisory lands) is deferred to a follow-up — `Readability.parse()` is synchronous and cannot be force-cancelled inside the event loop without a worker.

#### Low

- **(L-1) IPv6-mapped IPv4 normalization handles compressed hex form.**
  `[::ffff:7f00:1]` (= `127.0.0.1`) and `[::ffff:a9fe:a9fe]` (= AWS IMDS) now classify correctly as `loopback` / `link-local` rather than `invalid`. Previously they were *blocked by accident* via the `default → false` fallthrough; now the categorization is correct, so future loosening of `invalid` cannot create a bypass.
- **(L-3) Cache key canonicalization.**
  `https://Example.com/`, `https://example.com/`, `https://example.com/#a`, and `https://example.com/?` now share a cache slot. Recursive sort of nested objects in `makeKey`. `bypassCache` is no longer part of the key (it's behavior, not identity). Mitigates fragment-stuffing cache pollution.
- **(L-4) `extract_html` URL is scheme-allowlisted.**
  Optional `url` parameter is now rejected if not `http:` or `https:`. Eliminates the metadata-side `file:///etc/passwd` smuggling channel. Misleading "used by Readability for relative-link resolution" comment removed (Readability never sees the URL).
- **(L-5) Regression tests for redirect-into-link-local SSRF.**
  `test/fetcher.test.js` now asserts both `fetchPage` and `fetchText` reject a `302 → http://169.254.169.254/...` chain.

#### Acknowledged, not changed in this release

- **(L-2)** Subsumed by M-1 — the missing call site has been fixed; listing here for trail.
- **(I-1)** `npm view` for the version-update check uses bare `npm` from `$PATH`. Considered harmless: anyone with `$PATH` write access already owns the user. The postinstall script (a more attractive target) goes through `process.execPath` + `require.resolve('playwright/cli.js')`, which is the actual hijack-prevention path. Leaving as-is for now; documented here.
- **(I-2)** `fetcher.js` charset detection ignores `Content-Type: charset=`; non-UTF-8 pages will mojibake. Cosmetic and bounded by the byte cap. Tracked for a follow-up.

### Tests

62 tests via Node's built-in `--test` runner. New coverage:
- Bidi-override sanitization (Trojan Source range)
- Unicode tag-character (U+E0000–U+E007F) sanitization
- Variation selector / word joiner / soft hyphen / CGJ / Arabic letter mark
- `sanitizeBody` preserves newlines and tabs but strips smuggling chars
- IPv6-mapped IPv4 in compressed-hex form (`::ffff:7f00:1`, `::ffff:a9fe:a9fe`)
- `fetchPage` blocks 302 → `169.254.169.254`
- `fetchText` blocks 302 → `169.254.169.254`

### New env vars (introduced by audit fixes)

- `FORGECRAWL_MAX_CONCURRENT_PAGES` (default 4) — concurrency cap on Chromium contexts.
- `FORGECRAWL_EXTRACT_TIMEOUT` (default 10000) — reserved for the planned worker-thread extraction timeout; not yet enforced.
