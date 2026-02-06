# Browser Extension for Zaakify

Web browser extension that gives the agent full browsing capabilities via stealth Playwright.

## Features

- **Open pages** - Launch browser and navigate to any URL
- **Read content** - Accessibility tree + DOM extraction with element refs
- **Click elements** - Interact with buttons, links, and other elements by ref
- **Type text** - Fill inputs, search boxes, and forms
- **Press keys** - Enter, Tab, Escape, and other keyboard actions
- **Scroll pages** - Navigate long pages and trigger lazy-loaded content
- **Evaluate JS** - Run JavaScript directly in the page
- **Manage tabs** - Open, switch, list, and close browser tabs
- **Stealth mode** - Bypasses most bot detection (Cloudflare, PerimeterX, DataDome)
- **Cookie consent** - Auto-dismisses EU cookie banners (Cookiebot, OneTrust, etc.)
- **Smart loading** - Handles SPAs, React/Vue hydration, and streaming SSR

## Setup Instructions

### 1. Install Dependencies

```bash
# Agent can do this:
Extension({ action: "start", name: "browser" })

# Or manually:
cd extensions/browser
npm install
```

This installs Playwright and automatically downloads the Chromium browser (~200MB on first install) via the postinstall script.

**Note:** The `package.json` includes a `postinstall` script that runs `playwright install` automatically. No separate step needed.

### 2. Configure Extension

The default `config.json` ships with `configured: true` and sensible defaults. Edit if needed:

```json
{
  "configured": true,
  "headless": true,
  "locale": "en-US",
  "timezoneId": "Europe/Amsterdam",
  "viewport": {
    "width": 1280,
    "height": 720
  },
  "dismissCookies": true,
  "smartWaitTimeout": 10000
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `configured` | `true` | Extension is ready to use |
| `headless` | `true` | Run browser without visible window |
| `locale` | `"en-US"` | Browser locale |
| `timezoneId` | `"Europe/Amsterdam"` | Browser timezone |
| `viewport` | `1280x720` | Browser window size |
| `dismissCookies` | `true` | Auto-dismiss cookie consent banners |
| `smartWaitTimeout` | `10000` | Max wait (ms) for page to stabilize |

### 4. Reload Extension

```bash
Extension({ action: "reload", name: "browser" })
```

## Available Tools

Once configured, these tools are available:

### `browser-open`
Open a new browser tab and navigate to a URL.

```javascript
browser-open({
  url: "https://example.com"
})
```

### `browser-navigate`
Navigate the current tab to a URL.

```javascript
browser-navigate({
  url: "https://example.com/page"
})
```

### `browser-snapshot`
Get the current page's accessibility tree with element refs.

```javascript
browser-snapshot({})
```

### `browser-click`
Click an element by ref. Refs like `[e1]`, `[e2]` appear in snapshots next to interactive elements.

```javascript
browser-click({
  ref: "e3"
})
```

### `browser-type`
Type text into an element by ref.

```javascript
browser-type({
  ref: "e1",
  text: "search query"
})
```

### `browser-press`
Press a key (Enter, Tab, Escape, etc).

```javascript
browser-press({
  key: "Enter",
  ref: "e1"       // Optional: press key on specific element
})
```

### `browser-scroll`
Scroll the page up or down.

```javascript
browser-scroll({
  direction: "down"   // "up" or "down" (default: "down")
})
```

### `browser-evaluate`
Run JavaScript in the page and return the result.

```javascript
browser-evaluate({
  code: "document.title"
})
```

### `browser-wait`
Wait for page to finish loading (use after click that triggers navigation).

```javascript
browser-wait({})
```

### `browser-tabs`
List all open browser tabs.

```javascript
browser-tabs({})
```

### `browser-switch`
Switch to a tab by id.

```javascript
browser-switch({
  tabId: "tab2"
})
```

### `browser-close`
Close the current tab. Switches to next available tab.

```javascript
browser-close({})
```

### `browser-quit`
Close the browser completely.

```javascript
browser-quit({})
```

## Agent Usage Examples

```
User: "Search for headphones on Bol.com"
Agent: browser-open({ url: "https://www.bol.com" })
Agent: browser-type({ ref: "e1", text: "headphones" })
Agent: browser-press({ key: "Enter" })

