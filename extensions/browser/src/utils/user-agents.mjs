/**
 * Realistic user agent pool for rotation.
 * All are recent Windows Chrome versions to match our fingerprint.
 */

export const USER_AGENTS = [
  // Chrome 131 (current)
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  
  // Chrome 130
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  
  // Chrome 129
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  
  // Chrome 128
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  
  // Windows 11 variants
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
];

/**
 * Get a random user agent from the pool
 */
export function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Extract Chrome version from user agent for sec-ch-ua header
 */
export function getChromeVersion(userAgent) {
  const match = userAgent.match(/Chrome\/(\d+)/);
  return match ? match[1] : "131";
}

/**
 * Generate sec-ch-ua header that matches the user agent
 */
export function getSecChUa(chromeVersion) {
  return `"Google Chrome";v="${chromeVersion}", "Chromium";v="${chromeVersion}", "Not_A Brand";v="24"`;
}
