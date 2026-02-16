import type { TimeSlot, DaySlots, SlotOptions } from "../shared/types";

function getDefaultSlotOptions(): SlotOptions {
  return {
    numDays: 5,
    startHour: 9,
    endHour: 17,
    minMinutes: 30,
  };
}

function getNextBusinessDays(numDays: number): Date[] {
  const days: Date[] = [];
  const current = new Date();
  current.setHours(0, 0, 0, 0);

  // Start from tomorrow if it's already past working hours today
  const now = new Date();
  if (now.getHours() >= 17) {
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

function formatDayLabel(date: Date): string {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`;
}

function formatDateKey(date: Date): string {
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
  // All-day events that are "free" (transparent) should not block time
  // OOO events and "busy" all-day events should block
  const title = event.getTitle().toLowerCase();
  // Holidays and similar "show as free" events
  if (title.includes("holiday") && event.getGuestList().length === 0) return true;
  return false;
}

interface BusyBlock {
  start: number; // ms since epoch
  end: number;
}

function mergeBusyBlocks(blocks: BusyBlock[]): BusyBlock[] {
  if (blocks.length === 0) return [];
  blocks.sort((a, b) => a.start - b.start);
  const merged: BusyBlock[] = [{ ...blocks[0] }];
  for (let i = 1; i < blocks.length; i++) {
    const last = merged[merged.length - 1];
    if (blocks[i].start <= last.end) {
      last.end = Math.max(last.end, blocks[i].end);
    } else {
      merged.push({ ...blocks[i] });
    }
  }
  return merged;
}

export function getAvailableSlots(options?: Partial<SlotOptions>): DaySlots[] {
  const opts = { ...getDefaultSlotOptions(), ...options };
  const calendar = CalendarApp.getDefaultCalendar();
  const businessDays = getNextBusinessDays(opts.numDays);
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

      // Clamp to working hours
      busyBlocks.push({
        start: Math.max(evStart, dayStart.getTime()),
        end: Math.min(evEnd, dayEnd.getTime()),
      });
    }

    const merged = mergeBusyBlocks(busyBlocks);
    const slots: TimeSlot[] = [];
    let cursor = dayStart.getTime();

    for (const block of merged) {
      if (block.start > cursor) {
        const gapMinutes = (block.start - cursor) / 60000;
        if (gapMinutes >= opts.minMinutes) {
          slots.push({
            start: new Date(cursor).toISOString(),
            end: new Date(block.start).toISOString(),
          });
        }
      }
      cursor = Math.max(cursor, block.end);
    }

    // Trailing free time after last event
    if (cursor < dayEnd.getTime()) {
      const gapMinutes = (dayEnd.getTime() - cursor) / 60000;
      if (gapMinutes >= opts.minMinutes) {
        slots.push({
          start: new Date(cursor).toISOString(),
          end: new Date(dayEnd.getTime()).toISOString(),
        });
      }
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
