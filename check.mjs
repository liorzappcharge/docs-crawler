#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { instance as gaxios } from 'gaxios';
import { LinkChecker, LinkState } from 'linkinator';

const config = JSON.parse(await readFile(new URL('./linkinator.config.json', import.meta.url)));
const url = process.env.DOCS_URL || config.url;

if (!url) {
  console.error('No URL specified. Set DOCS_URL or add "url" to linkinator.config.json.');
  process.exit(1);
}

// Inject browser-like headers so Cloudflare/Mintlify doesn't 403 on the entry page.
// Note: Node.js has a different TLS fingerprint than a real browser, so some internal
// pages may still return 403. These are bot-detection false positives, not broken links.
gaxios.interceptors.request.add({
  resolved: (reqConfig) => {
    reqConfig.headers = {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      ...reqConfig.headers,
    };
    return reqConfig;
  },
});

console.error(`🏊 crawling ${url}`);

const checker = new LinkChecker();
const result = await checker.check({
  path: [url],
  recurse: config.recurse,
  timeout: config.timeout,
  concurrency: config.concurrency,
  retry: config.retry,
  retryErrors: config.retryErrors,
  retryErrorsCount: config.retryErrorsCount,
  linksToSkip: config.skip,
  userAgent: config.userAgent,
});

const allLinks = result.links;
const brokenLinks = allLinks.filter(l => l.state === LinkState.BROKEN);
const okLinks    = allLinks.filter(l => l.state === LinkState.OK);
const skipped    = allLinks.filter(l => l.state === LinkState.SKIPPED);

// Categorize broken links.
// "Anchor fragments" = URLs containing # that return 404 (URL itself not found).
// True fragment validation (anchor id missing in DOM) requires a browser-level check.
const broken404      = brokenLinks.filter(l => l.status === 404 && !l.url.includes('#'));
const brokenAnchors  = brokenLinks.filter(l => l.status === 404 &&  l.url.includes('#'));
const serverErrors   = brokenLinks.filter(l => l.status >= 500);
const botBlocked     = brokenLinks.filter(l => l.status === 403);
const redirectErrors = brokenLinks.filter(l => l.status >= 300 && l.status < 400);
// Network failures: no HTTP status — connection refused, timeout, DNS error, etc.
const networkErrors  = brokenLinks.filter(l => !l.status || l.status === 0);

// Unique pages visited = distinct parent URLs across all links + the root URL itself.
const crawledPages = new Set([url, ...allLinks.map(l => l.parent).filter(Boolean)]);

const toEntry = l => ({ url: l.url, parent: l.parent ?? null, status: l.status ?? null });

const report = {
  timestamp: new Date().toISOString(),
  url,
  passed: broken404.length === 0 && brokenAnchors.length === 0 && networkErrors.length === 0,
  stats: {
    totalPagesCrawled:  crawledPages.size,
    totalLinksChecked:  allLinks.length,
    totalOk:            okLinks.length,
    totalSkipped:       skipped.length,
    broken404:          broken404.length,
    brokenAnchors:      brokenAnchors.length,
    serverErrors:       serverErrors.length,
    botBlocked:         botBlocked.length,
    redirectErrors:     redirectErrors.length,
    networkErrors:      networkErrors.length,
  },
  broken404:      broken404.map(toEntry),
  brokenAnchors:  brokenAnchors.map(toEntry),
  serverErrors:   serverErrors.map(toEntry),
  botBlocked:     botBlocked.map(toEntry),
  redirectErrors: redirectErrors.map(toEntry),
  networkErrors:  networkErrors.map(toEntry),
};

await mkdir('reports', { recursive: true });
await writeFile('reports/crawl-report.json', JSON.stringify(report, null, 2));
console.error(`📊 report written to reports/crawl-report.json`);

if (botBlocked.length > 0) {
  console.error(`⚠️  ${botBlocked.length} page(s) returned 403 (Cloudflare bot-detection, not broken links)`);
}

if (serverErrors.length > 0) {
  console.error(`⚠️  ${serverErrors.length} page(s) returned 5xx:`);
  console.error(JSON.stringify(serverErrors.map(toEntry), null, 2));
}

const criticalBroken = [...broken404, ...brokenAnchors, ...networkErrors];

if (criticalBroken.length === 0) {
  console.log('✅ All links OK');
  process.exit(0);
}

console.log(JSON.stringify(criticalBroken.map(toEntry), null, 2));
process.exit(1);
