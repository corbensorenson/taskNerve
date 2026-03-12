import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  CONTROLLER_AGENT_ID,
  SCHEMA_PROJECT_TRACE_ENTRY,
  SCHEMA_PROJECT_TRACE_MANIFEST,
  SCHEMA_PROJECT_TRACE_STATE,
  nowIsoUtc,
} from "../constants.js";
import { normalizeProjectCodexSettings } from "../domain/projectCodexSettings.js";
import { writePrettyJsonIfChanged } from "../io/jsonStore.js";
import {
  projectTraceManifestPath,
  projectTracePath,
  timelineProjectTraceStatePath,
} from "../io/paths.js";
import type { ProjectCodexSettings } from "../schemas.js";

const FILE_MISSING_MTIME_MS = -1;
const PROJECT_TRACE_STATE_CACHE_LIMIT = 256;
const PROJECT_TRACE_SEEN_EVENT_IDS_LIMIT = 50_000;

const projectTraceStateSchema = z.object({
  schema_version: z.string().default(SCHEMA_PROJECT_TRACE_STATE),
  updated_at_utc: z.string(),
  last_sync_at_utc: z.string().nullish(),
  total_entries_written: z.number().int().min(0).default(0),
  seen_event_ids: z.array(z.string().trim().min(1)).default([]),
});

type ProjectTraceState = z.infer<typeof projectTraceStateSchema>;

interface ProjectTraceStateCacheEntry {
  mtimeMs: number;
  value: ProjectTraceState;
  raw: string;
}

interface ParsedThreadRecord {
  thread_id: string;
  thread_title: string | null;
  thread_role: string | null;
  agent_id: string | null;
  model: string | null;
  updated_at_utc: string | null;
  scope: "controller" | "agent" | "other";
  turns: Record<string, unknown>[];
}

interface ParsedTurnRecord {
  turn_id: string | null;
  turn_role: string | null;
  turn_model: string | null;
  turn_created_at_utc: string | null;
  content_text_raw: string | null;
  event_type: string | null;
}

export interface CodexProjectTraceEntry {
  schema_version: string;
  event_id: string;
  collected_at_utc: string;
  source: "codex-native-host";
  repo_root: string;
  project_name: string | null;
  thread_scope: "controller" | "agent" | "other";
  thread_id: string;
  thread_title: string | null;
  thread_role: string | null;
  agent_id: string | null;
  model: string | null;
  thread_updated_at_utc: string | null;
  event_type: "thread_snapshot" | "turn";
  turn_id: string | null;
  turn_role: string | null;
  turn_model: string | null;
  turn_created_at_utc: string | null;
  content_text: string | null;
  content_sha1: string | null;
  content_chars: number;
}

export interface CodexProjectTraceSyncOptions {
  repoRoot: string;
  projectName?: string | null;
  settings?: Partial<ProjectCodexSettings>;
  threadsPayload: unknown;
  nowIsoUtc?: string | null;
  force?: boolean;
}

export interface CodexProjectTraceSyncResult {
  integration_mode: "codex-native-host";
  repo_root: string;
  project_name: string | null;
  enabled: boolean;
  reason: "enabled" | "disabled";
  trace_path: string;
  manifest_path: string;
  state_path: string;
  threads_seen: number;
  threads_in_scope: number;
  entries_seen: number;
  entries_appended: number;
  total_entries_written: number;
  trace_settings: {
    capture_controller: boolean;
    capture_agents: boolean;
    include_message_content: boolean;
    max_content_chars: number;
  };
  synced_at_utc: string;
  warnings: string[];
}

const projectTraceStateCache = new Map<string, ProjectTraceStateCacheEntry>();
const projectTraceStateInflight = new Map<string, Promise<ProjectTraceStateCacheEntry>>();

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => asRecord(entry)).filter((entry): entry is Record<string, unknown> => !!entry);
}

function uniqueTrimmed(values: string[], limit = PROJECT_TRACE_SEEN_EVENT_IDS_LIMIT): string[] {
  const deduped = [
    ...new Set(values.map((value) => normalizeOptionalText(value)).filter((value): value is string => !!value)),
  ];
  if (deduped.length <= limit) {
    return deduped;
  }
  return deduped.slice(deduped.length - limit);
}

