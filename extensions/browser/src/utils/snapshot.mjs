/**
 * Page snapshot v2 — general-purpose content extraction.
 *
 * Works on any website: e-commerce, search engines, maps, news,
 * government sites, SPAs, dashboards, social media.
 *
 * Layered approach:
 *   1. Structured text — headings, paragraphs, lists, tables, links, images
 *   2. Interactive elements — buttons, inputs, selects, clickable divs with refs
 *   3. Semantic sections — nav, main, article, aside, footer grouping
 *   4. Canvas/empty fallback — detect canvas-heavy pages, report what's available
 *
 * Element refs (e1, e2, ...) use CSS-selector-based resolution for reliability
 * on any page, not just semantically marked-up ones.
 */

import {
  getRefMap,
  getRefCounter,
  setRefCounter,
  resetRefs,
} from "../client.mjs";

// Max chars for the snapshot output (prevent massive pages from blowing context)
const MAX_SNAPSHOT_CHARS = 30_000;

/**
 * Take a full page snapshot. Optionally scroll first to trigger lazy content.
 *
 * @param {import('playwright').Page} page
 * @param {{ scroll?: boolean }} options
 */
export async function getSnapshot(page, options = {}) {
  resetRefs();

  try {
    // Wait for page to be reasonably loaded (SPAs need this)
    await waitForPageReady(page);

    // Optionally scroll to load lazy content
    if (options.scroll) {
      await autoScroll(page);
    }

    // Run DOM extraction — this is the primary strategy now
    const domResult = await extractPage(page);

    // If DOM extraction got very little, try accessibility tree as supplement
    if (domResult.textLength < 100) {
      const a11y = await getA11ySnapshot(page);
      if (a11y && a11y.length > domResult.output.length) {
        return truncate(a11y);
      }
    }

    if (domResult.output.length === 0) {
      return "(empty page — no visible content detected)";
    }

    return truncate(domResult.output);
  } catch (err) {
    try {
      // Last resort: accessibility tree only
      const a11y = await getA11ySnapshot(page);
      return truncate(a11y || `(snapshot failed: ${err.message})`);
    } catch {
      return `(snapshot failed: ${err.message})`;
    }
  }
}

/**
 * Wait for page to be reasonably ready — handles SPAs and heavy JS sites.
 * Uses multiple strategies to detect when content is loaded.
 */
async function waitForPageReady(page) {
  try {
    // Strategy 1: Wait for network to be mostly idle
    await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
    
    // Strategy 2: Wait a bit for JS to execute (SPAs need this)
    await page.waitForTimeout(1500);
    
    // Strategy 3: Wait for common dynamic content indicators
    const url = page.url();
    
    // Google Maps specific
    if (url.includes('google.com/maps')) {
      await page.waitForSelector('[role="main"], .section-result, [aria-label*="Results"]', 
        { timeout: 3000, state: 'visible' }).catch(() => {});
    }
    
    // Search engines (Google, Bing, DuckDuckGo)
    else if (url.includes('/search') || url.includes('duckduckgo.com')) {
      await page.waitForSelector('[class*="result"], .g, [data-testid*="result"]', 
        { timeout: 3000, state: 'visible' }).catch(() => {});
    }
    
    // E-commerce sites
    else if (url.includes('amazon.') || url.includes('bol.com') || url.includes('coolblue')) {
      await page.waitForSelector('[class*="product"], [class*="item"]', 
        { timeout: 3000, state: 'visible' }).catch(() => {});
    }
    
    // Generic: wait for any meaningful content
    else {
      await page.waitForSelector('h1, h2, p, article, main', 
        { timeout: 3000, state: 'visible' }).catch(() => {});
    }
    
    // Final small delay for animations to settle
    await page.waitForTimeout(500);
  } catch (err) {
    // If any wait fails, just continue — better to try than fail completely
  }
}

