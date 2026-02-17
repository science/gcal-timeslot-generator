import type { SlotOptions, FormatStyle, DaySlots, CalendarInfo } from "../shared/types";
import { getAvailableSlots } from "./SlotCalculator";
import { formatSlots } from "./Formatter";

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
