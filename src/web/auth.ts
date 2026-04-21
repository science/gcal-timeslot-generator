// Google Identity Services (GIS) OAuth wrapper for a browser SPA.
//
// Flow: initAuth() loads the GIS script and sets up a token client. The
// first call to ensureValidToken() either returns a cached token or
// triggers a silent refresh via an invisible iframe. If there's no
// usable session (first visit, or 7-day testing-mode refresh expiry),
// the caller gets null — the UI shows a "Sign in" button that calls
// signIn() to open the consent popup.
//
// Tokens are cached in localStorage. Access tokens expire in ~1 hour;
// we treat tokens within 60 seconds of expiry as already expired so a
// long-running fetch doesn't race the boundary.

const STORAGE_KEY = "auth";

export interface AuthState {
  accessToken: string | null;
  expiresAt: number | null;
  isAuthenticated: boolean;
}

export class AuthRequiredError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "AuthRequiredError";
  }
}

type AuthChangeHandler = (state: AuthState) => void;

interface CachedAuth {
  accessToken: string;
  expiresAt: number;
}

interface GisTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface GisTokenClient {
  requestAccessToken: (overrides?: { prompt?: string }) => void;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: GisTokenResponse) => void;
          }) => GisTokenClient;
          revoke: (token: string, callback: () => void) => void;
        };
      };
    };
  }
}

let tokenClient: GisTokenClient | null = null;
let currentState: AuthState = emptyState();
let onChange: AuthChangeHandler | null = null;

// Resolvers waiting on the next token callback. Multiple API calls that
// land on expired tokens around the same time share one refresh.
let pendingResolvers: Array<(token: string | null) => void> = [];
let refreshInFlight = false;

function emptyState(): AuthState {
  return { accessToken: null, expiresAt: null, isAuthenticated: false };
}

function saveState(state: AuthState): void {
  if (state.accessToken && state.expiresAt) {
    const payload: CachedAuth = { accessToken: state.accessToken, expiresAt: state.expiresAt };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Quota or disabled — fall back to in-memory only.
    }
  } else {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch { /* ignore */ }
  }
  currentState = state;
  if (onChange) onChange(state);
}

function loadCachedState(): AuthState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as CachedAuth;
    if (!parsed.accessToken || !parsed.expiresAt) return emptyState();
    // Treat tokens within 60s of expiry as already dead so a slow
    // fetch doesn't race the clock.
    if (parsed.expiresAt < Date.now() + 60_000) return emptyState();
    return { accessToken: parsed.accessToken, expiresAt: parsed.expiresAt, isAuthenticated: true };
  } catch {
    return emptyState();
  }
}

function loadGisScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) {
      resolve();
      return;
    }
    const existing = document.querySelector('script[src*="accounts.google.com/gsi/client"]');
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Failed to load GIS script")));
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load GIS script"));
    document.head.appendChild(script);
  });
}

function handleTokenResponse(response: GisTokenResponse): void {
  refreshInFlight = false;
  const resolvers = pendingResolvers;
  pendingResolvers = [];

  if (response.error || !response.access_token) {
    // Testing-mode 7-day refresh expiry and unallowlisted users land here.
    // Clear cached token so the UI can prompt for sign-in.
    saveState(emptyState());
    resolvers.forEach((r) => r(null));
    return;
  }
  const expiresIn = response.expires_in ?? 3600;
  const next: AuthState = {
    accessToken: response.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
    isAuthenticated: true,
  };
  saveState(next);
  resolvers.forEach((r) => r(next.accessToken));
}

export interface InitAuthOptions {
  clientId: string;
  scopes: string[];
  onAuthChange: AuthChangeHandler;
}

export async function initAuth(opts: InitAuthOptions): Promise<AuthState> {
  onChange = opts.onAuthChange;
  // Publish cached state immediately so the UI can decide whether to
  // show sign-in or proceed straight into the app while GIS loads.
  currentState = loadCachedState();
  opts.onAuthChange(currentState);

  await loadGisScript();
  if (!window.google?.accounts?.oauth2) {
    throw new Error("Google Identity Services unavailable");
  }
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: opts.clientId,
    scope: opts.scopes.join(" "),
    callback: handleTokenResponse,
  });
  return currentState;
}

/** Open the interactive consent popup. First sign-in goes through here. */
export function signIn(): void {
  if (!tokenClient) throw new Error("Auth not initialized");
  // Explicitly request a full consent flow. GIS defaults to consent if
  // no session exists, but an explicit prompt makes the trigger clear.
  tokenClient.requestAccessToken({ prompt: "consent" });
}

/**
 * Attempt a silent refresh. If there's no usable session, GIS fires the
 * callback with an error rather than opening a popup. Safe to call as
 * part of a regular request flow.
 */
function requestSilentRefresh(): Promise<string | null> {
  return new Promise((resolve) => {
    if (!tokenClient) {
      resolve(null);
      return;
    }
    pendingResolvers.push(resolve);
    if (refreshInFlight) return;
    refreshInFlight = true;
    tokenClient.requestAccessToken({ prompt: "" });
  });
}

/**
 * Return a valid access token or null. Callers who get null should
 * present the sign-in UI. Expired cached tokens are automatically
 * refreshed via the GIS silent flow.
 */
export async function ensureValidToken(): Promise<string | null> {
  const cachedValid = currentState.accessToken
    && currentState.expiresAt
    && currentState.expiresAt >= Date.now() + 60_000;
  if (cachedValid) return currentState.accessToken;
  return requestSilentRefresh();
}

/** Force a fresh token, even if the current one is still valid. */
export async function forceRefresh(): Promise<string | null> {
  return requestSilentRefresh();
}

export function signOut(): void {
  const token = currentState.accessToken;
  if (token && window.google?.accounts.oauth2) {
    window.google.accounts.oauth2.revoke(token, () => {});
  }
  saveState(emptyState());
}

export function getState(): AuthState {
  return currentState;
}
