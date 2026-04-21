# One-time setup for the SPA deploy

End-to-end instructions to get the SPA live on GitHub Pages. Most of this is click-through on Google's Cloud Console (no public API for OAuth consent screen or test users — sorry).

## 0. Prerequisites

- `gcloud` CLI authenticated: `gcloud auth login`
- `gh` CLI authenticated: `gh auth status`
- This repo cloned locally with `npm install` done

## 1. Create the Google Cloud project + enable Calendar API (automated)

```bash
./scripts/setup-gcp.sh                        # uses default project ID
./scripts/setup-gcp.sh my-existing-project    # reuse an existing project
```

Creates the project (if new), enables the Google Calendar API, and sets it as your active gcloud project. The script prints links to the next manual steps; the rest of this doc is the long version.

## 2. Configure the OAuth consent screen (Console)

Open: `https://console.cloud.google.com/apis/credentials/consent?project=PROJECT_ID`

1. **User Type**: choose **External**. Click **Create**. (Internal requires a Workspace domain and locks you to employees only — wrong for this app.)
2. On the **App information** page:
   - **App name**: `Time Slot Generator`
   - **User support email**: your email
   - App logo: optional (skip)
   - **App domain**: can leave empty in Testing status
   - **Authorized domains**: skip for now — required only when you move to Production verification
   - **Developer contact**: your email
   - Click **Save and Continue**.
3. On the **Scopes** page: click **Add or Remove Scopes**, find or paste `https://www.googleapis.com/auth/calendar.readonly` (filter by "calendar"), check it, click **Update**. This is the sole scope the app needs. Click **Save and Continue**.
4. On the **Test users** page: click **Add Users**, paste your own email, then any colleagues (up to 100 total). Click **Save and Continue**.
5. On the **Summary** page: click **Back to Dashboard**. **Publishing status** stays on **Testing**.

To add more test users later: go back to this screen → Test users section → Add Users. No CLI for this.

## 3. Create the Web Application OAuth Client ID (Console)

Open: `https://console.cloud.google.com/apis/credentials?project=PROJECT_ID`

1. Click **Create Credentials** → **OAuth client ID**.
2. **Application type**: **Web application**.
3. **Name**: `Time Slot Generator (SPA)`.
4. **Authorized JavaScript origins** — click **Add URI** for each:
   - `http://localhost:5173` (dev)
   - `https://science.github.io` (production — the origin, not the full path)
5. **Authorized redirect URIs**: leave empty. The GIS token-client flow uses the implicit in-page callback, not redirects.
6. Click **Create**. A modal pops up with your **Client ID**. Copy it.

The Client ID looks like `123456789012-abcdef...xyz.apps.googleusercontent.com`. There's no client secret to worry about — Web application clients don't have one when used in a browser.

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

Open the URL Vite prints (usually `http://localhost:5173/`). Click **Sign in with Google**. Expect:

1. Google account picker popup.
2. **"Google hasn't verified this app"** warning screen. Click **Advanced** → **Go to Time Slot Generator (unsafe)**.
3. Consent screen listing `calendar.readonly`. Click **Allow**.
4. App loads, reads calendars, generates slots.

**Gotcha: if Vite binds to a port other than 5173** (because another dev server grabbed it), OAuth will fail because the origin won't match. Either kill the other dev server or add the new port to Authorized JavaScript origins in the Cloud Console.

## 6. Enable GitHub Pages

One-time, from the repo settings page. Via the gh CLI:

```bash
gh api --method POST /repos/science/gcal-timeslot-generator/pages \
  -f "build_type=workflow" || \
gh api --method PUT /repos/science/gcal-timeslot-generator/pages \
  -f "build_type=workflow"
```

(The `|| PUT` fallback handles the case where Pages has already been enabled; the `POST` fails with 409 in that case.)

Or through the UI: **Settings → Pages → Source: GitHub Actions**.

## 7. Deploy

```bash
git push origin main:production
```

This triggers `.github/workflows/deploy-pages.yml`, which:

1. Checks out `production`
2. `npm ci`
3. `npm run build:web` with `VITE_GOOGLE_CLIENT_ID` injected from the secret
4. Uploads `dist-web/` as a Pages artifact
5. Deploys to `https://science.github.io/gcal-timeslot-generator/`

Watch the run:

```bash
gh run watch
# or
gh run list --workflow=deploy-pages.yml --limit=1
```

First deploy takes ~1–2 minutes. Subsequent deploys are fast because of npm cache.

## 8. Verify production

Open `https://science.github.io/gcal-timeslot-generator/`. Sign in with an **allowlisted test user** account. Same unverified-app warning flow as local. Should land on the app screen with calendars loaded.

If you get `access_denied`: the email isn't on the test users list. Add it in the consent screen (step 2.4 above).

---

## Ongoing: adding new users to the allowlist

1. Go to `https://console.cloud.google.com/apis/credentials/consent?project=PROJECT_ID`
2. Scroll to **Test users** → **Add Users** → paste email(s) → Save

Cap is 100. When you hit it, it's time to apply for Google's sensitive-scope verification (free, 4–8 weeks — see README's "Distribution notes" section).

## When you're ready for verification

Publishing status → **In production**. Google requires at that point:
- Homepage URL (the GitHub Pages URL is fine)
- Privacy policy URL (host a single-page notice on the same site or a separate repo)
- Terms of service URL (likewise)
- A demo video (~2 min) showing the scope being used
- A justification: why does the app need calendar.readonly?

No code changes required in this repo — it's purely Cloud Console + documentation artifacts.
