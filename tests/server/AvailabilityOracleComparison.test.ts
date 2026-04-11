// Runs both the named fixtures and a large set of synthetic permutations
// through the current algorithm and compares the output against the
// reference oracle in availabilityOracle.ts.
//
// The test groups failures into two categories:
//
//   MISSING    — valid meetings the oracle accepts but the algorithm
//                does not offer (completeness bug)
//   OVER-OFFERED — meetings inside an offered slot that the oracle
//                  rejects (soundness bug)
//
// Each fixture becomes an `it` so Jest shows precisely which pattern
// fails. A summary block at the end prints totals across all fixtures.

import { computeFreeSlotsWithFatigue } from "../../src/server/SlotCalculator";
import type { BusyBlock, TimeSlot } from "../../src/shared/types";
import {
  compareWithOracle,
  DEFAULT_RULES,
  fmtBlock,
  fmtBlocks,
  isValidMeeting,
  enumerateValidMeetings,
} from "./availabilityOracle";
import { CALENDAR_FIXTURES, SYNTHETIC_FIXTURES, Fixture } from "./availabilityFixtures";

const MAX_CONT = 120;
const MIN_BREAK = 30;
const MIN_GAP = 15;
const MIN_SLOT = 30;

function t(h: number, m = 0): number {
  return new Date(2026, 0, 5, h, m).getTime();
}

const DAY_START = t(9);
const DAY_END = t(17);

function runAlgorithm(busy: BusyBlock[]): TimeSlot[] {
  return computeFreeSlotsWithFatigue(busy, DAY_START, DAY_END, {
    maxContinuousMinutes: MAX_CONT,
    minBreakMinutes: MIN_BREAK,
    minMinutes: MIN_SLOT,
  });
}
// MIN_GAP is retained only for the old tests; the new algorithm derives
// continuity from minBreakMinutes directly (see SlotCalculator comments).
void MIN_GAP;

