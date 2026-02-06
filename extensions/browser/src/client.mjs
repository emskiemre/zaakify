/**
 * Browser client v2 — manages Playwright browser lifecycle, tabs, and page state.
 *
 * Element refs now use CSS-selector-based resolution for reliability on any page,
 * not just semantically marked-up ones.
 */

import { chromium } from "playwright";
import { STEALTH_SCRIPTS } from "./stealth.mjs";
import { getRandomUserAgent, getChromeVersion, getSecChUa } from "./utils/user-agents.mjs";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// ─── State ───────────────────────────────────────────────────────

let browser = null;
let context = null;
let activePage = null;
const pages = new Map(); // tabId → Page
let tabCounter = 0;

// Storage path for persistent data
const STORAGE_DIR = join(homedir(), ".bitqlon", "extensions", "browser", "storage");
const COOKIES_FILE = join(STORAGE_DIR, "cookies.json");
const STORAGE_FILE = join(STORAGE_DIR, "storage.json");

// Element ref tracking — maps "e1", "e2" to ref info with CSS selectors
let refMap = new Map();
let refCounter = 0;

// ─── Browser Lifecycle ───────────────────────────────────────────

export async function ensureBrowser(config) {
  if (browser && browser.isConnected()) return;

  const headless = config.headless !== false;
  const viewport = config.viewport || { width: 1280, height: 720 };
  const locale = config.locale || "en-US";
  const timezoneId = config.timezoneId || "Europe/Amsterdam";

  // Ensure storage directory exists
  if (!existsSync(STORAGE_DIR)) {
    mkdirSync(STORAGE_DIR, { recursive: true });
  }

  // Load persisted cookies if they exist
  let storageCookies = [];
  if (existsSync(COOKIES_FILE)) {
    try {
      const data = readFileSync(COOKIES_FILE, "utf-8");
      storageCookies = JSON.parse(data);
    } catch (err) {
      // Ignore corrupted cookies file
    }
  }

  // Pick a random user agent for this session
  const userAgent = getRandomUserAgent();
  const chromeVersion = getChromeVersion(userAgent);
  const secChUa = getSecChUa(chromeVersion);

  browser = await chromium.launch({
    headless,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--disable-infobars",
      `--window-size=${viewport.width},${viewport.height}`,
      "--disable-features=IsolateOrigins,site-per-process",
      "--flag-switches-begin",
      "--flag-switches-end",
    ],
  });

  context = await browser.newContext({
    viewport,
    screen: { width: 1920, height: 1080 },
    userAgent,
    locale,
    timezoneId,
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9,nl;q=0.8",
      "sec-ch-ua": secChUa,
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
    },
    javaScriptEnabled: true,
    ignoreHTTPSErrors: true,
    // Restore cookies from previous session
    storageState: storageCookies.length > 0 ? { cookies: storageCookies, origins: [] } : undefined,
  });

  // Inject stealth scripts into every new page/frame
  for (const script of STEALTH_SCRIPTS) {
    await context.addInitScript(script);
  }
}

export function getActivePage() {
  if (!activePage || activePage.isClosed()) {
    for (const [id, page] of pages) {
      if (!page.isClosed()) {
        activePage = page;
        return page;
      }
    }
    return null;
  }
  return activePage;
}

export function setActivePage(page) {
  activePage = page;
}

export function getPages() {
  return pages;
}

export async function openTab(url, config) {
  await ensureBrowser(config);
  const page = await context.newPage();
  tabCounter++;
  const tabId = `tab${tabCounter}`;
  pages.set(tabId, page);
  activePage = page;

  page.on("close", () => {
    pages.delete(tabId);
    if (activePage === page) activePage = null;
  });

  if (url) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    const { smartWait } = await import("./utils/wait.mjs");
    await smartWait(page, config);
  }

  return tabId;
}

export async function closeBrowser() {
  if (browser) {
    // Save cookies and storage state before closing
    try {
      if (context) {
        const cookies = await context.cookies();
        writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2), "utf-8");
      }
    } catch (err) {
      // Ignore save errors
    }
    
    await browser.close().catch(() => {});
    browser = null;
    context = null;
    activePage = null;
    pages.clear();
    refMap.clear();
    refCounter = 0;
    tabCounter = 0;
  }
}

// ─── Element Refs ────────────────────────────────────────────────

export function getRefMap() {
  return refMap;
}

export function getRefCounter() {
  return refCounter;
}

export function setRefCounter(val) {
  refCounter = val;
}

export function resetRefs() {
  refMap = new Map();
  refCounter = 0;
}

/**
 * Resolve an element ref (e.g. "e3") to a Playwright locator.
 *
 * Resolution order (most reliable first):
 *   1. data-bq-ref attribute (injected by DOM extraction)
 *   2. CSS selector (built during extraction)
 *   3. Role + name (a11y fallback)
 */
export function resolveRef(page, ref) {
  const info = refMap.get(ref);
  if (!info) return null;

  // Strategy 1: DOM ref attribute (most reliable — we injected it)
  if (info.isDomRef) {
    return page.locator(`[data-bq-ref="${ref}"]`);
  }

  // Strategy 2: CSS selector (built during extraction)
  if (info.selector) {
    return page.locator(info.selector);
  }

  // Strategy 3: a11y role + name (fallback)
  if (info.role && info.name) {
    return page.getByRole(info.role, { name: info.name, exact: false });
  }

  return null;
}
