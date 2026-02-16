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
  numDays: number;      // Number of business days to scan (default 5)
  startHour: number;    // Start of working hours (default 9)
  endHour: number;      // End of working hours (default 17)
  minMinutes: number;   // Minimum slot duration in minutes (default 30)
}

export type FormatStyle = "bullets" | "compact";
