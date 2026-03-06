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
        // Include today only if it's a weekday and before endHour
        const dow = current.getDay();
        if (dow !== 0 && dow !== 6 && now.getHours() < endHour) {
            days.push(new Date(current));
        }
        current.setDate(current.getDate() + 1);
    }
    else {
        // Start from tomorrow
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
function computeFreeSlots(mergedBlocks, dayStartMs, dayEndMs, minMinutes) {
    const slots = [];
    let cursor = dayStartMs;
    for (const block of mergedBlocks) {
        if (block.start > cursor) {
            const gapMinutes = (block.start - cursor) / 60000;
            if (gapMinutes >= minMinutes) {
                slots.push({
                    start: new Date(cursor).toISOString(),
                    end: new Date(block.start).toISOString(),
                });
            }
        }
        cursor = Math.max(cursor, block.end);
    }
    // Trailing free time after last block
    if (cursor < dayEndMs) {
        const gapMinutes = (dayEndMs - cursor) / 60000;
        if (gapMinutes >= minMinutes) {
            slots.push({
                start: new Date(cursor).toISOString(),
                end: new Date(dayEndMs).toISOString(),
            });
        }
    }
    return slots;
}
function filterPastSlots(slots, nowMs) {
    const result = [];
    for (const slot of slots) {
        const startMs = new Date(slot.start).getTime();
        const endMs = new Date(slot.end).getTime();
        if (endMs <= nowMs)
            continue; // entirely in the past
        if (startMs < nowMs) {
            // Truncate: start becomes now
            result.push({ start: new Date(nowMs).toISOString(), end: slot.end });
        }
        else {
            result.push(slot);
        }
    }
    return result;
}
function applyFatigueBreaks(blocks, maxContinuousMinutes, minBreakMinutes, minGapMinutes, dayEndMs) {
    if (maxContinuousMinutes <= 0)
        return blocks;
    // Phase 0: Merge blocks separated by gaps <= minGapMinutes (these don't count as real breaks)
    let merged = mergeBusyBlocks(blocks);
    if (merged.length === 0)
        return [];
    if (minGapMinutes > 0) {
        const gapMerged = [{ ...merged[0] }];
        for (let i = 1; i < merged.length; i++) {
            const prev = gapMerged[gapMerged.length - 1];
            const gapMin = (merged[i].start - prev.end) / 60000;
            if (gapMin <= minGapMinutes) {
                gapMerged[gapMerged.length - 1] = { start: prev.start, end: merged[i].end };
            }
            else {
                gapMerged.push({ ...merged[i] });
            }
        }
        merged = gapMerged;
    }
    // Phase 1: Close gaps where filling them would exceed maxContinuousMinutes.
    // A gap between two blocks that, if booked, creates a combined block over
    // the threshold should not be offered as available time.
    let changed = true;
    while (changed) {
        changed = false;
        const closed = [{ ...merged[0] }];
        for (let i = 1; i < merged.length; i++) {
            const prev = closed[closed.length - 1];
            const curr = merged[i];
            const prevMin = (prev.end - prev.start) / 60000;
            const gapMin = (curr.start - prev.end) / 60000;
            const currMin = (curr.end - curr.start) / 60000;
            if (gapMin < minBreakMinutes && prevMin + gapMin + currMin > maxContinuousMinutes) {
                closed[closed.length - 1] = { start: prev.start, end: curr.end };
                changed = true;
            }
            else {
                closed.push({ ...curr });
            }
        }
        merged = closed;
    }
    // Then extend blocks at or over the threshold by break minutes
    const extended = merged.map((b) => {
        const durationMin = (b.end - b.start) / 60000;
        if (durationMin >= maxContinuousMinutes) {
            return { start: b.start, end: Math.min(b.end + minBreakMinutes * 60000, dayEndMs) };
        }
        return { ...b };
    });
    return mergeBusyBlocks(extended);
}
function applyFatiguePerCalendar(blocksByCalendar, maxContinuousMinutes, minBreakMinutes, minGapMinutes, dayEndMs) {
    const allBlocks = [];
    for (const calBlocks of blocksByCalendar) {
        const merged = mergeBusyBlocks(calBlocks);
        const withFatigue = applyFatigueBreaks(merged, maxContinuousMinutes, minBreakMinutes, minGapMinutes, dayEndMs);
        allBlocks.push(...withFatigue);
    }
    return mergeBusyBlocks(allBlocks);
}
function roundSlotStarts(slots, roundMinutes, minMinutes) {
    if (roundMinutes <= 0)
        return slots;
    const roundMs = roundMinutes * 60000;
    const result = [];
    for (const slot of slots) {
        const startMs = new Date(slot.start).getTime();
        const endMs = new Date(slot.end).getTime();
        const remainder = startMs % roundMs;
        const roundedStart = remainder === 0 ? startMs : startMs + (roundMs - remainder);
        if ((endMs - roundedStart) / 60000 >= minMinutes) {
            result.push({
                start: new Date(roundedStart).toISOString(),
                end: slot.end,
            });
        }
    }
    return result;
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
function getAvailableSlots(options) {
    const opts = { ...getDefaultSlotOptions(), ...options };
    const calendars = resolveCalendars(opts.calendarIds);
    const businessDays = getNextBusinessDays(opts.numDays, opts.includeToday, opts.endHour);
    const result = [];
    for (const day of businessDays) {
        const dayStart = new Date(day);
        dayStart.setHours(opts.startHour, 0, 0, 0);
        const dayEnd = new Date(day);
        dayEnd.setHours(opts.endHour, 0, 0, 0);
        const blocksByCalendar = [];
        for (const calendar of calendars) {
            const calBlocks = [];
            const events = calendar.getEvents(dayStart, dayEnd);
            for (const event of events) {
                if (isDeclined(event))
                    continue;
                if (isTransparentAllDay(event))
                    continue;
                const evStart = event.getStartTime().getTime();
                const evEnd = event.getEndTime().getTime();
                calBlocks.push({
                    start: Math.max(evStart, dayStart.getTime()),
                    end: Math.min(evEnd, dayEnd.getTime()),
                });
            }
            blocksByCalendar.push(calBlocks);
        }
        let withBreaks;
        if (opts.calendarMode === 'group' && blocksByCalendar.length > 1) {
            withBreaks = applyFatiguePerCalendar(blocksByCalendar, opts.maxContinuousMinutes, opts.minBreakMinutes, opts.minGapMinutes, dayEnd.getTime());
        }
        else {
            const allBlocks = blocksByCalendar.flat();
            const merged = mergeBusyBlocks(allBlocks);
            withBreaks = applyFatigueBreaks(merged, opts.maxContinuousMinutes, opts.minBreakMinutes, opts.minGapMinutes, dayEnd.getTime());
        }
        let slots = computeFreeSlots(withBreaks, dayStart.getTime(), dayEnd.getTime(), opts.minMinutes);
        // If today, filter out past slots
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
function formatSlotsBullets(days) {
    if (days.length === 0)
        return "No availability found for the selected period.";
    const lines = ["I'm available at the following times (Pacific):", ""];
    for (const day of days) {
        lines.push(`${day.dayLabel}:`);
        for (const slot of day.slots) {
            lines.push(`  - ${formatTime(slot.start)} - ${formatTime(slot.end)}`);
        }
        lines.push("");
    }
    // Remove trailing blank line
    if (lines[lines.length - 1] === "")
        lines.pop();
    return lines.join("\n");
}
function formatSlotsCompact(days) {
    if (days.length === 0)
        return "No availability found for the selected period.";
    const lines = ["Available (Pacific):"];
    for (const day of days) {
        const slotStrs = day.slots.map((s) => `${formatTime(s.start)}-${formatTime(s.end)}`);
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