function startLabel(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ─────────────────────────────────────────────────────────────────────
// Named fixtures
// ─────────────────────────────────────────────────────────────────────

function runFixtureSuite(label: string, fixtures: Fixture[]) {
  describe(label, () => {
    for (const fix of fixtures) {
      describe(fix.name, () => {
        const busy = fix.busy(t);
        const slots = runAlgorithm(busy);
        // Completeness only requires 30-min meetings to be covered. The
        // emission strategy intentionally trades some long-meeting
        // coverage for non-overlapping output (see comparator docs).
        const cmp = compareWithOracle(busy, slots, DAY_START, DAY_END, DEFAULT_RULES);

        it("has no oracle-missing meetings (completeness)", () => {
          if (cmp.missing.length > 0) {
            throw new Error(
              `[${fix.name}] ${fix.description}\n` +
                `  busy: ${fmtBlocks(busy)}\n` +
                `  offered: ${slots.map((s) => `${fmtBlock({ start: new Date(s.start).getTime(), end: new Date(s.end).getTime() })}`).join(", ") || "(none)"}\n` +
                `  MISSING ${cmp.missing.length}: ${cmp.missing.slice(0, 10).map(fmtBlock).join(", ")}${cmp.missing.length > 10 ? "…" : ""}`,
            );
          }
        });

        it("has no oracle-rejected grid meetings inside offered slots (soundness)", () => {
          if (cmp.overOffered.length > 0) {
            throw new Error(
              `[${fix.name}] ${fix.description}\n` +
                `  busy: ${fmtBlocks(busy)}\n` +
                `  offered: ${slots.map((s) => fmtBlock({ start: new Date(s.start).getTime(), end: new Date(s.end).getTime() })).join(", ")}\n` +
                `  OVER-OFFERED ${cmp.overOffered.length}: ${cmp.overOffered.slice(0, 10).map(fmtBlock).join(", ")}${cmp.overOffered.length > 10 ? "…" : ""}`,
            );
          }
        });

        if (fix.expected30MinStarts) {
          it("matches the hand-derived 30-min start set (oracle agrees with fixture)", () => {
            // Sanity: the oracle's 30-min valid set should equal the fixture's
            // explicit expectation. If this fails, EITHER the oracle is buggy
            // OR the hand-derivation in the fixture is wrong — both demand
            // investigation.
            const valid = enumerateValidMeetings(busy, DAY_START, DAY_END, DEFAULT_RULES, 15, [30]);
            const got = valid.map((m) => startLabel(m.start)).sort();
            const want = [...fix.expected30MinStarts!].sort();
            expect(got).toEqual(want);
          });
        }
      });
    }
  });
}

runFixtureSuite("calendar fixtures (real Apr 13-24 patterns)", CALENDAR_FIXTURES);
runFixtureSuite("synthetic rule-isolation fixtures", SYNTHETIC_FIXTURES);

// ─────────────────────────────────────────────────────────────────────
// Permutation sweep
//
// Generates every 3-block arrangement from the given duration / gap
// menus, subject to day bounds, and runs each through the oracle/algo
// comparison. Failures are collected into a table printed at the end.
// ─────────────────────────────────────────────────────────────────────

interface SweepResult {
  signature: string;
  busy: BusyBlock[];
  missingCount: number;
  overCount: number;
  missing: string;
  offered: string;
}

function blockLabel(b: BusyBlock): string {
  return `${startLabel(b.start)}-${startLabel(b.end)}`;
}

describe("permutation sweep (2-block and 3-block arrangements)", () => {
  const DURATIONS = [30, 60, 90, 120, 150]; // minutes
  const GAPS = [15, 30, 45, 60, 90, 120]; // minutes

  const sweep: SweepResult[] = [];

  // 2-block: prev at 9:00, next separated by gap
  for (const d1 of DURATIONS) {
    for (const gap of GAPS) {
      for (const d2 of DURATIONS) {
        const p1Start = t(9);
        const p1End = p1Start + d1 * 60000;
        const p2Start = p1End + gap * 60000;
        const p2End = p2Start + d2 * 60000;
        if (p2End > DAY_END) continue;
        const busy: BusyBlock[] = [
          { start: p1Start, end: p1End },
          { start: p2Start, end: p2End },
        ];
        const slots = runAlgorithm(busy);
        const cmp = compareWithOracle(busy, slots, DAY_START, DAY_END, DEFAULT_RULES);
        if (cmp.missing.length || cmp.overOffered.length) {
          sweep.push({
            signature: `2B d1=${d1} gap=${gap} d2=${d2}`,
            busy,
            missingCount: cmp.missing.length,
            overCount: cmp.overOffered.length,
            missing: cmp.missing.slice(0, 6).map(fmtBlock).join(", "),
            offered: slots
              .map((s) => blockLabel({ start: new Date(s.start).getTime(), end: new Date(s.end).getTime() }))
              .join(", "),
          });
        }
      }
    }
  }

  // 3-block: prev at 9:00, middle after gap1, next after gap2
  for (const d1 of [30, 60, 120]) {
    for (const g1 of [30, 60, 90]) {
      for (const d2 of [30, 60, 90]) {
        for (const g2 of [30, 60, 90, 120]) {
          for (const d3 of [30, 60, 120]) {
            const p1Start = t(9);
            const p1End = p1Start + d1 * 60000;
            const p2Start = p1End + g1 * 60000;
            const p2End = p2Start + d2 * 60000;
            const p3Start = p2End + g2 * 60000;
            const p3End = p3Start + d3 * 60000;
            if (p3End > DAY_END) continue;
            const busy: BusyBlock[] = [
              { start: p1Start, end: p1End },
              { start: p2Start, end: p2End },
              { start: p3Start, end: p3End },
            ];
            const slots = runAlgorithm(busy);
            const cmp = compareWithOracle(busy, slots, DAY_START, DAY_END, DEFAULT_RULES);
            if (cmp.missing.length || cmp.overOffered.length) {
              sweep.push({
                signature: `3B d1=${d1} g1=${g1} d2=${d2} g2=${g2} d3=${d3}`,
                busy,
                missingCount: cmp.missing.length,
                overCount: cmp.overOffered.length,
                missing: cmp.missing.slice(0, 6).map(fmtBlock).join(", "),
                offered: slots
                  .map((s) => blockLabel({ start: new Date(s.start).getTime(), end: new Date(s.end).getTime() }))
                  .join(", "),
              });
            }
          }
        }
      }
    }
  }

  it("reports zero oracle disagreements across all permutations", () => {
    if (sweep.length > 0) {
      const top = sweep.slice(0, 25);
      const lines = top.map(
        (r) =>
          `  ${r.signature}\n    busy=${r.busy.map(blockLabel).join(", ")}\n    offered=${r.offered || "(none)"}\n    missing=${r.missing || "(none)"} over=${r.overCount}`,
      );
      const total = sweep.length;
      throw new Error(
        `${total} permutation(s) disagree with oracle (showing first ${top.length}):\n${lines.join("\n")}`,
      );
    }
  });
});
