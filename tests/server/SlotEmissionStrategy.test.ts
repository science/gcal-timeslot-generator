// New slot-emission contract (April 2026):
//
//   1. Each raw free gap produces non-overlapping slots — no more
//      simultaneously emitting "left-anchored", "right-anchored", and
//      "middle island" slots that confuse the user with 3 overlapping
//      ranges in a 2hr window.
//
//   2. The annotation rule is "annotate only when the slot is more
//      restrictive than a normal meeting." User assumption: a normal
//      meeting is ≤ 1 hour. Therefore:
//        - max valid duration ≥ 60 min  → no annotation
//        - max valid duration < 60 min and slot length > X → "(max X min)"
//        - slot length == X (e.g. a 30-min slot supporting a 30-min meeting)
//          → no annotation; the slot length already communicates the cap
//
//   3. The slot's [start, end] must be SOUND for the annotation: every
//      meeting of duration ≤ X (or ≤ 60 if no annotation) placed fully
//      inside the slot must be valid.

import { computeFreeSlotsWithFatigue } from "../../src/server/SlotCalculator";
import type { BusyBlock, TimeSlot } from "../../src/shared/types";

const RULES = { maxContinuousMinutes: 120, minBreakMinutes: 30, minMinutes: 30 };

function t(h: number, m = 0): number {
  return new Date(2026, 0, 5, h, m).getTime();
}
function hm(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return t(h, m);
}
function fmt(slot: TimeSlot): string {
  const a = new Date(slot.start);
  const b = new Date(slot.end);
  const tag = slot.maxMinutes !== undefined ? ` (max ${slot.maxMinutes}m)` : "";
  const pp = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${pp(a)}-${pp(b)}${tag}`;
}
function run(busy: BusyBlock[]): TimeSlot[] {
  return computeFreeSlotsWithFatigue(busy, t(9), t(17), RULES);
}

// Helper: assert exact slot list (order-independent), with optional max.
type Expected = { start: string; end: string; max?: number };
function expectSlots(actual: TimeSlot[], expected: Expected[]): void {
  const got = actual.map(fmt).sort();
  const want = expected
    .map((e) => {
      const slot: TimeSlot = {
        start: new Date(hm(e.start)).toISOString(),
        end: new Date(hm(e.end)).toISOString(),
      };
      if (e.max !== undefined) slot.maxMinutes = e.max;
      return fmt(slot);
    })
    .sort();
  expect(got).toEqual(want);
}

describe("Tuesday Apr 14 — non-overlapping slot emission", () => {
  // busy: [9-11, 12-13, 15-16]. Was emitting 5 slots including overlapping
  // 1pm-2pm / 2pm-3pm / 1:30pm-2:30pm in the [13-15] gap.
  const busy: BusyBlock[] = [
    { start: t(9), end: t(11) },
    { start: t(12), end: t(13) },
    { start: t(15), end: t(16) },
  ];

  it("produces non-overlapping slots only", () => {
    const slots = run(busy);
    // Sort and check no slot overlaps the next
    const sorted = slots
      .slice()
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    for (let i = 1; i < sorted.length; i++) {
      const prevEnd = new Date(sorted[i - 1].end).getTime();
      const curStart = new Date(sorted[i].start).getTime();
      expect(curStart).toBeGreaterThanOrEqual(prevEnd);
    }
  });

  it("emits exactly the expected non-overlapping slot set", () => {
    const slots = run(busy);
    // With a 30-min meeting grid, every :00/:30 start in [13, 15] supports
    // up to a 60-min meeting (e.g. 13-14, 13:30-14:30, 14-15 all have
    // runs ≤ 2h). No annotation needed — slot looks clean.
    expectSlots(slots, [
      { start: "11:30", end: "12:00" },
      { start: "13:00", end: "15:00" },
      { start: "16:00", end: "17:00" },
    ]);
  });
});

describe("Thursday Apr 16 — no '(max 2h)' annotation", () => {
  // busy: [9-10, 11-13:30]. Old algorithm emitted [14, 17] (max 120 min).
  // New rule: 120 ≥ 60 → no annotation.
  const busy: BusyBlock[] = [
    { start: t(9), end: t(10) },
    { start: t(11), end: t(13, 30) },
  ];

  it("never annotates a slot whose max valid duration is ≥ 60 min", () => {
    const slots = run(busy);
    for (const s of slots) {
      if (s.maxMinutes !== undefined) {
        expect(s.maxMinutes).toBeLessThan(60);
      }
    }
  });

  it("emits the expected slot set", () => {
    expectSlots(run(busy), [
      { start: "10:00", end: "10:30" },
      { start: "14:00", end: "17:00" },
    ]);
  });
});

describe("annotation rule — small constrained slots", () => {
  it("annotates a slot where X < 60 and slot length > X", () => {
    // 1.5h prev + 90-min gap + 1h next: every grid-aligned start in the
    // gap touches either side on a longer-meeting attempt, and X=30.
    // Slot length is 90 min, so the (max 30m) annotation applies.
    const busy: BusyBlock[] = [
      { start: t(9), end: t(10, 30) },   // 1.5h prev
      { start: t(12), end: t(13) },       // 1h next
    ];
    const slots = run(busy);
    const middle = slots.find(
      (s) => new Date(s.start).getTime() === t(10, 30) && new Date(s.end).getTime() === t(12),
    );
    expect(middle).toBeDefined();
    expect(middle!.maxMinutes).toBe(30);
  });

  it("does not annotate a slot whose length equals its max duration", () => {
    // Single 30-min slot — annotation would be redundant
    const busy: BusyBlock[] = [
      { start: t(9), end: t(11) },
      { start: t(12), end: t(13) },
    ];
    const slots = run(busy);
    const slot = slots.find(
      (s) => new Date(s.start).getTime() === t(11, 30) && new Date(s.end).getTime() === t(12),
    );
    expect(slot).toBeDefined();
    expect(slot!.maxMinutes).toBeUndefined();
  });
});

describe("grid-aligned cleanliness — no 15-min stragglers poison slots", () => {
  it("1h block + 3h trailing: emits a clean '2pm-5pm' with no annotation", () => {
    // Previously this emitted '2pm-5pm (max 45m)' because the 14:15
    // off-grid start imposed a 45-min cap. With a 30-min grid, 14:15 is
    // ignored and the slot supports 2-hour meetings cleanly.
    const busy: BusyBlock[] = [
      { start: t(10, 30), end: t(12) },
      { start: t(13), end: t(14) },
    ];
    const slots = run(busy);
    const trailing = slots.find(
      (s) => new Date(s.start).getTime() === t(14) && new Date(s.end).getTime() === t(17),
    );
    expect(trailing).toBeDefined();
    expect(trailing!.maxMinutes).toBeUndefined();
  });
});

describe("non-overlap is universal across permutations", () => {
  // Spot-check: permutation sweep should never emit overlapping slots.
  const cases: [string, BusyBlock[]][] = [
    ["3 short blocks", [
      { start: t(10), end: t(10, 30) },
      { start: t(12), end: t(13) },
      { start: t(14), end: t(15) },
    ]],
    ["lunch pocket", [
      { start: t(9), end: t(11) },
      { start: t(13), end: t(15) },
    ]],
    ["bookend 30s", [
      { start: t(9), end: t(9, 30) },
      { start: t(16, 30), end: t(17) },
    ]],
  ];
  for (const [label, busy] of cases) {
    it(`${label}: emits no overlapping slots`, () => {
      const slots = run(busy)
        .slice()
        .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
      for (let i = 1; i < slots.length; i++) {
        const prevEnd = new Date(slots[i - 1].end).getTime();
        const curStart = new Date(slots[i].start).getTime();
        expect(curStart).toBeGreaterThanOrEqual(prevEnd);
      }
    });
  }
});
