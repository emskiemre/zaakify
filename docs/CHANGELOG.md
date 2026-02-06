# Changelog

All notable changes to BitQlon will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Extension GUIDANCE.md system — each extension ships its own usage guide, injected into the agent's context when the extension starts
- Browser extension v2 — general-purpose page extraction that works on search engines, news, maps, government sites, SPAs, and more (not just e-commerce)
- Smart async waiting — MutationObserver + network idle detection for SPA-heavy pages
- Auto-scroll support in browser snapshots for lazy-loaded content
- Google Search as default browsing strategy — GUIDANCE.md instructs the agent to Google when it doesn't have a URL
- Search result extraction (Google, Bing, DuckDuckGo patterns)
- Map sidebar result extraction (Google Maps pattern)
- Canvas/WebGL detection with fallback guidance
- CSS-selector-based element ref resolution for reliable clicking on any page
- One-extension-at-a-time enforcement in code — agent gets a clear error telling it which extension to stop first
- `npm run onboard` script for easier local development setup

### Changed
- Modularized 8 large source files into 13 focused modules (extension-tool, sandbox, search-utils, transcript-logger, history-manager, format-openai, routes, ws-handler, port-utils, templates, prompt-builder, message-utils, job-store)
- Moved Dockerfile and docker-compose.yml to `docker/`
- Moved vitest configs to `tests/`
- Moved CHANGELOG.md to `docs/`
- Cleaned up project root — only essential files remain (package.json, tsconfig, README, LICENSE, .gitignore, .env.example)
- Restructured extensions from `workspace/extensions/` to `extensions/` in repo root
- Centralized all path definitions in `src/paths.ts` — no more scattered `homedir()` calls
- Lazy-load extension system — extensions discovered on boot but not started (agent decides)
- Extension tool actions simplified: removed `create`, `toggle`, `delete`, `validate`; renamed `reload` to `restart`
- Agent runner now refreshes tool list each loop iteration — extensions tools are usable immediately after starting
- AGENTS.md template trimmed — extension-specific tips moved to per-extension GUIDANCE.md files
- Updated README architecture diagram, Docker commands, and key modules list
- Updated error message when config file is missing to show `npm run onboard` for local installations

### Fixed
- Fixed agent tool visibility bug — browser tools were invisible to the LLM after starting the extension (stale tool list snapshot)
- Fixed WebFetch tool description — now hints at browser extension for sites that block bots

### Removed
- Removed auto-restart on extension crash — agent decides when to restart
- Removed simple mode from extension system (only `activate(sdk)` pattern)
- Removed 4 stale planning docs
- Removed empty `scripts/` directory

## [1.0.0] - 2026-02-04

### Added
- Initial release of BitQlon
- Event-driven kernel with pub/sub architecture
- Process-isolated extensions system
- Support for Discord, Telegram, and WhatsApp channels
- Web-based chat UI with real-time token streaming
- Stealth browser extension with Playwright
- Automatic timezone-aware daily conversation logs
- Interactive onboarding wizard
- SQLite-based memory system with FTS5
- Comprehensive tool registry (Time, Read, Write, Edit, Delete, Bash, Glob, Grep, List, WebFetch)
- Z.AI (GLM) integration with streaming support
- Docker support with docker-compose
- CLI commands: gateway, onboard, doctor, status
