import {
  mergeBusyBlocks,
  computeFreeSlots,
  getNextBusinessDays,
  formatDayLabel,
  formatDateKey,
  filterPastSlots,
  applyFatigueBreaks,
  applyFatiguePerCalendar,
  roundSlotStarts,
} from "../../src/server/SlotCalculator";
import type { BusyBlock } from "../../src/shared/types";

// Helper: ms timestamp for a time on a given date
function ms(hour: number, minute = 0): number {
  return new Date(2026, 1, 17, hour, minute).getTime(); // Tue Feb 17 2026
}

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
});

// ─── computeFreeSlots ───

describe("computeFreeSlots", () => {
  const dayStart = ms(9);
  const dayEnd = ms(17);

  it("returns full day when no blocks", () => {
    const slots = computeFreeSlots([], dayStart, dayEnd, 30);
    expect(slots).toHaveLength(1);
    expect(new Date(slots[0].start).getTime()).toBe(dayStart);
    expect(new Date(slots[0].end).getTime()).toBe(dayEnd);
  });

  it("returns empty when fully booked", () => {
    const blocks: BusyBlock[] = [{ start: ms(9), end: ms(17) }];
    expect(computeFreeSlots(blocks, dayStart, dayEnd, 30)).toEqual([]);
  });

  it("finds a single gap", () => {
    const blocks: BusyBlock[] = [
      { start: ms(9), end: ms(10) },
      { start: ms(11), end: ms(17) },
    ];
    const slots = computeFreeSlots(blocks, dayStart, dayEnd, 30);
    expect(slots).toHaveLength(1);
    expect(new Date(slots[0].start).getTime()).toBe(ms(10));
    expect(new Date(slots[0].end).getTime()).toBe(ms(11));
  });

  it("finds multiple gaps", () => {
    const blocks: BusyBlock[] = [
      { start: ms(10), end: ms(11) },
      { start: ms(13), end: ms(14) },
    ];
    const slots = computeFreeSlots(blocks, dayStart, dayEnd, 30);
    expect(slots).toHaveLength(3);
    // 9-10, 11-13, 14-17
    expect(new Date(slots[0].start).getTime()).toBe(ms(9));
    expect(new Date(slots[0].end).getTime()).toBe(ms(10));
    expect(new Date(slots[1].start).getTime()).toBe(ms(11));
    expect(new Date(slots[1].end).getTime()).toBe(ms(13));
    expect(new Date(slots[2].start).getTime()).toBe(ms(14));
    expect(new Date(slots[2].end).getTime()).toBe(ms(17));
  });

  it("filters gaps shorter than minMinutes", () => {
    const blocks: BusyBlock[] = [
      { start: ms(9), end: ms(10) },
      { start: ms(10, 15), end: ms(17) }, // only 15-min gap
    ];
    const slots = computeFreeSlots(blocks, dayStart, dayEnd, 30);
    expect(slots).toEqual([]);
  });

  it("includes gap exactly equal to minMinutes", () => {
    const blocks: BusyBlock[] = [
      { start: ms(9), end: ms(10) },
      { start: ms(10, 30), end: ms(17) }, // exactly 30-min gap
    ];
    const slots = computeFreeSlots(blocks, dayStart, dayEnd, 30);
    expect(slots).toHaveLength(1);
  });
});

// ─── getNextBusinessDays ───

