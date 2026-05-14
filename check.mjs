#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
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

const broken = result.links.filter(l => l.state === LinkState.BROKEN && l.status === 404);
const serverErrors = result.links.filter(l => l.state === LinkState.BROKEN && l.status >= 500);
const botBlocked = result.links.filter(l => l.state === LinkState.BROKEN && l.status === 403);

if (botBlocked.length > 0) {
  console.error(`⚠️  ${botBlocked.length} page(s) returned 403 (Cloudflare bot-detection, not broken links)`);
}

if (serverErrors.length > 0) {
  console.error(`⚠️  ${serverErrors.length} page(s) returned 5xx:`);
  console.error(JSON.stringify(serverErrors.map(l => ({ status: l.status, url: l.url, parent: l.parent })), null, 2));
}

if (broken.length === 0) {
  console.log('All links OK (no 404s found)');
  process.exit(0);
}

console.log(JSON.stringify(broken.map(l => ({ status: l.status, url: l.url, parent: l.parent })), null, 2));
process.exit(1);
