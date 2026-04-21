import {
  mergeBusyBlocks,
  getNextBusinessDays,
  formatDayLabel,
  formatDateKey,
  filterPastSlots,
  roundSlotStarts,
} from "../../src/lib/slot-calculator";
import type { BusyBlock } from "../../src/lib/types";

// Helper: ms timestamp for a time on a given date
function ms(hour: number, minute = 0): number {
  return new Date(2026, 1, 17, hour, minute).getTime(); // Tue Feb 17 2026
}

// Note: the full fatigue-aware slot computation is exhaustively tested
// against a first-principles oracle in AvailabilityOracleComparison.test.ts
// (~400 fixtures + permutations). This file covers the small pure helpers
// that live alongside it.

// ─── mergeBusyBlocks ───

describe("mergeBusyBlocks", () => {
  it("returns empty for empty input", () => {
    expect(mergeBusyBlocks([])).toEqual([]);
  });

  it("returns single block unchanged", () => {
    const blocks: BusyBlock[] = [{ start: ms(9), end: ms(10) }];
    expect(mergeBusyBlocks(blocks)).toEqual([{ start: ms(9), end: ms(10) }]);
  });

  it("keeps non-overlapping blocks separate", () => {
    const blocks: BusyBlock[] = [
      { start: ms(9), end: ms(10) },
      { start: ms(11), end: ms(12) },
    ];
    expect(mergeBusyBlocks(blocks)).toEqual([
      { start: ms(9), end: ms(10) },
      { start: ms(11), end: ms(12) },
    ]);
  });

  it("merges overlapping blocks", () => {
    const blocks: BusyBlock[] = [
      { start: ms(9), end: ms(10, 30) },
      { start: ms(10), end: ms(11) },
    ];
    expect(mergeBusyBlocks(blocks)).toEqual([{ start: ms(9), end: ms(11) }]);
  });

  it("merges adjacent blocks (end === start)", () => {
    const blocks: BusyBlock[] = [
      { start: ms(9), end: ms(10) },
      { start: ms(10), end: ms(11) },
    ];
    expect(mergeBusyBlocks(blocks)).toEqual([{ start: ms(9), end: ms(11) }]);
  });

  it("merges nested blocks", () => {
    const blocks: BusyBlock[] = [
      { start: ms(9), end: ms(12) },
      { start: ms(10), end: ms(11) },
    ];
    expect(mergeBusyBlocks(blocks)).toEqual([{ start: ms(9), end: ms(12) }]);
  });

  it("handles unsorted input", () => {
    const blocks: BusyBlock[] = [
      { start: ms(11), end: ms(12) },
      { start: ms(9), end: ms(10) },
    ];
    expect(mergeBusyBlocks(blocks)).toEqual([
      { start: ms(9), end: ms(10) },
      { start: ms(11), end: ms(12) },
    ]);
  });

  it("merges overlapping blocks from two calendars", () => {
    const blocksA: BusyBlock[] = [{ start: ms(9), end: ms(10) }];
    const blocksB: BusyBlock[] = [{ start: ms(9, 30), end: ms(11) }];
    expect(mergeBusyBlocks([...blocksA, ...blocksB])).toEqual([
      { start: ms(9), end: ms(11) },
    ]);
  });

  it("merges identical events appearing on both calendars", () => {
    const block: BusyBlock = { start: ms(10), end: ms(11) };
    expect(mergeBusyBlocks([{ ...block }, { ...block }])).toEqual([
      { start: ms(10), end: ms(11) },
    ]);
  });
});

// ─── getNextBusinessDays ───

describe("getNextBusinessDays", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("returns only weekdays", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 1, 18, 10, 0));
    const days = getNextBusinessDays(3, false, 17);
    for (const d of days) {
      expect(d.getDay()).not.toBe(0);
      expect(d.getDay()).not.toBe(6);
    }
  });

  it("skips weekends when includeToday=false", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 1, 20, 10, 0)); // Fri Feb 20
    const days = getNextBusinessDays(3, false, 17);
    expect(days[0].getDate()).toBe(23);
    expect(days[1].getDate()).toBe(24);
    expect(days[2].getDate()).toBe(25);
  });

  it("starts from tomorrow even when past endHour and includeToday=false", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 1, 18, 18, 0));
    const days = getNextBusinessDays(1, false, 17);
    expect(days[0].getDate()).toBe(19);
  });

  it("starts from tomorrow when Monday 9pm and includeToday=false", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 1, 16, 21, 0));
    const days = getNextBusinessDays(5, false, 17);
    expect(days[0].getDate()).toBe(17);
  });

  it("includes today when includeToday=true and before endHour on weekday", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 1, 18, 10, 0));
    const days = getNextBusinessDays(3, true, 17);
    expect(days[0].getDate()).toBe(18);
    expect(days).toHaveLength(3);
  });

  it("excludes today when includeToday=true but past endHour", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 1, 18, 18, 0));
    const days = getNextBusinessDays(3, true, 17);
    expect(days[0].getDate()).toBe(19);
  });

  it("excludes today when includeToday=true but on weekend", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 1, 21, 10, 0));
    const days = getNextBusinessDays(3, true, 17);
    expect(days[0].getDate()).toBe(23);
  });
});

