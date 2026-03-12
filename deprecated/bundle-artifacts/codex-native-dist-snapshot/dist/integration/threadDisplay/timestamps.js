function numberTimestampToIso(value) {
    if (!Number.isFinite(value)) {
        return null;
    }
    const timestampMs = value > 1e12 ? value : value > 1e10 ? value : value * 1000;
    const date = new Date(timestampMs);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
export function parseTimestampUtc(value) {
    if (typeof value === "number") {
        return numberTimestampToIso(value);
    }
    if (typeof value !== "string") {
        return null;
    }
    const normalized = value.trim();
    if (!normalized) {
        return null;
    }
    if (/^\d+(\.\d+)?$/.test(normalized)) {
        return numberTimestampToIso(Number(normalized));
    }
    const parsedMs = Date.parse(normalized);
    if (!Number.isFinite(parsedMs)) {
        return null;
    }
    return new Date(parsedMs).toISOString();
}
const TIMESTAMP_DISPLAY_CACHE_LIMIT = 256;
const timestampDisplayCache = new Map();
function rememberTimestampDisplay(iso, label, tooltip) {
    if (timestampDisplayCache.size >= TIMESTAMP_DISPLAY_CACHE_LIMIT) {
        const oldestKey = timestampDisplayCache.keys().next().value;
        if (oldestKey) {
            timestampDisplayCache.delete(oldestKey);
        }
    }
    timestampDisplayCache.set(iso, { label, tooltip });
}
export function timestampDisplayFromIso(iso) {
    if (!iso) {
        return {
            label: "",
            tooltip: "",
        };
    }
    const cached = timestampDisplayCache.get(iso);
    if (cached) {
        return cached;
    }
    const date = new Date(iso);
    if (!Number.isFinite(date.getTime())) {
        return {
            label: "",
            tooltip: "",
        };
    }
    const label = date.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
    });
    const tooltip = date.toLocaleString([], {
        dateStyle: "medium",
        timeStyle: "medium",
    });
    rememberTimestampDisplay(iso, label, tooltip);
    return {
        label,
        tooltip,
    };
}
export function timestampLabel(value) {
    return timestampDisplayFromIso(parseTimestampUtc(value)).label;
}
export function timestampTooltip(value) {
    return timestampDisplayFromIso(parseTimestampUtc(value)).tooltip;
}
//# sourceMappingURL=timestamps.js.map