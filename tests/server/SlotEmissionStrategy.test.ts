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
//          → no annotation UNLESS the slot touches a sibling (rule 4).
//
//   3. The slot's [start, end] must be SOUND for the annotation: every
//      meeting of duration ≤ X (or ≤ 60 if no annotation) placed fully
//      inside the slot must be valid.
//
//   4. Adjacency exception: a minMinutes-length slot whose cap equals
//      its length gets an explicit "(max 30 min)" label if it touches
//      a sibling slot at either boundary. Without the label, three
//      back-to-back 30-min slots visually merge into one 90-min run
//      and a reader wrongly assumes a 60-min meeting can span them.
//      Standalone minMinutes slots stay unannotated because they can't
//      be confused for part of a longer bookable window.

import { computeFreeSlotsWithFatigue } from "../../src/lib/slot-calculator";
import type { BusyBlock, TimeSlot } from "../../src/lib/types";

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

describe("fallback — split into individual slots when no core reaches 60", () => {
  it("1.5h + 1h gap + 1h: splits the 12-1 gap into two 30-min slots instead of annotating", () => {
    // busy: [10:30-12, 13-14]. Gap [12, 13] has every sub-range
    // capped at 30 min. Emit two 30-min slots instead of
    // "12pm-1pm (max 30 min)".
    const busy: BusyBlock[] = [
      { start: t(10, 30), end: t(12) },
      { start: t(13), end: t(14) },
    ];
    const slots = run(busy);
    const a = slots.find(
      (s) => new Date(s.start).getTime() === t(12) && new Date(s.end).getTime() === t(12, 30),
    );
    const b = slots.find(
      (s) => new Date(s.start).getTime() === t(12, 30) && new Date(s.end).getTime() === t(13),
    );
    expect(a).toBeDefined();
    expect(a!.maxMinutes).toBe(30);
    expect(b).toBeDefined();
    expect(b!.maxMinutes).toBe(30);
    // Ensure the "one big annotated slot" version is NOT present.
    const big = slots.find(
      (s) => new Date(s.start).getTime() === t(12) && new Date(s.end).getTime() === t(13),
    );
    expect(big).toBeUndefined();
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

describe("boundary-trim splitting — preserve big core slots", () => {
  it("1.5h + 2h gap + 30min: splits off tight 10:30-11 and keeps 11-12:30 full", () => {
    // busy: [9-10:30, 12:30-1]. The 10:30 start has X=30 (touches 1.5h
    // prev block tightly), but dropping it leaves a [11, 12:30] core
    // where X=90. Expected: '10:30am-11am' + '11am-12:30pm', both
    // unannotated.
    const busy: BusyBlock[] = [
      { start: t(9), end: t(10, 30) },
      { start: t(12, 30), end: t(13) },
    ];
    const slots = run(busy);
    // 10:30-11 and 11-12:30 must both be present, both without annotation.
    const first = slots.find(
      (s) => new Date(s.start).getTime() === t(10, 30) && new Date(s.end).getTime() === t(11),
    );
    const core = slots.find(
      (s) => new Date(s.start).getTime() === t(11) && new Date(s.end).getTime() === t(12, 30),
    );
    expect(first).toBeDefined();
    expect(first!.maxMinutes).toBe(30);
    expect(core).toBeDefined();
    expect(core!.maxMinutes).toBeUndefined();
  });

  it("30min prev + 2h gap + 1.5h next: splits off tight tail and keeps 9-10:30 full", () => {
    // busy: [9:30-10, 12-1:30]. The 11:30 tail start touches the
    // 1.5h next block too tightly (run 90+60=150). Dropping it leaves
    // a [10, 11:30] core where X=90. Expected split: big core first,
    // 30-min tail.
    const busy: BusyBlock[] = [
      { start: t(9, 30), end: t(10) },
      { start: t(12), end: t(13, 30) },
    ];
    const slots = run(busy);
    const core = slots.find(
      (s) => new Date(s.start).getTime() === t(10) && new Date(s.end).getTime() === t(11, 30),
    );
    const tail = slots.find(
      (s) => new Date(s.start).getTime() === t(11, 30) && new Date(s.end).getTime() === t(12),
    );
    expect(core).toBeDefined();
    expect(core!.maxMinutes).toBeUndefined();
    expect(tail).toBeDefined();
    expect(tail!.maxMinutes).toBe(30);
  });

  it("1.5h + 2h gap + 1.5h: three slots — tight ends, unannotated middle", () => {
    // busy: [9-10:30, 12:30-2]. Both edges are tight (each touches
    // 1.5h bookend). Middle [11, 12] supports d=60 own-run. Expect
    // three slots, none annotated.
    const busy: BusyBlock[] = [
      { start: t(9), end: t(10, 30) },
      { start: t(12, 30), end: t(14) },
    ];
    const slots = run(busy);
    const first = slots.find(
      (s) => new Date(s.start).getTime() === t(10, 30) && new Date(s.end).getTime() === t(11),
    );
    const middle = slots.find(
      (s) => new Date(s.start).getTime() === t(11) && new Date(s.end).getTime() === t(12),
    );
    const last = slots.find(
      (s) => new Date(s.start).getTime() === t(12) && new Date(s.end).getTime() === t(12, 30),
    );
    expect(first).toBeDefined();
    expect(first!.maxMinutes).toBe(30);
    expect(middle).toBeDefined();
    expect(middle!.maxMinutes).toBeUndefined();
    expect(last).toBeDefined();
    expect(last!.maxMinutes).toBe(30);
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

describe("cojoined 30-min disambiguation (Wed Apr 22 ground truth)", () => {
  // Real calendar: 9-9:45, 10-10:30, 12-1, 1-1:30. Runs [9, 10:30] and
  // [12, 13:30] both span 90 min, so every start in the 10:30-12 gap
  // caps at 30 min. Without labels, the output "10:30-11, 11-11:30,
  // 11:30-12" visually merges into one 90-min block and a reader
  // assumes they can book 60 min across it. The adjacency post-pass
  // annotates each touching 30-min slot so the cap is explicit.
  const busy: BusyBlock[] = [
    { start: t(9), end: t(9, 45) },
    { start: t(10), end: t(10, 30) },
    { start: t(12), end: t(13) },
    { start: t(13), end: t(13, 30) },
  ];

  it("annotates each of the three back-to-back 30-min slots as (max 30 min)", () => {
    const slots = run(busy);
    const windows: Array<[number, number]> = [
      [t(10, 30), t(11)],
      [t(11), t(11, 30)],
      [t(11, 30), t(12)],
    ];
    for (const [a, b] of windows) {
      const slot = slots.find(
        (s) => new Date(s.start).getTime() === a && new Date(s.end).getTime() === b,
      );
      expect(slot).toBeDefined();
      expect(slot!.maxMinutes).toBe(30);
    }
  });

  it("annotates the 1:30-2 tail that touches the 2-5 long block", () => {
    const slots = run(busy);
    const tail = slots.find(
      (s) => new Date(s.start).getTime() === t(13, 30) && new Date(s.end).getTime() === t(14),
    );
    expect(tail).toBeDefined();
    expect(tail!.maxMinutes).toBe(30);
  });

  it("leaves the long 2-5 trailing slot unannotated (length already communicates freedom)", () => {
    const slots = run(busy);
    const long = slots.find(
      (s) => new Date(s.start).getTime() === t(14) && new Date(s.end).getTime() === t(17),
    );
    expect(long).toBeDefined();
    expect(long!.maxMinutes).toBeUndefined();
  });
});

describe("standalone 30-min slot stays unannotated (adjacency rule does not misfire)", () => {
  it("a single 30-min slot with no touching sibling keeps no annotation", () => {
    // busy: [9-11, 11:30-13]. The only free region before lunch is the
    // 30-min window [11, 11:30], and no meeting inside is valid (joining
    // both bookends makes a 240-min run), so no slot emits from it. The
    // afternoon has a clean [13, 17] gap. There is ONE slot at 11:30-12?
    // Actually no — [11, 11:30] has no valid starts, so no 30-min slot
    // emits there. Use a different setup: [9-11, 12-13]. Region [11, 12]
    // only has a valid 11:30 start, region [13, 17] emits a long slot
    // starting at 13. The 11:30-12 slot is 30 min, and the next slot
    // (13-17) does NOT touch it (12 ≠ 13), so the adjacency rule leaves
    // it unannotated.
    const busy: BusyBlock[] = [
      { start: t(9), end: t(11) },
      { start: t(12), end: t(13) },
    ];
    const slots = run(busy);
    const standalone = slots.find(
      (s) => new Date(s.start).getTime() === t(11, 30) && new Date(s.end).getTime() === t(12),
    );
    expect(standalone).toBeDefined();
    expect(standalone!.maxMinutes).toBeUndefined();
  });
});
