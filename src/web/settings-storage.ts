// Per-user settings persistence for the SPA. Previously handled by
// PropertiesService.getUserProperties() in the Apps Script build; the
// browser equivalent is localStorage. Same storage key as the Apps
// Script UI used for local mirroring so a user who already has the
// GAS version won't see a totally empty state on first SPA visit
// (they'll see their last-used settings from the same browser).

const STORAGE_KEY = "slotGeneratorSettings";

export type Settings = Record<string, unknown>;

export function loadSettings(): Settings | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Settings;
  } catch {
    return null;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Quota — silently drop. Settings aren't critical to app function.
  }
}

export function clearSettings(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
}
