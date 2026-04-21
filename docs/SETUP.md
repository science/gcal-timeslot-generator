# One-time setup for the SPA deploy

End-to-end instructions to set this up from scratch. Most of this is click-through on Google's Cloud Console (no public API for OAuth consent screen — sorry). Google recently revamped this UI as "Google Auth Platform"; URLs below use the current paths.

The instructions assume you want the same configuration as the live deployment: **Internal** user type (Workspace-only, no verification needed). For the External path, see the "Opening to non-Workspace users" section at the end.

## 0. Prerequisites

- A Google Cloud project (create one at [console.cloud.google.com](https://console.cloud.google.com/)) — ideally inside a Google Workspace organization, which is what makes the Internal path available.
- `gh` CLI authenticated: `gh auth status`
- This repo cloned locally with `npm install` done

Optional: `gcloud` CLI for the automated step. Not required if you do everything through the UI.

## 1. Enable the Google Calendar API

Open: `https://console.cloud.google.com/apis/library/calendar-json.googleapis.com?project=PROJECT_ID`

Click **Enable**. Wait ~10 seconds.

Or with `gcloud`:
```bash
./scripts/setup-gcp.sh PROJECT_ID     # enables the API + sets as active project
```

## 2. Configure the OAuth consent screen (Console)

Open: `https://console.cloud.google.com/auth/overview?project=PROJECT_ID`

1. **Get started** (if prompted):
   - **App name**: `Time Slot Generator`
   - **User support email**: your email
   - **Audience / User type**: **Internal** (requires your project to belong to a Workspace organization)
   - **Developer contact information**: your email
   - Accept the User Data Policy, click **Create**.
2. Navigate to **Data Access** in the left nav:
   - Click **Add or Remove Scopes**
   - Filter for `calendar.readonly`
   - Check the row for `.../auth/calendar.readonly` (confirm it's the read-only one, not full `calendar`)
   - Click **Update**, then **Save**

That's it for Internal apps. There's no Test users section — every account in the Workspace is automatically allowed.

## 3. Create the Web Application OAuth Client ID (Console)

Open: `https://console.cloud.google.com/auth/clients?project=PROJECT_ID`

1. Click **+ Create Client**.
2. **Application type**: **Web application**.
3. **Name**: `Time Slot Generator (SPA)`.
4. **Authorized JavaScript origins** — click **Add URI** for each:
   - `http://localhost:5173` (dev)
   - `https://science.github.io` (production — the origin only, not the full path)
5. **Authorized redirect URIs**: leave empty. The GIS token-client flow uses the implicit in-page callback, not redirects.
6. Click **Create**. A modal pops up with your **Client ID**. Copy it.

The Client ID looks like `123456789012-abcdef...xyz.apps.googleusercontent.com`. There's also a client secret shown — ignore it. Web application clients used from a browser don't use the secret. Google generates one anyway for API parity.

## 4. Set the Client ID locally + in GitHub (CLI)

```bash
# Local dev
echo 'VITE_GOOGLE_CLIENT_ID=PASTE_YOUR_CLIENT_ID_HERE' > .env.local

# GitHub Actions secret (for the Pages deploy)
gh secret set VITE_GOOGLE_CLIENT_ID --body 'PASTE_YOUR_CLIENT_ID_HERE'

# Verify it landed
gh secret list | grep VITE_GOOGLE_CLIENT_ID
```

`.env.local` is gitignored. The GitHub secret is injected at build time by the workflow.

## 5. Test locally

```bash
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173/gcal-timeslot-generator/`). Click **Sign in with Google**. Expect:

1. Google account picker popup.
2. Consent screen listing `calendar.readonly`. Click **Allow**.
3. App loads, reads calendars, generates slots.

No "unverified app" warning — that screen only shows for External-Testing apps.

**Gotcha: if Vite binds to a port other than 5173** (because another dev server grabbed it), OAuth will fail because the origin won't match. Either kill the other dev server or add the new port to Authorized JavaScript origins in the Cloud Console.

**Gotcha: if you get `access_denied`**, you're probably signed in with a non-Workspace account. Use your organization account (e.g. `@learningtapestry.com`).

## 6. Enable GitHub Pages

One-time. Via the gh CLI:

```bash
gh api --method POST /repos/science/gcal-timeslot-generator/pages \
  -f "build_type=workflow" || \
gh api --method PUT /repos/science/gcal-timeslot-generator/pages \
  -f "build_type=workflow"
```

(The `|| PUT` fallback handles the case where Pages is already enabled; the `POST` fails with 409 in that case.)

Or through the UI: **Settings → Pages → Source: GitHub Actions**.

## 7. Allow the `production` branch to deploy to Pages

When you enable Pages with the workflow source, GitHub auto-creates a `github-pages` environment that only allows deploys from the default branch (`main`). We deploy from `production`, so we need to add that branch to the policy:

```bash
gh api --method POST \
  /repos/science/gcal-timeslot-generator/environments/github-pages/deployment-branch-policies \
  -f "name=production" -f "type=branch"
```

If you skip this step, your first deploy run will fail immediately in the `deploy` job with zero steps executed (the environment gate rejects it).

## 8. Deploy

```bash
git push origin main:production
```

This triggers `.github/workflows/deploy-pages.yml`. If this is the *very first* time the `production` branch is created, GitHub sometimes doesn't fire the workflow automatically — manually dispatch it:

```bash
gh workflow run deploy-pages.yml --ref production
```

Subsequent pushes to `production` trigger the workflow as expected.

Watch the run:

```bash
gh run watch
# or
gh run list --workflow=deploy-pages.yml --limit=1
```

First deploy takes ~25 seconds. Subsequent deploys are similar with the npm cache warm.

## 9. Verify production

Open `https://science.github.io/gcal-timeslot-generator/`. Sign in with a Workspace account. No warnings; app should load calendars immediately.

---

## Opening to non-Workspace users (External path)

If you later want to open this to personal Gmail accounts or other companies, you'll switch the OAuth app to **External** user type. This introduces:

- A 100-user cap with an explicit allowlist (until you complete Google verification)
- The "Google hasn't verified this app" warning on first sign-in per account
- 7-day refresh-token expiry (users re-sign-in roughly weekly)

To switch:

1. Go to the Audience page: `https://console.cloud.google.com/auth/audience?project=PROJECT_ID`
2. Click **Make external**.
3. Add test users: **Audience** → **Test users** section → **+ Add users** → paste emails → Save. Max 100.

To remove all three constraints, apply for Google's sensitive-scope verification (free but bureaucratic, ~4–8 weeks). Requirements:

- Homepage URL (the GitHub Pages URL is fine)
- Privacy policy URL (host a one-page notice)
- Terms of service URL
- Demo video (~2 min) showing the `calendar.readonly` scope being used
- Justification letter

No code changes required in this repo for either switch — it's all Cloud Console state.
