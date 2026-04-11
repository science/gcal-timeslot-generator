function getDefaultSlotOptions() {
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
function getNextBusinessDays(numDays, includeToday, endHour) {
    const days = [];
    const now = new Date();
    const current = new Date();
    current.setHours(0, 0, 0, 0);
    if (includeToday) {
        const dow = current.getDay();
        if (dow !== 0 && dow !== 6 && now.getHours() < endHour) {
            days.push(new Date(current));
        }
        current.setDate(current.getDate() + 1);
    }
    else {
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
function formatDayLabel(date) {
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${dayNames[date.getDay()]}, ${monthNames[date.getMonth()]} ${date.getDate()}`;
}
function formatDateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}
function isDeclined(event) {
    const status = event.getMyStatus();
    return status === CalendarApp.GuestStatus.NO;
}
function isTransparentAllDay(event) {
    if (!event.isAllDayEvent())
        return false;
    const title = event.getTitle().toLowerCase();
    if (title.includes("holiday") && event.getGuestList().length === 0)
        return true;
    return false;
}
function mergeBusyBlocks(blocks) {
    if (blocks.length === 0)
        return [];
    const sorted = blocks.slice().sort((a, b) => a.start - b.start);
    const merged = [{ ...sorted[0] }];
    for (let i = 1; i < sorted.length; i++) {
        const last = merged[merged.length - 1];
        if (sorted[i].start <= last.end) {
            last.end = Math.max(last.end, sorted[i].end);
        }
        else {
            merged.push({ ...sorted[i] });
        }
    }
    return merged;
}
/** Group already-merged busy blocks into runs separated by gaps ≥ minBreakMs. */
function groupRuns(merged, minBreakMs) {
    if (merged.length === 0)
        return [];
    const runs = [{ start: merged[0].start, end: merged[0].end }];
    for (let i = 1; i < merged.length; i++) {
        const last = runs[runs.length - 1];
        if (merged[i].start - last.end < minBreakMs) {
            last.end = Math.max(last.end, merged[i].end);
        }
        else {
            runs.push({ start: merged[i].start, end: merged[i].end });
        }
    }
    return runs;
}
function roundStart(ms, roundMs) {
    if (roundMs <= 0)
        return ms;
    const r = ms % roundMs;
    return r === 0 ? ms : ms + (roundMs - r);
}
function makeSlot(start, end, maxMin) {
    const slot = {
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
    };
    if (maxMin !== undefined)
        slot.maxMinutes = maxMin;
    return slot;
}
/**
 * For one raw free gap [a, b] bounded by (optional) left and right runs,
 * emit the set of sound slot candidates.
 */
function slotsForGap(a, b, left, right, maxMs, breakMs, minMs) {
    const G = b - a;
    if (G < minMs)
        return [];
    const L = left ? left.end - left.start : 0;
    const R = right ? right.end - right.start : 0;
    // Fast path: even a full-gap meeting that touches both neighbors is
    // under threshold. Single unconstrained slot.
    if (L + G + R <= maxMs) {
        // Max meeting duration here is G, which is ≤ maxMs − L − R ≤ maxMs.
        return [makeSlot(a, b)];
    }
    const out = [];
    // LEFT-ANCHORED: meetings touching the left run. Only produced when a
    // left run exists; otherwise "touching left" is vacuous and the C slot
    // covers the day-start edge.
    if (left) {
        const leftAllow = Math.max(0, maxMs - L);
        // If a right run exists we must not extend into its break zone, or
        // we'd leak into "touching both" territory which we know is unsafe.
        const leftEnd = right
            ? Math.min(a + leftAllow, b - breakMs)
            : Math.min(a + leftAllow, b);
        if (leftEnd - a >= minMs) {
            out.push(makeSlot(a, leftEnd));
        }
    }
    // RIGHT-ANCHORED: symmetric.
    if (right) {
        const rightAllow = Math.max(0, maxMs - R);
        const rightStart = left
            ? Math.max(b - rightAllow, a + breakMs)
            : Math.max(b - rightAllow, a);
        if (b - rightStart >= minMs) {
            out.push(makeSlot(rightStart, b));
        }
    }
    // MIDDLE ISLAND: meetings that sit far enough from both neighbors to
    // form their own run. The island is capped at maxMs duration because a
    // longer meeting would violate (2) even without touching neighbors.
    const mStart = left ? a + breakMs : a;
    const mEnd = right ? b - breakMs : b;
    const mLen = mEnd - mStart;
    if (mLen >= minMs) {
        const maxDurMs = Math.min(mLen, maxMs);
        const maxMin = maxDurMs < mLen ? maxDurMs / 60000 : undefined;
        out.push(makeSlot(mStart, mEnd, maxMin));
    }
    return out;
}
/** Drop any slot fully contained in another slot with a looser-or-equal constraint. */
function dedupeContained(slots) {
    const withMs = slots.map((s) => {
        var _a;
        return ({
            slot: s,
            start: new Date(s.start).getTime(),
            end: new Date(s.end).getTime(),
            maxMs: ((_a = s.maxMinutes) !== null && _a !== void 0 ? _a : Infinity) * 60000,
        });
    });
    const keep = withMs.map(() => true);
    for (let i = 0; i < withMs.length; i++) {
        if (!keep[i])
            continue;
        for (let j = 0; j < withMs.length; j++) {
            if (i === j || !keep[j])
                continue;
            const A = withMs[i];
            const B = withMs[j];
            // A is contained in B and B's constraint is at least as loose → drop A.
            if (B.start <= A.start && B.end >= A.end && B.maxMs >= A.maxMs) {
                // Avoid mutual elimination when the two slots are equal.
                if (A.start === B.start && A.end === B.end && A.maxMs === B.maxMs) {
                    if (i > j)
                        keep[i] = false;
                }
                else {
                    keep[i] = false;
                }
                break;
            }
        }
    }
    return withMs.filter((_, i) => keep[i]).map((w) => w.slot);
}
function computeFreeSlotsWithFatigue(busy, dayStartMs, dayEndMs, opts) {
    const maxMs = opts.maxContinuousMinutes * 60000;
    const breakMs = opts.minBreakMinutes * 60000;
    const minMs = opts.minMinutes * 60000;
    // Clip busy blocks to the day window, drop empties, merge overlaps.
    const clipped = [];
    for (const b of busy) {
        const s = Math.max(b.start, dayStartMs);
        const e = Math.min(b.end, dayEndMs);
        if (s < e)
            clipped.push({ start: s, end: e });
    }
    const merged = mergeBusyBlocks(clipped);
    const runs = groupRuns(merged, breakMs);
    // Walk day start → end, emitting slots for each raw gap.
    const slots = [];
    let cursor = dayStartMs;
    for (let i = 0; i < runs.length; i++) {
        const run = runs[i];
        if (run.start > cursor) {
            const leftRun = i > 0 ? runs[i - 1] : undefined;
            const gapLeft = leftRun && leftRun.end >= cursor ? leftRun : undefined;
            slots.push(...slotsForGap(cursor, run.start, gapLeft, run, maxMs, breakMs, minMs));
        }
        cursor = Math.max(cursor, run.end);
    }
    if (cursor < dayEndMs) {
        const leftRun = runs.length > 0 ? runs[runs.length - 1] : undefined;
        slots.push(...slotsForGap(cursor, dayEndMs, leftRun, undefined, maxMs, breakMs, minMs));
    }
    return dedupeContained(slots);
}
function filterPastSlots(slots, nowMs) {
    const result = [];
    for (const slot of slots) {
        const startMs = new Date(slot.start).getTime();
        const endMs = new Date(slot.end).getTime();
        if (endMs <= nowMs)
            continue;
        if (startMs < nowMs) {
            const next = { start: new Date(nowMs).toISOString(), end: slot.end };
            if (slot.maxMinutes !== undefined)
                next.maxMinutes = slot.maxMinutes;
            result.push(next);
        }
        else {
            result.push(slot);
        }
    }
    return result;
}
function roundSlotStarts(slots, roundMinutes, minMinutes) {
    if (roundMinutes <= 0)
        return slots;
    const roundMs = roundMinutes * 60000;
    const out = [];
    for (const slot of slots) {
        const startMs = new Date(slot.start).getTime();
        const endMs = new Date(slot.end).getTime();
        const rs = roundStart(startMs, roundMs);
        if ((endMs - rs) / 60000 >= minMinutes) {
            const next = { start: new Date(rs).toISOString(), end: slot.end };
            if (slot.maxMinutes !== undefined)
                next.maxMinutes = slot.maxMinutes;
            out.push(next);
        }
    }
    return out;
}
function resolveCalendars(calendarIds) {
    const calendars = [];
    if (calendarIds && calendarIds.length > 0) {
        for (const id of calendarIds) {
            const cal = CalendarApp.getCalendarById(id);
            if (cal)
                calendars.push(cal);
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
function intersectSlotSets(a, b, minMinutes) {
    var _a, _b;
    const out = [];
    for (const s1 of a) {
        const s1s = new Date(s1.start).getTime();
        const s1e = new Date(s1.end).getTime();
        for (const s2 of b) {
            const s2s = new Date(s2.start).getTime();
            const s2e = new Date(s2.end).getTime();
            const start = Math.max(s1s, s2s);
            const end = Math.min(s1e, s2e);
            if (end - start < minMinutes * 60000)
                continue;
            const cap1 = (_a = s1.maxMinutes) !== null && _a !== void 0 ? _a : Infinity;
            const cap2 = (_b = s2.maxMinutes) !== null && _b !== void 0 ? _b : Infinity;
            const cap = Math.min(cap1, cap2);
            const slot = {
                start: new Date(start).toISOString(),
                end: new Date(end).toISOString(),
            };
            if (cap !== Infinity)
                slot.maxMinutes = cap;
            out.push(slot);
        }
    }
    return dedupeContained(out);
}
function getAvailableSlots(options) {
    const opts = { ...getDefaultSlotOptions(), ...options };
    const calendars = resolveCalendars(opts.calendarIds);
    const businessDays = getNextBusinessDays(opts.numDays, opts.includeToday, opts.endHour);
    const result = [];
    const fatigueOpts = {
        maxContinuousMinutes: opts.maxContinuousMinutes,
        minBreakMinutes: opts.minBreakMinutes,
        minMinutes: opts.minMinutes,
    };
    for (const day of businessDays) {
        const dayStart = new Date(day);
        dayStart.setHours(opts.startHour, 0, 0, 0);
        const dayEnd = new Date(day);
        dayEnd.setHours(opts.endHour, 0, 0, 0);
        const dayStartMs = dayStart.getTime();
        const dayEndMs = dayEnd.getTime();
        // Collect raw busy blocks per calendar.
        const blocksByCalendar = [];
        for (const calendar of calendars) {
            const calBlocks = [];
            const events = calendar.getEvents(dayStart, dayEnd);
            for (const event of events) {
                if (isDeclined(event))
                    continue;
                if (isTransparentAllDay(event))
                    continue;
                calBlocks.push({
                    start: Math.max(event.getStartTime().getTime(), dayStartMs),
                    end: Math.min(event.getEndTime().getTime(), dayEndMs),
                });
            }
            blocksByCalendar.push(calBlocks);
        }
        let slots;
        if (opts.calendarMode === 'group' && blocksByCalendar.length > 1) {
            // Each calendar is a distinct person. Compute per-person free slots
            // under that person's fatigue rules, then intersect the sets.
            const perPerson = blocksByCalendar.map((b) => computeFreeSlotsWithFatigue(b, dayStartMs, dayEndMs, fatigueOpts));
            slots = perPerson[0];
            for (let i = 1; i < perPerson.length; i++) {
                slots = intersectSlotSets(slots, perPerson[i], opts.minMinutes);
            }
        }
        else {
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

function formatTime(isoString) {
    const date = new Date(isoString);
    let hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? "pm" : "am";
    hours = hours % 12 || 12;
    const minuteStr = minutes === 0 ? "" : `:${String(minutes).padStart(2, "0")}`;
    return `${hours}${minuteStr}${ampm}`;
}
function durationSuffix(slot) {
    if (slot.maxMinutes === undefined)
        return "";
    return slot.maxMinutes >= 60 && slot.maxMinutes % 60 === 0
        ? ` (max ${slot.maxMinutes / 60}h)`
        : ` (max ${slot.maxMinutes} min)`;
}
function formatSlotsBullets(days) {
    if (days.length === 0)
        return "No availability found for the selected period.";
    const lines = ["I'm available at the following times (Pacific):", ""];
    for (const day of days) {
        lines.push(`${day.dayLabel}:`);
        for (const slot of day.slots) {
            lines.push(`  - ${formatTime(slot.start)} - ${formatTime(slot.end)}${durationSuffix(slot)}`);
        }
        lines.push("");
    }
    if (lines[lines.length - 1] === "")
        lines.pop();
    return lines.join("\n");
}
function formatSlotsCompact(days) {
    if (days.length === 0)
        return "No availability found for the selected period.";
    const lines = ["Available (Pacific):"];
    for (const day of days) {
        const slotStrs = day.slots.map((s) => `${formatTime(s.start)}-${formatTime(s.end)}${durationSuffix(s)}`);
        lines.push(`${day.dayLabel}: ${slotStrs.join(", ")}`);
    }
    return lines.join("\n");
}
function formatSlots(days, style) {
    if (style === "compact")
        return formatSlotsCompact(days);
    return formatSlotsBullets(days);
}

function doGet() {
    return HtmlService.createHtmlOutputFromFile("index")
        .setTitle("Time Slot Generator")
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
function getCalendars() {
    return CalendarApp.getAllCalendars()
        .filter((cal) => !cal.isHidden())
        .map((cal) => ({
        id: cal.getId(),
        name: cal.getName(),
        primary: cal.isMyPrimaryCalendar(),
    }))
        .sort((a, b) => {
        if (a.primary !== b.primary)
            return a.primary ? -1 : 1;
        return a.name.localeCompare(b.name);
    });
}
function getSlots(options) {
    return getAvailableSlots(options);
}
function getSlotsFormatted(style, options) {
    const slots = getAvailableSlots(options);
    return formatSlots(slots, style);
}
function saveSettings(settings) {
    PropertiesService.getUserProperties().setProperty('slotGeneratorSettings', JSON.stringify(settings));
}
function loadSettings() {
    const raw = PropertiesService.getUserProperties().getProperty('slotGeneratorSettings');
    return raw ? JSON.parse(raw) : null;
}

