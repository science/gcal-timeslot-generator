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

## Prerequisites

- **Node.js** 18+ and npm
- A **Google account** with Google Calendar
- Access to [Google Apps Script](https://script.google.com) (included with Google Workspace and free Gmail accounts)

## Installation

### 1. Clone and install dependencies

```bash
git clone <your-repo-url>
cd gcal-timeslot-generator
npm install
```

### 2. Create a Google Apps Script project

1. Go to [script.google.com](https://script.google.com)
2. Click **New project**
3. Give it a name (e.g., "Time Slot Generator")
4. Click the **gear icon** (Project Settings) in the left sidebar
5. Copy the **Script ID** shown under "IDs"

### 3. Configure clasp

```bash
cp .clasp.json.example .clasp.json
```

Open `.clasp.json` and replace `YOUR_SCRIPT_ID_HERE` with the Script ID you copied:

```json
{
  "scriptId": "your-actual-script-id-here",
  "rootDir": "dist"
}
```

### 4. Authenticate with Google

```bash
npm run login
```

This opens a browser window. Sign in with the same Google account that owns the Apps Script project and grant clasp permission to manage your scripts.

### 5. Build and push

```bash
npm run push
```

This compiles TypeScript, bundles everything with Rollup, and pushes the built files (`Code.gs`, `index.html`, `appsscript.json`) to your Apps Script project.

### 6. Create the initial web app deployment

1. Go back to [script.google.com](https://script.google.com) and open your project
2. Click **Deploy** > **New deployment**
3. Click the gear icon next to "Select type" and choose **Web app**
4. Set **Execute as**: "Me" (your account)
5. Set **Who has access**: "Only myself" (recommended) or "Anyone with Google account"
6. Click **Deploy**
7. **Authorize** the app when prompted -- it needs permission to read your calendar
8. Copy the **Web app URL** -- this is your app's permanent link

### 7. Open and use

Open the web app URL in your browser. You should see your available time slots.

## Updating

After making code changes, deploy the update:

```bash
npm run deploy
```

This builds, pushes, creates a new version, and updates your existing deployment in one command. No need to touch the Apps Script IDE.

## Usage

### Main Controls

| Control | Description |
|---------|-------------|
| **Days** | Number of business days to scan (3, 5, or 10) |
| **Timezone** | Display timezone for formatted times |
| **Format** | Bullets (multi-line with headers) or Compact (one line per day) |
| **Include today** | Show remaining free slots for today |

### Advanced Settings

Click "Advanced settings" to expand:

| Control | Description |
|---------|-------------|
| **Start / End hour** | Working hours window (default 9am-5pm) |
| **Max meeting block** | Longest meeting block before a forced break (default 2h, or Off) |
| **Break after** | Duration of the forced break (15-60 min, default 30) |
| **Calendars** | Select which calendars count as "busy" time |

### Calendar Selection

By default, only your primary calendar is checked. To merge availability across multiple calendars (e.g., personal + work), check additional calendars in the Advanced Settings. Events from all checked calendars are combined when computing free slots -- overlapping events from different calendars merge naturally.

## Development

### Scripts

| Command | Description |
|---------|-------------|
| `npm test` | Run Jest unit tests |
| `npm run build` | Compile and bundle to `dist/` |
| `npm run push` | Build and push to Apps Script |
| `npm run deploy` | Build, push, version, and update deployment |
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
dist/                   Build output (pushed to Apps Script)
```

### Architecture

The app runs as a Google Apps Script web app. `Code.ts` is the entry point that Apps Script calls. The build process (Rollup) bundles all server-side TypeScript into a single `Code.gs` file and strips ES module syntax (Apps Script runs everything in a shared global scope). The `index.html` file is served as-is by `HtmlService`.

Pure computation functions (`mergeBusyBlocks`, `computeFreeSlots`, `applyFatigueBreaks`, `filterPastSlots`) are exported and tested independently with Jest. The `getAvailableSlots` wrapper handles the Google Calendar API calls and is not unit-tested (it depends on the GAS runtime).

### Running Tests

```bash
npm test
```

Tests use `jest` + `ts-jest` and cover all pure computation and formatting functions. Fake timers (`jest.useFakeTimers`) are used to test date-dependent logic.
