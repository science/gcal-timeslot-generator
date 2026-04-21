// Entry point for the SPA. Boots auth, wires sign-in / sign-out, and
// hands off to ui.startApp() once a valid token is in hand.

import { AuthState, initAuth, signIn, signOut } from "./auth";
import { startApp } from "./ui";

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.readonly",
];

let appStarted = false;

function setBodyAuthAttr(status: "loading" | "signed-in" | "signed-out"): void {
  document.body.dataset.auth = status;
}

function showMissingConfigError(): void {
  setBodyAuthAttr("signed-out");
  const status = document.getElementById("authStatus");
  if (status) {
    status.hidden = false;
    status.innerHTML = `<div class="error" style="text-align:left">
<strong>Configuration error:</strong> <code>VITE_GOOGLE_CLIENT_ID</code>
is not set. The app was built without an OAuth Client ID — it can't
authenticate anyone.
<br><br>
For local dev: copy <code>.env.example</code> to <code>.env.local</code>
and fill in a Client ID from
<a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">Google Cloud Console</a>.
</div>`;
  }
  const signInBtn = document.getElementById("signInBtn") as HTMLButtonElement | null;
  if (signInBtn) signInBtn.disabled = true;
}

function handleAuthRequired(): void {
  appStarted = false;
  setBodyAuthAttr("signed-out");
  showAuthStatus(
    "Your session expired. Sign in again to continue.",
    "info",
  );
}

function handleAuthChange(state: AuthState): void {
  if (state.isAuthenticated) {
    setBodyAuthAttr("signed-in");
    if (!appStarted) {
      appStarted = true;
      startApp({ onAuthRequired: handleAuthRequired });
    }
    return;
  }
  setBodyAuthAttr("signed-out");
  if (state.lastError) {
    showAuthStatus(
      `Sign-in failed: ${state.lastError} This app only accepts @learningtapestry.com Google accounts.`,
      "error",
    );
  }
}

function showAuthStatus(message: string, kind: "error" | "info"): void {
  const status = document.getElementById("authStatus");
  if (!status) return;
  status.hidden = false;
  status.innerHTML = "";
  const node = document.createElement("div");
  node.className = kind === "error" ? "error" : "info";
  node.textContent = message;
  status.appendChild(node);
}

function setVersionTag(): void {
  const tag = document.getElementById("versionTag");
  if (!tag) return;
  const hash = typeof __GIT_HASH__ !== "undefined" ? __GIT_HASH__ : "dev";
  const date = typeof __GIT_DATE__ !== "undefined" ? __GIT_DATE__ : "";
  const dateSuffix = date ? ` · ${date}` : "";
  tag.innerHTML =
    `<a href="https://github.com/science/gcal-timeslot-generator/commit/${hash}" target="_blank" rel="noopener">${hash}</a>${dateSuffix}`;
}

async function main(): Promise<void> {
  setVersionTag();

  if (!CLIENT_ID || CLIENT_ID.startsWith("YOUR_CLIENT_ID")) {
    showMissingConfigError();
    return;
  }

  const signInBtn = document.getElementById("signInBtn") as HTMLButtonElement | null;
  if (signInBtn) signInBtn.addEventListener("click", () => {
    signInBtn.disabled = true;
    try {
      signIn();
    } catch (e) {
      signInBtn.disabled = false;
      const status = document.getElementById("authStatus");
      if (status) {
        status.hidden = false;
        status.textContent = e instanceof Error ? e.message : String(e);
      }
    }
    // Re-enable so user can retry if consent popup is dismissed.
    setTimeout(() => { signInBtn.disabled = false; }, 1500);
  });

  const signOutBtn = document.getElementById("signOutBtn");
  if (signOutBtn) signOutBtn.addEventListener("click", () => {
    signOut();
    // Reload clears all in-memory state; simplest reliable reset.
    location.reload();
  });

  try {
    await initAuth({
      clientId: CLIENT_ID,
      scopes: SCOPES,
      onAuthChange: handleAuthChange,
    });
  } catch (e) {
    setBodyAuthAttr("signed-out");
    const status = document.getElementById("authStatus");
    if (status) {
      status.hidden = false;
      status.textContent = e instanceof Error ? e.message : String(e);
    }
  }
}

void main();
