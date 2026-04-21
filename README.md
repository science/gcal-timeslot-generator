# Google Calendar Time Slot Generator

A browser app that reads your Google Calendar and generates copyable time-slot text for scheduling emails and messages. Instead of going back and forth about availability, open the app, review your free slots, and paste formatted availability into an email or chat.

## Use it — closed beta (Learning Tapestry only)

**Hosted app:** [science.github.io/gcal-timeslot-generator](https://science.github.io/gcal-timeslot-generator/)

> **Closed beta.** Access is currently limited to `@learningtapestry.com` Google Workspace accounts. Personal Gmail accounts and other company domains will be rejected at sign-in. The OAuth app is configured as **Internal** within the Learning Tapestry Workspace — if you're a member of the domain, no allowlist or verification step is required.

1. Open the link, click **Sign in with Google**.
2. Pick your `@learningtapestry.com` account.
3. Grant read-only calendar access on the consent screen.

That's it — the app loads and generates slots. No "unverified app" warning, no token expiry within the session.

Your calendar data stays in your browser — the app has no backend. Nothing is transmitted to the maintainer or anyone else. The source is all here for you to audit.

## Features

- Scans your Google Calendar for the next N business days (3, 5, or 10)
- Computes free time slots within configurable working hours
- **Multi-calendar support** — select which calendars contribute to busy-time calculation (personal + work, or switch between different people's calendars)
- **Meeting fatigue breaks** — automatically inserts buffer time after long meeting blocks, with smart gap classification (micro-gaps merge, short gaps may close, real breaks always preserved)
- **Non-overlapping slots** — each free gap produces clean, non-overlapping time slots. Short constrained slots (e.g. 30 min between long blocks) are labeled "(max 30 min)" when adjacent to other slots so readers don't assume they can book longer
- **Slot rounding** — round slot start times to clean increments (5, 10, 15, or 30 min) so you never propose a meeting at 2:55pm
- **Editable preview** — the preview area is an editable text box; clean up or remove slots before copying
- **Timezone display** — format times in Pacific, Mountain, Central, or Eastern
- **Include today** — optionally show remaining availability for the current day
- Check/uncheck individual slots or entire days before copying
- Two output formats: bullets (email-friendly) or compact (chat-friendly)
- One-click copy to clipboard

## Screenshots

<p align="center">
  <img src="docs/images/main-screen.png" alt="Main screen showing preview and time slot selection" width="440">
</p>

The main screen shows a live preview of the formatted availability text at top, with checkboxes below to include or exclude individual time slots and entire days.

<p align="center">
  <img src="docs/images/advanced-settings.png" alt="Advanced settings with working hours, fatigue controls, and calendar selection" width="440">
</p>

Advanced settings let you configure working hours, meeting fatigue breaks, and which calendars to include in the busy-time calculation.

## Usage

### Main Controls

| Control | Description |
|---------|-------------|
| **Days** | Number of business days to scan (3, 5, or 10) |
| **Timezone** | Display timezone for formatted times (Pacific, Mountain, Central, Eastern) |
| **Format** | Bullets (multi-line with day headers) or Compact (one line per day) |
| **Include today** | Show remaining free slots for today |

### Advanced Settings

Click "Advanced settings" to expand:

| Control | Description |
|---------|-------------|
| **Start / End hour** | Working hours window (default 9am-5pm) |
| **Max meeting block** | Longest meeting block before a forced break (default 2h, or Off to disable) |
| **Required break** | Minimum gap that counts as a real break, and the duration of enforced breaks after long blocks (default 30 min) |
| **Ignore gaps under** | Gaps this short or shorter are treated as continuous meeting time (default 15 min, or Off) |
| **Round to nearest** | Round slot start times up to the next clean increment (5, 10, 15, or 30 min; default 15) |
| **Calendars** | Select which calendars count toward "busy" time |

### Multi-Calendar

By default, only your primary calendar is checked. To merge availability across multiple calendars:

- **Personal + work**: Check both calendars. Events from all checked calendars are combined — overlapping events merge naturally, so a meeting on your work calendar and a dentist appointment on your personal calendar both block that time.
- **Admin / assistant use**: If you have view access to other people's calendars, they'll appear in the list. Check one person's calendar at a time to generate their availability.

## Alternative: self-hosted Apps Script install

Not on the allowlist yet? You can run your own private copy as a Google Apps Script web app. This takes ~10 minutes through `script.google.com` and doesn't require allowlisting — it's entirely under your own Google account.

<details>
<summary>Full copy-paste install instructions</summary>

### 1. Create a new Apps Script project

1. Go to [script.google.com](https://script.google.com) and sign in with your Google account.
2. Click **New project**.
3. Name it "Time Slot Generator" (click "Untitled project" at the top).

### 2. Add the code files

The pre-built files are in the [`release/`](release/) folder of this repository.

**Replace Code.gs:**

1. In the Apps Script editor, you'll see a file called `Code.gs` with a default `myFunction()` in it.
2. Select all the text and delete it.
3. Open [`release/Code.gs`](release/Code.gs) in this repository and copy its entire contents.
4. Paste into the empty `Code.gs` file in the editor.

**Add index.html:**

1. In the left sidebar, click the **+** button next to "Files".
2. Select **HTML**.
3. Name it `index` (it will become `index.html`).
4. Delete the default HTML content.
5. Open [`release/index.html`](release/index.html) in this repository and copy its entire contents.
6. Paste into the empty `index.html` file.

**Update appsscript.json:**

1. In the left sidebar, click the **gear icon** (Project Settings).
2. Check the box **"Show 'appsscript.json' manifest file in editor"**.
3. Go back to the Editor (left sidebar, `< >` icon).
4. Click on `appsscript.json` in the file list.
5. Select all and replace with the contents of [`release/appsscript.json`](release/appsscript.json).

### 3. Enable the Calendar API

1. In the left sidebar, click the **+** next to **Services**.
2. Find **Google Calendar API** in the list.
3. Click **Add**.

### 4. Deploy as a web app

1. Click **Deploy** > **New deployment**.
2. Click the **gear icon** next to "Select type" and choose **Web app**.
3. Fill in:
   - **Description**: "Time Slot Generator" (or anything you like).
   - **Execute as**: "Me" (your email address).
   - **Who has access**: "Only myself".
4. Click **Deploy**.
5. Click **Authorize access** when prompted.
6. In the popup, select your Google account.
7. If you see "Google hasn't verified this app", click **Advanced** → **Go to Time Slot Generator (unsafe)** — this is your own script, so it's safe.
8. Click **Allow** to grant calendar read access.
9. Copy the **Web app URL** shown — bookmark this link.

### 5. Use it

Open the Web app URL. The app reads your Google Calendar, computes your free time slots, and lets you copy formatted availability text to your clipboard.

### Updating to a new version

Your settings are saved automatically and carry over across updates.

1. Open your Apps Script project at [script.google.com](https://script.google.com).
2. Replace `Code.gs` and `index.html` by copying the latest contents from the `release/` folder (same as steps 2 above).
3. Click **Deploy** → **Manage deployments**.
4. Click the **pencil icon** on your existing deployment, change **Version** to "New version", click **Deploy**.

Your bookmarked URL stays the same — reload to see the updated app.

</details>

## Developer setup

### Prerequisites

- Node.js 18+ and npm.
- A Google account with Google Calendar.

### Install

```bash
git clone <your-repo-url>
cd gcal-timeslot-generator
npm install
```

### SPA dev workflow

One-time setup (Cloud Console + GitHub Pages) is documented end-to-end in [docs/SETUP.md](docs/SETUP.md). The partial-automation helper:

```bash
./scripts/setup-gcp.sh    # creates GCP project, enables Calendar API
```

After running it, continue with the manual Console steps in [docs/SETUP.md](docs/SETUP.md).

```bash
npm run dev              # Vite dev server on 0.0.0.0:5173
npm run check:web        # TypeScript check
npm run build:web        # Production build → dist-web/
npm run preview:web      # Preview the production build
```

Ship with `git push origin main:production`. The `.github/workflows/deploy-pages.yml` workflow builds the SPA (injecting the `VITE_GOOGLE_CLIENT_ID` repo secret) and deploys `dist-web/` to GitHub Pages.

### Apps Script dev workflow

```bash
cp .clasp.json.example .clasp.json   # then fill in your scriptId
npm run login                        # clasp auth
npm run build                        # Rollup bundle → dist/
npm run push                         # Build + push to Apps Script (HEAD)
npm run deploy                       # Full cycle: build + push + new version + update deployment
```

### Scripts

| Command | Description |
|---------|-------------|
| `npm test` | Jest unit tests (131 tests, pure logic only) |
| `npm run check:web` | TypeScript check for SPA sources |
| `npm run dev` | Vite dev server for the SPA |
| `npm run build:web` | Production SPA build |
| `npm run preview:web` | Preview built SPA |
| `npm run build` | Apps Script Rollup build |
| `npm run push` | Apps Script clasp push (HEAD only) |
| `npm run deploy` | Apps Script full deploy (version + update) |
| `npm run watch` | Apps Script Rollup watch |
| `npm run login` | clasp auth |
| `npm run open` | Open deployed Apps Script web app |

### Project structure

```
src/
  lib/                   # Pure logic shared between both builds
    types.ts
    slot-calculator.ts
    formatter.ts
  server/                # Apps Script build only
    Code.ts              # GAS entry points (doGet, getCalendars, …)
    calendar-service.ts  # Wraps Calendar.Events.list + CalendarApp
  web/                   # SPA build only (Vite root)
    index.html, main.ts, auth.ts, calendar-api.ts, ui.ts, settings-storage.ts
  pages/
    index.html           # GAS UI (served by HtmlService)
tests/
  server/                # Jest tests — all pure logic
scripts/
  deploy.js              # Apps Script deploy automation
release/                 # Pre-built Apps Script files for copy-paste install
```

### Architecture

Pure compute (slot calculation, fatigue algorithm, formatting) lives in `src/lib/` and is imported by both builds. The **SPA** (`src/web/`) uses Google Identity Services for browser-side OAuth and calls the Calendar v3 REST API directly with a Bearer token. The **Apps Script** build (`src/server/`) calls the Advanced Calendar Service (`Calendar.Events.list`) from the GAS runtime.

The build process for each target:
- **SPA**: Vite bundles `src/web/` + imported `src/lib/` → `dist-web/` with hashed asset names; GitHub Pages serves it.
- **Apps Script**: Rollup bundles `src/server/Code.ts` + imported `src/lib/` → `dist/Code.gs` (single file — GAS has no module system, so a custom plugin strips `export`/`import`).

Pure functions (`mergeBusyBlocks`, `computeFreeSlotsWithFatigue`, `computeDaySlots`, `filterPastSlots`, `roundSlotStarts`) are exported and unit-tested with Jest — 131 tests including a 381-permutation sweep validated against a reference oracle. Thin runtime wrappers (`getAvailableSlots` for GAS, `loadSlots` for SPA) are not unit-tested — they depend on their respective runtimes.

### Running Tests

```bash
npm test
```

Tests cover all pure computation and formatting functions. `jest.useFakeTimers()` is used for date-dependent logic.

## Distribution notes

The SPA uses the **`calendar.readonly`** OAuth scope, which Google classifies as a **sensitive** scope.

### Current setup: Internal user type (Workspace-only)

The OAuth app is configured as **Internal** in the Learning Tapestry Google Cloud project, meaning only `@learningtapestry.com` accounts can sign in. Internal apps in Google Workspace:

- Don't require Google verification for sensitive scopes
- Don't show the "Google hasn't verified this app" warning
- Have no user cap
- Don't enforce the 7-day refresh-token expiry that Testing-mode External apps do
- Can't be used by anyone outside the Workspace domain

This is the easiest possible deployment model, but it's a dead end for wider public use — personal Gmail accounts and other company domains get rejected at sign-in.

### If broader access is needed later

Switching the OAuth app to **External** user type unlocks non-Workspace accounts. That path adds two constraints until Google verification is completed:

- A 100-user cap with an explicit test-users allowlist (Cloud Console → Audience → Test users)
- The "Google hasn't verified this app" warning on first sign-in per account
- 7-day refresh-token expiry (users re-sign-in roughly weekly)

**Sensitive-scope verification** by Google is free but bureaucratic: consent screen with privacy policy, homepage, and terms of service URLs; a demo video; a justification letter; a ~4–8 week review cycle. Once verified, all three External-Testing constraints go away. No code changes are required — it's a Cloud Console flip.

**Google Workspace Marketplace** listing is a separate path that also requires verification plus marketplace-specific listing content. Not pursued here; the static-site + direct sign-in route delivers the same "click to use" UX without the marketplace overhead.
