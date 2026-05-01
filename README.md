# @icjia/forgecrawl

A self-contained MCP server that fetches a URL and returns clean Markdown — Mozilla Readability + Turndown for static pages, headless Chromium (Playwright) for SPAs. No external service. No API key. Stdio in, Markdown out.

## Why?

A typical web page is 50–500 KB of HTML. That's tens of thousands of tokens you'd be sending to Claude just to read what's on the page — most of it nav chrome, scripts, styles, and tracking. Forgecrawl runs the same extraction pipeline a human reader-mode tool runs (Mozilla's `Readability`, the same engine Firefox uses) and hands Claude only the meaningful content as Markdown.

The other half of the win is **output discipline at the boundary.** Forgecrawl defaults to a `summary` response — title, excerpt, word count, structured metadata, no body. Claude can decide whether the page is worth pulling in full before paying for it.

```
You: "Read these 10 articles and tell me which mention WCAG 2.2"
Claude: [calls scrape_url x10 with mode=summary]   ← cheap; ~5k tokens total
Claude: "Three look relevant. Pulling those in full."
Claude: [calls scrape_url x3 with mode=markdown]   ← only pays for what matters
```

## What it does

- Fetches URLs with built-in `fetch()` and converts the result to Markdown
- Uses **Mozilla Readability** as the primary extractor; falls back to a cleaned full-body extraction when Readability captures less than 40% of the page text (common on landing pages, gov sites, docs hubs)
- Renders **single-page apps** via headless Chromium when needed — `render: "auto"` (default) tries static fetch first and falls back automatically; `render: "js"` forces the browser path
- Returns three verbosity tiers — `summary` (no body), `preview` (first ~1k chars), `markdown` (full)
- Plumbs CSS `selectors.include` / `selectors.exclude` through to trim the DOM *before* Markdown conversion
- Strips `<a>` and `<img>` by default (toggle on with `includeLinks` / `includeImages`)
- Caps output at 50,000 characters — matches the convention in sibling ICJIA servers (`lightcap`, `axecap`)
- Caches results in-memory (5 min TTL, 50 entries) keyed on the full request shape; surfaces `cached: true` so Claude knows when a call was free
- SSRF-protected via CIDR-class IP classification (link-local / unspecified / multicast / reserved always blocked; private/loopback/CGNAT off by default, opt-in via `FORGECRAWL_BLOCK_PRIVATE=1`)
- Detects `sitemap.xml` and reports URL counts for crawl scoping
- Standalone CLI for use outside MCP clients (`forgecrawl scrape`, `forgecrawl sitemap`, `forgecrawl status`)
- Runs as a local MCP server over stdio (no HTTP, no ports, no remote attack surface)

## Installation

### Prerequisites

- **Node.js >= 20** (check with `node --version`)
- **Disk space for Chromium** (~200 MB — used for SPA rendering; downloaded automatically by Playwright on first install). Skip with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` if you only need static scraping.

### Option 1: npx (recommended, no install needed)

```bash
npx -y @icjia/forgecrawl --help
```

### Option 2: Global install

```bash
npm install -g @icjia/forgecrawl
```

### Option 3: Clone for development

```bash
git clone https://github.com/ICJIA/forgecrawl-mcp.git
cd forgecrawl-mcp
npm install
```

## Setup with Claude Code

Claude Code manages MCP server lifecycle automatically — register once, and Claude Code starts/stops it with each session.

### Using npx (recommended)

```bash
# All projects (user-level)
claude mcp add forgecrawl -s user -- npx -y @icjia/forgecrawl

