// Main UI logic: ported from src/pages/index.html's inline script but
// swapped to call the SPA's local pipeline (calendar-api + computeDaySlots)
// instead of google.script.run. Structure is kept close to the original for
// easy diffing against the GAS UI.

import type { CalendarInfo, DaySlots, SlotOptions, TimeSlot } from "../lib/types";
import {
  computeDaySlots,
  computeFetchRange,
  getDefaultSlotOptions,
} from "../lib/slot-calculator";
import {
  getPrimaryCalendarId,
  listCalendars,
  listEventsByCalendar,
} from "./calendar-api";
import { AuthRequiredError } from "./auth";
import { loadSettings, saveSettings } from "./settings-storage";

const TZ_LABELS: Record<string, string> = {
  "America/Los_Angeles": "Pacific",
  "America/Denver": "Mountain",
  "America/Chicago": "Central",
  "America/New_York": "Eastern",
};

interface UiSettings {
  [key: string]: unknown;
  numDays?: string;
  timezone?: string;
  formatStyle?: string;
  includeToday?: boolean;
  startHour?: string;
  endHour?: string;
  maxBlock?: string;
  breakAfter?: string;
  minGap?: string;
  calendarMode?: string;
  roundTo?: string;
  calendarIds?: string[];
}

interface UiCallbacks {
  onAuthRequired: () => void;
}

// Module-level state shared across event handlers.
let allSlots: DaySlots[] = [];
let calendarData: CalendarInfo[] = [];
let savedCalendarIds: string[] | null = null;
let lastLoadDate = new Date().toDateString();
let callbacks: UiCallbacks = { onAuthRequired: () => {} };

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

function getSelectValue(id: string): string {
  return el<HTMLSelectElement>(id).value;
}

function getCheckboxValue(id: string): boolean {
  return el<HTMLInputElement>(id).checked;
}

function getSlotOptionsFromUi(): Partial<SlotOptions> {
  return {
    numDays: parseInt(getSelectValue("numDays"), 10),
    startHour: parseInt(getSelectValue("startHour"), 10),
    endHour: parseInt(getSelectValue("endHour"), 10),
    includeToday: getCheckboxValue("includeToday"),
    maxContinuousMinutes: parseInt(getSelectValue("maxBlock"), 10),
    minBreakMinutes: parseInt(getSelectValue("breakAfter"), 10),
    minGapMinutes: parseInt(getSelectValue("minGap"), 10),
    calendarIds: getSelectedCalendarIds(),
    calendarMode: getSelectValue("calendarMode") as "mine" | "group",
    roundMinutes: parseInt(getSelectValue("roundTo"), 10),
  };
}

function getCurrentSettings(): UiSettings {
  return {
    numDays: getSelectValue("numDays"),
    timezone: getSelectValue("timezone"),
    formatStyle: getSelectValue("formatStyle"),
    includeToday: getCheckboxValue("includeToday"),
    startHour: getSelectValue("startHour"),
    endHour: getSelectValue("endHour"),
    maxBlock: getSelectValue("maxBlock"),
    breakAfter: getSelectValue("breakAfter"),
    minGap: getSelectValue("minGap"),
    calendarMode: getSelectValue("calendarMode"),
    roundTo: getSelectValue("roundTo"),
    calendarIds: getSelectedCalendarIds(),
  };
}

function applySettings(settings: UiSettings | null): void {
  if (!settings) return;
  const selects = [
    "numDays", "timezone", "formatStyle", "startHour", "endHour",
    "maxBlock", "breakAfter", "minGap", "calendarMode", "roundTo",
  ] as const;
  for (const id of selects) {
    const value = settings[id];
    if (value === undefined) continue;
    const select = el<HTMLSelectElement>(id);
    const option = select.querySelector(`option[value="${value}"]`);
    if (option) select.value = String(value);
  }
  if (settings.includeToday !== undefined) {
    el<HTMLInputElement>("includeToday").checked = !!settings.includeToday;
  }
  if (settings.calendarIds) {
    savedCalendarIds = settings.calendarIds;
  }
}

function applyCalendarSelection(ids: string[]): boolean {
  if (!ids || ids.length === 0) return false;
  const checkboxes = document.querySelectorAll<HTMLInputElement>(
    '#calendarList input[type="checkbox"]',
  );
  if (checkboxes.length === 0) return false;
  let changed = false;
  checkboxes.forEach((cb) => {
    const shouldCheck = ids.indexOf(cb.dataset.calId ?? "") !== -1;
    if (cb.checked !== shouldCheck) changed = true;
    cb.checked = shouldCheck;
  });
  return changed;
}

function persistSettings(): void {
  saveSettings(getCurrentSettings());
}

function getSelectedCalendarIds(): string[] {
  const checkboxes = document.querySelectorAll<HTMLInputElement>(
    '#calendarList input[type="checkbox"]',
  );
  const ids: string[] = [];
  checkboxes.forEach((cb) => {
    if (cb.checked && cb.dataset.calId) ids.push(cb.dataset.calId);
  });
  return ids;
}