function normalizeTraceState(value: Partial<ProjectTraceState> = {}): ProjectTraceState {
  const totalEntries = Number.isFinite(value.total_entries_written)
    ? Math.max(0, Math.round(Number(value.total_entries_written)))
    : 0;
  return projectTraceStateSchema.parse({
    schema_version: SCHEMA_PROJECT_TRACE_STATE,
    updated_at_utc: normalizeOptionalText(value.updated_at_utc) ?? nowIsoUtc(),
    last_sync_at_utc: normalizeOptionalText(value.last_sync_at_utc),
    total_entries_written: totalEntries,
    seen_event_ids: uniqueTrimmed(value.seen_event_ids || []),
  });
}

async function fileMtimeMs(filePath: string): Promise<number> {
  try {
    const metadata = await stat(filePath);
    return metadata.mtimeMs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return FILE_MISSING_MTIME_MS;
    }
    throw error;
  }
}

function getCachedProjectTraceState(filePath: string): ProjectTraceStateCacheEntry | null {
  if (!projectTraceStateCache.has(filePath)) {
    return null;
  }
  const cached = projectTraceStateCache.get(filePath)!;
  projectTraceStateCache.delete(filePath);
  projectTraceStateCache.set(filePath, cached);
  return cached;
}

function rememberProjectTraceState(filePath: string, entry: ProjectTraceStateCacheEntry) {
  if (projectTraceStateCache.has(filePath)) {
    projectTraceStateCache.delete(filePath);
  }
  projectTraceStateCache.set(filePath, entry);
  if (projectTraceStateCache.size > PROJECT_TRACE_STATE_CACHE_LIMIT) {
    const oldestPath = projectTraceStateCache.keys().next().value;
    if (typeof oldestPath === "string") {
      projectTraceStateCache.delete(oldestPath);
    }
  }
}

async function loadProjectTraceState(repoRoot: string): Promise<ProjectTraceStateCacheEntry> {
  const filePath = timelineProjectTraceStatePath(repoRoot);
  const inflight = projectTraceStateInflight.get(filePath);
  if (inflight) {
    return inflight;
  }

  const promise = (async () => {
    const currentMtimeMs = await fileMtimeMs(filePath);
    const cached = getCachedProjectTraceState(filePath);
    if (cached && cached.mtimeMs === currentMtimeMs) {
      return cached;
    }

    let raw: string | null = null;
    let parsedValue: ProjectTraceState | null = null;
    try {
      const fileRaw = await readFile(filePath, "utf8");
      raw = fileRaw;
      parsedValue = normalizeTraceState(projectTraceStateSchema.parse(JSON.parse(fileRaw)));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        throw error;
      }
    }

    const normalized = normalizeTraceState(parsedValue || {});
    const normalizedRaw = `${JSON.stringify(normalized, null, 2)}\n`;
    const entry: ProjectTraceStateCacheEntry = {
      mtimeMs: currentMtimeMs,
      value: normalized,
      raw: raw ?? normalizedRaw,
    };
    rememberProjectTraceState(filePath, entry);
    return entry;
  })();

  projectTraceStateInflight.set(filePath, promise);
  return promise.finally(() => {
    projectTraceStateInflight.delete(filePath);
  });
}

async function writeProjectTraceState(repoRoot: string, state: ProjectTraceState): Promise<ProjectTraceState> {
  const filePath = timelineProjectTraceStatePath(repoRoot);
  const currentMtimeMs = await fileMtimeMs(filePath);
  const cached = getCachedProjectTraceState(filePath);
  const existingRaw =
    currentMtimeMs === FILE_MISSING_MTIME_MS
      ? undefined
      : cached && cached.mtimeMs === currentMtimeMs
        ? cached.raw
        : undefined;
  const wrote = await writePrettyJsonIfChanged(filePath, state, { existingRaw });
  const nextMtimeMs =
    wrote || currentMtimeMs === FILE_MISSING_MTIME_MS ? await fileMtimeMs(filePath) : currentMtimeMs;
  const nextRaw = `${JSON.stringify(state, null, 2)}\n`;
  rememberProjectTraceState(filePath, {
    mtimeMs: nextMtimeMs,
    value: state,
    raw: nextRaw,
  });
  return state;
}

