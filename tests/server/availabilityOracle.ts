// Reference oracle for availability correctness. This file encodes the
// *rules* of acceptable availability from first principles. It is the
// ground truth the algorithm is tested against — if the oracle and the
// algorithm disagree, the algorithm is wrong (or the oracle needs to be
// refined and re-agreed upon).
//
// Rules (as stated by the user):
//
//   1. Each busy interval is a "work block". Two busy blocks are part of
//      the same "run" if the gap between them is strictly less than
//      minBreakMinutes. A gap of exactly minBreakMinutes counts as a real
//      break, starting a new run.
//
//   2. A run's "span" = (last block end) − (first block start). Runs must
//      have span ≤ maxContinuousMinutes.
//
//   3. A proposed meeting M is *valid* against a schedule of busy blocks iff
//      M does not overlap an existing block, and the run that contains M
//      in the post-insertion schedule has span ≤ maxContinuousMinutes.
//
//      (Pre-existing over-threshold runs that M does not join are ignored
//      — those reflect schedule decisions already made. The oracle only
//      rules on whether the new meeting *itself* creates or extends a run
//      past the threshold.)
//
//   4. A "free slot" range [a, b] offered to the user is sound iff every
//      meeting with a ≤ start < end ≤ b and (end − start) ≥ minMinutes is
//      valid. The user is allowed to book any sub-interval inside an
//      offered slot, so every such sub-interval must be safe.
//
//   5. The set of offered slots is complete iff every valid meeting
//      (duration ≥ minMinutes, on the grid) is covered by some slot.

import type { BusyBlock, TimeSlot } from "../../src/shared/types";

export interface FatigueRules {
  maxContinuousMinutes: number;
  minBreakMinutes: number;
  minMinutes: number;
}

export const DEFAULT_RULES: FatigueRules = {
  maxContinuousMinutes: 120,
  minBreakMinutes: 30,
  minMinutes: 30,
};

interface Run {
  start: number;
  end: number;
  containsMeeting: boolean;
}

function groupRuns(
  busy: BusyBlock[],
  minBreakMs: number,
  meeting?: BusyBlock,
): Run[] {
  if (busy.length === 0) return [];
  const sorted = [...busy].sort((a, b) => a.start - b.start);
  const runs: Run[] = [];
  let cur: Run = {
    start: sorted[0].start,
    end: sorted[0].end,
    containsMeeting: !!meeting && sorted[0].start === meeting.start && sorted[0].end === meeting.end,
  };
  for (let i = 1; i < sorted.length; i++) {
    const b = sorted[i];
    const gap = b.start - cur.end;
    const isMeeting = !!meeting && b.start === meeting.start && b.end === meeting.end;
    if (gap < minBreakMs) {
      cur.end = Math.max(cur.end, b.end);
      cur.containsMeeting = cur.containsMeeting || isMeeting;
    } else {
      runs.push(cur);
      cur = { start: b.start, end: b.end, containsMeeting: isMeeting };
    }
  }
  runs.push(cur);
  return runs;
}

export function isValidMeeting(
  busy: BusyBlock[],
  meeting: BusyBlock,
  rules: FatigueRules,
): boolean {
  // Rule: no overlap with existing busy
  for (const b of busy) {
    if (meeting.start < b.end && b.start < meeting.end) return false;
  }
  if (meeting.end <= meeting.start) return false;
  const durMin = (meeting.end - meeting.start) / 60000;
  if (durMin < rules.minMinutes) return false;

  const maxMs = rules.maxContinuousMinutes * 60000;
  const breakMs = rules.minBreakMinutes * 60000;
  const runs = groupRuns([...busy, meeting], breakMs, meeting);
  const containing = runs.find((r) => r.containsMeeting);
  if (!containing) return false;
  return containing.end - containing.start <= maxMs;
}

/**
 * Enumerate all valid meetings on a (start, duration) grid. Starts are
 * aligned to gridMinutes; durations are the provided set. This is the
 * canonical set of meetings the user would expect to see offered.
 */
export function enumerateValidMeetings(
  busy: BusyBlock[],
  dayStartMs: number,
  dayEndMs: number,
  rules: FatigueRules,
  gridMinutes: number,
  durations: number[],
): BusyBlock[] {
  const grid = gridMinutes * 60000;
  const out: BusyBlock[] = [];
  for (let s = dayStartMs; s < dayEndMs; s += grid) {
    for (const d of durations) {
      const e = s + d * 60000;
      if (e > dayEndMs) continue;
      const m = { start: s, end: e };
      if (isValidMeeting(busy, m, rules)) out.push(m);
    }
  }
  return out;
}

export function isMeetingCoveredBySlots(
  meeting: BusyBlock,
  slots: TimeSlot[],
): boolean {
  return slots.some((s) => {
    const ss = new Date(s.start).getTime();
    const ee = new Date(s.end).getTime();
    return ss <= meeting.start && ee >= meeting.end;
  });
}

export interface OracleComparison {
  /** Meetings the oracle says are valid but the algorithm does not cover. */
  missing: BusyBlock[];
  /** Grid meetings fully inside an offered slot that the oracle says are invalid. */
  overOffered: BusyBlock[];
  /** For reference: all valid meetings on the grid. */
  validCount: number;
  /** For reference: all offered slots. */
  slotCount: number;
}

/**
 * Compare an algorithm's output slots to the oracle for a given day.
 *
 * - `missing` lists valid meetings the algorithm failed to offer (completeness bug).
 * - `overOffered` lists grid meetings inside an offered slot that the oracle rejects
 *   (soundness bug — offering something the user shouldn't book).
 */
export function compareWithOracle(
  busy: BusyBlock[],
  slots: TimeSlot[],
  dayStartMs: number,
  dayEndMs: number,
  rules: FatigueRules,
  gridMinutes = 15,
  durations: number[] = [30, 45, 60, 90, 120],
): OracleComparison {
  const valid = enumerateValidMeetings(busy, dayStartMs, dayEndMs, rules, gridMinutes, durations);
  const missing = valid.filter((m) => !isMeetingCoveredBySlots(m, slots));

  // Soundness: walk every grid meeting fully inside each slot; check oracle.
  const overOffered: BusyBlock[] = [];
  const grid = gridMinutes * 60000;
  for (const slot of slots) {
    const ss = new Date(slot.start).getTime();
    const ee = new Date(slot.end).getTime();
    for (let s = ss; s < ee; s += grid) {
      for (const d of durations) {
        const e = s + d * 60000;
        if (e > ee) continue;
        const m = { start: s, end: e };
        if (!isValidMeeting(busy, m, rules)) overOffered.push(m);
      }
    }
  }
  return { missing, overOffered, validCount: valid.length, slotCount: slots.length };
}

// ─── Formatting helpers for readable test failures ───

export function fmt(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const m = d.getMinutes();
  const hh = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const ap = h >= 12 ? "pm" : "am";
  return m === 0 ? `${hh}${ap}` : `${hh}:${String(m).padStart(2, "0")}${ap}`;
}

export function fmtBlock(b: BusyBlock): string {
  return `${fmt(b.start)}-${fmt(b.end)}`;
}

export function fmtBlocks(bs: BusyBlock[]): string {
  return bs.map(fmtBlock).join(", ");
}
