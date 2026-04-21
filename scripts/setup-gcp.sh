#!/usr/bin/env bash
#
# Partial Google Cloud setup for the SPA build. Handles the two steps
# Google exposes via API — project creation and Calendar API enablement.
# Everything else (OAuth consent screen, Web-app OAuth client, test
# users) has to be done through the Cloud Console. See docs/SETUP.md
# for the click-by-click instructions and this script's follow-up steps.
#
# Usage:
#   ./scripts/setup-gcp.sh [PROJECT_ID]
#
# Defaults to PROJECT_ID=gcal-timeslot-generator. Pass your existing
# project ID as the argument to reuse it — recommended if you already
# have a Cloud project for other apps.

set -euo pipefail

PROJECT_ID="${1:-gcal-timeslot-generator}"

if ! command -v gcloud >/dev/null 2>&1; then
  echo "ERROR: gcloud CLI not found." >&2
  echo "Install: https://cloud.google.com/sdk/docs/install" >&2
  exit 1
fi

ACCOUNT="$(gcloud config get-value account 2>/dev/null || true)"
if [[ -z "$ACCOUNT" ]]; then
  echo "ERROR: gcloud not authenticated. Run: gcloud auth login" >&2
  exit 1
fi
echo "==> Authenticated as $ACCOUNT"

echo "==> Checking project '$PROJECT_ID'..."
if gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1; then
  echo "    Project already exists — reusing it"
else
  echo "    Creating project '$PROJECT_ID'"
  gcloud projects create "$PROJECT_ID" --name="Time Slot Generator"
fi

echo "==> Enabling Google Calendar API..."
gcloud services enable calendar-json.googleapis.com --project="$PROJECT_ID"

echo "==> Setting '$PROJECT_ID' as active project..."
gcloud config set project "$PROJECT_ID" >/dev/null

cat <<EOF

==> gcloud portion done. Remaining steps (Cloud Console, no API for these):

  1. Configure OAuth consent screen:
     https://console.cloud.google.com/apis/credentials/consent?project=$PROJECT_ID

     - User Type: External
     - Publishing status: stays on "Testing"
     - App name: Time Slot Generator
     - User support email: your email
     - Developer contact: your email
     - Scopes: add https://www.googleapis.com/auth/calendar.readonly
     - Test users: add your own email + any colleagues who should have access

  2. Create OAuth 2.0 Client ID:
     https://console.cloud.google.com/apis/credentials?project=$PROJECT_ID
     → Create Credentials → OAuth client ID

     - Application type: Web application
     - Name: Time Slot Generator (SPA)
     - Authorized JavaScript origins:
         http://localhost:5173
         https://science.github.io
     - Authorized redirect URIs: (leave empty — not used by GIS token flow)

  3. Copy the Client ID string (looks like NNNN.apps.googleusercontent.com).
     Set it in two places:

       echo 'VITE_GOOGLE_CLIENT_ID=NNNN.apps.googleusercontent.com' > .env.local
       gh secret set VITE_GOOGLE_CLIENT_ID --body 'NNNN.apps.googleusercontent.com'

  4. Verify local dev: npm run dev, open http://localhost:5173, click Sign in.

  5. Deploy: git push origin main:production

See docs/SETUP.md for full details including screenshots and gotchas.
EOF