function stableHash(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

function parseThreadScope(record: ParsedThreadRecord): "controller" | "agent" | "other" {
  const role = (record.thread_role || "").toLowerCase();
  const title = (record.thread_title || "").toLowerCase();
  const agentId = (record.agent_id || "").toLowerCase();
  if (
    role.includes("controller") ||
    agentId === CONTROLLER_AGENT_ID.toLowerCase() ||
    title.includes("controller")
  ) {
    return "controller";
  }
  if (
    role.includes("agent") ||
    role.includes("worker") ||
    agentId.startsWith("agent.") ||
    title.includes("agent")
  ) {
    return "agent";
  }
  return "other";
}

function firstRecordArray(record: Record<string, unknown>, keys: string[]): Record<string, unknown>[] {
  for (const key of keys) {
    const array = asRecordArray(record[key]);
    if (array.length > 0) {
      return array;
    }
  }
  return [];
}

function parseThreadList(payload: unknown): Record<string, unknown>[] {
  const direct = asRecordArray(payload);
  if (direct.length > 0) {
    return direct;
  }
  const record = asRecord(payload);
  if (!record) {
    return [];
  }

  const directCandidates = firstRecordArray(record, ["threads", "items", "results", "data"]);
  if (directCandidates.length > 0) {
    return directCandidates;
  }

  for (const key of ["payload", "response", "value"]) {
    const nested = asRecord(record[key]);
    if (!nested) {
      continue;
    }
    const nestedCandidates = firstRecordArray(nested, ["threads", "items", "results", "data"]);
    if (nestedCandidates.length > 0) {
      return nestedCandidates;
    }
  }

  return [];
}

function parseThreadRecord(record: Record<string, unknown>): ParsedThreadRecord | null {
  const thread = asRecord(record.thread) ?? record;
  const threadId =
    normalizeOptionalText(thread.thread_id) ??
    normalizeOptionalText(thread.threadId) ??
    normalizeOptionalText(thread.id);
  if (!threadId) {
    return null;
  }

  const parsed: ParsedThreadRecord = {
    thread_id: threadId,
    thread_title:
      normalizeOptionalText(thread.title) ??
      normalizeOptionalText(thread.name) ??
      normalizeOptionalText(thread.thread_name),
    thread_role:
      normalizeOptionalText(thread.role) ??
      normalizeOptionalText(thread.thread_role) ??
      normalizeOptionalText(thread.type),
    agent_id:
      normalizeOptionalText(thread.agent_id) ??
      normalizeOptionalText(thread.agentId) ??
      normalizeOptionalText(thread.worker_id),
    model:
      normalizeOptionalText(thread.model) ??
      normalizeOptionalText(thread.model_name) ??
      normalizeOptionalText(thread.default_model),
    updated_at_utc:
      normalizeOptionalText(thread.updated_at_utc) ??
      normalizeOptionalText(thread.updated_at) ??
      normalizeOptionalText(thread.updatedAt) ??
      normalizeOptionalText(thread.last_activity_at) ??
      normalizeOptionalText(thread.last_activity_at_utc),
    scope: "other",
    turns: firstRecordArray(thread, ["turns", "messages", "entries", "history", "events"]),
  };
  parsed.scope = parseThreadScope(parsed);
  return parsed;
}

function extractTextParts(value: unknown, depth = 0): string[] {
  if (depth > 5) {
    return [];
  }
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized ? [normalized] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => extractTextParts(entry, depth + 1));
  }
  const record = asRecord(value);
  if (!record) {
    return [];
  }

  const pieces: string[] = [];
  for (const key of ["text", "message", "body", "markdown", "value", "content_text"]) {
    const part = normalizeOptionalText(record[key]);
    if (part) {
      pieces.push(part);
    }
  }
  for (const key of [
    "content",
    "contents",
    "parts",
    "segments",
    "delta",
    "input",
    "output",
    "data",
    "item",
    "items",
    "message",
    "messages",
    "output_items",
    "input_items",
  ]) {
    if (!(key in record)) {
      continue;
    }
    pieces.push(...extractTextParts(record[key], depth + 1));
  }
  return pieces;
}

