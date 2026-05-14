#!/usr/bin/env node
/**
 * screenshot.mjs
 *
 * For each source page that contains broken links, opens a headless Chromium
 * browser, highlights every broken anchor in red, scrolls the first one into
 * view, and saves a viewport screenshot to reports/screenshots/.
 *
 * Reads:  reports/crawl-report.json  (written by check.mjs)
 * Writes: reports/screenshots/<slug>.png   (one per source page)
 *         reports/screenshots/index.json   (machine-readable index)
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const MAX_PAGES = 15; // cap to keep CI fast; sorted by most broken links first

// ── Load report ──────────────────────────────────────────────────────────────
let report;
try {
  report = JSON.parse(await readFile('reports/crawl-report.json', 'utf8'));
} catch {
  console.error('reports/crawl-report.json not found — run "npm run check" first.');
  process.exit(0);
}

const failures = [...report.broken404, ...report.brokenAnchors, ...report.networkErrors];

if (failures.length === 0) {
  console.log('No failures — skipping screenshots.');
  process.exit(0);
}

// ── Group broken URLs by their source page ───────────────────────────────────
const pageMap = new Map();
for (const { url, parent } of failures) {
  if (!parent) continue;
  if (!pageMap.has(parent)) pageMap.set(parent, new Set());
  pageMap.get(parent).add(url);
}

// Prioritise pages that have the most broken links
const pages = [...pageMap.entries()]
  .sort((a, b) => b[1].size - a[1].size)
  .slice(0, MAX_PAGES);

await mkdir('reports/screenshots', { recursive: true });

// ── Launch browser ───────────────────────────────────────────────────────────
const browser = await chromium.launch();
const screenshotIndex = [];

for (const [pageUrl, brokenUrls] of pages) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    // Match the same UA used by the crawler so we get the same rendered page.
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  const page = await ctx.newPage();

  try {
    await page.goto(pageUrl, { timeout: 20_000, waitUntil: 'load' });
    // Give JS frameworks (Next.js / Mintlify) time to finish hydration.
    await page.waitForTimeout(1500);

    // In-page: outline every broken <a> in red and scroll the first into view.
    // We compare el.href (the resolved absolute URL) rather than the raw href
    // attribute, because linkinator reports absolute URLs while the DOM often
    // stores relative paths like "/some/page".
    const highlightCount = await page.evaluate((urls) => {
      const normalize = u => u.replace(/\/$/, '').toLowerCase();
      const targets = new Set(urls.map(normalize));
      let firstEl = null;
      let count = 0;

      document.querySelectorAll('a[href]').forEach(el => {
        if (targets.has(normalize(el.href))) {
          el.style.outline = '3px solid #e53e3e';
          el.style.outlineOffset = '2px';
          el.style.backgroundColor = 'rgba(229,62,62,0.15)';
          if (!firstEl) firstEl = el;
          count++;
        }
      });

      if (firstEl) firstEl.scrollIntoView({ behavior: 'instant', block: 'center' });
      return count;
    }, [...brokenUrls]);

    // Build a safe filename from the URL.
    const slug = pageUrl
      .replace(/^https?:\/\//, '')
      .replace(/[^a-z0-9]/gi, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 80);
    const filename = `${slug}.png`;

    await page.screenshot({ path: `reports/screenshots/${filename}` });

    screenshotIndex.push({
      page: pageUrl,
      brokenLinks: [...brokenUrls],
      highlightedElements: highlightCount,
      screenshot: filename,
    });

    console.log(`📸  ${filename}  (${highlightCount} element(s) highlighted, ${brokenUrls.size} broken link(s))`);
  } catch (err) {
    console.error(`⚠️  Could not screenshot ${pageUrl}: ${err.message}`);
    screenshotIndex.push({
      page: pageUrl,
      brokenLinks: [...brokenUrls],
      highlightedElements: 0,
      screenshot: null,
      error: err.message,
    });
  }

  await ctx.close();
}

await browser.close();

await writeFile('reports/screenshots/index.json', JSON.stringify(screenshotIndex, null, 2));

const saved = screenshotIndex.filter(e => e.screenshot).length;
console.log(`\n✅ ${saved}/${pages.length} screenshots saved → reports/screenshots/`);
