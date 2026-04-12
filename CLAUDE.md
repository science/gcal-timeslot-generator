# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Deploy Commands

```bash
npm run build          # Clean + Rollup bundle → dist/
npm test               # Run all Jest tests
npm run deploy         # Full cycle: build → clasp push → create version → update deployment
npm run push           # Build + push to Apps Script (HEAD only — NOT production)
npm run watch          # Rollup watch mode for development
npm run open           # Open deployed web app in browser
```

**IMPORTANT:** When asked to "push to production", "deploy via clasp", or "push with clasp", always:
1. Run tests: `npm test`
2. Commit all changes (the deploy script **refuses to run with uncommitted changes** so the version hash in the UI matches the deployed code)
3. Deploy: `npm run deploy`

Never use `npm run push` for production — it only updates the HEAD deployment, which is NOT what users access. Only `deploy` creates a versioned deployment that updates the live web app.

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
- **`src/server/SlotCalculator.ts`** — Pure functions: `computeFreeSlotsWithFatigue` (fatigue-aware slot emission), `mergeBusyBlocks`, `filterPastSlots`, `roundSlotStarts`, `getNextBusinessDays`. Non-pure: `getAvailableSlots()` and `fetchCalendarEvents()` call the Advanced Calendar Service (`Calendar.Events.list`).
- **`src/server/Formatter.ts`** — Pure formatting functions: `formatTime`, `formatSlots` (bullets/compact styles), `durationSuffix` (renders "(max 30 min)" annotations).
- **`src/shared/types.ts`** — Shared interfaces: `TimeSlot` (with optional `maxMinutes`), `DaySlots`, `SlotOptions`, `BusyBlock`, `CalendarInfo`.
- **`src/pages/index.html`** — Complete UI (HTML + CSS + inline JS). Preview is an editable `<textarea>`. Calls server via `google.script.run.*`.

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
- Build injects `__GIT_HASH__` and `__GIT_DATE__` placeholders in `index.html` with the current git commit (version indicator visible in the UI footer, links to GitHub commit). The `release/` copy uses the stable package version (`v0.3.0`) instead of git hash/date to keep the build idempotent — otherwise every commit or new day makes `release/` dirty and blocks deploy.

## Testing & TDD

**Goal: red/green whenever possible.** Write a failing test first, then make it pass. This project has good test coverage on its pure logic and that discipline should continue.

### What's testable

All pure functions in `SlotCalculator.ts` and `Formatter.ts` are fully testable with Jest — no GAS runtime needed. This is by design: business logic is deliberately separated from GAS API calls. When adding new logic, keep it pure and export it so tests can reach it.

Current test files (131 tests total):
- `tests/server/SlotCalculator.test.ts` — covers `mergeBusyBlocks`, `computeFreeSlotsWithFatigue`, `filterPastSlots`, `getNextBusinessDays`, `formatDayLabel`
- `tests/server/Formatter.test.ts` — covers `formatTime`, `formatSlots` (both styles)
- `tests/server/SlotEmissionStrategy.test.ts` — non-overlapping emission, boundary-trim splitting, adjacent-slot annotation, fallback individual splits
- `tests/server/AvailabilityOracleComparison.test.ts` — compares algorithm output against the reference oracle across 23 named fixtures + 381 synthetic permutations (2-block and 3-block arrangements over varying durations and gaps)
- `tests/server/availabilityOracle.ts` — reference oracle implementing availability rules from first principles (`isValidMeeting`, `compareWithOracle`). The oracle is the ground truth — if it and the algorithm disagree, the algorithm is wrong.
- `tests/server/availabilityFixtures.ts` — 10 calendar fixtures (anonymized from real Apr 2026 data) + 13 synthetic rule-isolation fixtures, each with hand-derived expected valid meeting starts

### What's not testable (GAS boundaries)

Some things can't be unit tested locally because they depend on the GAS runtime:
- **`google.script.run.*`** calls from the HTML UI — no local browser environment
- **Calendar API calls** in `getAvailableSlots()` / `fetchCalendarEvents()` and `getCalendars()` — `fetchCalendarEvents` uses the Advanced Calendar Service (`Calendar.Events.list`); `getCalendars` still uses `CalendarApp` for listing calendars
- **`doGet()` / `HtmlService`** — GAS-specific serving layer
- **UI behavior** in `index.html` — inline JS with no test harness

Don't fight this. The GAS runtime boundary is thin by design (`Code.ts` is mostly glue). Put effort into testing the logic that can be tested, not into elaborate mocks of GAS APIs that provide little confidence anyway.

### TDD workflow

1. Write a failing test (`npm test` — red)
2. Implement the minimal code to pass (`npm test` — green)
3. Refactor if needed, tests stay green
4. Build and deploy: `npm run deploy`