# Current project only
claude mcp add forgecrawl -s project -- npx -y @icjia/forgecrawl
```

### Using a local clone

```bash
claude mcp add forgecrawl -s user -- node /absolute/path/to/forgecrawl-mcp/src/server.js
```

### Manual config

Edit `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "forgecrawl": {
      "command": "npx",
      "args": ["-y", "@icjia/forgecrawl"]
    }
  }
}
```

Then run `/mcp` in Claude Code to verify it's listed, and try:

> "Use forgecrawl to summarize https://en.wikipedia.org/wiki/Markdown"

## Setup with Cursor

### Global

`~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "forgecrawl": {
      "command": "npx",
      "args": ["-y", "@icjia/forgecrawl"]
    }
  }
}
```

### Project-level

`.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "forgecrawl": {
      "command": "npx",
      "args": ["-y", "@icjia/forgecrawl"]
    }
  }
}
```

Restart Cursor after adding the configuration.

## Setup with Cline (VS Code)

Cline reads MCP servers from `cline_mcp_settings.json`. Open the Cline panel → MCP Servers → Edit MCP Settings:

```json
{
  "mcpServers": {
    "forgecrawl": {
      "command": "npx",
      "args": ["-y", "@icjia/forgecrawl"]
    }
  }
}
```

## Setup with Continue.dev

Continue uses `~/.continue/config.json`. Add forgecrawl to the `mcpServers` block:

```json
{
  "mcpServers": [
    {
      "name": "forgecrawl",
      "command": "npx",
      "args": ["-y", "@icjia/forgecrawl"]
    }
  ]
}
```

## Setup with Windsurf

Windsurf supports MCP servers via Settings → Cascade → MCP. Add an entry:

```json
{
  "mcpServers": {
    "forgecrawl": {
      "command": "npx",
      "args": ["-y", "@icjia/forgecrawl"]
    }
  }
}
```

## Setup with Zed

Zed reads MCP configuration from `~/.config/zed/settings.json`:

```json
{
  "context_servers": {
    "forgecrawl": {
      "command": {
        "path": "npx",
        "args": ["-y", "@icjia/forgecrawl"]
      }
    }
  }
}
```

## Setup with any other MCP client

Forgecrawl works with any MCP client that supports stdio transport. Configure your client to spawn:

```bash
npx -y @icjia/forgecrawl
```

No HTTP ports, no environment variables required.

## Troubleshooting

### `Failed to connect` or `sh: forgecrawl: command not found`

If your MCP client reports **"Failed to connect"**, or running `npx -y @icjia/forgecrawl` in a terminal prints `sh: forgecrawl: command not found`, your local npx run cache likely has a stale entry (often seeded by an earlier failed install — e.g. a typo'd package name returning 404). Clear it and retry:

```bash
rm -rf ~/.npm/_npx
npx -y @icjia/forgecrawl --help
```

If that succeeds, restart your MCP client. `publish.sh` runs the same clear-and-retry as a post-publish smoke test, so a published artifact reaching the registry has already been verified to launch from a clean cache.

**Working inside the `forgecrawl-mcp` repo?** Same symptom, different cause: your cwd's `package.json` has the same `name` as the requested package, so npx looks for the bin in this repo's `node_modules/.bin/` and finds nothing (a package isn't installed as its own dependency). Clearing the npx cache won't help — register the dev MCP via the [Local development](#local-development) snippet instead.

### First-run timeout (Chromium download)

The `postinstall` step downloads Chromium (~150 MB) for SPA support. On the very first `npx -y @icjia/forgecrawl`, this can take longer than the MCP client's startup window and surface as "Failed to connect." Either warm the cache once in a terminal:

```bash
npx -y @icjia/forgecrawl --help
```

…or skip the Chromium download (loses JS-render / SPA support) by setting `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` in the server's environment.

## MCP Tools

### `scrape_url`

Fetch a URL and return Markdown. Default mode is `summary`.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | string | *(required)* | HTTP/HTTPS URL to scrape |
| `mode` | string | `summary` | `summary` \| `preview` \| `markdown` |
| `maxBodyChars` | number | 50,000 | Cap body length (markdown/preview) |
| `previewChars` | number | 1,000 | Preview length (preview only) |
| `selectors.include` | string | — | CSS selector to narrow DOM before extraction |
| `selectors.exclude` | string | — | CSS selector(s) to remove |
| `includeLinks` | boolean | false | Keep `<a>` hrefs |
| `includeImages` | boolean | false | Keep `<img>` |
| `bypassCache` | boolean | false | Skip in-memory cache |
| `render` | string | `auto` | `auto` \| `static` \| `js` |
| `waitUntil` | string | `domcontentloaded` | `load` \| `domcontentloaded` \| `networkidle` (JS render) |
| `waitFor` | string | — | CSS selector to wait for (JS render) |
| `waitMs` | number | — | Extra delay after page load (JS render) |

**Returns** (mode: summary):

```json
{
  "url": "https://en.wikipedia.org/wiki/Markdown",
  "title": "Markdown - Wikipedia",
  "excerpt": "Markdown is a lightweight markup language for creating formatted text…",
  "wordCount": 4823,
  "metadata": { "language": "en", "site": "Wikipedia", "image": "…" },
  "cached": false,
  "renderedWith": "static"
}
```

**Returns** (mode: markdown): adds a `body` field with the full Markdown (capped at 50,000 chars; `truncated` flag set when capped).

### `extract_html`

Convert HTML you already have to Markdown — no fetch.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `html` | string | *(required)* | Raw HTML content |
| `url` | string | — | Optional source URL (metadata + relative-link resolution only) |
| `mode` | string | `summary` | Same as `scrape_url` |
| (other params) | — | — | Same as `scrape_url` minus the network-only ones |

### `check_sitemap`

Detect `/sitemap.xml` and report URL count + a sample. Cheap way to scope a crawl before fanning out into `scrape_url` calls.

| Parameter | Type | Description |
|-----------|------|-------------|
| `url` | string | Any URL on the target domain — only the origin is used |

**Returns:**

```json
{
  "sitemapUrl": "https://example.com/sitemap.xml",
  "urlCount": 142,
  "sample": ["https://example.com/...", "..."]
}
```

### `get_status`

Server + dependency versions and update availability.

```
forgecrawl status
  Server:      @icjia/forgecrawl v0.1.0 (latest)
  Readability: v0.5.0
  Turndown:    v7.2.0
  Playwright:  v1.49.0
  linkedom:    v0.18.0
  cheerio:     v1.0.0
  Node:        v22.22.0
  Platform:    darwin arm64
  Default mode:summary
