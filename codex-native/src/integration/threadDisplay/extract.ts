import type { ThreadActor, ThreadDisplayEntry, ThreadEntryKind } from "./types.js";
import {
  parseTimestampUtc,
  timestampDisplayFromIso,
} from "./timestamps.js";

const MAX_SCAN_OBJECTS = 8000;
const MAX_TEXT_SCAN_OBJECTS = 48;

const KNOWN_TURN_ARRAY_PATHS: ReadonlyArray<ReadonlyArray<string>> = [
  ["conversation", "turns"],
  ["thread", "turns"],
  ["turns"],
  ["conversation", "turn_mapping"],
  ["turn_mapping"],
  ["messages"],
];

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

interface ThreadExtractionCacheEntry {
  marker: string;
  entries: ThreadDisplayEntry[];
}

const threadExtractionCache = new WeakMap<object, ThreadExtractionCacheEntry>();
const turnArrayExtractionCache = new WeakMap<unknown[], ThreadExtractionCacheEntry>();
const turnMappingExtractionCache = new WeakMap<Record<string, unknown>, ThreadExtractionCacheEntry>();

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function looksLikeTurnRecord(value: unknown): value is RawTurnRecord {
  const entry = asRecord(value);
  if (!entry || !("id" in entry)) {
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

function readPath(root: unknown, path: ReadonlyArray<string>): unknown {
  let current: unknown = root;
  for (const segment of path) {
    const record = asRecord(current);
    if (!record || !(segment in record)) {
      return null;
    }
    current = record[segment];
  }
  return current;
}

function normalizeTurnArray(value: unknown): RawTurnRecord[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is RawTurnRecord => looksLikeTurnRecord(entry));
  }
  const record = asRecord(value);
  if (!record) {
    return [];
  }
  return Object.values(record)
    .map((entry) => asRecord(entry)?.turn ?? entry)
    .filter((entry): entry is RawTurnRecord => looksLikeTurnRecord(entry));
}

function dedupeSortTurns(turns: RawTurnRecord[]): RawTurnRecord[] {
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

function extractTurnsViaKnownPaths(thread: unknown): RawTurnRecord[] {
  for (const path of KNOWN_TURN_ARRAY_PATHS) {
    const candidateTurns = normalizeTurnArray(readPath(thread, path));
    if (candidateTurns.length > 0) {
      return dedupeSortTurns(candidateTurns);
    }
  }
  return [];
}

function extractTurnsByScan(thread: unknown): RawTurnRecord[] {
  const queue: unknown[] = [thread];
  const seen = new Set<unknown>();
  const turns: RawTurnRecord[] = [];
  let scanned = 0;

  for (let queueIndex = 0; queueIndex < queue.length && scanned < MAX_SCAN_OBJECTS; queueIndex += 1) {
    const current = queue[queueIndex];
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

  return dedupeSortTurns(turns);
}

function extractTurns(thread: unknown): RawTurnRecord[] {
  const fastPath = extractTurnsViaKnownPaths(thread);
  if (fastPath.length > 0) {
    return fastPath;
  }
  return extractTurnsByScan(thread);
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

  const queue: unknown[] = [value];
  const seen = new Set<unknown>();
  const pieces: string[] = [];
  let scanned = 0;

  for (
    let queueIndex = 0;
    queueIndex < queue.length && scanned < MAX_TEXT_SCAN_OBJECTS;
    queueIndex += 1
  ) {
    const current = queue[queueIndex];
    scanned += 1;

    const text = stringFromUnknown(current);
    if (text) {
      pieces.push(text);
      continue;
    }
    if (!current || typeof current !== "object" || seen.has(current)) {
      continue;
    }
    seen.add(current);

    if (Array.isArray(current)) {
      current.forEach((entry) => queue.push(entry));
      continue;
    }

    const record = current as Record<string, unknown>;
    const picked = bestTextField(record);
    if (picked) {
      pieces.push(picked);
      continue;
    }
    Object.values(record).forEach((entry) => queue.push(entry));
  }

  return compactWhitespace(pieces.join(" "));
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
    const timestampDisplay = timestampDisplayFromIso(entryTimestamp);
    entries.push({
      entry_id: `${turnId}:user:${itemIndex + 1}`,
      turn_key: `user:${turnId}`,
      turn_id: turnId,
      role: inferRole("user", item),
      kind: inferKind(item),
      text: summarizeItem(item, "User action"),
      created_at_utc: entryTimestamp,
      timestamp_label: timestampDisplay.label,
      timestamp_tooltip: timestampDisplay.tooltip,
    });
  });

  outputItems.forEach((item, itemIndex) => {
    const entryTimestamp = itemTimestamp(item, baseTimestamp);
    const timestampDisplay = timestampDisplayFromIso(entryTimestamp);
    entries.push({
      entry_id: `${turnId}:assistant:${itemIndex + 1}`,
      turn_key: `assistant:${turnId}`,
      turn_id: turnId,
      role: inferRole("assistant", item),
      kind: inferKind(item),
      text: summarizeItem(item, "Assistant action"),
      created_at_utc: entryTimestamp,
      timestamp_label: timestampDisplay.label,
      timestamp_tooltip: timestampDisplay.tooltip,
    });
  });

  if (!hasDirectionalItems) {
    genericItems.forEach((item, itemIndex) => {
      const entryTimestamp = itemTimestamp(item, baseTimestamp);
      const timestampDisplay = timestampDisplayFromIso(entryTimestamp);
      entries.push({
        entry_id: `${turnId}:item:${itemIndex + 1}`,
        turn_key: turnId,
        turn_id: turnId,
        role: inferRole("unknown", item),
        kind: inferKind(item),
        text: summarizeItem(item, "Thread action"),
        created_at_utc: entryTimestamp,
        timestamp_label: timestampDisplay.label,
        timestamp_tooltip: timestampDisplay.tooltip,
      });
    });
  }

  if (entries.length > 0) {
    return entries;
  }

  const timestampDisplay = timestampDisplayFromIso(baseTimestamp);
  return [
    {
      entry_id: `${turnId}:fallback`,
      turn_key: turnId,
      turn_id: turnId,
      role: "unknown",
      kind: "action",
      text: "Thread action",
      created_at_utc: baseTimestamp,
      timestamp_label: timestampDisplay.label,
      timestamp_tooltip: timestampDisplay.tooltip,
    },
  ];
}

