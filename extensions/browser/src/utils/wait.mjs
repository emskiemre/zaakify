/**
 * Smart page wait v2 — handles SPAs, lazy-loading, and JS-heavy sites.
 *
 * Strategy:
 *   1. Wait for domcontentloaded (page skeleton)
 *   2. Start a MutationObserver on document.body
 *   3. Wait until BOTH conditions are met:
 *      a. No DOM mutations for 500ms (content stopped changing)
 *      b. No pending fetch/XHR for 500ms (network is idle)
 *   4. Hard timeout at configurable limit (don't wait forever)
 *   5. Dismiss cookie banners
 */

import { dismissCookieBanners } from "./cookies.mjs";

export async function smartWait(page, config) {
  const timeoutMs = config?.smartWaitTimeout || 8000;

  try {
    // Wait for DOM mutations and network to settle
    await page.evaluate((timeout) => {
      return new Promise((resolve) => {
        let mutationTimer = null;
        let settled = false;
        const hardTimeout = setTimeout(() => {
          settled = true;
          if (observer) observer.disconnect();
          resolve();
        }, timeout);

        // Watch for DOM changes
        const observer = new MutationObserver(() => {
          if (settled) return;
          // Reset the "quiet" timer on every mutation
          if (mutationTimer) clearTimeout(mutationTimer);
          mutationTimer = setTimeout(() => {
            // No mutations for 500ms — page is stable
            settled = true;
            observer.disconnect();
            clearTimeout(hardTimeout);
            resolve();
          }, 500);
        });

        observer.observe(document.body || document.documentElement, {
          childList: true,
          subtree: true,
          attributes: false,
          characterData: false,
        });

        // Start the quiet timer immediately (if page is already stable)
        mutationTimer = setTimeout(() => {
          if (!settled) {
            settled = true;
            observer.disconnect();
            clearTimeout(hardTimeout);
            resolve();
          }
        }, 500);
      });
    }, timeoutMs);
  } catch {
    // Page navigated or context destroyed — that's fine
  }

  // Also try networkidle briefly — catches late XHR responses
  try {
    await page.waitForLoadState("networkidle", { timeout: 2000 });
  } catch {
    // Timeout is fine
  }

  // Dismiss cookie consent banners
  if (config?.dismissCookies !== false) {
    await dismissCookieBanners(page);
  }
}
