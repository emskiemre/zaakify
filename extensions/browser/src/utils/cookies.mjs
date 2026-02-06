/**
 * Cookie consent banner auto-dismissal.
 * Targets common consent management platforms used in the Netherlands/EU.
 */

const COOKIE_SELECTORS = [
  // Generic patterns
  'button[id*="accept"]',
  'button[class*="accept"]',
  'button[data-testid*="accept"]',
  '[class*="cookie"] button:first-of-type',
  '[id*="cookie"] button:first-of-type',
  // Dutch sites
  'button:has-text("Alles accepteren")',
  'button:has-text("Accepteren")',
  'button:has-text("Alle cookies accepteren")',
  'button:has-text("Akkoord")',
  // English
  'button:has-text("Accept all")',
  'button:has-text("Accept All")',
  'button:has-text("Accept cookies")',
  'button:has-text("Allow all")',
  'button:has-text("I agree")',
  'button:has-text("Got it")',
  // CMP platforms
  "#onetrust-accept-btn-handler",
  ".cmp-accept-all",
  '[data-cookiefirst-action="accept"]',
  "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
  ".cc-accept-all",
  ".js-cookie-accept",
];

export async function dismissCookieBanners(page) {
  for (const sel of COOKIE_SELECTORS) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 500 })) {
        await btn.click({ timeout: 2000 });
        await page.waitForTimeout(300);
        return; // One click is enough
      }
    } catch {
      // Not found, try next
    }
  }
}