/**
 * Auto-scroll down the page to trigger lazy-loaded content.
 * Scrolls in 3 viewport steps, waits for new content, scrolls back to top.
 */
async function autoScroll(page) {
  const viewportHeight = (await page.viewportSize())?.height || 720;
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, viewportHeight);
    await page.waitForTimeout(600);
  }
  // Scroll back to top
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
}

/**
 * General-purpose DOM extraction. Reads the page like a human would:
 * headings, text, links, images, forms, tables, lists — everything visible.
 */
async function extractPage(page) {
  const refMap = getRefMap();
  let refCounter = getRefCounter();

  const result = await page.evaluate((startRef) => {
    let ref = startRef;
    const seen = new Set();
    const sections = [];
    let totalText = 0;

    // ── Helpers ────────────────────────────────────────────────

    function isVisible(el) {
      if (!el.offsetParent && el.tagName !== "BODY" && el.tagName !== "HTML") {
        // Check for position:fixed/sticky which don't have offsetParent
        const style = window.getComputedStyle(el);
        if (style.position !== "fixed" && style.position !== "sticky") return false;
      }
      const style = window.getComputedStyle(el);
      return style.display !== "none" && style.visibility !== "hidden" && parseFloat(style.opacity) > 0;
    }

    function cleanText(text) {
      return (text || "").replace(/\s+/g, " ").trim();
    }

    function addRef(el) {
      ref++;
      const id = `e${ref}`;
      el.setAttribute("data-bq-ref", id);
      return { id, ref };
    }

    function buildSelector(el) {
      // Build a reliable CSS selector for this element
      if (el.id) return `#${CSS.escape(el.id)}`;
      // data-bq-ref is the most reliable
      const bqRef = el.getAttribute("data-bq-ref");
      if (bqRef) return `[data-bq-ref="${bqRef}"]`;
      // Fallback: tag + classes
      const tag = el.tagName.toLowerCase();
      const classes = Array.from(el.classList).slice(0, 2).map(c => CSS.escape(c)).join(".");
      return classes ? `${tag}.${classes}` : tag;
    }

    // ── Main content extraction ───────────────────────────────

    const mainEl = document.querySelector("main, [role='main'], #main, #content, .content, article")
      || document.body;

    // Detect canvas-heavy pages (Google Maps, games, etc.)
    const canvasElements = document.querySelectorAll("canvas");
    let hasLargeCanvas = false;
    for (const c of canvasElements) {
      if (c.width > 400 && c.height > 300) hasLargeCanvas = true;
    }

    // ── Headings ──────────────────────────────────────────────
    mainEl.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((el) => {
      if (!isVisible(el)) return;
      const text = cleanText(el.textContent);
      if (!text || text.length < 2 || seen.has("h:" + text)) return;
      seen.add("h:" + text);
      const level = el.tagName.toLowerCase();
      const prefix = "#".repeat(parseInt(level.charAt(1)));
      sections.push({ type: "heading", line: `${prefix} ${text}`, order: getOrder(el) });
      totalText += text.length;
    });

    // ── Paragraphs and text blocks ────────────────────────────
    mainEl.querySelectorAll("p, [class*='description'], [class*='text'], blockquote, figcaption, dt, dd, summary").forEach((el) => {
      if (!isVisible(el)) return;
      // Skip if inside an already-processed parent
      if (el.closest("a, button, [role='button'], label")) return;
      const text = cleanText(el.textContent);
      if (!text || text.length < 10 || seen.has("p:" + text.slice(0, 80))) return;
      seen.add("p:" + text.slice(0, 80));
      sections.push({ type: "text", line: text.slice(0, 500), order: getOrder(el) });
      totalText += Math.min(text.length, 500);
    });

    // ── Lists ─────────────────────────────────────────────────
    mainEl.querySelectorAll("ul, ol").forEach((list) => {
      if (!isVisible(list)) return;
      // Skip nav/menu lists — too noisy
      if (list.closest("nav, [role='navigation'], header, footer")) return;
      const items = [];
      list.querySelectorAll(":scope > li").forEach((li) => {
        const text = cleanText(li.textContent);
        if (text && text.length > 2 && text.length < 300) {
          items.push(`  - ${text.slice(0, 200)}`);
        }
      });
      if (items.length > 0 && items.length < 50) {
        const key = items.slice(0, 3).join("|");
        if (!seen.has("list:" + key)) {
          seen.add("list:" + key);
          sections.push({ type: "list", line: items.join("\n"), order: getOrder(list) });
          totalText += items.join("").length;
        }
      }
    });

    // ── Tables ─────────────────────────────────────────────────
    mainEl.querySelectorAll("table").forEach((table) => {
      if (!isVisible(table)) return;
      const rows = [];
      table.querySelectorAll("tr").forEach((tr, i) => {
        if (i > 20) return; // Cap at 20 rows
        const cells = [];
        tr.querySelectorAll("th, td").forEach((cell) => {
          cells.push(cleanText(cell.textContent).slice(0, 100));
        });
        if (cells.some(c => c.length > 0)) {
          rows.push(`| ${cells.join(" | ")} |`);
          if (i === 0) rows.push(`| ${cells.map(() => "---").join(" | ")} |`);
        }
      });
      if (rows.length > 1) {
        const key = rows[0];
        if (!seen.has("table:" + key)) {
          seen.add("table:" + key);
          sections.push({ type: "table", line: rows.join("\n"), order: getOrder(table) });
          totalText += rows.join("").length;
        }
      }
    });

    // ── Images with meaningful alt text ────────────────────────
    mainEl.querySelectorAll("img[alt]").forEach((el) => {
      if (!isVisible(el)) return;
      const alt = cleanText(el.alt);
      if (!alt || alt.length < 5 || seen.has("img:" + alt)) return;
      seen.add("img:" + alt);
      sections.push({ type: "image", line: `[image: ${alt.slice(0, 150)}]`, order: getOrder(el) });
    });

    // ── Search inputs ─────────────────────────────────────────
    document.querySelectorAll(
      'input[type="text"], input[type="search"], input:not([type]), textarea, [role="searchbox"], [role="combobox"]'
    ).forEach((el) => {
      if (!isVisible(el)) return;
      const label = el.getAttribute("placeholder")
        || el.getAttribute("aria-label")
        || el.labels?.[0]?.textContent?.trim()
        || el.getAttribute("name")
        || "input";
      const { id } = addRef(el);
      const val = el.value ? ` value="${el.value}"` : "";
      const inputType = el.type === "search" || el.getAttribute("role") === "searchbox" ? "searchbox" : "textbox";
      sections.push({
        type: "interactive",
        line: `${inputType} "${cleanText(label).slice(0, 80)}"${val} [${id}]`,
        order: getOrder(el),
        refInfo: { ref, role: inputType, name: cleanText(label), selector: buildSelector(el), isDomRef: true },
      });
    });

    // ── Select / dropdown ──────────────────────────────────────
    document.querySelectorAll("select").forEach((el) => {
      if (!isVisible(el)) return;
      const label = el.getAttribute("aria-label")
        || el.labels?.[0]?.textContent?.trim()
        || el.getAttribute("name")
        || "select";
      const { id } = addRef(el);
      const selected = el.options[el.selectedIndex]?.text || "";
      sections.push({
        type: "interactive",
        line: `select "${cleanText(label)}" value="${selected}" [${id}]`,
        order: getOrder(el),
        refInfo: { ref, role: "combobox", name: cleanText(label), selector: buildSelector(el), isDomRef: true },
      });
    });

    // ── Buttons ────────────────────────────────────────────────
    document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]').forEach((el) => {
      if (!isVisible(el)) return;
      const text = cleanText(
        el.textContent || el.getAttribute("value") || el.getAttribute("aria-label") || ""
      ).slice(0, 80);
      if (!text || text.length < 1 || seen.has("btn:" + text)) return;
      seen.add("btn:" + text);
      const { id } = addRef(el);
      sections.push({
        type: "interactive",
        line: `button "${text}" [${id}]`,
        order: getOrder(el),
        refInfo: { ref, role: "button", name: text, selector: buildSelector(el), isDomRef: true },
      });
    });

    // ── Links ──────────────────────────────────────────────────
    document.querySelectorAll("a[href]").forEach((el) => {
      if (!isVisible(el)) return;
      const text = cleanText(el.textContent).slice(0, 120);
      if (!text || text.length < 2 || seen.has("link:" + text)) return;
      seen.add("link:" + text);
      const href = el.getAttribute("href") || "";
      const { id } = addRef(el);
      // Show href for external/useful links, skip for anchors and javascript:
      const hrefDisplay = href.startsWith("http") ? ` -> ${href.slice(0, 100)}` : "";
      sections.push({
        type: "interactive",
        line: `link "${text}"${hrefDisplay} [${id}]`,
        order: getOrder(el),
        refInfo: { ref, role: "link", name: text, selector: buildSelector(el), isDomRef: true },
      });
    });

    // ── Clickable divs (SPA buttons without semantic markup) ──
    document.querySelectorAll("[onclick], [data-click], [tabindex='0']").forEach((el) => {
      if (!isVisible(el)) return;
      if (el.tagName === "A" || el.tagName === "BUTTON" || el.getAttribute("role") === "button") return;
      const text = cleanText(el.textContent).slice(0, 80);
      if (!text || text.length < 2 || seen.has("clickable:" + text)) return;
      seen.add("clickable:" + text);
      const style = window.getComputedStyle(el);
      if (style.cursor === "pointer" || el.hasAttribute("onclick") || el.hasAttribute("tabindex")) {
        const { id } = addRef(el);
        sections.push({
          type: "interactive",
          line: `clickable "${text}" [${id}]`,
          order: getOrder(el),
          refInfo: { ref, role: "button", name: text, selector: buildSelector(el), isDomRef: true },
        });
      }
    });

    // ── Product cards (keep for e-commerce compatibility) ─────
    document.querySelectorAll(
      '[class*="product"], [class*="card"], [data-testid*="product"], [data-testid*="item"], article'
    ).forEach((el) => {
      if (!isVisible(el)) return;
      const titleEl = el.querySelector(
        'h2, h3, h4, [class*="title"], [class*="name"], [data-testid*="title"]'
      );
      const title = cleanText(titleEl?.textContent)?.slice(0, 120);
      if (!title || title.length < 3 || seen.has("prod:" + title)) return;
      seen.add("prod:" + title);

      const priceEl = el.querySelector('[class*="price"], [data-testid*="price"], [itemprop="price"]');
      const price = cleanText(priceEl?.textContent)?.slice(0, 30);

      const ratingEl = el.querySelector('[class*="rating"], [class*="stars"], [aria-label*="rating"]');
      const rating = cleanText(ratingEl?.textContent)?.slice(0, 20)
        || ratingEl?.getAttribute("aria-label")?.slice(0, 20);

      const linkEl = el.querySelector("a[href]") || el;
      const { id } = addRef(linkEl);

      let line = `product "${title}"`;
      if (price) line += ` price="${price}"`;
      if (rating) line += ` rating="${rating}"`;
      line += ` [${id}]`;

      sections.push({
        type: "product",
        line,
        order: getOrder(el),
        refInfo: { ref, role: "link", name: title, selector: buildSelector(linkEl), isDomRef: true },
      });
    });

    // ── Search results (Google, Bing, DuckDuckGo, etc.) ───────
    document.querySelectorAll('[class*="result"], [data-testid*="result"], .g, [data-sokoban-container]').forEach((el) => {
      if (!isVisible(el)) return;
      const titleEl = el.querySelector("h3, h2, [class*='title'], [role='heading']");
      const title = cleanText(titleEl?.textContent)?.slice(0, 150);
      if (!title || title.length < 5 || seen.has("result:" + title)) return;
      seen.add("result:" + title);

      const snippetEl = el.querySelector("[class*='snippet'], [class*='description'], [data-content-feature], .VwiC3b, span:not(:empty)");
      const snippet = cleanText(snippetEl?.textContent)?.slice(0, 200);
      const linkEl = el.querySelector("a[href]");
      const href = linkEl?.getAttribute("href") || "";

      let line = `result: "${title}"`;
      if (href) line += ` url=${href.slice(0, 120)}`;
      if (snippet && snippet !== title) line += `\n  ${snippet}`;

      if (linkEl) {
        const { id } = addRef(linkEl);
        line += ` [${id}]`;
        sections.push({
          type: "result",
          line,
          order: getOrder(el),
          refInfo: { ref, role: "link", name: title, selector: buildSelector(linkEl), isDomRef: true },
        });
      } else {
        sections.push({ type: "result", line, order: getOrder(el) });
      }
    });

    // ── Map/sidebar results (Google Maps pattern) ─────────────
    // Enhanced Google Maps extraction with better selectors
    document.querySelectorAll([
      '[data-result-index]',
      '[class*="result-container"]', 
      '.section-result',
      '[jsaction*="pane.resultSection"]',
      '[role="article"]', // Maps uses article role for places
      'div[class*="Nv2PK"]', // Maps result card class (may change)
      'a[data-item-id]', // Direct place links
    ].join(', ')).forEach((el) => {
      if (!isVisible(el)) return;
      
      // Try to extract structured data first
      const nameEl = el.querySelector('[class*="fontHeadlineSmall"], [class*="fontBodyMedium"], h2, h3, [role="heading"]');
      const name = cleanText(nameEl?.textContent || '');
      
      const addressEl = el.querySelector('[class*="W4Efsd"], [class*="fontBodySmall"], [data-tooltip*="address"]');
      const address = cleanText(addressEl?.textContent || '');
      
      const ratingEl = el.querySelector('[class*="MW4etd"], [role="img"][aria-label*="stars"]');
      const rating = ratingEl?.getAttribute('aria-label') || cleanText(ratingEl?.textContent || '');
      
      const categoryEl = el.querySelector('[class*="fontBodyMedium"]:not([class*="fontHeadlineSmall"])');
      const category = cleanText(categoryEl?.textContent || '');
      
      // Fallback to full text if structured extraction fails
      const text = name || cleanText(el.textContent).slice(0, 300);
      if (!text || text.length < 10 || seen.has("map:" + text.slice(0, 60))) return;
      seen.has("map:" + text.slice(0, 60));
      
      const linkEl = el.querySelector("a[href]") || el;
      const { id } = addRef(linkEl);
      
      // Build rich output
      let line = `map-result: "${name || text}"`;
      if (address && address !== name) line += `\n  address: ${address}`;
      if (rating) line += `\n  rating: ${rating}`;
      if (category && category !== name && category !== address) line += `\n  category: ${category}`;
      line += ` [${id}]`;
      
      sections.push({
        type: "result",
        line,
        order: getOrder(el),
        refInfo: { ref, role: "link", name: name || text.slice(0, 80), selector: buildSelector(linkEl), isDomRef: true },
      });
    });

    // ── Canvas detection ──────────────────────────────────────
    let canvasNote = "";
    if (hasLargeCanvas && totalText < 200) {
      canvasNote = "\n[NOTE: This page uses canvas/WebGL rendering. Text above is from overlays only. Use browser-evaluate to run JS for deeper extraction.]\n";
    }

    // Sort by document order
    sections.sort((a, b) => a.order - b.order);

    return {
      items: sections,
      lastRef: ref,
      totalText,
      canvasNote,
    };

    // ── Utility: approximate document order ───────────────────
    function getOrder(el) {
      // Use bounding rect Y as proxy for document order
      try {
        const rect = el.getBoundingClientRect();
        return rect.top + window.scrollY;
      } catch {
        return 0;
      }
    }
  }, refCounter);

  if (!result) return { output: "", textLength: 0 };

  // Register refs in the host-side map
  for (const item of result.items) {
    if (item.refInfo) {
      refMap.set(`e${item.refInfo.ref}`, {
        role: item.refInfo.role,
        name: item.refInfo.name,
        index: item.refInfo.ref,
        isDomRef: true,
        selector: item.refInfo.selector,
      });
    }
  }
  setRefCounter(result.lastRef);

  const output = result.items.map((i) => i.line).join("\n") + (result.canvasNote || "");
  return { output, textLength: result.totalText };
}

