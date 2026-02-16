import type { DaySlots, FormatStyle } from "../shared/types";

export function formatTime(isoString: string): string {
  const date = new Date(isoString);
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? "pm" : "am";
  hours = hours % 12 || 12;
  const minuteStr = minutes === 0 ? "" : `:${String(minutes).padStart(2, "0")}`;
  return `${hours}${minuteStr}${ampm}`;
}

export function formatSlotsBullets(days: DaySlots[]): string {
  if (days.length === 0) return "No availability found for the selected period.";

  const lines: string[] = ["I'm available at the following times (Pacific):", ""];
  for (const day of days) {
    lines.push(`${day.dayLabel}:`);
    for (const slot of day.slots) {
      lines.push(`  - ${formatTime(slot.start)} - ${formatTime(slot.end)}`);
    }
    lines.push("");
  }
  // Remove trailing blank line
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

export function formatSlotsCompact(days: DaySlots[]): string {
  if (days.length === 0) return "No availability found for the selected period.";

  const lines: string[] = ["Available (Pacific):"];
  for (const day of days) {
    const slotStrs = day.slots.map((s) => `${formatTime(s.start)}-${formatTime(s.end)}`);
    lines.push(`${day.dayLabel}: ${slotStrs.join(", ")}`);
  }
  return lines.join("\n");
}

export function formatSlots(days: DaySlots[], style: FormatStyle): string {
  if (style === "compact") return formatSlotsCompact(days);
  return formatSlotsBullets(days);
}