describe("getNextBusinessDays", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("returns only weekdays", () => {
    jest.useFakeTimers();
    // Wednesday Feb 18, 2026 at 10am
    jest.setSystemTime(new Date(2026, 1, 18, 10, 0));
    const days = getNextBusinessDays(3, false, 17);
    for (const d of days) {
      const dow = d.getDay();
      expect(dow).not.toBe(0);
      expect(dow).not.toBe(6);
    }
  });

  it("skips weekends when includeToday=false", () => {
    jest.useFakeTimers();
    // Friday Feb 20, 2026 at 10am
    jest.setSystemTime(new Date(2026, 1, 20, 10, 0));
    const days = getNextBusinessDays(3, false, 17);
    // Should be Mon 23, Tue 24, Wed 25
    expect(days[0].getDate()).toBe(23);
    expect(days[1].getDate()).toBe(24);
    expect(days[2].getDate()).toBe(25);
  });

  it("starts from tomorrow even when past endHour and includeToday=false", () => {
    jest.useFakeTimers();
    // Wednesday Feb 18, 2026 at 6pm (past 5pm endHour)
    jest.setSystemTime(new Date(2026, 1, 18, 18, 0));
    const days = getNextBusinessDays(1, false, 17);
    // Should start from tomorrow (Thursday), not skip an extra day
    expect(days[0].getDate()).toBe(19);
  });

  it("starts from tomorrow when Monday 9pm and includeToday=false", () => {
    jest.useFakeTimers();
    // Monday Feb 16, 2026 at 9pm Pacific (past 5pm endHour)
    jest.setSystemTime(new Date(2026, 1, 16, 21, 0));
    const days = getNextBusinessDays(5, false, 17);
    // Should start from Tuesday, not skip to Wednesday
    expect(days[0].getDate()).toBe(17);
  });

  it("includes today when includeToday=true and before endHour on weekday", () => {
    jest.useFakeTimers();
    // Wednesday Feb 18, 2026 at 10am
    jest.setSystemTime(new Date(2026, 1, 18, 10, 0));
    const days = getNextBusinessDays(3, true, 17);
    expect(days[0].getDate()).toBe(18); // today included
    expect(days).toHaveLength(3);
  });

  it("excludes today when includeToday=true but past endHour", () => {
    jest.useFakeTimers();
    // Wednesday Feb 18, 2026 at 6pm
    jest.setSystemTime(new Date(2026, 1, 18, 18, 0));
    const days = getNextBusinessDays(3, true, 17);
    expect(days[0].getDate()).toBe(19); // tomorrow
  });

  it("excludes today when includeToday=true but on weekend", () => {
    jest.useFakeTimers();
    // Saturday Feb 21, 2026 at 10am
    jest.setSystemTime(new Date(2026, 1, 21, 10, 0));
    const days = getNextBusinessDays(3, true, 17);
    expect(days[0].getDate()).toBe(23); // Monday
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
    const result = filterPastSlots(slots, ms(11));
    expect(result).toEqual([]);
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

  it("handles mixed past, spanning, and future slots", () => {
    const slots = [
      { start: new Date(ms(9)).toISOString(), end: new Date(ms(10)).toISOString() },
      { start: new Date(ms(10)).toISOString(), end: new Date(ms(12)).toISOString() },
      { start: new Date(ms(14)).toISOString(), end: new Date(ms(15)).toISOString() },
    ];
    const nowMs = ms(11);
    const result = filterPastSlots(slots, nowMs);
    expect(result).toHaveLength(2);
    expect(new Date(result[0].start).getTime()).toBe(nowMs); // truncated
    expect(new Date(result[1].start).getTime()).toBe(ms(14)); // future
  });
});

// ─── applyFatigueBreaks ───

describe("applyFatigueBreaks", () => {
  const dayEnd = ms(17);

  it("leaves blocks under threshold unchanged", () => {
    const blocks: BusyBlock[] = [{ start: ms(9), end: ms(10) }]; // 60 min
    const result = applyFatigueBreaks(blocks, 120, 30, 0, dayEnd);
    expect(result).toEqual([{ start: ms(9), end: ms(10) }]);
  });

  it("extends block at threshold by break minutes", () => {
    const blocks: BusyBlock[] = [{ start: ms(9), end: ms(11) }]; // 120 min
    const result = applyFatigueBreaks(blocks, 120, 30, 0, dayEnd);
    expect(result).toEqual([{ start: ms(9), end: ms(11, 30) }]);
  });

  it("extends block over threshold by break minutes", () => {
    const blocks: BusyBlock[] = [{ start: ms(9), end: ms(12) }]; // 180 min
    const result = applyFatigueBreaks(blocks, 120, 30, 0, dayEnd);
    expect(result).toEqual([{ start: ms(9), end: ms(12, 30) }]);
  });

  it("clamps extension to dayEnd", () => {
    const blocks: BusyBlock[] = [{ start: ms(15), end: ms(17) }]; // ends at dayEnd
    const result = applyFatigueBreaks(blocks, 120, 30, 0, dayEnd);
    expect(result).toEqual([{ start: ms(15), end: ms(17) }]); // clamped
  });

  it("re-merges when extension overlaps next meeting", () => {
    // 120+15+45=180 > 120 → gap closed → 9-12 (180min) → extended to 12:30
    const blocks: BusyBlock[] = [
      { start: ms(9), end: ms(11) },   // 120 min
      { start: ms(11, 15), end: ms(12) }, // 45 min, 15-min gap
    ];
    const result = applyFatigueBreaks(blocks, 120, 30, 0, dayEnd);
    expect(result).toEqual([{ start: ms(9), end: ms(12, 30) }]);
  });

  it("returns blocks unchanged when maxContinuousMinutes=0 (disabled)", () => {
    const blocks: BusyBlock[] = [{ start: ms(9), end: ms(14) }]; // 5 hours
    const result = applyFatigueBreaks(blocks, 0, 30, 0, dayEnd);
    expect(result).toEqual([{ start: ms(9), end: ms(14) }]);
  });

  it("preserves gap >= minBreakMinutes even when combined span exceeds threshold", () => {
    // 1hr meeting, 30min gap, 2hr block — gap=30 >= minBreak=30 → preserved as real break
    // Phase 2: 2hr block >= 120 → extended by 30min
    const blocks: BusyBlock[] = [
      { start: ms(9, 30), end: ms(10, 30) },  // 1hr meeting
      { start: ms(11), end: ms(13) },          // 2hr block
    ];
    const result = applyFatigueBreaks(blocks, 120, 30, 0, dayEnd);
    expect(result).toEqual([
      { start: ms(9, 30), end: ms(10, 30) },
      { start: ms(11), end: ms(13, 30) },
    ]);
  });

  it("keeps gap open when filling it would not exceed maxContinuousMinutes", () => {
    // 30min meeting, 30min gap, 30min meeting — booking gap creates 1.5hr (under 2hr)
    const blocks: BusyBlock[] = [
      { start: ms(9), end: ms(9, 30) },
      { start: ms(10), end: ms(10, 30) },
    ];
    const result = applyFatigueBreaks(blocks, 120, 30, 0, dayEnd);
    expect(result).toEqual([
      { start: ms(9), end: ms(9, 30) },
      { start: ms(10), end: ms(10, 30) },
    ]);
  });

  it("cascades gap closing when merged block triggers another closure", () => {
    // Block A: 9-10 (1hr), gap 10-10:15, Block B: 10:15-11:15 (1hr), gap 11:15-11:30, Block C: 11:30-13 (1.5hr)
    // A+gapAB+B = 60+15+60=135 > 120 → close → AB: 9-11:15 (135min)
    // AB+gapBC+C = 135+15+90=240 > 120 → close → ABC: 9-13 (240min)
    // ABC >= 120 → extend to 13:30
    const blocks: BusyBlock[] = [
      { start: ms(9), end: ms(10) },
      { start: ms(10, 15), end: ms(11, 15) },
      { start: ms(11, 30), end: ms(13) },
    ];
    const result = applyFatigueBreaks(blocks, 120, 30, 0, dayEnd);
    expect(result).toEqual([{ start: ms(9), end: ms(13, 30) }]);
  });
});

// ─── applyFatigueBreaks with minGapMinutes ───

describe("applyFatigueBreaks with minGapMinutes", () => {
  const dayEnd = ms(17);

  it("merges small gap into continuous block triggering fatigue", () => {
    // 9:00-9:25 (25m), 5m gap, 9:30-11:00 (90m) → merged to 9:00-11:00 (120m) → extended to 11:30
    const blocks: BusyBlock[] = [
      { start: ms(9), end: ms(9, 25) },
      { start: ms(9, 30), end: ms(11) },
    ];
    const result = applyFatigueBreaks(blocks, 120, 30, 15, dayEnd);
    expect(result).toEqual([{ start: ms(9), end: ms(11, 30) }]);
  });

  it("merges gap at exactly the threshold", () => {
    // 9:00-10:00, 15m gap, 10:15-11:00 → merged to 9:00-11:00 (120m exactly, no extension needed? 120 >= 120 → extended)
    const blocks: BusyBlock[] = [
      { start: ms(9), end: ms(10) },
      { start: ms(10, 15), end: ms(11) },
    ];
    const result = applyFatigueBreaks(blocks, 120, 30, 15, dayEnd);
    expect(result).toEqual([{ start: ms(9), end: ms(11, 30) }]);
  });

  it("keeps gap above threshold open", () => {
    // 9:00-10:00, 20m gap, 10:20-11:00 → gap > 15, stays open
    const blocks: BusyBlock[] = [
      { start: ms(9), end: ms(10) },
      { start: ms(10, 20), end: ms(11) },
    ];
    const result = applyFatigueBreaks(blocks, 120, 30, 15, dayEnd);
    expect(result).toEqual([
      { start: ms(9), end: ms(10) },
      { start: ms(10, 20), end: ms(11) },
    ]);
  });

  it("preserves current behavior when minGapMinutes=0", () => {
    // Same blocks as first test but minGap=0 → no merging, two separate blocks
    const blocks: BusyBlock[] = [
      { start: ms(9), end: ms(9, 25) },
      { start: ms(9, 30), end: ms(11) },
    ];
    const result = applyFatigueBreaks(blocks, 120, 30, 0, dayEnd);
    expect(result).toEqual([
      { start: ms(9), end: ms(9, 25) },
      { start: ms(9, 30), end: ms(11) },
    ]);
  });

  it("cascades multiple small gaps into one block", () => {
    // 9:00-9:25, 5m gap, 9:30-9:55, 5m gap, 10:00-11:30 → all merge to 9:00-11:30 (150m) → extended to 12:00
    const blocks: BusyBlock[] = [
      { start: ms(9), end: ms(9, 25) },
      { start: ms(9, 30), end: ms(9, 55) },
      { start: ms(10), end: ms(11, 30) },
    ];
    const result = applyFatigueBreaks(blocks, 120, 30, 15, dayEnd);
    expect(result).toEqual([{ start: ms(9), end: ms(12) }]);
  });

  it("interacts with existing gap-closing (Phase 1) — preserves gap >= minBreakMinutes", () => {
    // 9:00-9:50, 5m gap, 9:55-10:50 → Phase 0 merges to 9:00-10:50 (110m)
    // 30m gap to 11:20-13:00 → gap=30 >= minBreak=30 → preserved (real break)
    // Neither block >= 120 → no extension
    const blocks: BusyBlock[] = [
      { start: ms(9), end: ms(9, 50) },
      { start: ms(9, 55), end: ms(10, 50) },
      { start: ms(11, 20), end: ms(13) },
    ];
    const result = applyFatigueBreaks(blocks, 120, 30, 15, dayEnd);
    expect(result).toEqual([
      { start: ms(9), end: ms(10, 50) },
      { start: ms(11, 20), end: ms(13) },
    ]);
  });

  it("is disabled when maxContinuousMinutes=0", () => {
    const blocks: BusyBlock[] = [
      { start: ms(9), end: ms(9, 25) },
      { start: ms(9, 30), end: ms(10) },
    ];
    const result = applyFatigueBreaks(blocks, 0, 30, 15, dayEnd);
    expect(result).toEqual([
      { start: ms(9), end: ms(9, 25) },
      { start: ms(9, 30), end: ms(10) },
    ]);
  });
});

// ─── Multi-calendar merging (regression / documentation) ───

describe("multi-calendar busy block merging", () => {
  it("merges overlapping blocks from two calendars", () => {
    // Calendar A: meeting 9-10, Calendar B: meeting 9:30-11
    const blocksA: BusyBlock[] = [{ start: ms(9), end: ms(10) }];
    const blocksB: BusyBlock[] = [{ start: ms(9, 30), end: ms(11) }];
    const merged = mergeBusyBlocks([...blocksA, ...blocksB]);
    expect(merged).toEqual([{ start: ms(9), end: ms(11) }]);
  });

  it("keeps non-overlapping blocks from different calendars separate", () => {
    const blocksA: BusyBlock[] = [{ start: ms(9), end: ms(10) }];
    const blocksB: BusyBlock[] = [{ start: ms(14), end: ms(15) }];
    const merged = mergeBusyBlocks([...blocksA, ...blocksB]);
    expect(merged).toEqual([
      { start: ms(9), end: ms(10) },
      { start: ms(14), end: ms(15) },
    ]);
  });

  it("merges identical events appearing on both calendars", () => {
    // Same meeting accepted on both work and personal calendar
    const block: BusyBlock = { start: ms(10), end: ms(11) };
    const merged = mergeBusyBlocks([{ ...block }, { ...block }]);
    expect(merged).toEqual([{ start: ms(10), end: ms(11) }]);
  });

  it("correctly computes free slots from multi-calendar blocks", () => {
    // Cal A: 9-10:30, Cal B: 10-11:30 → merged 9-11:30 → free 11:30-17
    const combined: BusyBlock[] = [
      { start: ms(9), end: ms(10, 30) },
      { start: ms(10), end: ms(11, 30) },
    ];
    const merged = mergeBusyBlocks(combined);
    const slots = computeFreeSlots(merged, ms(9), ms(17), 30);
    expect(slots).toHaveLength(1);
    expect(new Date(slots[0].start).getTime()).toBe(ms(11, 30));
    expect(new Date(slots[0].end).getTime()).toBe(ms(17));
  });
});

// ─── applyFatiguePerCalendar ───

describe("applyFatiguePerCalendar", () => {
  const dayEnd = ms(17);

  it("does NOT add fatigue break for adjacent short blocks from different calendars", () => {
    // Core bug fix: Cal A 9-10 + Cal B 10-11 = 2hr merged, but neither person
    // has a 2hr block — no fatigue break should be added
    const calA: BusyBlock[] = [{ start: ms(9), end: ms(10) }];
    const calB: BusyBlock[] = [{ start: ms(10), end: ms(11) }];
    const result = applyFatiguePerCalendar([calA, calB], 120, 30, 0, dayEnd);
    // Should merge to one block 9-11 with NO fatigue extension
    expect(result).toEqual([{ start: ms(9), end: ms(11) }]);
  });

  it("applies fatigue independently per calendar", () => {
    // Cal A has 2hr block (gets fatigue), Cal B has 1hr (doesn't)
    const calA: BusyBlock[] = [{ start: ms(9), end: ms(11) }];   // 2hr → fatigue
    const calB: BusyBlock[] = [{ start: ms(14), end: ms(15) }];  // 1hr → no fatigue
    const result = applyFatiguePerCalendar([calA, calB], 120, 30, 0, dayEnd);
    expect(result).toEqual([
      { start: ms(9), end: ms(11, 30) },  // Cal A extended
      { start: ms(14), end: ms(15) },      // Cal B unchanged
    ]);
  });

  it("merges correctly when fatigue-extended block overlaps another calendar's block", () => {
    // Cal A: 9-11 (2hr → extends to 11:30), Cal B: 11:15-12
    // After fatigue on A: 9-11:30, which overlaps B's 11:15-12 → merged to 9-12
    const calA: BusyBlock[] = [{ start: ms(9), end: ms(11) }];
    const calB: BusyBlock[] = [{ start: ms(11, 15), end: ms(12) }];
    const result = applyFatiguePerCalendar([calA, calB], 120, 30, 0, dayEnd);
    expect(result).toEqual([{ start: ms(9), end: ms(12) }]);
  });

  it("matches applyFatigueBreaks for a single calendar", () => {
    const blocks: BusyBlock[] = [
      { start: ms(9), end: ms(11) },
      { start: ms(11, 15), end: ms(12) },
    ];
    const perCalResult = applyFatiguePerCalendar([blocks], 120, 30, 0, dayEnd);
    const directResult = applyFatigueBreaks(
      mergeBusyBlocks(blocks), 120, 30, 0, dayEnd
    );
    expect(perCalResult).toEqual(directResult);
  });

  it("returns empty for empty input", () => {
    expect(applyFatiguePerCalendar([], 120, 30, 0, dayEnd)).toEqual([]);
  });

  it("returns empty for empty calendars", () => {
    expect(applyFatiguePerCalendar([[], []], 120, 30, 0, dayEnd)).toEqual([]);
  });

  it("applies fatigue to both calendars independently when both have long blocks", () => {
    // Cal A: 9-11 (2hr → 11:30), Cal B: 13-15 (2hr → 15:30)
    const calA: BusyBlock[] = [{ start: ms(9), end: ms(11) }];
    const calB: BusyBlock[] = [{ start: ms(13), end: ms(15) }];
    const result = applyFatiguePerCalendar([calA, calB], 120, 30, 0, dayEnd);
    expect(result).toEqual([
      { start: ms(9), end: ms(11, 30) },
      { start: ms(13), end: ms(15, 30) },
    ]);
  });

  it("does NOT add fatigue for three adjacent 1hr blocks from three calendars", () => {
    // 3hr merged span but no single calendar has a 2hr+ block
    const calA: BusyBlock[] = [{ start: ms(9), end: ms(10) }];
    const calB: BusyBlock[] = [{ start: ms(10), end: ms(11) }];
    const calC: BusyBlock[] = [{ start: ms(11), end: ms(12) }];
    const result = applyFatiguePerCalendar([calA, calB, calC], 120, 30, 0, dayEnd);
    expect(result).toEqual([{ start: ms(9), end: ms(12) }]);
  });

  it("matches applyFatigueBreaks for single calendar with Phase 1 fix", () => {
    // Verify per-calendar mode gives same result as direct call after the fix
    const blocks: BusyBlock[] = [
      { start: ms(9, 30), end: ms(10, 30) },
      { start: ms(11), end: ms(13) },
    ];
    const perCalResult = applyFatiguePerCalendar([blocks], 120, 30, 0, dayEnd);
    const directResult = applyFatigueBreaks(
      mergeBusyBlocks(blocks), 120, 30, 0, dayEnd
    );
    expect(perCalResult).toEqual(directResult);
  });

  it("merges small gaps independently per calendar before fatigue", () => {
    // Cal A: 9:00-9:25, 5m gap, 9:30-11:00 → minGap=15 merges to 9:00-11:00 (120m) → extended to 11:30
    // Cal B: 14:00-15:00 (no fatigue)
    const calA: BusyBlock[] = [
      { start: ms(9), end: ms(9, 25) },
      { start: ms(9, 30), end: ms(11) },
    ];
    const calB: BusyBlock[] = [{ start: ms(14), end: ms(15) }];
    const result = applyFatiguePerCalendar([calA, calB], 120, 30, 15, dayEnd);
    expect(result).toEqual([
      { start: ms(9), end: ms(11, 30) },
      { start: ms(14), end: ms(15) },
    ]);
  });
});

// ─── applyFatigueBreaks Phase 1 fix — additional scenarios ───

describe("applyFatigueBreaks Phase 1 fix", () => {
  const dayEnd = ms(17);

  it("reported bug: preserves 30min gap between 150min and 55min blocks", () => {
    // Events: 11:00-13:30 (150min), 14:00-14:55 (55min)
    // Gap = 30min >= minBreak=30 → preserved (real break)
    // Phase 2: 150min block >= 120 → extended to 14:00, merges with 14:00-14:55
    // Final: 11:00-14:55
    const blocks: BusyBlock[] = [
      { start: ms(11), end: ms(13, 30) },
      { start: ms(14), end: ms(14, 55) },
    ];
    const result = applyFatigueBreaks(blocks, 120, 30, 15, dayEnd);
    expect(result).toEqual([{ start: ms(11), end: ms(14, 55) }]);
  });

  it("still closes short gap when combined span exceeds threshold", () => {
    // 9:00-11:00 (120min), 20min gap, 11:20-12:00 (40min)
    // gap=20 < minBreak=30, combined 120+20+40=180 > 120 → closed
    // 9:00-12:00 (180min) → extended to 12:30
    const blocks: BusyBlock[] = [
      { start: ms(9), end: ms(11) },
      { start: ms(11, 20), end: ms(12) },
    ];
    const result = applyFatigueBreaks(blocks, 120, 30, 15, dayEnd);
    expect(result).toEqual([{ start: ms(9), end: ms(12, 30) }]);
  });

  it("preserves large gap even with huge combined span", () => {
    // 9:00-12:00 (180min), 30min gap, 12:30-15:00 (150min)
    // gap=30 >= minBreak=30 → preserved
    // Phase 2: both blocks >= 120 → each extended independently
    const blocks: BusyBlock[] = [
      { start: ms(9), end: ms(12) },
      { start: ms(12, 30), end: ms(15) },
    ];
    const result = applyFatigueBreaks(blocks, 120, 30, 15, dayEnd);
    // 9:00-12:30 (extended) and 12:30-15:30 (extended) → merge to 9:00-15:30
    expect(result).toEqual([{ start: ms(9), end: ms(15, 30) }]);
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
    // Slot is 9:50-10:15 (25min), rounded to 10:00-10:15 (15min) < 30min → dropped
    const slots = [
      { start: new Date(ms(9, 50)).toISOString(), end: new Date(ms(10, 15)).toISOString() },
    ];
    const result = roundSlotStarts(slots, 15, 30);
    expect(result).toEqual([]);
  });

  it("disabled when roundMinutes=0 (pass-through)", () => {
    const slots = [
      { start: new Date(ms(9, 7)).toISOString(), end: new Date(ms(12)).toISOString() },
    ];
    const result = roundSlotStarts(slots, 0, 30);
    expect(new Date(result[0].start).getTime()).toBe(ms(9, 7));
  });

  it("rounds each slot independently", () => {
    const slots = [
      { start: new Date(ms(9, 3)).toISOString(), end: new Date(ms(10)).toISOString() },
      { start: new Date(ms(14, 55)).toISOString(), end: new Date(ms(17)).toISOString() },
    ];
    const result = roundSlotStarts(slots, 15, 30);
    expect(result).toHaveLength(2);
    expect(new Date(result[0].start).getTime()).toBe(ms(9, 15));
    expect(new Date(result[1].start).getTime()).toBe(ms(15));
  });
});
