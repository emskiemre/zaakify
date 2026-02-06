# Browser Extension — Usage Guide

**You already started this extension successfully.** Dependencies and browser binaries were installed automatically. You're ready to use the browser right away.

## Google Search is your default

When you don't have a direct URL, always start with Google Search. Don't guess URLs.

```
browser-open({ url: "https://www.google.com/search?q=your+search+query" })
```

The snapshot shows search results with clickable refs — click through to the page you need.

## How it works

The browser reads pages as structured text: headings, paragraphs, links, buttons, tables, forms.
Interactive elements show as `[e1]`, `[e2]`, etc. Use these refs with `browser-click`,
`browser-type`, and `browser-press`.

## Workflow

Open -> do your thing -> quit. Every time.

- If you need multiple sites, do it all in one session, then quit once.
- If a page looks empty or sparse, try `browser-snapshot({ scroll: "true" })` to load lazy content.
- For heavy SPAs (Google Maps, dashboards), use `browser-evaluate` to run JS that extracts data directly.

**IMPORTANT:** When you reach a results/listings page, STOP interacting with the form. Extract the visible results and move on. Don't keep refining searches - one search is enough.

## Tools

| Tool | What it does |
|---|---|
| `browser-open` | Open a new tab with a URL |
| `browser-navigate` | Navigate current tab to a URL |
| `browser-snapshot` | Read the page (set scroll="true" for lazy content) |
| `browser-click` | Click an element by ref (e.g. ref="e3") |
| `browser-type` | Type text into an input by ref |
| `browser-press` | Press a key (Enter, Tab, Escape) |
| `browser-scroll` | Scroll page up or down |
| `browser-evaluate` | Run JavaScript in the page |
| `browser-wait` | Wait for page to finish loading |
| `browser-tabs` | List open tabs |
| `browser-switch` | Switch to a tab |
| `browser-close` | Close current tab |
| `browser-quit` | Close the browser completely |

## When you're done

**Stop this extension when you're finished.** Each extension runs as a separate process.
Only one extension should be running at a time. When you have what you need:

```
browser-quit()
Extension({ action: "stop", name: "browser" })
```

Always quit the browser first, then stop the extension.