async function loadCalendars(): Promise<void> {
  try {
    const cals = await listCalendars();
    onCalendarsLoaded(cals);
  } catch (e) {
    if (e instanceof AuthRequiredError) {
      callbacks.onAuthRequired();
      return;
    }
    el("calendarList").textContent = "Could not load calendars.";
  }
}

function onCalendarsLoaded(calendars: CalendarInfo[]): void {
  calendarData = calendars;
  const container = el("calendarList");
  if (calendars.length === 0) {
    container.textContent = "No calendars found.";
    return;
  }
  const html = calendars
    .map((cal) => {
      const checked = cal.primary ? " checked" : "";
      const cls = cal.primary ? " cal-primary" : "";
      return `<label class="cal-label${cls}">
<input type="checkbox" data-cal-id="${escapeAttr(cal.id)}"${checked}>
${escapeHtml(cal.name)}
</label>`;
    })
    .join("");
  container.innerHTML = html;
  // Wire change handlers
  container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    .forEach((cb) => {
      cb.addEventListener("change", () => {
        persistSettings();
        void loadSlots();
      });
    });
  // Apply saved selection; if it differs from defaults, reload.
  if (savedCalendarIds && applyCalendarSelection(savedCalendarIds)) {
    void loadSlots();
  }
}

async function loadSlots(): Promise<void> {
  lastLoadDate = new Date().toDateString();
  el("content").innerHTML =
    '<div class="loading"><div class="spinner"></div><div>Loading your availability&hellip;</div></div>';
  el<HTMLTextAreaElement>("preview").value = "Loading…";
  el<HTMLButtonElement>("copyBtn").disabled = true;

  try {
    const uiOpts = getSlotOptionsFromUi();
    const merged: SlotOptions = { ...getDefaultSlotOptions(), ...uiOpts };
    const { businessDays, rangeStart, rangeEnd } = computeFetchRange(merged);
    if (businessDays.length === 0) {
      onSlotsLoaded([]);
      return;
    }
    let calendarIds = merged.calendarIds ?? [];
    if (calendarIds.length === 0) {
      calendarIds = [await getPrimaryCalendarId()];
    }
    const eventsByCalendar = await listEventsByCalendar(calendarIds, rangeStart, rangeEnd);
    const days = computeDaySlots(eventsByCalendar, businessDays, merged);
    onSlotsLoaded(days);
  } catch (e) {
    if (e instanceof AuthRequiredError) {
      callbacks.onAuthRequired();
      return;
    }
    onError(e instanceof Error ? e : new Error(String(e)));
  }
}

function onSlotsLoaded(days: DaySlots[]): void {
  allSlots = days;
  renderSlots();
}

function onError(err: Error): void {
  el("content").innerHTML =
    `<div class="error">Error loading calendar: ${escapeHtml(err.message)}</div>`;
  el<HTMLTextAreaElement>("preview").value = "Error";
}

function renderSlots(): void {
  const container = el("content");

  if (allSlots.length === 0) {
    container.innerHTML =
      '<div class="empty-state">No availability found. Your calendar is fully booked!</div>';
    updatePreview();
    return;
  }

  const html = allSlots
    .map((day, d) => {
      const slotHtml = day.slots
        .map((slot, s) =>
          `<div class="slot-item">
<input type="checkbox" checked data-day="${d}" data-slot="${s}">
<span class="slot-time">${fmtTime(slot.start)} – ${fmtTime(slot.end)}${fmtDurationSuffix(slot)}</span>
</div>`,
        )
        .join("");
      return `<div class="day-group">
<div class="day-header">
<input type="checkbox" checked data-day="${d}">
<span>${escapeHtml(day.dayLabel)}</span>
</div>
<div class="slots-wrap">${slotHtml}</div>
</div>`;
    })
    .join("");

  container.innerHTML = html;
  // Wire day-header checkboxes
  container.querySelectorAll<HTMLInputElement>('.day-header input[type="checkbox"]')
    .forEach((cb) => {
      cb.addEventListener("change", () => {
        const dayIndex = parseInt(cb.dataset.day ?? "-1", 10);
        toggleDay(dayIndex);
      });
    });
  // Wire slot checkboxes
  container.querySelectorAll<HTMLInputElement>('.slot-item input[type="checkbox"]')
    .forEach((cb) => {
      cb.addEventListener("change", updatePreview);
    });

  el<HTMLButtonElement>("copyBtn").disabled = false;
  updatePreview();
}

function toggleDay(dayIndex: number): void {
  const dayCheckbox = document.querySelector<HTMLInputElement>(
    `.day-header input[data-day="${dayIndex}"]`,
  );
  if (!dayCheckbox) return;
  document.querySelectorAll<HTMLInputElement>(
    `.slot-item input[data-day="${dayIndex}"]`,
  ).forEach((cb) => {
    cb.checked = dayCheckbox.checked;
  });
  updatePreview();
}