function extractText(value: unknown, maxChars: number): string | null {
  const parts = extractTextParts(value);
  if (parts.length === 0) {
    return null;
  }
  const joined = parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!joined) {
    return null;
  }
  return joined.length <= maxChars ? joined : joined.slice(0, maxChars);
}

function parseTurnRecord(record: Record<string, unknown>, maxChars: number): ParsedTurnRecord {
  return {
    turn_id:
      normalizeOptionalText(record.turn_id) ??
      normalizeOptionalText(record.turnId) ??
      normalizeOptionalText(record.id) ??
      normalizeOptionalText(record.message_id) ??
      normalizeOptionalText(record.event_id),
    turn_role:
      normalizeOptionalText(record.role) ??
      normalizeOptionalText(record.author_role) ??
      normalizeOptionalText(record.speaker) ??
      normalizeOptionalText(record.actor),
    turn_model:
      normalizeOptionalText(record.model) ??
      normalizeOptionalText(record.model_name) ??
      normalizeOptionalText(record.modelId),
    turn_created_at_utc:
      normalizeOptionalText(record.created_at_utc) ??
      normalizeOptionalText(record.created_at) ??
      normalizeOptionalText(record.createdAt) ??
      normalizeOptionalText(record.timestamp) ??
      normalizeOptionalText(record.ts),
    content_text_raw: extractText(record, maxChars),
    event_type: normalizeOptionalText(record.type) ?? normalizeOptionalText(record.event_type),
  };
}

function buildTraceEntries(options: {
  repoRoot: string;
  projectName: string | null;
  threadsPayload: unknown;
  nowIso: string;
  captureController: boolean;
  captureAgents: boolean;
  includeMessageContent: boolean;
  maxContentChars: number;
}): {
  threadsSeen: number;
  threadsInScope: number;
  entries: CodexProjectTraceEntry[];
} {
  const threadRecords = parseThreadList(options.threadsPayload);
  const entries: CodexProjectTraceEntry[] = [];
  let threadsInScope = 0;

  for (const threadRecord of threadRecords) {
    const parsedThread = parseThreadRecord(threadRecord);
    if (!parsedThread) {
      continue;
    }
    if (parsedThread.scope === "controller" && !options.captureController) {
      continue;
    }
    if (parsedThread.scope === "agent" && !options.captureAgents) {
      continue;
    }
    if (parsedThread.scope === "other") {
      continue;
    }

    threadsInScope += 1;

    const snapshotEventId = stableHash(
      [
        "thread_snapshot",
        parsedThread.thread_id,
        parsedThread.thread_title || "",
        parsedThread.thread_role || "",
        parsedThread.agent_id || "",
        parsedThread.model || "",
        parsedThread.updated_at_utc || "",
      ].join("|"),
    );
    entries.push({
      schema_version: SCHEMA_PROJECT_TRACE_ENTRY,
      event_id: snapshotEventId,
      collected_at_utc: options.nowIso,
      source: "codex-native-host",
      repo_root: options.repoRoot,
      project_name: options.projectName,
      thread_scope: parsedThread.scope,
      thread_id: parsedThread.thread_id,
      thread_title: parsedThread.thread_title,
      thread_role: parsedThread.thread_role,
      agent_id: parsedThread.agent_id,
      model: parsedThread.model,
      thread_updated_at_utc: parsedThread.updated_at_utc,
      event_type: "thread_snapshot",
      turn_id: null,
      turn_role: null,
      turn_model: null,
      turn_created_at_utc: null,
      content_text: null,
      content_sha1: null,
      content_chars: 0,
    });

    for (let turnIndex = 0; turnIndex < parsedThread.turns.length; turnIndex += 1) {
      const turnRecord = parsedThread.turns[turnIndex]!;
      const turn = parseTurnRecord(turnRecord, options.maxContentChars);
      const contentHash = turn.content_text_raw ? stableHash(turn.content_text_raw) : null;
      const turnEventId = stableHash(
        [
          "turn",
          parsedThread.thread_id,
          turn.turn_id || "",
          String(turnIndex),
          turn.turn_role || "",
          turn.turn_model || "",
          turn.turn_created_at_utc || "",
          turn.event_type || "",
          contentHash || "",
        ].join("|"),
      );
      entries.push({
        schema_version: SCHEMA_PROJECT_TRACE_ENTRY,
        event_id: turnEventId,
        collected_at_utc: options.nowIso,
        source: "codex-native-host",
        repo_root: options.repoRoot,
        project_name: options.projectName,
        thread_scope: parsedThread.scope,
        thread_id: parsedThread.thread_id,
        thread_title: parsedThread.thread_title,
        thread_role: parsedThread.thread_role,
        agent_id: parsedThread.agent_id,
        model: parsedThread.model,
        thread_updated_at_utc: parsedThread.updated_at_utc,
        event_type: "turn",
        turn_id: turn.turn_id,
        turn_role: turn.turn_role,
        turn_model: turn.turn_model,
        turn_created_at_utc: turn.turn_created_at_utc,
        content_text: options.includeMessageContent ? turn.content_text_raw : null,
        content_sha1: contentHash,
        content_chars: turn.content_text_raw ? turn.content_text_raw.length : 0,
      });
    }
  }

  entries.sort((left, right) => left.event_id.localeCompare(right.event_id));

  return {
    threadsSeen: threadRecords.length,
    threadsInScope,
    entries,
  };
}