User: "Click on the first result"
Agent: browser-click({ ref: "e5" })

User: "What's the price?"
Agent: browser-evaluate({ code: "document.querySelector('[class*=\"price\"]')?.textContent" })

User: "Scroll down to see more products"
Agent: browser-scroll({ direction: "down" })

User: "Close the browser"
Agent: browser-quit({})
```

## Agent Extension Management

The agent manages the browser extension lifecycle through the `Extension` tool:

### First-Time Setup:

```
User: "Browse the web for me"
  ↓
Agent: Extension({ action: "list" })
  → Sees: browser (not installed)
  ↓
Agent: Extension({ action: "info", name: "browser" })
  → { hasDependencies: true, dependenciesInstalled: false, configured: true }
  ↓
Agent: "I found a browser extension but need to install dependencies (Playwright, ~200MB). OK?"
  ↓
User: "Yes"
  ↓
Agent: Extension({ action: "start", name: "browser" })
  → Runs npm install (including postinstall to download browsers)
  → Extension starts, 13 tools registered
  ↓
Agent: browser-open({ url: "https://example.com" })
  → SUCCESS! Browser is working
```

### Subsequent Usage:

```
User: "Open Bol.com"
Agent: browser-open({ url: "https://www.bol.com" })
  → Works immediately, no setup needed
```

### Extension Info:

```
Agent: Extension({ action: "info", name: "browser" })
  → Shows status, tools, dependencies, config, restart count
```

### Validate Config:

```
Agent: Extension({ action: "validate", name: "browser" })
  → Checks config.json against SCHEMA.json
```

### Toggle (Disable/Enable):

```
Agent: Extension({ action: "toggle", name: "browser", enabled: false })
  → Disables extension, kills browser process, unregisters tools

Agent: Extension({ action: "toggle", name: "browser", enabled: true })
  → Re-enables and restarts extension
```

### Cleanup:

```
User: "I don't need the browser anymore"
Agent: Extension({ action: "uninstall", name: "browser" })
  → Removes node_modules/ (~200MB freed)
  → Extension code remains, can reinstall later

User: "Delete browser completely"
Agent: Extension({ action: "delete", name: "browser" })
  → Entire directory removed
