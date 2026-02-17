# Google Calendar Time Slot Generator

A Google Apps Script web app that reads your Google Calendar and generates copyable time-slot text for scheduling emails and messages. Instead of going back and forth about availability, open the app, review your free slots, and paste formatted availability into an email or chat.

## Features

- Scans your Google Calendar for the next N business days (3, 5, or 10)
- Computes free time slots within configurable working hours
- **Multi-calendar support** -- select which calendars contribute to busy-time calculation (personal + work, or switch between different people's calendars)
- **Meeting fatigue breaks** -- automatically inserts buffer time after long meeting blocks
- **Timezone display** -- format times in Pacific, Mountain, Central, or Eastern
- **Include today** -- optionally show remaining availability for the current day
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

## Quick Install (No Developer Tools Required)

This method uses only your browser. No Node.js, git, or command line needed.

### 1. Create a new Apps Script project

1. Go to [script.google.com](https://script.google.com) and sign in with your Google account
2. Click **New project**
3. Name it "Time Slot Generator" (click "Untitled project" at the top)

### 2. Add the code files

The pre-built files are in the [`release/`](release/) folder of this repository.

**Replace Code.gs:**

1. In the Apps Script editor, you'll see a file called `Code.gs` with a default `myFunction()` in it
2. Select all the text and delete it
3. Open [`release/Code.gs`](release/Code.gs) in this repository and copy its entire contents
4. Paste into the empty `Code.gs` file in the editor

**Add index.html:**

1. In the left sidebar, click the **+** button next to "Files"
2. Select **HTML**
3. Name it `index` (it will become `index.html`)
4. Delete the default HTML content
5. Open [`release/index.html`](release/index.html) in this repository and copy its entire contents
6. Paste into the empty `index.html` file

**Update appsscript.json:**

1. In the left sidebar, click the **gear icon** (Project Settings)
2. Check the box **"Show 'appsscript.json' manifest file in editor"**
3. Go back to the Editor (left sidebar, `< >` icon)
4. Click on `appsscript.json` in the file list
5. Select all and replace with:

```json
{
  "timeZone": "America/Los_Angeles",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "webapp": {
    "executeAs": "USER_DEPLOYING",
    "access": "MYSELF"
  }
}
```

### 3. Deploy as a web app

1. Click **Deploy** > **New deployment**
2. Click the **gear icon** next to "Select type" and choose **Web app**
3. Fill in:
   - **Description**: "Time Slot Generator" (or anything you like)
   - **Execute as**: "Me" (your email address)
   - **Who has access**: "Only myself"
4. Click **Deploy**
5. Click **Authorize access** when prompted
6. In the popup, select your Google account
7. If you see "Google hasn't verified this app", click **Advanced** > **Go to Time Slot Generator (unsafe)** -- this is your own script, so it's safe
8. Click **Allow** to grant calendar read access
9. Copy the **Web app URL** shown -- bookmark this link

### 4. Use it

Open the Web app URL. The app reads your Google Calendar, computes your free time slots, and lets you copy formatted availability text to your clipboard.

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
| **Break after** | Duration of the forced break (15-60 min, default 30 min) |
| **Calendars** | Select which calendars count toward "busy" time |

### Multi-Calendar

By default, only your primary calendar is checked. To merge availability across multiple calendars:

- **Personal + work**: Check both calendars. Events from all checked calendars are combined -- overlapping events merge naturally, so a meeting on your work calendar and a dentist appointment on your personal calendar both block that time.
- **Admin / assistant use**: If you have view access to other people's calendars, they'll appear in the list. Check one person's calendar at a time to generate their availability.

## Updating to a New Version

If a new version is released:

1. Open your Apps Script project at [script.google.com](https://script.google.com)
2. Replace the contents of `Code.gs` with the new [`release/Code.gs`](release/Code.gs)
3. Replace the contents of `index.html` with the new [`release/index.html`](release/index.html)
4. Click **Deploy** > **Manage deployments**
5. Click the **pencil icon** on your deployment
6. Change **Version** to "New version"
7. Click **Deploy**

---

## Developer Setup

If you want to modify the code, run tests, or set up automated deployments, use the developer workflow below.

### Prerequisites

- **Node.js** 18+ and npm
- A **Google account** with Google Calendar

### Install

```bash
git clone <your-repo-url>
cd gcal-timeslot-generator
npm install
```

### Configure clasp

```bash
cp .clasp.json.example .clasp.json
```

Edit `.clasp.json` and replace `YOUR_SCRIPT_ID_HERE` with your Script ID (found under Project Settings > IDs in the Apps Script editor):

```json
{
  "scriptId": "your-actual-script-id-here",
  "rootDir": "dist"
}
```

### Authenticate

```bash
npm run login
```

### Build, Push, and Deploy

```bash
npm run deploy
```

This compiles TypeScript, bundles with Rollup, pushes to Apps Script, creates a new version, and updates the web app deployment.

### Scripts

| Command | Description |
|---------|-------------|
| `npm test` | Run Jest unit tests (49 tests) |
| `npm run build` | Compile and bundle to `dist/` and `release/` |
| `npm run push` | Build and push to Apps Script |
| `npm run deploy` | Build, push, create version, update deployment |
| `npm run watch` | Watch mode for development |
| `npm run login` | Authenticate clasp with Google |
| `npm run open` | Open the web app in your browser |

### Project Structure

```
src/
  server/
    Code.ts             Entry point (doGet, getSlots, getCalendars)
    SlotCalculator.ts   Core availability computation
    Formatter.ts        Text formatting (bullets, compact)
  shared/
    types.ts            TypeScript interfaces
  pages/
    index.html          Web UI (HTML + CSS + JS)
tests/
  server/               Jest unit tests
scripts/
  deploy.js             Deployment automation
release/                Pre-built files for non-developer install
dist/                   Build output (pushed to Apps Script)
```

### Architecture

The app runs as a Google Apps Script web app. `Code.ts` is the entry point. The build process (Rollup) bundles all server TypeScript into a single `Code.gs` file and strips ES module syntax (Apps Script runs everything in a shared global scope). The `index.html` is served by `HtmlService`.

Pure computation functions (`mergeBusyBlocks`, `computeFreeSlots`, `applyFatigueBreaks`, `filterPastSlots`) are exported and unit-tested with Jest. The `getAvailableSlots` wrapper calls the Google Calendar API and is not unit-tested (requires the GAS runtime).

### Running Tests

```bash
npm test
```

Tests cover all pure computation and formatting functions. `jest.useFakeTimers()` is used for date-dependent logic.

---

## Distribution Options

### Current: Copy-Paste Install

The `release/` folder contains pre-built files that anyone can copy into a new Apps Script project via the browser. No developer tools required. See [Quick Install](#quick-install-no-developer-tools-required) above.

### Future: Google Workspace Marketplace

Publishing to the [Google Workspace Marketplace](https://workspace.google.com/marketplace) would allow one-click installation. However, this app requires calendar read access, which Google classifies as a **restricted OAuth scope**. Restricted scopes require:

- A Google Cloud project with OAuth consent screen
- A third-party security assessment (CASA Tier 2), which costs **$15,000 - $75,000**
- Google's app review process

This makes Marketplace publishing impractical for a free personal tool. The copy-paste install is the recommended distribution method.