function inferProjectName(repoRoot: string, explicitProjectName: string | null): string | null {
  const explicit = normalizeOptionalText(explicitProjectName);
  if (explicit) {
    return explicit;
  }
  const basename = normalizeOptionalText(path.basename(repoRoot));
  return basename || null;
}

function defaultSyncResult(options: {
  repoRoot: string;
  projectName: string | null;
  enabled: boolean;
  reason: "enabled" | "disabled";
  nowIso: string;
  tracePath: string;
  manifestPath: string;
  statePath: string;
  totalEntriesWritten: number;
  settings: {
    captureController: boolean;
    captureAgents: boolean;
    includeMessageContent: boolean;
    maxContentChars: number;
  };
  threadsSeen?: number;
  threadsInScope?: number;
  entriesSeen?: number;
  entriesAppended?: number;
  warnings?: string[];
}): CodexProjectTraceSyncResult {
  return {
    integration_mode: "codex-native-host",
    repo_root: options.repoRoot,
    project_name: options.projectName,
    enabled: options.enabled,
    reason: options.reason,
    trace_path: options.tracePath,
    manifest_path: options.manifestPath,
    state_path: options.statePath,
    threads_seen: options.threadsSeen ?? 0,
    threads_in_scope: options.threadsInScope ?? 0,
    entries_seen: options.entriesSeen ?? 0,
    entries_appended: options.entriesAppended ?? 0,
    total_entries_written: options.totalEntriesWritten,
    trace_settings: {
      capture_controller: options.settings.captureController,
      capture_agents: options.settings.captureAgents,
      include_message_content: options.settings.includeMessageContent,
      max_content_chars: options.settings.maxContentChars,
    },
    synced_at_utc: options.nowIso,
    warnings: options.warnings ?? [],
  };
}

