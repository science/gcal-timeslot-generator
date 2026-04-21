import type { BusyBlock, DaySlots, SlotOptions } from "../lib/types";
import {
  computeDaySlots,
  computeFetchRange,
  getDefaultSlotOptions,
} from "../lib/slot-calculator";

/** Fetch all events for a calendar in one Advanced Calendar Service call. */
function fetchCalendarEvents(
  calendarId: string,
  rangeStart: Date,
  rangeEnd: Date,
): BusyBlock[] {
  const blocks: BusyBlock[] = [];
  let pageToken: string | undefined;
  do {
    const response = Calendar.Events!.list(calendarId, {
      timeMin: rangeStart.toISOString(),
      timeMax: rangeEnd.toISOString(),
      singleEvents: true,
      maxResults: 2500,
      pageToken: pageToken || undefined,
    });
    for (const item of response.items || []) {
      if (item.status === "cancelled") continue;
      if (item.attendees?.some((a: GoogleAppsScript.Calendar.Schema.EventAttendee) => a.self && a.responseStatus === "declined")) continue;
      const isAllDay = !!item.start?.date;
      if (isAllDay) {
        const title = (item.summary || "").toLowerCase();
        const noGuests = !item.attendees || item.attendees.every((a: GoogleAppsScript.Calendar.Schema.EventAttendee) => a.self);
        if (title.includes("holiday") && noGuests) continue;
      }
      const startMs = new Date(isAllDay ? item.start!.date! : item.start!.dateTime!).getTime();
      const endMs = new Date(isAllDay ? item.end!.date! : item.end!.dateTime!).getTime();
      blocks.push({ start: startMs, end: endMs });
    }
    pageToken = response.nextPageToken ?? undefined;
  } while (pageToken);
  return blocks;
}

function resolveCalendars(calendarIds?: string[]): GoogleAppsScript.Calendar.Calendar[] {
  const calendars: GoogleAppsScript.Calendar.Calendar[] = [];
  if (calendarIds && calendarIds.length > 0) {
    for (const id of calendarIds) {
      const cal = CalendarApp.getCalendarById(id);
      if (cal) calendars.push(cal);
    }
  }
  if (calendars.length === 0) {
    calendars.push(CalendarApp.getDefaultCalendar());
  }
  return calendars;
}

export function getAvailableSlots(options?: Partial<SlotOptions>): DaySlots[] {
  const opts = { ...getDefaultSlotOptions(), ...options };
  const { businessDays, rangeStart, rangeEnd } = computeFetchRange(opts);
  if (businessDays.length === 0) return [];

  const calendars = resolveCalendars(opts.calendarIds);
  const eventsByCalendar: BusyBlock[][] = calendars.map((calendar) =>
    fetchCalendarEvents(calendar.getId(), rangeStart, rangeEnd),
  );

  return computeDaySlots(eventsByCalendar, businessDays, opts);
}
