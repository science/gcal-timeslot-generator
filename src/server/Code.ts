import type { SlotOptions, FormatStyle, DaySlots, CalendarInfo } from "../lib/types";
import { getAvailableSlots } from "./calendar-service";
import { formatSlots } from "../lib/formatter";

export function doGet(): GoogleAppsScript.HTML.HtmlOutput {
  return HtmlService.createHtmlOutputFromFile("index")
    .setTitle("Time Slot Generator")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

export function getCalendars(): CalendarInfo[] {
  return CalendarApp.getAllCalendars()
    .filter((cal) => !cal.isHidden())
    .map((cal) => ({
      id: cal.getId(),
      name: cal.getName(),
      primary: cal.isMyPrimaryCalendar(),
    }))
    .sort((a, b) => {
      if (a.primary !== b.primary) return a.primary ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

export function getSlots(options?: Partial<SlotOptions>): DaySlots[] {
  return getAvailableSlots(options);
}

export function getSlotsFormatted(
  style: FormatStyle,
  options?: Partial<SlotOptions>
): string {
  const slots = getAvailableSlots(options);
  return formatSlots(slots, style);
}

export function saveSettings(settings: Record<string, unknown>): void {
  PropertiesService.getUserProperties().setProperty(
    'slotGeneratorSettings',
    JSON.stringify(settings)
  );
}

export function loadSettings(): Record<string, unknown> | null {
  const raw = PropertiesService.getUserProperties().getProperty('slotGeneratorSettings');
  return raw ? JSON.parse(raw) : null;
}
