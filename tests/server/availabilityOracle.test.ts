// Self-tests for the reference oracle. If these fail, the oracle is
// wrong and all subsequent fixture tests are meaningless — fix these first.

import {
  isValidMeeting,
  enumerateValidMeetings,
  DEFAULT_RULES,
} from "./availabilityOracle";
import type { BusyBlock } from "../../src/shared/types";

function t(h: number, m = 0): number {
  return new Date(2026, 0, 5, h, m).getTime();
}

describe("oracle: isValidMeeting", () => {
  it("accepts a meeting with no existing busy", () => {
    expect(isValidMeeting([], { start: t(10), end: t(11) }, DEFAULT_RULES)).toBe(true);
  });

  it("rejects a meeting overlapping existing busy", () => {
    const busy: BusyBlock[] = [{ start: t(10), end: t(11) }];
    expect(isValidMeeting(busy, { start: t(10, 30), end: t(11, 30) }, DEFAULT_RULES)).toBe(false);
  });

  it("rejects a sub-minimum meeting", () => {
    expect(
      isValidMeeting([], { start: t(10), end: t(10, 15) }, DEFAULT_RULES),
    ).toBe(false);
  });

  it("accepts meeting adjacent to a 2hr block if it lands in the required break", () => {
    const busy: BusyBlock[] = [{ start: t(9), end: t(11) }];
    // 11:30-12: gap 30 = break, own run. Valid.
    expect(isValidMeeting(busy, { start: t(11, 30), end: t(12) }, DEFAULT_RULES)).toBe(true);
  });

  it("rejects meeting touching a 2hr block without the required break", () => {
    const busy: BusyBlock[] = [{ start: t(9), end: t(11) }];
    // 11-11:30: gap 0, merges into 9-11:30 = 150min > 120. Invalid.
    expect(isValidMeeting(busy, { start: t(11), end: t(11, 30) }, DEFAULT_RULES)).toBe(false);
    // 11:15-11:45: gap 15 < 30, still same run. Span 9-11:45 = 165 > 120.
    expect(isValidMeeting(busy, { start: t(11, 15), end: t(11, 45) }, DEFAULT_RULES)).toBe(false);
  });

  it("accepts left-anchored meeting (touching prev) if run ≤ threshold", () => {
    // prev 12-13 (1hr), meeting 13-14: run 12-14 = 120 = threshold. Valid.
    const busy: BusyBlock[] = [{ start: t(12), end: t(13) }, { start: t(15), end: t(16) }];
    expect(isValidMeeting(busy, { start: t(13), end: t(14) }, DEFAULT_RULES)).toBe(true);
  });

  it("accepts right-anchored meeting (touching next) if run ≤ threshold", () => {
    // next 15-16 (1hr), meeting 14-15: run 14-16 = 120. Valid.
    const busy: BusyBlock[] = [{ start: t(12), end: t(13) }, { start: t(15), end: t(16) }];
    expect(isValidMeeting(busy, { start: t(14), end: t(15) }, DEFAULT_RULES)).toBe(true);
  });

  it("rejects a meeting spanning a gap and touching both bookends when total > max", () => {
    const busy: BusyBlock[] = [{ start: t(12), end: t(13) }, { start: t(15), end: t(16) }];
    // 13-15 merges both into 12-16 = 240 > 120.
    expect(isValidMeeting(busy, { start: t(13), end: t(15) }, DEFAULT_RULES)).toBe(false);
  });

  it("accepts an island meeting isolated by breaks from both neighbors", () => {
    const busy: BusyBlock[] = [{ start: t(12), end: t(13) }, { start: t(15), end: t(16) }];
    // 13:30-14:30: gaps 30 and 30 → own run 60min. Valid.
    expect(isValidMeeting(busy, { start: t(13, 30), end: t(14, 30) }, DEFAULT_RULES)).toBe(true);
  });

  it("ignores pre-existing over-threshold runs the meeting does not join", () => {
    // 9-12 already over threshold (180 > 120). Meeting 13-13:30 is isolated.
    const busy: BusyBlock[] = [{ start: t(9), end: t(12) }];
    expect(isValidMeeting(busy, { start: t(13), end: t(13, 30) }, DEFAULT_RULES)).toBe(true);
  });

  it("rejects a meeting joining a pre-existing over-threshold run", () => {
    const busy: BusyBlock[] = [{ start: t(9), end: t(12) }];
    // 12-12:30 joins the existing long run.
    expect(isValidMeeting(busy, { start: t(12), end: t(12, 30) }, DEFAULT_RULES)).toBe(false);
  });

  it("accepts minBreakMinutes gap exactly (boundary: break, not continuous)", () => {
    const busy: BusyBlock[] = [{ start: t(9), end: t(11) }];
    // 11:30-12 with gap = 30 is a valid break.
    expect(isValidMeeting(busy, { start: t(11, 30), end: t(12) }, DEFAULT_RULES)).toBe(true);
  });
});

describe("oracle: enumerateValidMeetings", () => {
  it("returns a non-empty set on an open day", () => {
    const v = enumerateValidMeetings([], t(9), t(17), DEFAULT_RULES, 15, [30]);
    // Open day from 9-17 with 30-min meetings on 15-min grid: starts at
    // 9:00, 9:15, …, 16:30. 31 starts.
    expect(v.length).toBe(31);
  });

  it("returns empty when day is fully booked", () => {
    const busy: BusyBlock[] = [{ start: t(9), end: t(17) }];
    const v = enumerateValidMeetings(busy, t(9), t(17), DEFAULT_RULES, 15, [30]);
    expect(v.length).toBe(0);
  });
});
