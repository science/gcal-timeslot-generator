import type { TimeSlot, DaySlots, SlotOptions, BusyBlock } from "../shared/types";

export function getDefaultSlotOptions(): SlotOptions {
  return {
    numDays: 5,
    startHour: 9,
    endHour: 17,
    minMinutes: 30,
    includeToday: false,
    maxContinuousMinutes: 120,
    minBreakMinutes: 30,
    minGapMinutes: 15,
    calendarMode: 'mine',
    roundMinutes: 15,
  };
}

export function getNextBusinessDays(numDays: number, includeToday: boolean, endHour: number): Date[] {
  const days: Date[] = [];
  const now = new Date();
  const current = new Date();
  current.setHours(0, 0, 0, 0);

  if (includeToday) {
    const dow = current.getDay();
    if (dow !== 0 && dow !== 6 && now.getHours() < endHour) {
      days.push(new Date(current));
    }
    current.setDate(current.getDate() + 1);
  } else {
    current.setDate(current.getDate() + 1);
  }

  while (days.length < numDays) {
    const dow = current.getDay();
    if (dow !== 0 && dow !== 6) {
      days.push(new Date(current));
    }
    current.setDate(current.getDate() + 1);
  }
  return days;
}

export function formatDayLabel(date: Date): string {
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${dayNames[date.getDay()]}, ${monthNames[date.getMonth()]} ${date.getDate()}`;
}

export function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isDeclined(event: GoogleAppsScript.Calendar.CalendarEvent): boolean {
  const status = event.getMyStatus();
  return status === CalendarApp.GuestStatus.NO;
}

function isTransparentAllDay(event: GoogleAppsScript.Calendar.CalendarEvent): boolean {
  if (!event.isAllDayEvent()) return false;
  const title = event.getTitle().toLowerCase();
  if (title.includes("holiday") && event.getGuestList().length === 0) return true;
  return false;
}

export function mergeBusyBlocks(blocks: BusyBlock[]): BusyBlock[] {
  if (blocks.length === 0) return [];
  const sorted = blocks.slice().sort((a, b) => a.start - b.start);
  const merged: BusyBlock[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i].start <= last.end) {
      last.end = Math.max(last.end, sorted[i].end);
    } else {
      merged.push({ ...sorted[i] });
    }
  }
  return merged;
}

// ─────────────────────────────────────────────────────────────────────
// Fatigue-aware free slot computation.
//
// Rules the algorithm enforces:
//
//   1. Merge raw busy blocks into runs: two blocks are part of the same
//      run iff the gap between them is < minBreakMinutes.
//   2. A proposed meeting's "containing run" after insertion must have
//      span ≤ maxContinuousMinutes.
//   3. A free slot [a, b] is sound iff every meeting of duration ≥
//      minMinutes and ≤ slot.maxMinutes placed fully inside [a, b]
//      satisfies (2).
//
// Emission strategy (April 2026 revision):
//
//   For each raw free gap between runs (and at day edges):
//
//   1. Enumerate all valid 30-min meeting starts on the 15-min grid.
//   2. Group consecutive valid starts into contiguous regions.
//   3. Each region becomes ONE non-overlapping slot spanning from the
//      first valid start to (last valid start + minMinutes).
//   4. Compute X = the largest meeting duration such that EVERY meeting
//      of length ≤ X positioned anywhere on the grid inside the slot is
//      valid. Annotate with maxMinutes only when X < 60 (the user's
//      assumed normal-meeting ceiling) AND slot length > X.
//
// This produces non-overlapping slots and never annotates a slot whose
// constraint is looser than a normal 1-hour meeting.
// ─────────────────────────────────────────────────────────────────────

export interface FreeSlotOptions {
  maxContinuousMinutes: number;
  minBreakMinutes: number;
  minMinutes: number;
}

interface Run {
  start: number;
  end: number;
}

/** Group already-merged busy blocks into runs separated by gaps ≥ minBreakMs. */
function groupRuns(merged: BusyBlock[], minBreakMs: number): Run[] {
  if (merged.length === 0) return [];
  const runs: Run[] = [{ start: merged[0].start, end: merged[0].end }];
  for (let i = 1; i < merged.length; i++) {
    const last = runs[runs.length - 1];
    if (merged[i].start - last.end < minBreakMs) {
      last.end = Math.max(last.end, merged[i].end);
    } else {
      runs.push({ start: merged[i].start, end: merged[i].end });
    }
  }
  return runs;
}

function roundStart(ms: number, roundMs: number): number {
  if (roundMs <= 0) return ms;
  const r = ms % roundMs;
  return r === 0 ? ms : ms + (roundMs - r);
}

function makeSlot(start: number, end: number, maxMin?: number): TimeSlot {
  const slot: TimeSlot = {
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
  };
  if (maxMin !== undefined) slot.maxMinutes = maxMin;
  return slot;
}

/** Threshold above which we don't bother annotating maxMinutes. */
const NORMAL_MEETING_MAX_MS = 60 * 60000;

// Grid resolution: meetings are enumerated at minMinutes increments.
// This means the algorithm is sound "for meetings starting on the
// minMinutes grid" — e.g. with minMinutes=30, meeting starts are :00
// and :30. Users who book at :15 or :45 are outside the guarantee and
// should verify manually.
//
// Rationale: 15-min grid pollutes otherwise-clean slots. A 2pm-5pm
// free block next to a 1-2pm busy block has a low local max at 2:15
// (because 2:15-3:15 touches the 1-2 run too tightly), which drags
// the whole slot's annotated cap down. Nobody books meetings at 2:15,
// so paying that cost for theoretical completeness is wrong.

/**
 * Is a proposed meeting [ms, me] valid against a gap with optional left
 * and right run bookends? This is the canonical fatigue rule:
 *   - If the meeting touches the left run (gap < breakMs), the combined
 *     run span is L + (me - leftEnd). Must be ≤ maxMs.
 *   - Symmetric for right.
 *   - If it touches both, the run is L + G + R.
 *   - If it touches neither, own-run span = me - ms. Must be ≤ maxMs.
 */
function isMeetingValidInGap(
  ms: number,
  me: number,
  left: Run | undefined,
  right: Run | undefined,
  maxMs: number,
  breakMs: number,
): boolean {
  if (me <= ms) return false;
  const touchesLeft = left ? ms - left.end < breakMs : false;
  const touchesRight = right ? right.start - me < breakMs : false;
  const L = left ? left.end - left.start : 0;
  const R = right ? right.end - right.start : 0;
  if (touchesLeft && touchesRight) {
    return L + (right!.start - left!.end) + R <= maxMs;
  }
  if (touchesLeft) {
    return L + (me - left!.end) <= maxMs;
  }
  if (touchesRight) {
    return R + (right!.start - ms) <= maxMs;
  }
  return me - ms <= maxMs;
}

/**
 * Largest meeting duration X (a multiple of minMs — the emission grid)
 * such that EVERY meeting of length ≤ X positioned on the grid inside
 * [a, b] is valid. Returns 0 if no minMs-length meeting in [a, b] is
 * valid. Note the loop increments d by minMs, so X is always a multiple
 * of minMs (on the 30-min default grid: X ∈ {30, 60, 90, 120, ...}).
 */
function maxValidDurationInRegion(
  a: number,
  b: number,
  left: Run | undefined,
  right: Run | undefined,
  maxMs: number,
  breakMs: number,
  minMs: number,
): number {
  let maxValid = 0;
  for (let d = minMs; a + d <= b; d += minMs) {
    let allOk = true;
    for (let s = a; s + d <= b; s += minMs) {
      if (!isMeetingValidInGap(s, s + d, left, right, maxMs, breakMs)) {
        allOk = false;
        break;
      }
    }
    if (!allOk) break; // monotone: longer d at the failing position also fails
    maxValid = d;
  }
  return maxValid;
}

/** Round a timestamp up to the next multiple of minMs, anchored at dayStartMs. */
function nextGridStart(ms: number, dayStartMs: number, minMs: number): number {
  if (ms <= dayStartMs) return dayStartMs;
  const offset = ms - dayStartMs;
  const r = offset % minMs;
  return r === 0 ? ms : ms + (minMs - r);
}

/**
 * For one raw free gap [a, b] bounded by (optional) left and right runs,
 * emit non-overlapping slots. Grid starts are anchored at dayStartMs.
 */
function slotsForGap(
  a: number,
  b: number,
  left: Run | undefined,
  right: Run | undefined,
  maxMs: number,
  breakMs: number,
  minMs: number,
  dayStartMs: number,
): TimeSlot[] {
  const G = b - a;
  if (G < minMs) return [];

  const L = left ? left.end - left.start : 0;
  const R = right ? right.end - right.start : 0;

  // Fast path: a full-gap meeting touching both neighbors stays under
  // threshold, so the whole gap is unconstrained. Single slot, no
  // annotation (the slot's own length is the cap, and that cap ≤ maxMs).
  if (L + G + R <= maxMs) {
    const aligned = nextGridStart(a, dayStartMs, minMs);
    if (aligned + minMs > b) return [];
    return [makeSlot(aligned, b)];
  }

  // Enumerate valid grid-aligned minMs meeting starts in the gap.
  // Starts are anchored to dayStartMs so a meeting ending at 10:45
  // doesn't cause the next slot's grid to be offset by 15 minutes.
  const validStarts: number[] = [];
  const gridStart = nextGridStart(a, dayStartMs, minMs);
  for (let s = gridStart; s + minMs <= b; s += minMs) {
    if (isMeetingValidInGap(s, s + minMs, left, right, maxMs, breakMs)) {
      validStarts.push(s);
    }
  }
  if (validStarts.length === 0) return [];

  // Split the valid-starts list into maximal contiguous runs (on the
  // minMs grid). Each contiguous run is an independent emission region
  // because a hole in the valid-starts list means some meeting start
  // between them is unsafe, so we can't pretend the two halves are one.
  const regions: number[][] = [];
  let cur: number[] = [validStarts[0]];
  for (let i = 1; i < validStarts.length; i++) {
    if (validStarts[i] === cur[cur.length - 1] + minMs) {
      cur.push(validStarts[i]);
    } else {
      regions.push(cur);
      cur = [validStarts[i]];
    }
  }
  regions.push(cur);

  const out: TimeSlot[] = [];
  for (const region of regions) {
    out.push(...emitForRegion(region, left, right, maxMs, breakMs, minMs));
  }
  return out;
}

/**
 * Emit slots for one contiguous run of valid grid-aligned minMs starts.
 *
 * Strategy: try the whole region first. If its X (max uniformly valid
 * duration) is ≥ 60 min, emit a single unannotated slot. Otherwise,
 * search for the longest sub-range [i..j] whose X ≥ 60 min and peel it
 * out as the "core" slot; recursively emit the prefix and suffix as
 * separate slots. This preserves a boundary-constrained position (e.g.
 * a start that tightly touches a 2hr bookend) as its own short slot
 * rather than dragging a whole 1-hour-capable slot down to "max 30 min".
 * Falls back to a single annotated slot when no sub-range is ≥ 60.
 */
function emitForRegion(
  starts: number[],
  left: Run | undefined,
  right: Run | undefined,
  maxMs: number,
  breakMs: number,
  minMs: number,
): TimeSlot[] {
  if (starts.length === 0) return [];

  const slotStart = starts[0];
  const slotEnd = starts[starts.length - 1] + minMs;
  const X = maxValidDurationInRegion(slotStart, slotEnd, left, right, maxMs, breakMs, minMs);

  if (X >= NORMAL_MEETING_MAX_MS || starts.length === 1) {
    return [slotWithCap(slotStart, slotEnd, X)];
  }

  // Find the largest contiguous sub-range [i..j] whose core slot has
  // X ≥ NORMAL_MEETING_MAX_MS. Prefer longer ranges; ties broken by
  // earlier start.
  let bestI = -1;
  let bestJ = -1;
  let bestLen = 0;
  for (let i = 0; i < starts.length; i++) {
    for (let j = i; j < starts.length; j++) {
      const coreStart = starts[i];
      const coreEnd = starts[j] + minMs;
      const coreX = maxValidDurationInRegion(coreStart, coreEnd, left, right, maxMs, breakMs, minMs);
      if (coreX >= NORMAL_MEETING_MAX_MS) {
        const len = j - i + 1;
        if (len > bestLen) {
          bestLen = len;
          bestI = i;
          bestJ = j;
        }
      }
    }
  }

  if (bestI === -1) {
    // No core reaches the normal-meeting threshold. Rather than emit one
    // big annotated slot (which hides structure), split into individual
    // minMs-length slots — each stands alone as a clearly-bounded 30 min
    // option. Recipient sees two "1pm-1:30pm, 1:30pm-2pm" entries instead
    // of a single confusing "1pm-2pm (max 30 min)".
    return starts.map((s) => slotWithCap(s, s + minMs, minMs));
  }

  const prefix = starts.slice(0, bestI);
  const core = starts.slice(bestI, bestJ + 1);
  const suffix = starts.slice(bestJ + 1);
  const coreStart = core[0];
  const coreEnd = core[core.length - 1] + minMs;
  const coreX = maxValidDurationInRegion(coreStart, coreEnd, left, right, maxMs, breakMs, minMs);

  return [
    ...emitForRegion(prefix, left, right, maxMs, breakMs, minMs),
    slotWithCap(coreStart, coreEnd, coreX),
    ...emitForRegion(suffix, left, right, maxMs, breakMs, minMs),
  ];
}

/**
 * Post-pass: annotate minMs-length slots that touch a sibling slot at
 * either boundary. Three back-to-back 30-min slots visually merge into
 * one 90-min run, and a reader assumes they can book 60 min across
 * them. An explicit "(max 30 min)" label debunks the visual merge.
 * Standalone 30-min slots (no touching sibling) keep the unannotated
 * form — their length alone is unambiguous. Two touching slots within
 * a day always share a free region (a busy block between them would
 * create a gap), so adjacency is a reliable proxy for "this was a
 * fatigue-driven split, not a full-width slot."
 */
function annotateTouchingMinSlots(slots: TimeSlot[], minMs: number): TimeSlot[] {
  if (slots.length < 2) return slots;
  const sorted = slots
    .slice()
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  const minMinutes = minMs / 60000;
  return sorted.map((slot, i) => {
    if (slot.maxMinutes !== undefined) return slot;
    const startMs = new Date(slot.start).getTime();
    const endMs = new Date(slot.end).getTime();
    if (endMs - startMs !== minMs) return slot;
    const touchesPrev = i > 0 && new Date(sorted[i - 1].end).getTime() === startMs;
    const touchesNext = i < sorted.length - 1 && new Date(sorted[i + 1].start).getTime() === endMs;
    if (touchesPrev || touchesNext) {
      return { ...slot, maxMinutes: minMinutes };
    }
    return slot;
  });
}

/**
 * Wrap a slot range with an optional maxMinutes annotation: only
 * annotate when the effective cap is under the normal-meeting ceiling
 * AND the slot has more room than that cap (otherwise the length
 * communicates the cap on its own).
 */
function slotWithCap(slotStart: number, slotEnd: number, X: number): TimeSlot {
  const slotLen = slotEnd - slotStart;
  let maxMinutes: number | undefined;
  if (X < NORMAL_MEETING_MAX_MS && slotLen > X) {
    maxMinutes = X / 60000;
  }
  return makeSlot(slotStart, slotEnd, maxMinutes);
}

export function computeFreeSlotsWithFatigue(
  busy: BusyBlock[],
  dayStartMs: number,
  dayEndMs: number,
  opts: FreeSlotOptions,
): TimeSlot[] {
  const maxMs = opts.maxContinuousMinutes * 60000;
  const breakMs = opts.minBreakMinutes * 60000;
  const minMs = opts.minMinutes * 60000;

  // Clip busy blocks to the day window, drop empties, merge overlaps.
  const clipped: BusyBlock[] = [];
  for (const b of busy) {
    const s = Math.max(b.start, dayStartMs);
    const e = Math.min(b.end, dayEndMs);
    if (s < e) clipped.push({ start: s, end: e });
  }
  const merged = mergeBusyBlocks(clipped);
  const runs = groupRuns(merged, breakMs);

  // Walk day start → end, emitting slots for each raw gap.
  const slots: TimeSlot[] = [];
  let cursor = dayStartMs;
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    if (run.start > cursor) {
      const leftRun = i > 0 ? runs[i - 1] : undefined;
      const gapLeft = leftRun && leftRun.end >= cursor ? leftRun : undefined;
      slots.push(...slotsForGap(cursor, run.start, gapLeft, run, maxMs, breakMs, minMs, dayStartMs));
    }
    cursor = Math.max(cursor, run.end);
  }
  if (cursor < dayEndMs) {
    const leftRun = runs.length > 0 ? runs[runs.length - 1] : undefined;
    slots.push(...slotsForGap(cursor, dayEndMs, leftRun, undefined, maxMs, breakMs, minMs, dayStartMs));
  }

  return annotateTouchingMinSlots(slots, minMs);
}

export function filterPastSlots(slots: TimeSlot[], nowMs: number): TimeSlot[] {
  const result: TimeSlot[] = [];
  for (const slot of slots) {
    const startMs = new Date(slot.start).getTime();
    const endMs = new Date(slot.end).getTime();
    if (endMs <= nowMs) continue;
    if (startMs < nowMs) {
      const next: TimeSlot = { start: new Date(nowMs).toISOString(), end: slot.end };
      if (slot.maxMinutes !== undefined) next.maxMinutes = slot.maxMinutes;
      result.push(next);
    } else {
      result.push(slot);
    }
  }
  return result;
}

export function roundSlotStarts(
  slots: TimeSlot[],
  roundMinutes: number,
  minMinutes: number,
): TimeSlot[] {
  if (roundMinutes <= 0) return slots;
  const roundMs = roundMinutes * 60000;
  const out: TimeSlot[] = [];
  for (const slot of slots) {
    const startMs = new Date(slot.start).getTime();
    const endMs = new Date(slot.end).getTime();
    const rs = roundStart(startMs, roundMs);
    if ((endMs - rs) / 60000 >= minMinutes) {
      const next: TimeSlot = { start: new Date(rs).toISOString(), end: slot.end };
      if (slot.maxMinutes !== undefined) next.maxMinutes = slot.maxMinutes;
      out.push(next);
    }
  }
  return out;
}

function resolveCalendars(calendarIds?: string[]): GoogleAppsScript.Calendar.Calendar[] {
  const calendars: GoogleAppsScript.Calendar.Calendar[] = [];
  if (calendarIds && calendarIds.length > 0) {
    for (const id of calendarIds) {
      const cal = CalendarApp.getCalendarById(id);
      if (cal) calendars.push(cal);
    }
  }
  if (calendars.length === 0) {
    calendars.push(CalendarApp.getDefaultCalendar());
  }
  return calendars;
}

/**
 * Intersect two sets of TimeSlots. The intersection of [a1,b1] and [a2,b2]
 * is [max(a1,a2), min(b1,b2)] when non-empty, carrying the tighter
 * maxMinutes constraint. Slots shorter than minMinutes after intersection
 * are dropped.
 */
function intersectSlotSets(a: TimeSlot[], b: TimeSlot[], minMinutes: number): TimeSlot[] {
  const out: TimeSlot[] = [];
  for (const s1 of a) {
    const s1s = new Date(s1.start).getTime();
    const s1e = new Date(s1.end).getTime();
    for (const s2 of b) {
      const s2s = new Date(s2.start).getTime();
      const s2e = new Date(s2.end).getTime();
      const start = Math.max(s1s, s2s);
      const end = Math.min(s1e, s2e);
      if (end - start < minMinutes * 60000) continue;
      const cap1 = s1.maxMinutes ?? Infinity;
      const cap2 = s2.maxMinutes ?? Infinity;
      const cap = Math.min(cap1, cap2);
      const slot: TimeSlot = {
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
      };
      if (cap !== Infinity) slot.maxMinutes = cap;
      out.push(slot);
    }
  }
  return out;
}

export function getAvailableSlots(options?: Partial<SlotOptions>): DaySlots[] {
  const opts = { ...getDefaultSlotOptions(), ...options };
  const calendars = resolveCalendars(opts.calendarIds);
  const businessDays = getNextBusinessDays(opts.numDays, opts.includeToday, opts.endHour);
  const result: DaySlots[] = [];
  if (businessDays.length === 0) return result;

  const fatigueOpts: FreeSlotOptions = {
    maxContinuousMinutes: opts.maxContinuousMinutes,
    minBreakMinutes: opts.minBreakMinutes,
    minMinutes: opts.minMinutes,
  };

  // Fetch all events once per calendar across the full date range,
  // pre-process (filter declined/transparent, extract timestamps) so
  // GAS API properties are read exactly once per event, not per day.
  const rangeStart = new Date(businessDays[0]);
  rangeStart.setHours(opts.startHour, 0, 0, 0);
  const rangeEnd = new Date(businessDays[businessDays.length - 1]);
  rangeEnd.setHours(opts.endHour, 0, 0, 0);

  const eventsByCalendar: BusyBlock[][] = calendars.map((calendar) => {
    const events = calendar.getEvents(rangeStart, rangeEnd);
    const blocks: BusyBlock[] = [];
    for (const event of events) {
      if (isDeclined(event)) continue;
      if (isTransparentAllDay(event)) continue;
      blocks.push({
        start: event.getStartTime().getTime(),
        end: event.getEndTime().getTime(),
      });
    }
    return blocks;
  });

  for (const day of businessDays) {
    const dayStart = new Date(day);
    dayStart.setHours(opts.startHour, 0, 0, 0);
    const dayEnd = new Date(day);
    dayEnd.setHours(opts.endHour, 0, 0, 0);
    const dayStartMs = dayStart.getTime();
    const dayEndMs = dayEnd.getTime();

    const blocksByCalendar: BusyBlock[][] = eventsByCalendar.map((calEvents) => {
      const dayBlocks: BusyBlock[] = [];
      for (const ev of calEvents) {
        if (ev.end <= dayStartMs || ev.start >= dayEndMs) continue;
        dayBlocks.push({
          start: Math.max(ev.start, dayStartMs),
          end: Math.min(ev.end, dayEndMs),
        });
      }
      return dayBlocks;
    });

    let slots: TimeSlot[];
    if (opts.calendarMode === 'group' && blocksByCalendar.length > 1) {
      const perPerson = blocksByCalendar.map((b) =>
        computeFreeSlotsWithFatigue(b, dayStartMs, dayEndMs, fatigueOpts),
      );
      slots = perPerson[0];
      for (let i = 1; i < perPerson.length; i++) {
        slots = intersectSlotSets(slots, perPerson[i], opts.minMinutes);
      }
    } else {
      const allBlocks = blocksByCalendar.flat();
      slots = computeFreeSlotsWithFatigue(allBlocks, dayStartMs, dayEndMs, fatigueOpts);
    }

    const now = new Date();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (day.getTime() === today.getTime()) {
      slots = filterPastSlots(slots, now.getTime());
    }

    slots = roundSlotStarts(slots, opts.roundMinutes, opts.minMinutes);

    if (slots.length > 0) {
      result.push({
        date: formatDateKey(day),
        dayLabel: formatDayLabel(day),
        slots,
      });
    }
  }

  return result;
}
