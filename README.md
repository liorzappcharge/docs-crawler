# broken-links

Headless broken-link checker for [docs.appcharge.com](https://docs.appcharge.com/) using [linkinator](https://github.com/JustinBeckwith/linkinator).

Crawls the docs site recursively and reports 404s. Checks all Appcharge-owned URLs (`*.appcharge.com`, `appcharge.instatus.com`, etc.) and skips unrelated external links.

## Requirements

- Node.js 18+

## Setup

```bash
npm install
```

## Usage

### Check production docs

```bash
npm run check:prod
```

### Check a different environment

Set `DOCS_URL` to any base URL before running:

```bash
DOCS_URL=https://staging.docs.appcharge.com/ npm run check:url
```

### Check a specific sub-path

```bash
DOCS_URL=https://docs.appcharge.com/api-reference/ npm run check:url
```

## Output

Only **404s** are treated as broken links and printed as JSON — each entry has `status`, `url`, and `parent` (the page the link was found on).

Exit codes:
- `0` — no 404s found
- `1` — one or more 404s found (use this to fail CI)

**About 403s:** Cloudflare's bot detection (TLS fingerprinting) blocks Node.js HTTP requests on some pages even with a browser User-Agent. These are false positives — the pages exist and work in a browser. The script reports a warning count for 403s but does not fail. Server errors (5xx) are also surfaced as warnings.

## Configuration

All settings live in [`linkinator.config.json`](./linkinator.config.json).

| Key | Value | Purpose |
|-----|-------|---------|
| `url` | `https://docs.appcharge.com/` | Default crawl entry point (production) |
| `recurse` | `true` | Follow all links from the entry page |
| `concurrency` | `5` | Parallel requests — increase for speed, decrease to be polite |
| `timeout` | `10000` | Per-request timeout in ms |
| `userAgent` | Chrome 124 UA string | Sent on every request to reduce bot-detection false positives |
| `retry` / `retryErrors` | `true` | Retry on transient network failures |
| `retryErrorsCount` | `2` | Max retries per link |
| `skip` | see below | Patterns for URLs to skip entirely |

### Skip patterns

| Pattern | What it skips |
|---------|--------------|
| `^https?://(?!.*appcharge)` | All external URLs that don't contain "appcharge" — only Appcharge-owned links are checked |
| `/mintlify-assets/` | Mintlify CDN assets (JS, CSS, fonts) served from the same domain |
| `mailto:` / `tel:` | Non-HTTP links |
| `https://twitter.com`, `https://x.com`, `https://linkedin.com` | Social links that rate-limit or block crawlers |

#### What `^https?://(?!.*appcharge)` covers

```
┌──────────────────────────────────────┬───────────┐
│               URL                    │  Status   │
├──────────────────────────────────────┼───────────┤
│ https://docs.appcharge.com/...       │ ✓ checked │
│ https://publishers.appcharge.com/... │ ✓ checked │
│ https://appcharge.instatus.com/...   │ ✓ checked │
│ https://dashboard.appcharge.com/...  │ ✓ checked │
│ https://twitter.com/...              │ ✗ skipped │
│ https://mintcdn.com/...              │ ✗ skipped │
└──────────────────────────────────────┴───────────┘
```

To check additional external domains, remove or adjust the `^https?://(?!.*appcharge)` pattern.
