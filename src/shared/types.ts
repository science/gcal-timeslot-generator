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
  maxContinuousMinutes: number; // Max meeting block before forced break (default 120, 0=disabled)
  minBreakMinutes: number;      // Break duration after long block (default 30)
}

export interface BusyBlock {
  start: number; // ms since epoch
  end: number;
}

export type FormatStyle = "bullets" | "compact";