```

## CLI (standalone usage)

```bash
# Summary (no body)
forgecrawl scrape https://example.com

# Full markdown
forgecrawl scrape https://en.wikipedia.org/wiki/Markdown -m markdown

# Preview with selector trim
forgecrawl scrape https://example.com -m preview --selectors-include "main"

# Force JS rendering for an SPA
forgecrawl scrape https://react.dev -r js -m summary

# Auto mode (will fall back to JS if static is too thin)
forgecrawl scrape https://vuejs.org -r auto -m preview

# Convert HTML from stdin
cat page.html | forgecrawl extract-html -m markdown

# Sitemap discovery
forgecrawl sitemap https://example.com

# Versions + update check
forgecrawl status

# Verbose logging
forgecrawl --verbose scrape https://example.com

# Pipe HTML you already have to Markdown
cat saved-page.html | forgecrawl extract-html -m markdown
```

When run without a subcommand, `forgecrawl` starts in MCP server mode (stdio transport).

## What you'd actually use this for

The point isn't "Claude can read a webpage." Claude already can. The point is **Claude can read 30 webpages cheaply, decide which 3 matter, and pull those in full** — because forgecrawl gives the model a `summary` lever, an SPA-capable renderer, and pre-fetch DOM trimming. Concrete workflows:

### For developers

**Compare framework / library docs without burning context**

```
You: "Compare React Server Components, Solid, Qwik, Astro, and Svelte 5
     for an SSR-heavy app. Skim each project's docs site first."
Claude: [scrape_url × 5 with mode='summary']     ← ~2.5k tokens total
Claude: "Astro and Svelte 5 look most aligned with your constraints.
        Pulling those in full."
