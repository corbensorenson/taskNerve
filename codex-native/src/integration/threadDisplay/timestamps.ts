function numberTimestampToIso(value: number): string | null {
  if (!Number.isFinite(value)) {
    return null;
  }
  const timestampMs = value > 1e12 ? value : value > 1e10 ? value : value * 1000;
  const date = new Date(timestampMs);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function parseTimestampUtc(value: unknown): string | null {
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

export function timestampLabel(value: unknown): string {
  const iso = parseTimestampUtc(value);
  if (!iso) {
    return "";
  }
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function timestampTooltip(value: unknown): string {
  const iso = parseTimestampUtc(value);
  if (!iso) {
    return "";
  }
  return new Date(iso).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "medium",
  });
}