function getSelectedSlots(): DaySlots[] {
  const selected: DaySlots[] = [];
  for (let d = 0; d < allSlots.length; d++) {
    const daySlots: TimeSlot[] = [];
    for (let s = 0; s < allSlots[d].slots.length; s++) {
      const cb = document.querySelector<HTMLInputElement>(
        `.slot-item input[data-day="${d}"][data-slot="${s}"]`,
      );
      if (cb && cb.checked) daySlots.push(allSlots[d].slots[s]);
    }
    if (daySlots.length > 0) {
      selected.push({
        date: allSlots[d].date,
        dayLabel: allSlots[d].dayLabel,
        slots: daySlots,
      });
    }
  }
  return selected;
}

function updatePreview(): void {
  const selected = getSelectedSlots();
  const style = getSelectValue("formatStyle");
  const text = formatLocal(selected, style);
  el<HTMLTextAreaElement>("preview").value = text;
  el<HTMLButtonElement>("copyBtn").disabled = selected.length === 0;
}

function getTzLabel(): string {
  const tz = getSelectValue("timezone");
  return TZ_LABELS[tz] || tz;
}

function formatLocal(days: DaySlots[], style: string): string {
  if (days.length === 0) return "No slots selected.";
  if (style === "compact") return formatCompact(days);
  return formatBullets(days);
}

function formatBullets(days: DaySlots[]): string {
  const lines: string[] = [`I'm available at the following times (${getTzLabel()}):`, ""];
  days.forEach((day, d) => {
    lines.push(`${day.dayLabel}:`);
    for (const slot of day.slots) {
      lines.push(`  - ${fmtTime(slot.start)} - ${fmtTime(slot.end)}${fmtDurationSuffix(slot)}`);
    }
    if (d < days.length - 1) lines.push("");
  });
  return lines.join("\n");
}

function formatCompact(days: DaySlots[]): string {
  const lines: string[] = [`Available (${getTzLabel()}):`];
  for (const day of days) {
    const parts = day.slots.map(
      (s) => `${fmtTime(s.start)}-${fmtTime(s.end)}${fmtDurationSuffix(s)}`,
    );
    lines.push(`${day.dayLabel}: ${parts.join(", ")}`);
  }
  return lines.join("\n");
}

function fmtDurationSuffix(slot: TimeSlot): string {
  if (slot.maxMinutes === undefined || slot.maxMinutes === null) return "";
  if (slot.maxMinutes >= 60 && slot.maxMinutes % 60 === 0) {
    return ` (max ${slot.maxMinutes / 60}h)`;
  }
  return ` (max ${slot.maxMinutes} min)`;
}

function fmtTime(iso: string): string {
  const tz = getSelectValue("timezone");
  const date = new Date(iso);
  const str = date.toLocaleTimeString("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const parts = str.match(/^(\d+):(\d+)\s*(AM|PM)$/i);
  if (!parts) return str;
  const h = parts[1];
  const m = parts[2];
  const ap = parts[3].toLowerCase();
  return m === "00" ? `${h}${ap}` : `${h}:${m}${ap}`;
}

function copyToClipboard(): void {
  const text = el<HTMLTextAreaElement>("preview").value;
  const btn = el<HTMLButtonElement>("copyBtn");

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard
      .writeText(text)
      .then(() => showCopied(btn))
      .catch(() => fallbackCopy(text, btn));
  } else {
    fallbackCopy(text, btn);
  }
}

function fallbackCopy(text: string, btn: HTMLButtonElement): void {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
    showCopied(btn);
  } catch {
    btn.textContent = "Copy failed";
  }
  document.body.removeChild(ta);
}

function showCopied(btn: HTMLButtonElement): void {
  btn.textContent = "Copied!";
  btn.classList.add("copied");
  setTimeout(() => {
    btn.textContent = "Copy to Clipboard";
    btn.classList.remove("copied");
  }, 2000);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(str: string): string {
  return escapeHtml(str);
}

function wireControls(): void {
  // Display-only settings: persist + re-render preview (no server call)
  ["formatStyle", "timezone"].forEach((id) => {
    el(id).addEventListener("change", () => {
      persistSettings();
      renderSlots();
    });
  });

  // Server-affecting settings: persist + reload slots
  [
    "numDays", "includeToday", "startHour", "endHour",
    "maxBlock", "breakAfter", "minGap", "calendarMode", "roundTo",
  ].forEach((id) => {
    el(id).addEventListener("change", () => {
      persistSettings();
      void loadSlots();
    });
  });

  el("refreshBtn").addEventListener("click", () => void loadSlots());
  el("copyBtn").addEventListener("click", copyToClipboard);

  // Reload when tab becomes visible on a new day
  document.addEventListener("visibilitychange", () => {
    if (
      document.visibilityState === "visible"
      && new Date().toDateString() !== lastLoadDate
    ) {
      void loadCalendars();
      void loadSlots();
    }
  });
}

/**
 * Entry point called by main.ts after authentication succeeds. Hydrates
 * saved settings, wires event handlers, and kicks off the first fetch.
 * Safe to call multiple times — re-entry just re-runs the initial load.
 */
export function startApp(cbs: UiCallbacks): void {
  callbacks = cbs;
  // Hydrate saved settings from localStorage before first load so the
  // fetch uses the user's last-chosen filters.
  applySettings(loadSettings());
  wireControls();
  void loadCalendars();
  void loadSlots();
}
