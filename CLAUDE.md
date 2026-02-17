# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Deploy Commands

```bash
npm run build          # Clean + Rollup bundle → dist/
npm test               # Run all Jest tests
npm run deploy         # Full cycle: build → clasp push → create version → update deployment
npm run push           # Build + push to Apps Script (no new version)
npm run watch          # Rollup watch mode for development
npm run open           # Open deployed web app in browser
```

Run a single test file:
```bash
npx jest tests/server/SlotCalculator.test.ts
```

## Architecture

Google Apps Script web app written in TypeScript, bundled with Rollup.

**Source → Build → Deploy pipeline:**
- `src/server/*.ts` → Rollup bundles into `dist/Code.gs` (single file)
- `src/pages/index.html` → copied to `dist/index.html`
- `appsscript.json` → copied to `dist/`
- `clasp push` uploads `dist/` to Apps Script; `deploy.js` creates a versioned deployment

**Key constraint:** GAS has no module system — all `.gs` files share a global scope. A custom Rollup plugin (`stripModuleSyntax`) removes all `export`/`import` statements from the bundle. Write normal ES module syntax in source; it's stripped at build time.

### Source Layout

- **`src/server/Code.ts`** — GAS entry points: `doGet()`, `getSlots()`, `getCalendars()`. Only file that touches GAS runtime APIs.
- **`src/server/SlotCalculator.ts`** — Pure functions: `computeFreeSlots`, `mergeBusyBlocks`, `applyFatigueBreaks`, `filterPastSlots`, `getNextBusinessDays`. The one exception is `getAvailableSlots()` which calls Calendar API.
- **`src/server/Formatter.ts`** — Pure formatting functions: `formatTime`, `formatSlots` (bullets/compact styles).
- **`src/shared/types.ts`** — Shared interfaces: `TimeSlot`, `DaySlots`, `SlotOptions`, `BusyBlock`, `CalendarInfo`.
- **`src/pages/index.html`** — Complete UI (HTML + CSS + inline JS). Calls server via `google.script.run.*`.

### Test Setup

Tests live in `tests/server/` using Jest + ts-jest. Only pure functions are tested (no GAS runtime mocking needed).

Two TypeScript configs:
- `tsconfig.json` — production build (rootDir: `src/`)
- `tsconfig.test.json` — extends main, adds `"types": ["jest", "google-apps-script"]` and includes `tests/`. The `jest.config.ts` references this via the `transform` option (not top-level).

### Build & Deploy to Apps Script

Full deployment (build, push, create version, update live web app):
```bash
npm run deploy
```

This runs the complete pipeline: `npm run build` → `clasp push --force` → `scripts/deploy.js` (creates a new version and updates the non-HEAD deployment). The deployed web app URL stays the same across versions.

For iterating without cutting a new version:
```bash
npm run push    # Build + push to Apps Script (HEAD deployment only)
```

Internals:
- `.clasp.json` (gitignored) contains scriptId and `"rootDir": "dist"`
- `scripts/deploy.js` auto-discovers the non-HEAD deployment ID via clasp output
- Clasp syntax: `clasp deploy -i <id> -V <version>` (not `--deploymentId`)
- `release/` folder has pre-built files for non-developer distribution

## Testing & TDD

**Goal: red/green whenever possible.** Write a failing test first, then make it pass. This project has good test coverage on its pure logic and that discipline should continue.

### What's testable

All pure functions in `SlotCalculator.ts` and `Formatter.ts` are fully testable with Jest — no GAS runtime needed. This is by design: business logic is deliberately separated from GAS API calls. When adding new logic, keep it pure and export it so tests can reach it.

Current test files:
- `tests/server/SlotCalculator.test.ts` — covers `mergeBusyBlocks`, `computeFreeSlots`, `filterPastSlots`, `applyFatigueBreaks`, `getNextBusinessDays`, `formatDayLabel`
- `tests/server/Formatter.test.ts` — covers `formatTime`, `formatSlots` (both styles)

### What's not testable (GAS boundaries)

Some things can't be unit tested locally because they depend on the GAS runtime:
- **`google.script.run.*`** calls from the HTML UI — no local browser environment
- **Calendar API calls** in `getAvailableSlots()` and `getCalendars()` — would require mocking the entire `CalendarApp` global
- **`doGet()` / `HtmlService`** — GAS-specific serving layer
- **UI behavior** in `index.html` — inline JS with no test harness

Don't fight this. The GAS runtime boundary is thin by design (`Code.ts` is mostly glue). Put effort into testing the logic that can be tested, not into elaborate mocks of GAS APIs that provide little confidence anyway.

### TDD workflow

1. Write a failing test (`npm test` — red)
2. Implement the minimal code to pass (`npm test` — green)
3. Refactor if needed, tests stay green
4. Build and deploy: `npm run deploy`
