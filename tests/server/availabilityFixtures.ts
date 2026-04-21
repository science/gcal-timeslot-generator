// Library of hand-crafted named fixtures. Each fixture encodes a busy
// schedule and (where relevant) the expected availability, derived from
// first principles — NOT from what the current algorithm happens to
// emit.
//
// Two families:
//
//   1. CALENDAR_FIXTURES — anonymized from the real calendar dump
//      (Apr 13-24 2026). These are the production examples the user
//      reported bugs against.
//
//   2. SYNTHETIC_FIXTURES — hand-crafted to isolate specific rule
//      interactions (single long block, two-block bookend, triple
//      sandwich, etc.).

import type { BusyBlock } from "../../src/lib/types";

export interface Fixture {
  name: string;
  /** Human-readable description of the pattern. */
  description: string;
  busy: (t: (h: number, m?: number) => number) => BusyBlock[];
  /**
   * Explicit expected valid 30-min meeting starts (on the 15-min grid)
   * when provided — derived by hand from the rules, NOT from the current
   * algorithm. Array of "HH:MM" strings. Optional; when omitted, the
   * permutation test relies on the oracle alone.
   */
  expected30MinStarts?: string[];
}

// ─── Real-calendar fixtures (Apr 13-24, 2026), anonymized ───

export const CALENDAR_FIXTURES: Fixture[] = [
  {
    name: "Mon Apr 13",
    description:
      "Short standup at 9:30-10, then back-to-back-to-back 10:30-17 (merged via 15-min micro-gap into one huge run)",
    busy: (t) => [
      { start: t(9, 30), end: t(10) },
      { start: t(10, 30), end: t(11) },
      { start: t(11), end: t(12) },
      { start: t(12), end: t(13) },
      { start: t(13, 15), end: t(16, 30) },
      { start: t(13, 30), end: t(14, 30) },
    ],
    // 9-9:30 is the only free slot. Nothing else survives run collapse.
    expected30MinStarts: ["09:00"],
  },
  {
    name: "Tue Apr 14",
    description:
      "9-11 maxed prev, 12-13 middle block, 15-16 'no meetings'. Classic gap-protection bug triad.",
    busy: (t) => [
      { start: t(9), end: t(11) },
      { start: t(12), end: t(13) },
      { start: t(15), end: t(16) },
    ],
    // Derivation:
    //   9-11 at threshold → requires break until 11:30
    //   11:30-12 adjacent to 12-13 → run 11:30-13 = 90min ≤ 120 ✓
    //   13-14 adjacent to 12-13 → 12-14 = 120 ✓
    //   14-15 adjacent to 15-16 → 14-16 = 120 ✓
    //   16-17 tail
    expected30MinStarts: [
      "11:30", // right-anchored to 12-13
      "13:00", "13:15", "13:30", // left-anchored to 12-13
      "13:45", // own run (gaps 45/45 from neighbors)
      "14:00", "14:15", "14:30", // right-anchored to 15-16
      "16:00", "16:15", "16:30", // trailing
    ],
  },
  {
    name: "Wed Apr 15",
    description: "9-10:30 morning (90min), then 12-13. Two-block day with modest durations.",
    busy: (t) => [
      { start: t(9), end: t(10, 30) },
      { start: t(12), end: t(13) },
    ],
    // 10:30-11 (left, 9-11=120), 11-12 (right, 11-13=120), plus 13-17 tail
    expected30MinStarts: [
      "10:30", // left anchor (run 9-11 = 120)
      "11:00", "11:15", "11:30", // right anchor (run to 13)
      "13:00", "13:15", "13:30", "13:45", "14:00", "14:15", "14:30",
      "14:45", "15:00", "15:15", "15:30", "15:45", "16:00", "16:15", "16:30",
    ],
  },
  {
    name: "Thu Apr 16",
    description: "9-10 then 11-13:30 (next over threshold). Left-anchor only in 10-11 gap.",
    busy: (t) => [
      { start: t(9), end: t(10) },
      { start: t(11), end: t(13, 30) },
    ],
    // 11-13:30 is 150 > 120, so pre-existing long run. Meetings joining it invalid.
    // Left anchor: 10-10:30 (run 9-10:30 = 90min ✓); 10:15-10:45 (gap 15<30 touches prev,
    //   span 9-10:45 = 105 ✓ — yes valid). But 10:30-11 touches next. Next 11-13:30 is
    //   already >threshold; meeting joining it is invalid.
    // After fatigue break on 11-13:30: the meeting at 13:30-14 has gap=0 joining long run → invalid.
    //   But 14-14:30 gap 30 from 13:30 → own run. Valid.
    // NOTE: 10:15 is NOT valid — gap 15 to 11-13:30 merges the whole day
    // into one run (9-13:30 = 270min), so a meeting at 10:15-10:45 would
    // join both bookends. Only 10:00-10:30 (far enough from next) is safe.
    expected30MinStarts: [
      "10:00",
      "14:00", "14:15", "14:30", "14:45", "15:00", "15:15", "15:30", "15:45",
      "16:00", "16:15", "16:30",
    ],
  },
  {
    name: "Fri Apr 17",
    description: "9-11, 11:30-13, 14-17. All gaps at break threshold (30 min).",
    busy: (t) => [
      { start: t(9), end: t(11) },
      { start: t(11, 30), end: t(13) },
      { start: t(14), end: t(17) },
    ],
    // 9-11 at threshold (break required 11-11:30).
    // 11:30-13 joins next run? Gap 0 → prev 11-11:30 gap 0 merges with 11:30-13 if meeting spans.
    // Hmm wait, existing 11:30-13 is 90. 9-11 and 11:30-13: gap 30 → separate runs.
    // Meeting 11-11:30 joins both! 9-11:30 gap 0, 11-11:30 + 11:30-13 gap 0 → super run 9-13 = 240 ✗.
    // Meeting 13-13:30: joins 11:30-13 → run 11:30-13:30 = 120 ✓. Gap to 14-17 = 30 ≥ break.
    // Meeting 13:15-13:45: gap 15 to prev, touches 11:30-13. Span 11:30-13:45 = 135 > 120 ✗.
    // Meeting 13:30-14: gap 30 break from prev. Touches 14-17. Run 13:30-17 = 210 > 120 ✗.
    // 14-17 is pre-existing over threshold; meeting joining is invalid. 13:30-14 invalid.
    expected30MinStarts: ["13:00"],
  },
  {
    name: "Mon Apr 20",
    description: "Morning free, mid-day solid 10:30-17 including stray cancel event.",
    busy: (t) => [
      { start: t(10, 30), end: t(11) },
      { start: t(11), end: t(12) },
      { start: t(12), end: t(13) },
      { start: t(13, 15), end: t(16, 30) },
      { start: t(16, 15), end: t(17, 15) }, // cancelled but still opaque
    ],
    // Merged: [10:30-17]. 9-10:30 free (90 min). Meetings 9 through 10:00 (left anchor: 9-10:30 = 90 ✓).
    // 10:15-10:45: span 9-10:45 (gap 15 triggers run with 10:30) → hmm wait meeting 10:15-10:45
    // Gap to 10:30-17 run = 10:30-10:45 overlap. No actually meeting ends 10:45 and next starts 10:30.
    // They overlap: 10:30 < 10:45. Invalid — overlap with busy.
    // So only meetings ending by 10:30: 9-9:30, 9:15-9:45, 9:30-10, 9:45-10:15, 10-10:30.
    // 9:45-10:15: gap 15 < 30 to 10:30 run, span 9:45-17 = huge. Touches the mega-run → invalid.
    // Meetings NOT touching 10:30-17 (gap ≥ 30) = must end by 10:00. 9-9:30, 9:15-9:45, 9:30-10.
    // 10-10:30 gap 0 touches 10:30-17 mega run (pre-existing over threshold) → invalid.
    expected30MinStarts: ["09:00", "09:15", "09:30"],
  },
  {
    name: "Tue Apr 21",
    description: "Heavy morning 9-11:30 (overlapping meetings), then 12-13.",
    busy: (t) => [
      { start: t(9), end: t(10) },
      { start: t(10), end: t(11) },
      { start: t(10, 30), end: t(11, 30) },
      { start: t(12), end: t(13) },
    ],
    // Merged: [9-11:30, 12-13]. 9-11:30 = 150 > 120 pre-existing.
    // Gap 11:30-12. Meeting 11:30-12: touches prev (joins long run) → invalid.
    //   touches next too (gap 0 to 12-13). Joins mega run 9-13 = 240 ✗.
    // So 11:30-12 gap yields no valid meetings.
    // 13-? : 13-13:30 touches 12-13 → run 12-13:30 = 90 ✓. Etc.
    expected30MinStarts: [
      "13:00", "13:15", "13:30", "13:45", "14:00", "14:15", "14:30",
      "14:45", "15:00", "15:15", "15:30", "15:45", "16:00", "16:15", "16:30",
    ],
  },
  {
    name: "Wed Apr 22",
    description: "9-9:45 + 10-10:30 morning (≈90min after gap-merge), then 12-13:30.",
    busy: (t) => [
      { start: t(9), end: t(9, 45) },
      { start: t(10), end: t(10, 30) },
      { start: t(12), end: t(13, 30) },
    ],
    // 9-9:45 gap 10-10:30: gap 15 min, both in same run (15 < 30). Run 9-10:30, span 90.
    // 10:30-11 (left): run 9-11 = 120 ✓. 11-12 (right): run 11-13:30 = 150 > 120 ✗.
    //   Wait — 12-13:30 = 90min, meeting 11-12 adjacent, run 11-13:30 = 150 > 120 ✗.
    // 11-11:30: run to 13:30? gap 30 = break → new run. Own run 30 ✓.
    //   But 11-11:30 adjacent to 10:30? gap 30 = break → new run. Actually 10:30 is prev block end.
    //   Gap 10:30-11 = 30 = break, not < break → not same run. ✓ Own run.
    //   Not touching 12-13:30 either (gap 30). Own run 30 ✓. Valid.
    // 11:30-12: touches 12-13:30, run 11:30-13:30 = 120 ✓. Valid.
    // 11:15-11:45: gap 15 < 30 to 10:30-9:45 run. Span 9-11:45 = 165 > 120 ✗.
    // So expected:
    // 13:45-14:15 is NOT valid — gap 15 to 12-13:30 touches prev,
    // run 12-14:15 = 135 > 120.
    expected30MinStarts: [
      "10:30", // left anchor (run 9-11 = 120)
      "11:00", // own run (break from both sides)
      "11:30", // right anchor (run 11:30-13:30 = 120)
      "13:30", "14:00", "14:15", "14:30", "14:45", "15:00",
      "15:15", "15:30", "15:45", "16:00", "16:15", "16:30",
    ],
  },
  {
    name: "Thu Apr 23",
    description: "Same shape as Thu Apr 16 (9-10 then 11-13:30).",
    busy: (t) => [
      { start: t(9), end: t(10) },
      { start: t(11), end: t(13, 30) },
    ],
    // Same as Thu Apr 16: 10:15 is NOT valid (gap 15 to next makes all one run).
    expected30MinStarts: [
      "10:00",
      "14:00", "14:15", "14:30", "14:45", "15:00", "15:15", "15:30", "15:45",
      "16:00", "16:15", "16:30",
    ],
  },
  {
    name: "Fri Apr 24",
    description: "9-10, then 11:30-13 (via overlapping events).",
    busy: (t) => [
      { start: t(9), end: t(10) },
      { start: t(11, 30), end: t(12, 30) },
      { start: t(12), end: t(13) },
    ],
    // Merged: [9-10, 11:30-13]. Gap 10-11:30.
    // 10-10:30 left anchor (9-10:30 = 90 ✓); 10:15-10:45 gap 15 touches prev, 9-10:45 = 105 ✓;
    //   10:30-11 gap 30 from prev, 30 from next, own run 30 ✓;
    //   10:45-11:15 gap 45 from prev, 15 from next, joins next → 10:45-13 = 135 ✗;
    //   11-11:30 gap 0 to next, 11-13 = 120 ✓; 11-12 would be 11-13 = 120 ✓ too
    // Actually let me re-enumerate with discipline:
    //   10:00 (30): run 9-10:30 = 90 ✓
    //   10:15 (30→10:45): gap 15 prev, touches. Span 9-10:45 = 105 ✓
    //   10:30 (30→11): gap 30 prev (break), gap 30 next (break). Own run 30 ✓
    //   10:45 (30→11:15): gap 45 prev (break). Gap 15 next, touches 11:30-13. Span 10:45-13 = 135 > 120 ✗
    //   11:00 (30→11:30): gap 60 prev. Gap 0 next, touches. Span 11-13 = 120 ✓
    //   11:15 (30→11:45): gap 75 prev. Touches next (gap 0 end). Span 11:15-13 = 105 ✓
    //   13:00 onward trailing
    // 11:15-11:45 overlaps 11:30-12:30 — invalid by overlap.
    // 13:15-13:45 gap 15 to 11:30-13 run → span 11:30-13:45 = 135 > 120 ✗.
    expected30MinStarts: [
      "10:00", "10:15", "10:30",
      "11:00",
      "13:00", "13:30", "13:45", "14:00", "14:15", "14:30",
      "14:45", "15:00", "15:15", "15:30", "15:45", "16:00", "16:15", "16:30",
    ],
  },
];

