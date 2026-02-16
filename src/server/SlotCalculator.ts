import type { TimeSlot, DaySlots, SlotOptions, BusyBlock } from "../shared/types";

export function getDefaultSlotOptions(): SlotOptions {
  return {
    numDays: 5,
    startHour: 9,
    endHour: 17,
    minMinutes: 30,
    includeToday: false,
    maxContinuousMinutes: 120,
    minBreakMinutes: 30,
  };
}

export function getNextBusinessDays(numDays: number, includeToday: boolean, endHour: number): Date[] {
  const days: Date[] = [];
  const now = new Date();
  const current = new Date();
  current.setHours(0, 0, 0, 0);

  if (includeToday) {
    // Include today only if it's a weekday and before endHour
    const dow = current.getDay();
    if (dow !== 0 && dow !== 6 && now.getHours() < endHour) {
      days.push(new Date(current));
    }
    current.setDate(current.getDate() + 1);
  } else {
    // Start from tomorrow (or next day if past endHour — legacy skip-today behavior)
    if (now.getHours() >= endHour) {
      current.setDate(current.getDate() + 1);
    }
    current.setDate(current.getDate() + 1);
  }

  while (days.length < numDays) {
    const dow = current.getDay();
    if (dow !== 0 && dow !== 6) {
      days.push(new Date(current));
    }
    current.setDate(current.getDate() + 1);
  }
  return days;
}

export function formatDayLabel(date: Date): string {
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${dayNames[date.getDay()]}, ${monthNames[date.getMonth()]} ${date.getDate()}`;
}

export function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isDeclined(event: GoogleAppsScript.Calendar.CalendarEvent): boolean {
  const status = event.getMyStatus();
  return status === CalendarApp.GuestStatus.NO;
}

function isTransparentAllDay(event: GoogleAppsScript.Calendar.CalendarEvent): boolean {
  if (!event.isAllDayEvent()) return false;
  const title = event.getTitle().toLowerCase();
  if (title.includes("holiday") && event.getGuestList().length === 0) return true;
  return false;
}

export function mergeBusyBlocks(blocks: BusyBlock[]): BusyBlock[] {
  if (blocks.length === 0) return [];
  const sorted = blocks.slice().sort((a, b) => a.start - b.start);
  const merged: BusyBlock[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i].start <= last.end) {
      last.end = Math.max(last.end, sorted[i].end);
    } else {
      merged.push({ ...sorted[i] });
    }
  }
  return merged;
}

export function computeFreeSlots(
  mergedBlocks: BusyBlock[],
  dayStartMs: number,
  dayEndMs: number,
  minMinutes: number
): TimeSlot[] {
  const slots: TimeSlot[] = [];
  let cursor = dayStartMs;

  for (const block of mergedBlocks) {
    if (block.start > cursor) {
      const gapMinutes = (block.start - cursor) / 60000;
      if (gapMinutes >= minMinutes) {
        slots.push({
          start: new Date(cursor).toISOString(),
          end: new Date(block.start).toISOString(),
        });
      }
    }
    cursor = Math.max(cursor, block.end);
  }

  // Trailing free time after last block
  if (cursor < dayEndMs) {
    const gapMinutes = (dayEndMs - cursor) / 60000;
    if (gapMinutes >= minMinutes) {
      slots.push({
        start: new Date(cursor).toISOString(),
        end: new Date(dayEndMs).toISOString(),
      });
    }
  }

  return slots;
}

export function filterPastSlots(slots: TimeSlot[], nowMs: number): TimeSlot[] {
  const result: TimeSlot[] = [];
  for (const slot of slots) {
    const startMs = new Date(slot.start).getTime();
    const endMs = new Date(slot.end).getTime();
    if (endMs <= nowMs) continue; // entirely in the past
    if (startMs < nowMs) {
      // Truncate: start becomes now
      result.push({ start: new Date(nowMs).toISOString(), end: slot.end });
    } else {
      result.push(slot);
    }
  }
  return result;
}

export function applyFatigueBreaks(
  blocks: BusyBlock[],
  maxContinuousMinutes: number,
  minBreakMinutes: number,
  dayEndMs: number
): BusyBlock[] {
  if (maxContinuousMinutes <= 0) return blocks;

  const extended: BusyBlock[] = blocks.map((b) => {
    const durationMin = (b.end - b.start) / 60000;
    if (durationMin >= maxContinuousMinutes) {
      return { start: b.start, end: Math.min(b.end + minBreakMinutes * 60000, dayEndMs) };
    }
    return { ...b };
  });

  return mergeBusyBlocks(extended);
}

export function getAvailableSlots(options?: Partial<SlotOptions>): DaySlots[] {
  const opts = { ...getDefaultSlotOptions(), ...options };
  const calendar = CalendarApp.getDefaultCalendar();
  const businessDays = getNextBusinessDays(opts.numDays, opts.includeToday, opts.endHour);
  const result: DaySlots[] = [];

  for (const day of businessDays) {
    const dayStart = new Date(day);
    dayStart.setHours(opts.startHour, 0, 0, 0);
    const dayEnd = new Date(day);
    dayEnd.setHours(opts.endHour, 0, 0, 0);

    const events = calendar.getEvents(dayStart, dayEnd);

    const busyBlocks: BusyBlock[] = [];
    for (const event of events) {
      if (isDeclined(event)) continue;
      if (isTransparentAllDay(event)) continue;

      const evStart = event.getStartTime().getTime();
      const evEnd = event.getEndTime().getTime();

      busyBlocks.push({
        start: Math.max(evStart, dayStart.getTime()),
        end: Math.min(evEnd, dayEnd.getTime()),
      });
    }

    const merged = mergeBusyBlocks(busyBlocks);
    const withBreaks = applyFatigueBreaks(merged, opts.maxContinuousMinutes, opts.minBreakMinutes, dayEnd.getTime());
    let slots = computeFreeSlots(withBreaks, dayStart.getTime(), dayEnd.getTime(), opts.minMinutes);

    // If today, filter out past slots
    const now = new Date();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (day.getTime() === today.getTime()) {
      slots = filterPastSlots(slots, now.getTime());
    }

    if (slots.length > 0) {
      result.push({
        date: formatDateKey(day),
        dayLabel: formatDayLabel(day),
        slots,
      });
    }
  }

  return result;
}
