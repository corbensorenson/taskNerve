import type { ThreadActor, ThreadDisplayEntry, ThreadEntryKind } from "./types.js";
import { parseTimestampUtc, timestampLabel, timestampTooltip } from "./timestamps.js";

const MAX_SCAN_OBJECTS = 8000;

interface RawTurnRecord {
  id: unknown;
  created_at?: unknown;
  createdAt?: unknown;
  updated_at?: unknown;
  updatedAt?: unknown;
  timestamp?: unknown;
  input_items?: unknown;
  inputItems?: unknown;
  output_items?: unknown;
  outputItems?: unknown;
  items?: unknown;
  previous_turn_id?: unknown;
  previousTurnId?: unknown;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function looksLikeTurnRecord(value: unknown): value is RawTurnRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const entry = value as Record<string, unknown>;
  if (!("id" in entry)) {
    return false;
  }
  return (
    Array.isArray(entry.input_items) ||
    Array.isArray(entry.output_items) ||
    Array.isArray(entry.inputItems) ||
    Array.isArray(entry.outputItems) ||
    "previous_turn_id" in entry ||
    "previousTurnId" in entry
  );
}

function normalizeTurnId(value: unknown, fallbackIndex: number): string {
  const text = String(value ?? "").trim();
  return text || `turn-${fallbackIndex + 1}`;
}

function turnTimestamp(turn: RawTurnRecord): string | null {
  return (
    parseTimestampUtc(turn.created_at) ||
    parseTimestampUtc(turn.createdAt) ||
    parseTimestampUtc(turn.updated_at) ||
    parseTimestampUtc(turn.updatedAt) ||
    parseTimestampUtc(turn.timestamp)
  );
}