Claude: [scrape_url × 2 with mode='markdown']    ← only pays for what matters
```

Without forgecrawl: 5 raw HTML pages × ~25k tokens each = a context window already half-spent before the comparison starts.

**Find the migration / breaking-changes section in a long changelog**

```
You: "What's the migration path from v17 to v18 of @opentelemetry/api?"
Claude: [scrape_url … mode='preview' previewChars=2000]
Claude: "The migration section is at #migration-from-v17. Re-fetching just that."
Claude: [scrape_url … selectors.include='#migration-from-v17' mode='markdown']
```

`selectors.include` runs in Cheerio *before* Readability — the rest of the changelog never enters the model's context.

**Read a GitHub README without `git clone`**

```
You: "What does the @icjia/lightcap MCP server do? Look at its README."
Claude: [scrape_url https://github.com/ICJIA/lightcap-mcp mode='markdown']
```

GitHub's rendered README hits Readability cleanly. Static path, no auth, no rate-limit, no clone.

**Scrape an SPA admin dashboard or doc site**

```
You: "Read the React docs on Suspense and explain the async render fence."
Claude: [scrape_url https://react.dev/reference/react/Suspense
         render='auto' mode='markdown']
```

Static fetch returns near-empty HTML (React mounts client-side). Auto-fallback fires Playwright, page mounts, content is extracted, response includes `renderedWith: 'js'` so Claude knows it paid the browser-launch cost.

**Convert HTML you already have on disk**

```bash
cat saved-page.html | forgecrawl extract-html -m markdown
```

Or via MCP, `extract_html` lets Claude convert HTML it already pulled (from a logged-in session, a fixture, a CMS export) without paying for the network round-trip. No data leaves your machine.

### For designers / content people

**Pull copy and structure from a competitor's pricing page**

```
You: "I'm redesigning our pricing page. Pull the structure and copy
     from Stripe, Vercel, and Linear's pricing pages."
Claude: [scrape_url × 3 mode='markdown' selectors.include='main']
```

The `selectors.include='main'` skips nav and footer. Markdown output preserves the hierarchy of headings, tier names, feature lists, and CTA copy — it's effectively a content audit in a structured form.

**Reference content for a redesign — without the design**

```
You: "What's actually IN the IRS Form 1040 instructions PDF page on
     irs.gov? Just the content, no nav."
Claude: [scrape_url … selectors.exclude='nav, .breadcrumbs, footer'
         mode='markdown' includeLinks=true]
```

Designers often need the *content model* of a page — the headings, the hierarchy, the cross-references. forgecrawl with `includeLinks: true` gives you exactly that as Markdown.

### For technical writers / researchers

**Build a literature review across many sources**

```
You: "I'm writing a brief on procedural justice in pretrial release.
     Summarize each of these 12 academic and policy sources."
Claude: [scrape_url × 12 mode='summary']        ← ~6k tokens
Claude: [composes the brief, citing each by URL + author + date from the
         structured metadata field]
```

The `metadata` block on every response carries `author`, `published`, `site`, `language` — Claude has citation data without you handing it over manually.

**Track policy changes across jurisdictions**

```
You: "Pull the current bail-reform statute language from the AOICs of
     Illinois, New Jersey, and California."
Claude: [scrape_url × 3 mode='markdown' selectors.include='article, main']
Claude: [diffs the statutes, flags the structural differences]
```

### For accessibility auditors

**Pair forgecrawl with axecap for content + a11y audits**

```
You: "Audit the about page on icjia.illinois.gov for accessibility AND
     check whether the page actually says what it claims to."
Claude: [axecap.audit_url … ]   ← what's broken
Claude: [scrape_url …]          ← what the page actually says
Claude: [composes report combining a11y findings with content critique]
```

Most a11y tools tell you *that* a heading is wrong, not *what* the heading says. forgecrawl supplies the content half of that picture.

### Why an MCP server, not "just have Claude fetch the URL"

| Concern | Without forgecrawl | With forgecrawl |
|---------|-------------------|-----------------|
| 30 URLs to triage | 30 × ~25k tokens raw HTML | 30 × ~400 tokens summary, then drill into 2-3 |
| SPA / JS-rendered page | Returns ~0 content | Auto-fallback to headless Chromium |
| Internal corp page | Fetch leaves through whatever the model's network is | Local fetch, never leaves your host |
| AWS / GCP / Azure metadata endpoints | No SSRF guarantees | Hard-blocked at every redirect hop |
| Bidi / Unicode-tag prompt-injection | Page content reaches model verbatim | Stripped before output |

## Token economy

The point of the design is to never load more than the model needs.

| Mode | Typical output | Use when |
|------|---------------|----------|
| `summary` | 200–500 tokens | "Is this page about X?" / triaging multiple URLs |
| `preview` | ~1,500 tokens | Need a snippet but not the full text |
| `markdown` | up to ~13,000 tokens | Doing real work with the page content |

**Compression strategies in play:**

1. **Mode tiers** — caller picks scope; default is `summary`
2. **Pre-fetch trimming** — `selectors.include`/`exclude` runs *before* extraction, shrinking the DOM that ever sees Readability
3. **Frontmatter as structured field** — page metadata is returned as a JSON object, not embedded in the Markdown body, so the caller never pays tokens for both
4. **Default link/image stripping** — Turndown rules drop `<a>` hrefs and `<img>` URLs unless explicitly requested
5. **Body cap at 50k chars** — matches axecap/lightcap; truncation is reported in the response
6. **In-memory cache** — repeat calls (same URL + same options) return instantly with `cached: true`

## Configuration (env vars, all optional)

| Variable | Default | What it does |
|----------|---------|--------------|
| `FORGECRAWL_DEFAULT_MODE` | `summary` | Default response tier |
| `FORGECRAWL_PREVIEW_CHARS` | `1000` | Default `previewChars` |
| `FORGECRAWL_MAX_BODY_CHARS` | `200000` | Hard ceiling on `maxBodyChars` |
| `FORGECRAWL_TIMEOUT` | `30000` | HTTP fetch timeout (ms) |
| `FORGECRAWL_MAX_REDIRECTS` | `10` | Redirect cap |
| `FORGECRAWL_USER_AGENT` | `forgecrawl-mcp/<version>` | UA string |
| `FORGECRAWL_MAX_HTML_BYTES` | `5242880` | Body byte cap (5 MB) |
| `FORGECRAWL_CACHE_TTL` | `300000` | Cache entry TTL (ms) |
| `FORGECRAWL_CACHE_MAX` | `50` | Cache size cap |
| `FORGECRAWL_AUTO_MIN_WORDS` | `50` | Auto-fallback threshold (words) |
| `FORGECRAWL_AUTO_MIN_CHARS` | `200` | Auto-fallback threshold (body chars) |
| `FORGECRAWL_NAV_TIMEOUT` | `30000` | Playwright navigation timeout |
| `FORGECRAWL_WAITFOR_MAX` | `15000` | Max delay for `waitFor`/`waitMs` |
| `FORGECRAWL_BROWSER_IDLE` | `60000` | Close Chromium after this idle period (ms) |
| `FORGECRAWL_MAX_CONCURRENT_PAGES` | `4` | Cap on inflight Chromium contexts |
| `FORGECRAWL_VIEWPORT_WIDTH` | `1280` | Browser viewport width |
| `FORGECRAWL_VIEWPORT_HEIGHT` | `800` | Browser viewport height |
| `FORGECRAWL_EXTRACT_TIMEOUT` | `10000` | Reserved for the planned worker-thread extraction timeout (not yet enforced) |
| `FORGECRAWL_BLOCK_PRIVATE` | (off) | Set to `1` to block RFC1918 / loopback / CGNAT. **Recommended for any non-localhost-dev deployment.** |
| `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` | (off) | Set to `1` to skip Chromium install |
| `PLAYWRIGHT_DOWNLOAD_HOST` | (default mirror) | Use a private Chromium mirror |

## Testing

```bash
npm test
```

Covers `urlValidate` (CIDR matrix, IPv4-mapped IPv6, link-local, multicast), `sanitizeError`, `cache` (TTL + LRU), `converter` (link/image strip, GFM tables, fenced code), `extractor` (Readability + fallback + selector trim), `compress.applyMode` (all three tiers + truncation), and `fetcher` (loopback HTTP server, redirects, content-type rejection, sitemap fetch).

## Local development

No build step. Plain JavaScript with ES modules. Edit source, restart Claude Code, repeat.

```bash
git clone https://github.com/ICJIA/forgecrawl-mcp.git
cd forgecrawl-mcp
npm install
claude mcp add forgecrawl -s user -- node $(pwd)/src/server.js
# restart Claude Code, then ask it to scrape something
```

**Don't register the MCP as `npx -y @icjia/forgecrawl` while working inside this repo.** With cwd in the project, npx sees the matching local `package.json`, tries to spawn `forgecrawl` from `node_modules/.bin/` — which doesn't exist (a package isn't installed as its own dep) — and exits `127` with `sh: forgecrawl: command not found`. The `node $(pwd)/src/server.js` form above sidesteps the collision *and* runs your working tree, so edits take effect on the next MCP restart.

## Publishing to npm

This package follows the ICJIA publish convention:

```bash
# First-time publish (uses current version in package.json):
./publish.sh

# Subsequent releases — bump and publish:
./publish.sh patch      # 0.1.0 → 0.1.1
./publish.sh minor      # 0.1.1 → 0.2.0
./publish.sh major      # 0.2.0 → 1.0.0

# Dry run only:
./publish.sh --dry-run
```

The script:

1. Verifies you're logged in to npm (`npm whoami`); prompts `npm login` if not
2. Verifies a clean git working tree
3. Detects whether `@icjia/forgecrawl` exists on npm — first-time publish uses `--access public`
4. Bumps the version with `npm version <bump>`
5. Runs `npm publish --dry-run` and prompts for confirmation
6. Publishes
7. Commits the version bump, tags `vX.Y.Z`, and pushes (with tags)

Aborts cleanly if anything fails or you say no at the prompt.

## Architecture

```
src/
├── server.js ........ MCP server: registers 4 tools, stdio transport
├── cli.js ........... Dual-mode entry: subcommand → CLI, otherwise → server
├── config.js ........ CONFIG (env-driven) + log()/setVerbosity()
├── scraper.js ....... Pipeline orchestration: validate → cache → fetch (static or JS) → extract → convert → finalize
├── fetcher.js ....... fetch() with manual redirect handling + per-hop SSRF re-validation; sitemap helper
├── browser.js ....... Lazy Playwright Chromium lifecycle (single instance, idle close, withPage helper)
├── extractor.js ..... Readability primary, Cheerio-based fallback, selector pre-filter, metadata
├── converter.js ..... Turndown + GFM, link/image strip
├── compress.js ...... applyMode (summary/preview/markdown), truncate, buildMetadata, sanitize
├── cache.js ......... In-memory LRU with TTL
├── urlValidate.js ... SSRF: CIDR classification, DNS resolution, scheme allowlist
└── sanitizeError.js . KNOWN_ERRORS allowlist + connection/timeout/DNS pattern matching
```

| File | Role |
|------|------|
| `server.js` | MCP init, Zod schemas for 4 tools, request routing, error handling |
| `scraper.js` | The core pipeline. `scrape()`, `extractFromHtml()`, `checkSitemap()` |
| `fetcher.js` | HTTP fetch with manual redirect handling. Each hop re-validates. Body byte cap. |
| `browser.js` | Single shared Chromium, lazy-launched, closed on idle. `withPage(fn)` helper. |
| `extractor.js` | Readability primary; sparse-content fallback at 40% capture ratio. |
| `converter.js` | Turndown + GFM. Strips links/images by default. |
| `compress.js` | Mode tiers + char ceilings + structured metadata. |
| `urlValidate.js` | CIDR-based IP classification. Always blocks link-local/unspecified/multicast/reserved. Loopback/private/CGNAT opt-in via `FORGECRAWL_BLOCK_PRIVATE=1`. |
| `sanitizeError.js` | Known-safe messages pass through; everything else maps to a generic message. Stack traces never leak. |
| `cache.js` | Map-based LRU keyed on a stable JSON of the request shape. |

### Dependencies

| Package | Purpose |
|---------|---------|
| `@modelcontextprotocol/server` | MCP SDK (stdio transport, tool registration) |
| `@mozilla/readability` | Reader-mode extraction (the same engine Firefox uses) |
| `linkedom` | Lightweight DOM that pairs cleanly with Readability on the server |
| `cheerio` | Used for selector trimming and the fallback extraction path |
| `turndown` + `turndown-plugin-gfm` | HTML → Markdown |
| `playwright` | Headless Chromium for SPA rendering |
| `commander` | CLI parsing |
| `zod` | Schema validation for MCP tool parameters |

## Security

Forgecrawl runs locally over stdio — no network listener, no ports, no remote attack surface. The hardening below addresses misuse via prompt injection and SSRF.

A pre-publish red/blue team audit (see [CHANGELOG.md](CHANGELOG.md) → 0.1.0 → Security) identified 0 critical, 3 high, 4 medium, and 5 low findings. Highs and mediums are fixed; relevant lows are fixed; remaining items are documented in the changelog. `npm audit`: 0 vulnerabilities.

### Threat model

The MCP server is local-only (stdio), so the threats are:
- A **page** the model is asked to scrape is treated as untrusted: it can redirect to internal addresses, embed `<img>` pointing at metadata endpoints (when JS-rendered), or stuff invisible Unicode into its content trying to influence the model.
- A **URL** the model is given via tool-call may be attacker-influenced (prompt-injected or sourced from an untrusted document).
- **Local users** with `$PATH` write access are out of scope (they already own the host).

### SSRF prevention

- **Scheme allowlist.** Only `http:` and `https:` URLs are accepted, in `scrape_url`, `extract_html`'s optional `url`, and `check_sitemap`.
- **Hostname blocklist.** AWS metadata (`169.254.169.254`), GCP (`metadata.google.internal`), Azure (`metadata.azure.com`), and `0.0.0.0` are blocked by name before DNS even runs.
- **CIDR-based IP classification.** Hostnames are resolved via DNS, every returned address is normalized (IPv4-mapped IPv6 unwrapped, including the compressed hex form `::ffff:7f00:1`) and classified. Always-blocked categories: link-local (`169.254.0.0/16` IPv4 + `fe80::/10` IPv6, catches *all* AWS IMDS addresses), unspecified (`0.0.0.0`, `::`), multicast (`224.0.0.0/4`, `ff00::/8`), reserved.
- **All-records lookup.** The validator examines every A/AAAA record returned by `dns.lookup` and rejects if any is non-public — closes a multi-A rebinding-style bypass where a single-record check could miss the private one.
- **Opt-in private/loopback blocking.** `FORGECRAWL_BLOCK_PRIVATE=1` blocks RFC1918, CGNAT (`100.64.0.0/10`), loopback (`127/8`, `::1`), and IPv6 ULA (`fc00::/7`). Off by default so the dev workflow keeps working; **recommended on for any non-localhost-dev deployment.**
- **Per-hop redirect re-validation, both code paths.** `fetchPage` (static) and `fetchText` (sitemap) both use `redirect: 'manual'` and run every `Location:` target through the full validator (with fresh DNS) before the next request.
- **Subresource and redirect re-validation in JS render.** When Playwright is used, a `page.route('**/*')` handler runs `validateUrl` on every request URL the page makes — documents, redirects, and any subresource. Non-essential resource types (images, fonts, media, stylesheets) are blocked outright; the scraper only consumes the document tree.
- **Fail-closed DNS.** Resolution failures block the request rather than allow.

### Prompt-injection prevention

- **Sanitizer covers the smuggling channels.** Output strings are stripped of: C0/C1 controls, soft hyphen, combining grapheme joiner, Arabic letter mark, zero-width chars and LTR/RTL marks (U+200B–U+200F), line/paragraph separators, **bidi embedding/override (U+202A–U+202E, the "Trojan Source" range)**, **bidi isolate / word joiner / function-application (U+2060–U+206F)**, **variation selectors (U+FE00–U+FE0F)**, BOM, and **Unicode tag characters (U+E0000–U+E007F) — the active LLM-jailbreak smuggling channel.**
- **Body sanitization.** A second variant of the sanitizer is applied to the body markdown in `preview` and `markdown` mode responses (preserving `\n`, `\t`, `\r` so structure survives) — page body content cannot smuggle invisible instructions to the model.
- **Char ceiling.** Total output is capped at 50,000 chars (with truncation note) so a hostile page cannot inflate token usage.
- **Safe URL emission.** Even with `includeLinks: true` / `includeImages: true`, links and images whose href/src is not `http:` or `https:` are stripped from Markdown output. `javascript:`, `data:`, `file:`, and any other scheme cannot reach the response body.
- **No raw HTML to the model.** Even in `mode: "markdown"`, the response is post-extraction Markdown — not the raw HTML the page served. Nothing unmediated.

### Postinstall hardening

`scripts/postinstall.mjs` resolves Playwright's CLI through Node's module resolver (`require.resolve('playwright/cli.js')`) rather than `$PATH` — this closes the shadowed-binary hijack vector. Spawns via `process.execPath`. Honors `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`. Emits actionable error messages on failure rather than silent broken installs.

### Resource limits

| Resource | Limit | Enforced by |
|----------|-------|-------------|
| URL length | 2,048 chars | Zod schema |
| HTML body | 5 MB | `fetcher.js` (streaming with byte counter) |
| HTTP timeout | 30 s | `fetcher.js` (AbortController) |
| Redirects | 10 | `fetcher.js` (manual loop) |
| Browser navigation timeout | 30 s | `browser.js` / `scraper.js` |
| Inflight Chromium contexts | 4 | `browser.js` (semaphore) |
| Browser idle close | 60 s | `browser.js` (`bumpIdleTimer`) |
| `waitFor` / `waitMs` | 15 s | Zod schema + scraper enforcement |
| Output chars | 50,000 | `compress.js` |
| Cache entries | 50 | `cache.js` (LRU eviction) |

## License

MIT. See [LICENSE](LICENSE).
