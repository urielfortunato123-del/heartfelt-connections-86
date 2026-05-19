#!/usr/bin/env node
// SSR smoke test: ensures /projeto returns 200 and renders non-blank HTML.
// Usage: node scripts/test-ssr.mjs [baseUrl]
// Default baseUrl: http://localhost:8080

const baseUrl = process.argv[2] || process.env.SSR_TEST_URL || "http://localhost:8080";
const routes = ["/", "/projeto"];

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";

let failed = 0;

function fail(msg) {
  console.error(`${RED}✗ ${msg}${RESET}`);
  failed++;
}
function pass(msg) {
  console.log(`${GREEN}✓ ${msg}${RESET}`);
}

async function checkRoute(path) {
  const url = `${baseUrl}${path}`;
  let res;
  try {
    res = await fetch(url, { headers: { accept: "text/html" } });
  } catch (e) {
    fail(`${path} — fetch failed: ${e.message}`);
    return;
  }

  if (res.status !== 200) {
    fail(`${path} — expected status 200, got ${res.status}`);
    return;
  }

  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("text/html")) {
    fail(`${path} — expected text/html, got ${ct}`);
    return;
  }

  const html = await res.text();

  // Blank-screen signals
  if (html.length < 500) {
    fail(`${path} — HTML too short (${html.length} bytes), likely blank`);
    return;
  }
  if (!/<body[\s\S]*>[\s\S]*<\/body>/i.test(html)) {
    fail(`${path} — missing <body>...</body>`);
    return;
  }

  // Catastrophic SSR error sentinel (h3 swallow)
  if (html.includes('"unhandled":true') && html.includes('"message":"HTTPError"')) {
    fail(`${path} — catastrophic SSR error body`);
    return;
  }

  // Branded error fallback page sentinel
  if (/Esta página não carregou|This page didn't load/i.test(html) && !/Modo:|KM Converter/i.test(html)) {
    fail(`${path} — rendered the error fallback page`);
    return;
  }

  // Extract body innerHTML and check it has meaningful content
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyInner = bodyMatch ? bodyMatch[1] : "";
  const textOnly = bodyInner.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, "").trim();
  if (textOnly.length < 20) {
    fail(`${path} — body has no rendered text (${textOnly.length} chars)`);
    return;
  }

  pass(`${path} — 200, ${html.length} bytes, ${textOnly.length} chars of text`);
}

console.log(`SSR smoke test against ${baseUrl}\n`);
for (const r of routes) {
  await checkRoute(r);
}

if (failed > 0) {
  console.error(`\n${RED}${failed} check(s) failed${RESET}`);
  process.exit(1);
}
console.log(`\n${GREEN}All SSR checks passed${RESET}`);