function extractTurns(thread: unknown): RawTurnRecord[] {
  const queue: unknown[] = [thread];
  const seen = new Set<unknown>();
  const turns: RawTurnRecord[] = [];
  let scanned = 0;

  while (queue.length > 0 && scanned < MAX_SCAN_OBJECTS) {
    const current = queue.shift();
    scanned += 1;
    if (!current || typeof current !== "object" || seen.has(current)) {
      continue;
    }
    seen.add(current);

    if (looksLikeTurnRecord(current)) {
      turns.push(current);
    }

    if (Array.isArray(current)) {
      current.forEach((entry) => {
        if (entry && typeof entry === "object") {
          queue.push(entry);
        }
      });
      continue;
    }

    Object.values(current as Record<string, unknown>).forEach((entry) => {
      if (entry && typeof entry === "object") {
        queue.push(entry);
      }
    });
  }

  if (turns.length === 0 && Array.isArray(thread)) {
    return thread.filter((entry): entry is RawTurnRecord => looksLikeTurnRecord(entry));
  }

  const deduped = new Map<string, RawTurnRecord>();
  turns.forEach((turn, index) => {
    const key = normalizeTurnId(turn.id, index);
    if (!deduped.has(key)) {
      deduped.set(key, turn);
      return;
    }
    deduped.set(key, { ...deduped.get(key), ...turn });
  });

  return [...deduped.values()].sort((left, right) => {
    const leftTime = turnTimestamp(left);
    const rightTime = turnTimestamp(right);
    if (leftTime && rightTime && leftTime !== rightTime) {
      return leftTime.localeCompare(rightTime);
    }
    return normalizeTurnId(left.id, 0).localeCompare(normalizeTurnId(right.id, 0));
  });
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stringFromUnknown(value: unknown): string {
  if (typeof value === "string") {
    return compactWhitespace(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function bestTextField(record: Record<string, unknown>): string {
  const preferredKeys = [
    "text",
    "message",
    "content",
    "title",
    "detail",
    "reason",
    "status",
    "name",
    "label",
    "summary",
  ];
  for (const key of preferredKeys) {
    const text = stringFromUnknown(record[key]);
    if (text) {
      return text;
    }
  }
  return "";
}

function flattenText(value: unknown): string {
  const direct = stringFromUnknown(value);
  if (direct) {
    return direct;
  }
  if (!value || typeof value !== "object") {
    return "";
  }
  if (Array.isArray(value)) {
    const combined = value.map((entry) => flattenText(entry)).filter(Boolean).join(" ");
    return compactWhitespace(combined);
  }

  const record = value as Record<string, unknown>;
  const picked = bestTextField(record);
  if (picked) {
    return picked;
  }

  const combined = Object.values(record)
    .map((entry) => flattenText(entry))
    .filter(Boolean)
    .join(" ");
  return compactWhitespace(combined);
}

function itemType(item: unknown): string {
  if (!item || typeof item !== "object") {
    return "";
  }
  const raw = (item as Record<string, unknown>).type;
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

function inferRole(defaultRole: ThreadActor, item: unknown): ThreadActor {
  const type = itemType(item);
  if (type.includes("tool")) {
    return "tool";
  }
  if (type.includes("system")) {
    return "system";
  }
  return defaultRole;
}

function inferKind(item: unknown): ThreadEntryKind {
  const type = itemType(item);
  if (type === "message" || type.endsWith("message") || type.includes("assistant_message")) {
    return "message";
  }
  return "action";
}

function summarizeItem(item: unknown, fallbackPrefix: string): string {
  const type = itemType(item);
  if (item && typeof item === "object" && type && type !== "message") {
    const record = item as Record<string, unknown>;
    const name = stringFromUnknown(record.name);
    const detail = flattenText(
      record.detail ?? record.arguments ?? record.result ?? record.output ?? record.input,
    );
    const structured = [type, name, detail].filter(Boolean).join(" ");
    if (structured) {
      return compactWhitespace(structured);
    }
  }
  const text = flattenText(item);
  if (text) {
    return text;
  }
  if (type) {
    return `${fallbackPrefix}: ${type}`;
  }
  return `${fallbackPrefix}: action`;
}

function itemTimestamp(item: unknown, fallback: string | null): string | null {
  if (!item || typeof item !== "object") {
    return fallback;
  }
  const record = item as Record<string, unknown>;
  return (
    parseTimestampUtc(record.created_at) ||
    parseTimestampUtc(record.createdAt) ||
    parseTimestampUtc(record.updated_at) ||
    parseTimestampUtc(record.updatedAt) ||
    parseTimestampUtc(record.timestamp) ||
    fallback
  );
}

function turnEntries(turn: RawTurnRecord, index: number): ThreadDisplayEntry[] {
  const turnId = normalizeTurnId(turn.id, index);
  const baseTimestamp = turnTimestamp(turn);
  const inputItems = asArray(turn.input_items).concat(asArray(turn.inputItems));
  const outputItems = asArray(turn.output_items).concat(asArray(turn.outputItems));
  const genericItems = asArray(turn.items);
  const hasDirectionalItems = inputItems.length > 0 || outputItems.length > 0;

  const entries: ThreadDisplayEntry[] = [];

  inputItems.forEach((item, itemIndex) => {
    const entryTimestamp = itemTimestamp(item, baseTimestamp);
    entries.push({
      entry_id: `${turnId}:user:${itemIndex + 1}`,
      turn_key: `user:${turnId}`,
      turn_id: turnId,
      role: inferRole("user", item),
      kind: inferKind(item),
      text: summarizeItem(item, "User action"),
      created_at_utc: entryTimestamp,
      timestamp_label: timestampLabel(entryTimestamp),
      timestamp_tooltip: timestampTooltip(entryTimestamp),
    });
  });

  outputItems.forEach((item, itemIndex) => {
    const entryTimestamp = itemTimestamp(item, baseTimestamp);
    entries.push({
      entry_id: `${turnId}:assistant:${itemIndex + 1}`,
      turn_key: `assistant:${turnId}`,
      turn_id: turnId,
      role: inferRole("assistant", item),
      kind: inferKind(item),
      text: summarizeItem(item, "Assistant action"),
      created_at_utc: entryTimestamp,
      timestamp_label: timestampLabel(entryTimestamp),
      timestamp_tooltip: timestampTooltip(entryTimestamp),
    });
  });

  if (!hasDirectionalItems) {
    genericItems.forEach((item, itemIndex) => {
      const entryTimestamp = itemTimestamp(item, baseTimestamp);
      entries.push({
        entry_id: `${turnId}:item:${itemIndex + 1}`,
        turn_key: turnId,
        turn_id: turnId,
        role: inferRole("unknown", item),
        kind: inferKind(item),
        text: summarizeItem(item, "Thread action"),
        created_at_utc: entryTimestamp,
        timestamp_label: timestampLabel(entryTimestamp),
        timestamp_tooltip: timestampTooltip(entryTimestamp),
      });
    });
  }

  if (entries.length > 0) {
    return entries;
  }

  return [
    {
      entry_id: `${turnId}:fallback`,
      turn_key: turnId,
      turn_id: turnId,
      role: "unknown",
      kind: "action",
      text: "Thread action",
      created_at_utc: baseTimestamp,
      timestamp_label: timestampLabel(baseTimestamp),
      timestamp_tooltip: timestampTooltip(baseTimestamp),
    },
  ];
}

export function extractThreadDisplayEntries(thread: unknown): ThreadDisplayEntry[] {
  const turns = extractTurns(thread);
  return turns.flatMap((turn, index) => turnEntries(turn, index));
}
