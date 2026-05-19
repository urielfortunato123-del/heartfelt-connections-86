#!/usr/bin/env node
// Verifies MapPlaceholder is present in SSR HTML and is removed after Leaflet mounts.
// Usage: node scripts/test-map-placeholder.mjs [baseUrl]
// Default baseUrl: http://localhost:8080

const baseUrl = process.argv[2] || process.env.SSR_TEST_URL || "http://localhost:8080";
const url = `${baseUrl}/projeto`;

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";

let failed = 0;
const fail = (m) => { console.error(`${RED}✗ ${m}${RESET}`); failed++; };
const pass = (m) => console.log(`${GREEN}✓ ${m}${RESET}`);

// 1) SSR check: placeholder must appear in the server-rendered HTML
const res = await fetch(url, { headers: { accept: "text/html" } });
if (res.status !== 200) {
  fail(`SSR status ${res.status} for ${url}`);
  process.exit(1);
}
const html = await res.text();
if (html.includes('data-testid="map-placeholder"')) {
  pass("SSR HTML contains MapPlaceholder");
} else {
  fail("SSR HTML missing MapPlaceholder before hydration");
}

// 2) Browser check: after mount, placeholder must be removed and Leaflet map present
const { chromium } = await import("playwright");
let browser;
try {
  browser = await chromium.launch();
} catch (e) {
  console.warn(`\n⚠ Skipping browser hydration check: ${e.message.split("\n")[0]}`);
  console.warn("  (Install chromium system libs to run the full test.)");
  process.exit(failed > 0 ? 1 : 0);
}
const ctx = await browser.newContext();
const page = await ctx.newPage();

try {
  await page.goto(url, { waitUntil: "domcontentloaded" });

  // Placeholder should be visible immediately after load (pre-Leaflet)
  const earlyCount = await page.locator('[data-testid="map-placeholder"]').count();
  if (earlyCount >= 1) pass(`Placeholder visible on initial load (count=${earlyCount})`);
  else fail("Placeholder not visible on initial load");

  // Wait for Leaflet container to render
  await page.waitForSelector(".leaflet-container", { timeout: 15000 });
  pass("Leaflet container mounted");

  // Placeholder must be gone after mount
  await page.waitForSelector('[data-testid="map-placeholder"]', { state: "detached", timeout: 5000 })
    .then(() => pass("MapPlaceholder removed after Leaflet mount"))
    .catch(() => fail("MapPlaceholder still present after Leaflet mount"));
} catch (e) {
  fail(`Browser check error: ${e.message}`);
} finally {
  await browser.close();
}

if (failed > 0) {
  console.error(`\n${RED}${failed} check(s) failed${RESET}`);
  process.exit(1);
}
console.log(`\n${GREEN}All MapPlaceholder checks passed${RESET}`);