// ─── formatDayLabel / formatDateKey ───

describe("formatDayLabel", () => {
  it("formats a Tuesday", () => {
    expect(formatDayLabel(new Date(2026, 1, 17))).toBe("Tuesday, Feb 17");
  });

  it("formats a Monday", () => {
    expect(formatDayLabel(new Date(2026, 1, 16))).toBe("Monday, Feb 16");
  });
});

describe("formatDateKey", () => {
  it("formats with zero-padded month and day", () => {
    expect(formatDateKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("formats double-digit month and day", () => {
    expect(formatDateKey(new Date(2026, 11, 25))).toBe("2026-12-25");
  });
});

// ─── filterPastSlots ───

describe("filterPastSlots", () => {
  it("removes slots entirely in the past", () => {
    const slots = [
      { start: new Date(ms(9)).toISOString(), end: new Date(ms(10)).toISOString() },
    ];
    expect(filterPastSlots(slots, ms(11))).toEqual([]);
  });

  it("keeps slots entirely in the future", () => {
    const slots = [
      { start: new Date(ms(14)).toISOString(), end: new Date(ms(15)).toISOString() },
    ];
    const result = filterPastSlots(slots, ms(11));
    expect(result).toHaveLength(1);
    expect(new Date(result[0].start).getTime()).toBe(ms(14));
  });

  it("truncates slots spanning now", () => {
    const slots = [
      { start: new Date(ms(9)).toISOString(), end: new Date(ms(12)).toISOString() },
    ];
    const nowMs = ms(10, 30);
    const result = filterPastSlots(slots, nowMs);
    expect(result).toHaveLength(1);
    expect(new Date(result[0].start).getTime()).toBe(nowMs);
    expect(new Date(result[0].end).getTime()).toBe(ms(12));
  });

  it("preserves maxMinutes annotation when truncating", () => {
    const slots = [
      {
        start: new Date(ms(9)).toISOString(),
        end: new Date(ms(12)).toISOString(),
        maxMinutes: 60,
      },
    ];
    const result = filterPastSlots(slots, ms(10));
    expect(result[0].maxMinutes).toBe(60);
  });

  it("handles mixed past, spanning, and future slots", () => {
    const slots = [
      { start: new Date(ms(9)).toISOString(), end: new Date(ms(10)).toISOString() },
      { start: new Date(ms(10)).toISOString(), end: new Date(ms(12)).toISOString() },
      { start: new Date(ms(14)).toISOString(), end: new Date(ms(15)).toISOString() },
    ];
    const result = filterPastSlots(slots, ms(11));
    expect(result).toHaveLength(2);
    expect(new Date(result[0].start).getTime()).toBe(ms(11));
    expect(new Date(result[1].start).getTime()).toBe(ms(14));
  });
});

// ─── roundSlotStarts ───

describe("roundSlotStarts", () => {
  it("rounds 14:55 start up to 15:00 with roundMinutes=15", () => {
    const slots = [
      { start: new Date(ms(14, 55)).toISOString(), end: new Date(ms(17)).toISOString() },
    ];
    const result = roundSlotStarts(slots, 15, 30);
    expect(result).toHaveLength(1);
    expect(new Date(result[0].start).getTime()).toBe(ms(15));
    expect(new Date(result[0].end).getTime()).toBe(ms(17));
  });

  it("rounds 9:07 start up to 9:10 with roundMinutes=10", () => {
    const slots = [
      { start: new Date(ms(9, 7)).toISOString(), end: new Date(ms(12)).toISOString() },
    ];
    const result = roundSlotStarts(slots, 10, 30);
    expect(new Date(result[0].start).getTime()).toBe(ms(9, 10));
  });

  it("no-op when start already on boundary", () => {
    const slots = [
      { start: new Date(ms(9)).toISOString(), end: new Date(ms(10)).toISOString() },
      { start: new Date(ms(9, 15)).toISOString(), end: new Date(ms(10)).toISOString() },
    ];
    const result = roundSlotStarts(slots, 15, 30);
    expect(new Date(result[0].start).getTime()).toBe(ms(9));
    expect(new Date(result[1].start).getTime()).toBe(ms(9, 15));
  });

  it("drops slot when rounding leaves remaining duration < minMinutes", () => {
    const slots = [
      { start: new Date(ms(9, 50)).toISOString(), end: new Date(ms(10, 15)).toISOString() },
    ];
    expect(roundSlotStarts(slots, 15, 30)).toEqual([]);
  });

  it("disabled when roundMinutes=0 (pass-through)", () => {
    const slots = [
      { start: new Date(ms(9, 7)).toISOString(), end: new Date(ms(12)).toISOString() },
    ];
    expect(new Date(roundSlotStarts(slots, 0, 30)[0].start).getTime()).toBe(ms(9, 7));
  });

  it("preserves maxMinutes annotation", () => {
    const slots = [
      {
        start: new Date(ms(9, 7)).toISOString(),
        end: new Date(ms(12)).toISOString(),
        maxMinutes: 60,
      },
    ];
    const result = roundSlotStarts(slots, 15, 30);
    expect(result[0].maxMinutes).toBe(60);
  });
});