/**
 * Accessibility tree snapshot — fallback for when DOM extraction fails.
 */
async function getA11ySnapshot(page) {
  // Validate page object first
  if (!page || !page.accessibility || typeof page.accessibility.snapshot !== 'function') {
    return "(accessibility tree unavailable)";
  }

  try {
    let snapshot = await page.accessibility.snapshot({ interestingOnly: true });
    let lines = [];

    if (snapshot) {
      flattenA11yTree(snapshot, lines, 0);
    }

    // If too sparse, try full tree
    if (lines.length < 10) {
      const full = await page.accessibility.snapshot({ interestingOnly: false });
      if (full) {
        const fullLines = [];
        flattenA11yTree(full, fullLines, 0);
        if (fullLines.length > lines.length) lines = fullLines;
      }
    }

    return lines.join("\n");
  } catch (err) {
    return `(accessibility tree error: ${err.message})`;
  }
}

/**
 * Flatten the accessibility tree into readable text lines.
 */
function flattenA11yTree(node, lines, depth) {
  if (!node) return;

  const indent = "  ".repeat(depth);
  const role = node.role || "";
  const name = node.name || "";
  const value = node.value || "";

  // Skip generic/none roles with no name
  if ((role === "none" || role === "generic" || role === "GenericContainer") && !name) {
    if (node.children) {
      for (const child of node.children) flattenA11yTree(child, lines, depth);
    }
    return;
  }

  // Assign refs for interactive elements
  const refMap = getRefMap();
  let refCounter = getRefCounter();
  let refStr = "";
  const interactive = [
    "link", "button", "textbox", "searchbox", "combobox", "checkbox",
    "radio", "tab", "menuitem", "option", "switch", "slider",
    "spinbutton", "menuitemcheckbox", "menuitemradio", "treeitem",
  ];
  if (interactive.includes(role)) {
    refCounter++;
    refStr = `e${refCounter}`;
    refMap.set(refStr, { role, name, index: refCounter });
    setRefCounter(refCounter);
  }

  let line = `${indent}${role}`;
  if (name) line += ` "${name}"`;
  if (value) line += ` value="${value}"`;
  if (refStr) line += ` [${refStr}]`;

  // States
  const states = [];
  if (node.checked !== undefined) states.push(node.checked ? "checked" : "unchecked");
  if (node.selected) states.push("selected");
  if (node.disabled) states.push("disabled");
  if (node.expanded !== undefined) states.push(node.expanded ? "expanded" : "collapsed");
  if (states.length > 0) line += ` (${states.join(", ")})`;

  lines.push(line);

  if (node.children) {
    for (const child of node.children) flattenA11yTree(child, lines, depth + 1);
  }
}

/**
 * Truncate snapshot output to prevent blowing up the LLM context.
 */
function truncate(text) {
  if (text.length <= MAX_SNAPSHOT_CHARS) return text;
  return text.slice(0, MAX_SNAPSHOT_CHARS) + "\n\n(snapshot truncated — page has more content, use scroll or evaluate for details)";
}