function hydrateMissingTimestamps(entries: ThreadDisplayEntry[], generatedAtUtc: string): ThreadDisplayEntry[] {
  let hasMissingTimestampData = false;
  for (const entry of entries) {
    if (
      !parseTimestampUtc(entry.created_at_utc) ||
      !entry.timestamp_label ||
      !entry.timestamp_tooltip
    ) {
      hasMissingTimestampData = true;
      break;
    }
  }
  if (!hasMissingTimestampData) {
    return entries;
  }

  const generated = parseTimestampUtc(generatedAtUtc) || new Date().toISOString();
  let lastKnown = generated;

  const forward = entries.map((entry) => {
    const createdAt = parseTimestampUtc(entry.created_at_utc) || lastKnown;
    lastKnown = createdAt;
    const timestampDisplay = timestampDisplayFromIso(createdAt);
    return {
      ...entry,
      created_at_utc: createdAt,
      timestamp_label: entry.timestamp_label || timestampDisplay.label,
      timestamp_tooltip: entry.timestamp_tooltip || timestampDisplay.tooltip,
    };
  });

  let nextKnown = generated;
  for (let index = forward.length - 1; index >= 0; index -= 1) {
    const entry = forward[index]!;
    const createdAt = parseTimestampUtc(entry.created_at_utc) || nextKnown;
    nextKnown = createdAt;
    if (entry.timestamp_label && entry.timestamp_tooltip) {
      continue;
    }
    const timestampDisplay = timestampDisplayFromIso(createdAt);
    forward[index] = {
      ...entry,
      created_at_utc: createdAt,
      timestamp_label: entry.timestamp_label || timestampDisplay.label,
      timestamp_tooltip: entry.timestamp_tooltip || timestampDisplay.tooltip,
    };
  }

  return forward;
}

const CACHEABLE_TURN_ARRAY_PATHS: ReadonlyArray<ReadonlyArray<string>> = [
  ["conversation", "turns"],
  ["thread", "turns"],
  ["turns"],
  ["messages"],
];
const CACHEABLE_TURN_MAPPING_PATHS: ReadonlyArray<ReadonlyArray<string>> = [
  ["conversation", "turn_mapping"],
  ["turn_mapping"],
];

function cacheableTurnArray(thread: unknown): unknown[] | null {
  for (const path of CACHEABLE_TURN_ARRAY_PATHS) {
    const value = readPath(thread, path);
    if (Array.isArray(value)) {
      return value;
    }
  }
  return Array.isArray(thread) ? thread : null;
}

