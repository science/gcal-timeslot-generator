import {
  formatTime,
  formatSlotsBullets,
  formatSlotsCompact,
} from "../../src/server/Formatter";
import type { DaySlots } from "../../src/shared/types";

// Helper: create ISO string at a specific hour/minute (local time)
function iso(hour: number, minute = 0): string {
  return new Date(2026, 1, 17, hour, minute).toISOString();
}

// ─── formatTime ───

describe("formatTime", () => {
  it("formats 9am", () => {
    expect(formatTime(iso(9))).toBe("9am");
  });

  it("formats 12pm (noon)", () => {
    expect(formatTime(iso(12))).toBe("12pm");
  });

  it("formats 12:30am (midnight-ish)", () => {
    expect(formatTime(iso(0, 30))).toBe("12:30am");
  });

  it("formats 2:15pm", () => {
    expect(formatTime(iso(14, 15))).toBe("2:15pm");
  });

  it("formats 5pm", () => {
    expect(formatTime(iso(17))).toBe("5pm");
  });

  it("formats 11:45am", () => {
    expect(formatTime(iso(11, 45))).toBe("11:45am");
  });
});

// ─── formatSlotsBullets ───

describe("formatSlotsBullets", () => {
  it("returns empty message for no days", () => {
    expect(formatSlotsBullets([])).toBe("No availability found for the selected period.");
  });

  it("formats a single day with one slot", () => {
    const days: DaySlots[] = [
      {
        date: "2026-02-17",
        dayLabel: "Tuesday, Feb 17",
        slots: [{ start: iso(9), end: iso(10) }],
      },
    ];
    const result = formatSlotsBullets(days);
    expect(result).toContain("I'm available at the following times (Pacific):");
    expect(result).toContain("Tuesday, Feb 17:");
    expect(result).toContain("  - 9am - 10am");
  });

  it("formats multiple days", () => {
    const days: DaySlots[] = [
      {
        date: "2026-02-17",
        dayLabel: "Tuesday, Feb 17",
        slots: [{ start: iso(9), end: iso(10) }],
      },
      {
        date: "2026-02-18",
        dayLabel: "Wednesday, Feb 18",
        slots: [
          { start: iso(14), end: iso(16, 30) },
        ],
      },
    ];
    const result = formatSlotsBullets(days);
    expect(result).toContain("Tuesday, Feb 17:");
    expect(result).toContain("Wednesday, Feb 18:");
    expect(result).toContain("  - 2pm - 4:30pm");
  });
});

// ─── formatSlotsCompact ───

describe("formatSlotsCompact", () => {
  it("returns empty message for no days", () => {
    expect(formatSlotsCompact([])).toBe("No availability found for the selected period.");
  });

  it("formats a single day compactly", () => {
    const days: DaySlots[] = [
      {
        date: "2026-02-17",
        dayLabel: "Tuesday, Feb 17",
        slots: [
          { start: iso(9), end: iso(10) },
          { start: iso(14), end: iso(16, 30) },
        ],
      },
    ];
    const result = formatSlotsCompact(days);
    expect(result).toBe("Available (Pacific):\nTuesday, Feb 17: 9am-10am, 2pm-4:30pm");
  });

  it("formats multiple days compactly", () => {
    const days: DaySlots[] = [
      {
        date: "2026-02-17",
        dayLabel: "Tuesday, Feb 17",
        slots: [{ start: iso(9), end: iso(12) }],
      },
      {
        date: "2026-02-18",
        dayLabel: "Wednesday, Feb 18",
        slots: [{ start: iso(13), end: iso(17) }],
      },
    ];
    const result = formatSlotsCompact(days);
    const lines = result.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("Available (Pacific):");
    expect(lines[1]).toBe("Tuesday, Feb 17: 9am-12pm");
    expect(lines[2]).toBe("Wednesday, Feb 18: 1pm-5pm");
  });
});
