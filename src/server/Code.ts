import type { SlotOptions, FormatStyle, DaySlots } from "../shared/types";
import { getAvailableSlots } from "./SlotCalculator";
import { formatSlots } from "./Formatter";

export function doGet(): GoogleAppsScript.HTML.HtmlOutput {
  return HtmlService.createHtmlOutputFromFile("index")
    .setTitle("Time Slot Generator")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
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
