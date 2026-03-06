export interface TimeSlot {
  start: string; // ISO 8601
  end: string;   // ISO 8601
}

export interface DaySlots {
  date: string;       // "2026-02-17"
  dayLabel: string;   // "Tuesday, Feb 17"
  slots: TimeSlot[];
}

export interface SlotOptions {
  numDays: number;              // Number of business days to scan (default 5)
  startHour: number;            // Start of working hours (default 9)
  endHour: number;              // End of working hours (default 17)
  minMinutes: number;           // Minimum slot duration in minutes (default 30)
  includeToday: boolean;        // Include today's remaining slots (default false)
  /** Maximum continuous meeting time before a break is enforced (default 120, 0=disabled) */
  maxContinuousMinutes: number;
  /** Minimum gap duration that counts as a "real break" resetting fatigue, AND duration of the enforced break appended after a block exceeds the threshold (default 30) */
  minBreakMinutes: number;
  /** Gaps <= this are treated as continuous meeting time, not real breaks (default 15, 0=disabled) */
  minGapMinutes: number;
  /** Round slot start times up to the next clean increment in minutes (default 15, 0=disabled) */
  roundMinutes: number;
  calendarIds?: string[];       // Calendar IDs to check (undefined/empty = primary only)
  calendarMode?: 'mine' | 'group'; // 'mine' = all calendars are yours, 'group' = different people
}

export interface CalendarInfo {
  id: string;
  name: string;
  primary: boolean;
}

export interface BusyBlock {
  start: number; // ms since epoch
  end: number;
}

export type FormatStyle = "bullets" | "compact";
