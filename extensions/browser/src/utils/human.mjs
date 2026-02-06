/**
 * Human-like behavior utilities to avoid bot detection.
 * Adds realistic delays, mouse movements, and interaction patterns.
 */

/**
 * Random delay with realistic human variance
 * @param {number} minMs - Minimum delay in milliseconds
 * @param {number} maxMs - Maximum delay in milliseconds
 */
export async function humanDelay(minMs = 100, maxMs = 300) {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  await new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Simulate human-like mouse movement to an element before clicking
 * @param {import('playwright').Page} page
 * @param {import('playwright').Locator} element
 */
export async function humanMouseMove(page, element) {
  try {
    const box = await element.boundingBox();
    if (!box) return;

    // Get current mouse position (assume center of viewport as start)
    const viewport = page.viewportSize() || { width: 1280, height: 720 };
    const startX = viewport.width / 2;
    const startY = viewport.height / 2;

    // Target position with small random offset (humans don't click exact center)
    const targetX = box.x + box.width / 2 + (Math.random() - 0.5) * 10;
    const targetY = box.y + box.height / 2 + (Math.random() - 0.5) * 10;

    // Move in steps with easing
    const steps = Math.floor(Math.random() * 5) + 3; // 3-7 steps
    for (let i = 1; i <= steps; i++) {
      const progress = i / steps;
      // Ease-out curve for more human-like movement
      const eased = 1 - Math.pow(1 - progress, 3);
      
      const currentX = startX + (targetX - startX) * eased;
      const currentY = startY + (targetY - startY) * eased;
      
      await page.mouse.move(currentX, currentY);
      await humanDelay(10, 30);
    }

    // Small pause before clicking (humans don't click instantly)
    await humanDelay(50, 150);
  } catch (err) {
    // If mouse movement fails, just continue - clicking will still work
  }
}

/**
 * Human-like click with movement and realistic timing
 * @param {import('playwright').Page} page
 * @param {string} selector
 */
export async function humanClick(page, selector) {
  const element = page.locator(selector).first();
  await humanMouseMove(page, element);
  await element.click();
  await humanDelay(100, 300); // Post-click delay
}

/**
 * Human-like typing with realistic pauses between keystrokes
 * @param {import('playwright').Page} page
 * @param {string} selector
 * @param {string} text
 */
export async function humanType(page, selector, text) {
  const element = page.locator(selector).first();
  await humanMouseMove(page, element);
  await element.click(); // Focus the input
  await humanDelay(100, 200);
  
  // Type character by character with realistic delays
  for (const char of text) {
    await page.keyboard.type(char);
    // Faster typists have 100-300ms between keys, slower 200-500ms
    const isSpace = char === ' ';
    const isPunctuation = ['.', ',', '!', '?', ';', ':'].includes(char);
    
    if (isSpace) {
      await humanDelay(150, 250); // Slightly longer pause after space
    } else if (isPunctuation) {
      await humanDelay(200, 400); // Longer pause for punctuation
    } else {
      await humanDelay(80, 200); // Normal typing speed
    }
  }
  
  await humanDelay(100, 300); // Pause after finishing typing
}

/**
 * Random scroll movements like a human reading/browsing
 * @param {import('playwright').Page} page
 */
export async function humanScroll(page) {
  const scrollCount = Math.floor(Math.random() * 3) + 2; // 2-4 scrolls
  
  for (let i = 0; i < scrollCount; i++) {
    // Random scroll distance (200-600px)
    const distance = Math.floor(Math.random() * 400) + 200;
    const direction = Math.random() > 0.2 ? distance : -distance; // 80% down, 20% up
    
    await page.mouse.wheel(0, direction);
    await humanDelay(500, 1500); // Pause to "read" content
  }
}

/**
 * Simulate random mouse movements (shows activity)
 * @param {import('playwright').Page} page
 */
export async function humanIdleMovement(page) {
  const viewport = page.viewportSize() || { width: 1280, height: 720 };
  const movements = Math.floor(Math.random() * 2) + 1; // 1-2 movements
  
  for (let i = 0; i < movements; i++) {
    const x = Math.random() * viewport.width;
    const y = Math.random() * viewport.height;
    await page.mouse.move(x, y);
    await humanDelay(1000, 2000);
  }
}