// ─── Hand-crafted synthetic fixtures isolating rule interactions ───

export const SYNTHETIC_FIXTURES: Fixture[] = [
  {
    name: "empty day",
    description: "Totally free 9-17. Should offer every grid meeting.",
    busy: () => [],
  },
  {
    name: "single short block",
    description: "One 30-min block mid-morning. Simple two-gap day.",
    busy: (t) => [{ start: t(10), end: t(10, 30) }],
  },
  {
    name: "single 2hr block (at threshold)",
    description:
      "9-11 exactly at threshold. Enforces break 11-11:30. 11:30-17 valid.",
    busy: (t) => [{ start: t(9), end: t(11) }],
  },
  {
    name: "single 3hr block (over threshold)",
    description:
      "9-12 already over threshold. Meeting joining it must be rejected; 12:30 is earliest valid adjacency.",
    busy: (t) => [{ start: t(9), end: t(12) }],
  },
  {
    name: "two 1hr bookends, 2hr middle gap",
    description:
      "The Tuesday pattern in isolation. Left- and right-anchored slots must both be offered.",
    busy: (t) => [
      { start: t(12), end: t(13) },
      { start: t(15), end: t(16) },
    ],
  },
  {
    name: "2hr prev + 1hr next, 1hr gap",
    description:
      "Prev at threshold exhausts left anchor; right anchor to next is only option.",
    busy: (t) => [
      { start: t(9), end: t(11) },
      { start: t(12), end: t(13) },
    ],
  },
  {
    name: "1hr prev + 2hr next, 1hr gap",
    description:
      "Mirror of above — left anchor only; right anchor is zero because next is at threshold.",
    busy: (t) => [
      { start: t(11), end: t(12) },
      { start: t(13), end: t(15) },
    ],
  },
  {
    name: "three 1hr blocks with minimum gaps",
    description:
      "9-10, 10:30-11:30, 12-13. Every gap is exactly 30 min = break. Runs separate.",
    busy: (t) => [
      { start: t(9), end: t(10) },
      { start: t(10, 30), end: t(11, 30) },
      { start: t(12), end: t(13) },
    ],
  },
  {
    name: "micro-gap merges to one run",
    description:
      "9-10 + 10:15-11:15. Gap 15 < break → single run of span 135 > 120. Pre-existing over-threshold.",
    busy: (t) => [
      { start: t(9), end: t(10) },
      { start: t(10, 15), end: t(11, 15) },
    ],
  },
  {
    name: "wide open middle",
    description: "Only 9-9:30 and 16:30-17 busy. Everything in between free.",
    busy: (t) => [
      { start: t(9), end: t(9, 30) },
      { start: t(16, 30), end: t(17) },
    ],
  },
  {
    name: "exact-break gap between two short blocks",
    description:
      "10-10:30 and 11-11:30, gap 30 = break. Meetings at 10:30 and 11 are at boundary.",
    busy: (t) => [
      { start: t(10), end: t(10, 30) },
      { start: t(11), end: t(11, 30) },
    ],
  },
  {
    name: "four stacked 30-min blocks with 15-min gaps",
    description:
      "9-9:30, 9:45-10:15, 10:30-11, 11:15-11:45. All gaps 15 < break → one run span 165 > 120.",
    busy: (t) => [
      { start: t(9), end: t(9, 30) },
      { start: t(9, 45), end: t(10, 15) },
      { start: t(10, 30), end: t(11) },
      { start: t(11, 15), end: t(11, 45) },
    ],
  },
  {
    name: "lunch pocket between two 2hr walls",
    description:
      "9-11, 13-15. Center gap 2hrs. Both bookends maxed — no left or right anchors available, but the middle is free for an isolated meeting.",
    busy: (t) => [
      { start: t(9), end: t(11) },
      { start: t(13), end: t(15) },
    ],
  },
];