export async function syncCodexProjectTrace(
  options: CodexProjectTraceSyncOptions,
): Promise<CodexProjectTraceSyncResult> {
  const nowIso = normalizeOptionalText(options.nowIsoUtc) ?? nowIsoUtc();
  const normalizedSettings = normalizeProjectCodexSettings(options.settings || {});
  const tracePath = projectTracePath(options.repoRoot);
  const manifestPath = projectTraceManifestPath(options.repoRoot);
  const statePath = timelineProjectTraceStatePath(options.repoRoot);
  const projectName = inferProjectName(options.repoRoot, options.projectName ?? null);
  const stateEntry = await loadProjectTraceState(options.repoRoot);
  const warnings: string[] = [];

  const captureController = normalizedSettings.trace_capture_controller;
  const captureAgents = normalizedSettings.trace_capture_agents;
  const includeMessageContent = normalizedSettings.trace_include_message_content;
  const maxContentChars = normalizedSettings.trace_max_content_chars;
  const enabled = normalizedSettings.trace_collection_enabled || options.force === true;

  let result = defaultSyncResult({
    repoRoot: options.repoRoot,
    projectName,
    enabled,
    reason: enabled ? "enabled" : "disabled",
    nowIso,
    tracePath,
    manifestPath,
    statePath,
    totalEntriesWritten: stateEntry.value.total_entries_written,
    settings: {
      captureController,
      captureAgents,
      includeMessageContent,
      maxContentChars,
    },
  });

  if (!enabled) {
    await writePrettyJsonIfChanged(manifestPath, {
      schema_version: SCHEMA_PROJECT_TRACE_MANIFEST,
      updated_at_utc: nowIso,
      repo_root: options.repoRoot,
      project_name: projectName,
      trace_path: tracePath,
      enabled: false,
      last_sync_at_utc: stateEntry.value.last_sync_at_utc ?? null,
      total_entries_written: stateEntry.value.total_entries_written,
      trace_settings: result.trace_settings,
    });
    return result;
  }

  if (!captureController && !captureAgents) {
    warnings.push("Trace collection is enabled but both controller and agent capture are disabled");
  }

  const built = buildTraceEntries({
    repoRoot: options.repoRoot,
    projectName,
    threadsPayload: options.threadsPayload,
    nowIso,
    captureController,
    captureAgents,
    includeMessageContent,
    maxContentChars,
  });

  const seenEventIds = [...stateEntry.value.seen_event_ids];
  const seenSet = new Set(seenEventIds);
  const entriesToAppend: CodexProjectTraceEntry[] = [];
  for (const entry of built.entries) {
    if (seenSet.has(entry.event_id)) {
      continue;
    }
    seenSet.add(entry.event_id);
    seenEventIds.push(entry.event_id);
    entriesToAppend.push(entry);
  }

  if (seenEventIds.length > PROJECT_TRACE_SEEN_EVENT_IDS_LIMIT) {
    seenEventIds.splice(0, seenEventIds.length - PROJECT_TRACE_SEEN_EVENT_IDS_LIMIT);
  }

  if (entriesToAppend.length > 0) {
    await mkdir(path.dirname(tracePath), { recursive: true });
    const payload =
      entriesToAppend.map((entry) => JSON.stringify(entry)).join("\n") +
      "\n";
    await appendFile(tracePath, payload, "utf8");
  }

  const nextState = normalizeTraceState({
    ...stateEntry.value,
    updated_at_utc: nowIso,
    last_sync_at_utc: nowIso,
    total_entries_written: stateEntry.value.total_entries_written + entriesToAppend.length,
    seen_event_ids: seenEventIds,
  });
  await writeProjectTraceState(options.repoRoot, nextState);

  result = defaultSyncResult({
    repoRoot: options.repoRoot,
    projectName,
    enabled: true,
    reason: "enabled",
    nowIso,
    tracePath,
    manifestPath,
    statePath,
    totalEntriesWritten: nextState.total_entries_written,
    settings: {
      captureController,
      captureAgents,
      includeMessageContent,
      maxContentChars,
    },
    threadsSeen: built.threadsSeen,
    threadsInScope: built.threadsInScope,
    entriesSeen: built.entries.length,
    entriesAppended: entriesToAppend.length,
    warnings,
  });

  await writePrettyJsonIfChanged(manifestPath, {
    schema_version: SCHEMA_PROJECT_TRACE_MANIFEST,
    updated_at_utc: nowIso,
    repo_root: options.repoRoot,
    project_name: projectName,
    trace_path: tracePath,
    enabled: true,
    last_sync_at_utc: nextState.last_sync_at_utc ?? nowIso,
    total_entries_written: nextState.total_entries_written,
    last_sync_stats: {
      threads_seen: built.threadsSeen,
      threads_in_scope: built.threadsInScope,
      entries_seen: built.entries.length,
      entries_appended: entriesToAppend.length,
    },
    trace_settings: result.trace_settings,
    warnings,
  });

  return result;
}