```

## How Element Refs Work

When you take a snapshot (`browser-snapshot` or any tool that returns a snapshot), interactive elements get tagged with refs like `[e1]`, `[e2]`, etc:

```
searchbox "Zoeken" [e1]
button "Zoeken" [e2]
link "Laptops" [e3]
link "Telefoons" [e4]
product "Sony WH-1000XM5" price="€299,00" [e5]
```

Use these refs with `browser-click`, `browser-type`, and `browser-press` to interact with elements. Refs reset on each new snapshot.

Two extraction strategies are used:
1. **Accessibility tree** - Structured a11y data from the browser
2. **DOM extraction** - Direct DOM query for search boxes, buttons, links, headings, and product cards

If the accessibility tree is sparse (common on React/Vue/Next.js sites), DOM extraction becomes the primary source.

## Stealth Mode & Bot Detection Bypass

The browser uses comprehensive stealth measures to bypass bot detection on most sites:

### **JavaScript Fingerprint Spoofing:**
1. Hides `navigator.webdriver` flag
2. Fakes Chrome plugin array (PDF Plugin, PDF Viewer, Native Client)
3. Fakes navigator languages (`en-US`, `en`, `nl`)
4. Fakes platform (`Win32`)
5. Fakes hardware concurrency (8 cores)
6. Fakes device memory (8 GB)
7. Stubs `window.chrome` runtime
8. Normalizes Permissions API
9. Fakes WebGL vendor/renderer (NVIDIA GTX 1650)
10. Overrides iframe contentWindow detection
11. **Canvas fingerprint spoofing** with consistent noise per session
12. **Audio context fingerprint spoofing** (AudioContext, oscillator)
13. **Battery API spoofing** with realistic values (85-99% charge)
14. **Media devices spoofing** (fake microphone, speakers, webcam)
15. **Connection API spoofing** (4G, realistic downlink/rtt)

### **Browser Behavior:**
- **User agent rotation** - Random Chrome UA (v128-131) per session
- **Human-like mouse movement** - Curved paths with easing before clicks
- **Human-like typing** - Variable speed (50-500ms per character) with pauses
- **Random delays** - Realistic timing between actions
- **Cookie persistence** - Saved between sessions (looks like returning visitor)
- Matching `sec-ch-ua` headers for each UA version
- `Accept-Language` header matches navigator languages
- Disabled automation flags (`AutomationControlled`, `IsolateOrigins`)

### **Tested & Working On:**
✅ Google Maps (SPA extraction)
✅ Goudengids.nl (directory site)
✅ KVK.nl (Dutch Chamber of Commerce)
✅ Telefoonboek.nl (phone directory)
✅ Belastingdienst.nl (Dutch Tax Authority)
✅ Detelefoongids.nl (phone directory)

## Troubleshooting

### Extension not loading
- Check if dependencies are installed: `Extension({ action: "info", name: "browser" })`
- Install if needed: `Extension({ action: "install", name: "browser" })`
- Ensure Playwright browsers are downloaded: `npx playwright install chromium`

### Page content is empty
- Try `browser-wait({})` then `browser-snapshot({})` — some sites take time to render
- Use `browser-evaluate({ code: "document.body.innerText" })` as a fallback
- Some sites require scrolling to load content: `browser-scroll({ direction: "down" })`

### Bot detection / blocked
- The stealth scripts handle most sites, but some (e.g. Akamai Bot Manager) may still block
- Try setting `headless: false` in `config.json` for better evasion
- Use `browser-evaluate` to add custom headers or cookies

### Browser crashes
- Extensions run in isolated processes — a crash won't affect the gateway
- The extension host auto-restarts crashed extensions (up to 3 retries with exponential backoff)
- If persistent, check available memory and disk space

## Security & Privacy Notes

- The browser runs in the extension's isolated process
- Pages cannot access the host system beyond what Playwright allows
- Evaluate code runs in the page context, not in Node.js
- Cookie consent auto-dismiss only clicks "accept" buttons, no data is shared
- **Cookies are persisted** between sessions at `~/.zaakify/extensions/browser/storage/cookies.json`
- Browsing history is NOT persisted (only cookies)
- All fingerprint spoofing values are consistent per session but randomized between sessions
- User agent rotates randomly on each browser start

## Architecture

```
browser/
├── index.mjs           # Extension entry point
├── config.json         # Browser settings
├── package.json        # Dependencies (playwright)
├── SCHEMA.json         # Config validation
├── GUIDANCE.md         # Agent usage guidance
├── README.md           # This file
└── src/
    ├── client.mjs      # Browser lifecycle, tabs, element refs, cookie persistence
    ├── stealth.mjs     # 15+ stealth scripts for bot detection bypass
    ├── tools/          # Individual tool implementations
    │   ├── open.mjs
    │   ├── navigate.mjs
    │   ├── snapshot.mjs
    │   ├── click.mjs      # Human-like mouse movement
    │   ├── type.mjs       # Human-like typing speeds
    │   ├── press.mjs
    │   ├── scroll.mjs
    │   ├── evaluate.mjs
    │   ├── wait.mjs
    │   ├── tabs.mjs
    │   ├── switch.mjs
    │   ├── close.mjs
    │   └── quit.mjs
    └── utils/
        ├── cookies.mjs        # Cookie consent auto-dismissal
        ├── human.mjs          # Human behavior simulation (mouse, typing, delays)
        ├── snapshot.mjs       # A11y tree + DOM extraction + Google Maps support
        ├── user-agents.mjs    # User agent rotation pool (6 Chrome versions)
        └── wait.mjs           # Smart page wait with SPA detection
```

## Version

2.0.0 - THE ULTIMATE BROWSER
- Comprehensive bot detection bypass (15+ fingerprint spoofing techniques)
- Human-like behavior (mouse movement, typing speeds, random delays)
- Cookie persistence between sessions
- User agent rotation
- Google Maps SPA support
- Tested on 6+ Dutch business sites with 100% success rate

1.0.0 - Initial release

## License

MIT
