# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Two build targets

The repo ships the same app two ways:

1. **SPA (primary, end-user facing).** Static site on GitHub Pages. Users sign in with Google, calendar data stays in the browser, no backend. Built with Vite.
2. **Apps Script (secondary, legacy path).** Copy-paste install into `script.google.com`, executed as the user who deployed. Built with Rollup. Retained so existing users don't break.

Pure compute is shared between the two via `src/lib/`.

## Build & Test Commands

```bash
npm test                 # Run all 131 Jest tests (pure logic only)
npm run check:web        # TypeScript check for the SPA sources
npm run dev              # Vite dev server on 0.0.0.0:5173 (SPA)
npm run build:web        # Production SPA build → dist-web/
npm run preview:web      # Preview the built SPA locally
npm run build            # Rollup Apps Script build → dist/
npm run push             # Build + clasp push (Apps Script HEAD — NOT production)
npm run deploy           # Full Apps Script cycle: build → push → version → update deployment
npm run watch            # Rollup watch mode (Apps Script dev)
npm run open             # Open deployed Apps Script web app in browser
npm run login            # clasp login (Apps Script)
```

Run a single test file:
```bash
npx jest tests/server/SlotCalculator.test.ts
```

## SPA dev setup

1. Copy `.env.example` → `.env.local` (gitignored).
2. Create an OAuth 2.0 Client ID in [Google Cloud Console](https://console.cloud.google.com/apis/credentials) (Web application type). Add `http://localhost:5173` to Authorized JavaScript origins. Enable the Google Calendar API.
3. Set `VITE_GOOGLE_CLIENT_ID` in `.env.local`.
4. Add your own email to the OAuth consent screen's test users list (the app is in Testing publishing status — up to 100 allowlisted users).
5. `npm run dev`.

**The Client ID is baked into the production build.** Vite replaces `import.meta.env.VITE_GOOGLE_CLIENT_ID` with a string literal at build time, so the deployed bundle contains the ID. Client IDs aren't secret — Google's consent flow enforces the authorized origin. If the env var is unset at build time, Vite tree-shakes the post-auth code away and the site renders a "missing config" error; this is by design.

## SPA deploy pipeline

GitHub Pages via `.github/workflows/deploy-pages.yml`:

- Triggered by pushing to the `production` branch (or manual workflow dispatch).
- Workflow runs `npm ci` + `npm run build:web`, uploads `dist-web/` as the Pages artifact, deploys it.
- `VITE_GOOGLE_CLIENT_ID` is passed from a repo secret of the same name.
- Shipping looks like: `git push origin main:production`. Mirrors the gdoc-comments-md pattern; no PR required because `main` is the development branch.

The base path defaults to `/gcal-timeslot-generator/` to match the GitHub Pages subpath at `https://science.github.io/gcal-timeslot-generator/`. Override via `VITE_BASE_PATH=/` for a root-domain deploy.

## Apps Script deploy pipeline

Full deployment (build, push, create version, update live web app):
```bash
npm run deploy
```

Runs `npm run build` → `clasp push --force` → `scripts/deploy.js` (creates a new version and updates the non-HEAD deployment). The deployed web app URL stays the same across versions.

For iterating without cutting a new version:
```bash
npm run push    # Build + push to Apps Script (HEAD deployment only)
```

**IMPORTANT:** When asked to "push to production", "deploy via clasp", or "push with clasp", always:
1. Run tests: `npm test`.
2. Commit all changes (the deploy script refuses to run with uncommitted changes so the version hash in the UI matches the deployed code).
3. Deploy: `npm run deploy`.

Never use `npm run push` for production — it only updates the HEAD deployment, which is NOT what users access.

Internals:
- `.clasp.json` (gitignored) contains scriptId and `"rootDir": "dist"`.
- `scripts/deploy.js` auto-discovers the non-HEAD deployment ID via clasp output.
- Clasp syntax: `clasp deploy -i <id> -V <version>` (not `--deploymentId`).
- `release/` folder has pre-built files for the manual copy-paste install (still documented in README as a fallback).

## Source layout

```
src/
  lib/                   # Pure logic shared between SPA and Apps Script builds
    types.ts             # TimeSlot, DaySlots, SlotOptions, BusyBlock, CalendarInfo
    slot-calculator.ts   # computeFreeSlotsWithFatigue, computeDaySlots, mergeBusyBlocks, …
    formatter.ts         # formatTime, formatSlots (bullets, compact)
  server/                # Apps Script build only
    Code.ts              # GAS entry points (doGet, getCalendars, getSlots, saveSettings)
    calendar-service.ts  # Wraps Advanced Calendar Service (Calendar.Events.list) + CalendarApp
  web/                   # SPA build only (Vite root)
    index.html           # SPA shell + sign-in gate
    main.ts              # Entry: boots auth, wires sign-in/sign-out, calls startApp()
    auth.ts              # Google Identity Services wrapper (token cache, silent refresh)
    calendar-api.ts      # Fetch wrappers for Calendar v3 REST
    settings-storage.ts  # localStorage wrapper (mirrors GAS PropertiesService API shape)
    ui.ts                # Main UI logic (ported from pages/index.html inline script)
    env.d.ts             # Vite env var types
  pages/
    index.html           # GAS UI — served by HtmlService via doGet()
```

**Key constraint (Apps Script):** GAS has no module system. All `.gs` files share a global scope. The Rollup plugin `stripModuleSyntax` removes `export`/`import` statements. Write normal ES module syntax in source; it's stripped at build time.

**Key constraint (SPA):** All calendar data stays client-side. No server. OAuth 2.0 in the browser via the GIS token-client flow — access tokens live in `localStorage` and are silently refreshed via an invisible iframe when they expire (1 hour typical). In Testing publishing status, GIS silent refresh fails after ~7 days and the user re-authenticates via the sign-in button.

## TypeScript configs

- `tsconfig.json` — base config, ES2019 target, used by Rollup for the Apps Script build. `@types/google-apps-script` is picked up automatically from `node_modules`.
- `tsconfig.test.json` — extends base, adds `"types": ["jest", "google-apps-script"]`, includes `tests/`. Referenced by `jest.config.ts` via the transform option.
- `tsconfig.web.json` — extends base, overrides `lib` to add DOM types, `types: []` to exclude google-apps-script leakage, `moduleResolution: "bundler"` for Vite. Includes `src/lib/` + `src/web/`. `noEmit` (Vite handles emission via esbuild).

## Testing & TDD

**Goal: red/green whenever possible.** Write a failing test first, then make it pass.

### What's testable

All pure functions in `src/lib/` are fully testable with Jest — no runtime mocking needed. When adding logic, keep it pure and export it so tests can reach it. Put GAS or browser API calls in `src/server/` or `src/web/` respectively; both call into the same pure `src/lib/` code.

Current test files (131 tests total) live under `tests/server/` for historical reasons — the directory name predates the split. Tests import from `../../src/lib/*`:
- `tests/server/SlotCalculator.test.ts` — `mergeBusyBlocks`, `computeFreeSlotsWithFatigue`, `filterPastSlots`, `getNextBusinessDays`, `formatDayLabel`.
- `tests/server/Formatter.test.ts` — `formatTime`, `formatSlots` (both styles).
- `tests/server/SlotEmissionStrategy.test.ts` — non-overlapping emission, boundary-trim splitting, adjacent-slot annotation, fallback individual splits.
- `tests/server/AvailabilityOracleComparison.test.ts` — 23 named fixtures + 381 synthetic permutations vs. the reference oracle.
- `tests/server/availabilityOracle.ts` — reference oracle from first principles.
- `tests/server/availabilityFixtures.ts` — 10 real + 13 synthetic fixtures with hand-derived expectations.

### What's not testable (runtime boundaries)

Not unit-tested locally because they need real runtimes:
- **GAS**: `google.script.run.*`, `Calendar.Events.list`, `CalendarApp`, `PropertiesService`, `HtmlService`.
- **SPA**: GIS token client, Calendar v3 fetches, DOM interactions.

The boundary modules (`src/server/calendar-service.ts`, `src/web/calendar-api.ts`, `src/web/ui.ts`) are thin adapters by design — put effort into the pure logic, not into elaborate runtime mocks.

### TDD workflow

1. Write a failing test (`npm test` — red).
2. Implement the minimal code to pass (`npm test` — green).
3. Refactor if needed, tests stay green.
4. Build for the right target: `npm run build:web` (SPA) or `npm run deploy` (Apps Script).