function cacheableTurnMapping(thread: unknown): Record<string, unknown> | null {
  for (const path of CACHEABLE_TURN_MAPPING_PATHS) {
    const value = readPath(thread, path);
    const record = asRecord(value);
    if (record) {
      return record;
    }
  }
  return null;
}

function fastTurnMarker(value: unknown): string {
  const record = asRecord(value);
  if (!record) {
    return String(value ?? "");
  }
  const id = String(record.id ?? "");
  const timestamp = String(
    record.updated_at ??
      record.updatedAt ??
      record.timestamp ??
      record.created_at ??
      record.createdAt ??
      "",
  );
  const inputCount =
    asArray(record.input_items).length +
    asArray(record.inputItems).length +
    asArray(record.content).length;
  const outputCount = asArray(record.output_items).length + asArray(record.outputItems).length;
  return `${id}:${timestamp}:${inputCount}:${outputCount}`;
}

function mappingTurnValue(value: unknown): unknown {
  const record = asRecord(value);
  if (record && "turn" in record) {
    return record.turn;
  }
  return value;
}

function entriesCacheMarker(thread: unknown, generatedAtUtc: string): string | null {
  const turns = cacheableTurnArray(thread);
  const generated = parseTimestampUtc(generatedAtUtc) || generatedAtUtc.trim() || "generated";
  if (turns) {
    if (turns.length === 0) {
      return `0:${generated}`;
    }
    const middleIndex = Math.floor((turns.length - 1) / 2);
    return [
      String(turns.length),
      fastTurnMarker(turns[0]),
      fastTurnMarker(turns[middleIndex]),
      fastTurnMarker(turns[turns.length - 1]),
      generated,
    ].join("|");
  }

  const mapping = cacheableTurnMapping(thread);
  if (!mapping) {
    return null;
  }
  const keys = Object.keys(mapping);
  if (keys.length === 0) {
    return `m0:${generated}`;
  }
  const middleIndex = Math.floor((keys.length - 1) / 2);
  const firstKey = keys[0]!;
  const middleKey = keys[middleIndex]!;
  const lastKey = keys[keys.length - 1]!;
  return [
    `m${keys.length}`,
    `${firstKey}:${fastTurnMarker(mappingTurnValue(mapping[firstKey]))}`,
    `${middleKey}:${fastTurnMarker(mappingTurnValue(mapping[middleKey]))}`,
    `${lastKey}:${fastTurnMarker(mappingTurnValue(mapping[lastKey]))}`,
    generated,
  ].join("|");
}

export function extractThreadDisplayEntries(
  thread: unknown,
  generatedAtUtc = new Date().toISOString(),
): ThreadDisplayEntry[] {
  const marker = entriesCacheMarker(thread, generatedAtUtc);
  const turnArray = marker ? cacheableTurnArray(thread) : null;
  const turnMapping = marker && !turnArray ? cacheableTurnMapping(thread) : null;
  if (thread && typeof thread === "object" && marker) {
    const cached = threadExtractionCache.get(thread);
    if (cached && cached.marker === marker) {
      return cached.entries;
    }
  }
  if (turnArray && marker) {
    const cached = turnArrayExtractionCache.get(turnArray);
    if (cached && cached.marker === marker) {
      if (thread && typeof thread === "object") {
        threadExtractionCache.set(thread, cached);
      }
      return cached.entries;
    }
  }
  if (turnMapping && marker) {
    const cached = turnMappingExtractionCache.get(turnMapping);
    if (cached && cached.marker === marker) {
      if (thread && typeof thread === "object") {
        threadExtractionCache.set(thread, cached);
      }
      return cached.entries;
    }
  }

  const sourceTurns = extractTurns(thread);
  const entries = sourceTurns.flatMap((turn, index) => turnEntries(turn, index));
  const hydrated = hydrateMissingTimestamps(entries, generatedAtUtc);

  if (thread && typeof thread === "object" && marker) {
    const cacheEntry = {
      marker,
      entries: hydrated,
    };
    threadExtractionCache.set(thread, cacheEntry);
    if (turnArray) {
      turnArrayExtractionCache.set(turnArray, cacheEntry);
    } else if (turnMapping) {
      turnMappingExtractionCache.set(turnMapping, cacheEntry);
    }
  }

  return hydrated;
}
