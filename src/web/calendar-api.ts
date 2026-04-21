// Thin wrapper over the Google Calendar v3 REST API. Lives on top of
// the auth module: every call grabs a token via ensureValidToken(),
// retries once on 401 with a forced refresh, and surfaces a clear
// AuthRequiredError when the session is genuinely gone (user must
// re-sign-in).

import type { BusyBlock, CalendarInfo } from "../lib/types";
import { AuthRequiredError, ensureValidToken, forceRefresh } from "./auth";

const API_BASE = "https://www.googleapis.com/calendar/v3";

interface CalendarListResponse {
  items?: Array<{
    id: string;
    summary?: string;
    summaryOverride?: string;
    primary?: boolean;
    hidden?: boolean;
    selected?: boolean;
    deleted?: boolean;
    accessRole?: string;
  }>;
}

interface EventsListResponse {
  items?: Array<{
    status?: string;
    summary?: string;
    start?: { date?: string; dateTime?: string };
    end?: { date?: string; dateTime?: string };
    attendees?: Array<{ self?: boolean; responseStatus?: string }>;
  }>;
  nextPageToken?: string;
}

async function authedFetch(url: string): Promise<Response> {
  let token = await ensureValidToken();
  if (!token) throw new AuthRequiredError();
  let response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 401) {
    token = await forceRefresh();
    if (!token) throw new AuthRequiredError();
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }
  return response;
}

async function authedFetchJson<T>(url: string): Promise<T> {
  const response = await authedFetch(url);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Calendar API ${response.status}: ${body.slice(0, 500)}`);
  }
  return response.json() as Promise<T>;
}

export async function listCalendars(): Promise<CalendarInfo[]> {
  const url = `${API_BASE}/users/me/calendarList?minAccessRole=reader&showHidden=false`;
  const data = await authedFetchJson<CalendarListResponse>(url);
  const items = data.items ?? [];
  return items
    .filter((cal) => !cal.hidden && !cal.deleted && cal.id)
    .map((cal) => ({
      id: cal.id,
      name: cal.summaryOverride || cal.summary || cal.id,
      primary: !!cal.primary,
    }))
    .sort((a, b) => {
      if (a.primary !== b.primary) return a.primary ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

/** Fetch all events for one calendar in the given window, following pagination. */
async function listEventsSingle(
  calendarId: string,
  rangeStart: Date,
  rangeEnd: Date,
): Promise<BusyBlock[]> {
  const blocks: BusyBlock[] = [];
  let pageToken: string | undefined;
  const base = new URL(`${API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`);
  base.searchParams.set("timeMin", rangeStart.toISOString());
  base.searchParams.set("timeMax", rangeEnd.toISOString());
  base.searchParams.set("singleEvents", "true");
  base.searchParams.set("maxResults", "2500");

  do {
    const url = new URL(base.toString());
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const data = await authedFetchJson<EventsListResponse>(url.toString());
    for (const item of data.items ?? []) {
      if (item.status === "cancelled") continue;
      if (item.attendees?.some((a) => a.self && a.responseStatus === "declined")) continue;
      const isAllDay = !!item.start?.date;
      if (isAllDay) {
        const title = (item.summary || "").toLowerCase();
        const noGuests = !item.attendees || item.attendees.every((a) => a.self);
        if (title.includes("holiday") && noGuests) continue;
      }
      const startStr = isAllDay ? item.start!.date! : item.start!.dateTime!;
      const endStr = isAllDay ? item.end!.date! : item.end!.dateTime!;
      if (!startStr || !endStr) continue;
      blocks.push({
        start: new Date(startStr).getTime(),
        end: new Date(endStr).getTime(),
      });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return blocks;
}

/**
 * Fetch events for many calendars in parallel. Returns a result in the
 * same order as the input calendarIds so the caller can correlate.
 */
export async function listEventsByCalendar(
  calendarIds: string[],
  rangeStart: Date,
  rangeEnd: Date,
): Promise<BusyBlock[][]> {
  if (calendarIds.length === 0) return [];
  return Promise.all(
    calendarIds.map((id) => listEventsSingle(id, rangeStart, rangeEnd)),
  );
}

/** Fetch the primary calendar's ID. Used when no specific calendars are selected. */
export async function getPrimaryCalendarId(): Promise<string> {
  const cals = await listCalendars();
  const primary = cals.find((c) => c.primary);
  return primary?.id ?? "primary";
}
