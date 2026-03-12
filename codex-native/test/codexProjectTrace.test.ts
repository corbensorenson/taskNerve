import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  syncCodexProjectTrace,
  type CodexProjectTraceEntry,
} from "../src/integration/codexProjectTrace.js";
import { projectTraceManifestPath, projectTracePath } from "../src/io/paths.js";

async function readTraceEntries(repoRoot: string): Promise<CodexProjectTraceEntry[]> {
  const raw = await readFile(projectTracePath(repoRoot), "utf8");
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CodexProjectTraceEntry);
}

describe("project trace sync", () => {
  it("collects and appends deterministic controller/agent trace entries with de-dup", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tasknerve-trace-sync-"));
    const threadsPayload = {
      threads: [
        {
          thread_id: "thread-controller",
          role: "controller",
          agent_id: "agent.controller",
          title: "TaskNerve Controller",
          updated_at: "2026-03-12T00:00:00.000Z",
          turns: [
            {
              id: "turn-1",
              role: "user",
              created_at: "2026-03-12T00:00:01.000Z",
              content: [{ text: "Plan the next sprint." }],
            },
            {
              id: "turn-2",
              role: "assistant",
              created_at: "2026-03-12T00:00:02.000Z",
              text: "Created and prioritized next tasks.",
            },
          ],
        },
        {
          thread_id: "thread-agent-alpha",
          role: "agent",
          agent_id: "agent.alpha",
          title: "Agent Alpha",
          updated_at: "2026-03-12T00:00:03.000Z",
          messages: [
            {
              id: "message-1",
              role: "assistant",
              created_at: "2026-03-12T00:00:04.000Z",
              body: "Implemented parser and tests.",
            },
          ],
        },
      ],
    };

    const first = await syncCodexProjectTrace({
      repoRoot,
      projectName: "taskNerve",
      threadsPayload,
      nowIsoUtc: "2026-03-12T00:01:00.000Z",
    });
    expect(first.enabled).toBe(true);
    expect(first.entries_seen).toBe(5);
    expect(first.entries_appended).toBe(5);
    expect(first.threads_seen).toBe(2);
    expect(first.threads_in_scope).toBe(2);
    expect(first.total_entries_written).toBe(5);

    const entriesAfterFirst = await readTraceEntries(repoRoot);
    expect(entriesAfterFirst).toHaveLength(5);
    expect(entriesAfterFirst.some((entry) => entry.thread_scope === "controller")).toBe(true);
    expect(entriesAfterFirst.some((entry) => entry.thread_scope === "agent")).toBe(true);

    const second = await syncCodexProjectTrace({
      repoRoot,
      projectName: "taskNerve",
      threadsPayload,
      nowIsoUtc: "2026-03-12T00:01:30.000Z",
    });
    expect(second.entries_seen).toBe(5);
    expect(second.entries_appended).toBe(0);
    expect(second.total_entries_written).toBe(5);

    const entriesAfterSecond = await readTraceEntries(repoRoot);
    expect(entriesAfterSecond).toHaveLength(5);

    const manifestRaw = await readFile(projectTraceManifestPath(repoRoot), "utf8");
    expect(manifestRaw).toContain("\"schema_version\": \"tasknerve.project_trace_manifest.v1\"");
    expect(manifestRaw).toContain("\"total_entries_written\": 5");
  });

  it("respects capture policy and message text size limits", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tasknerve-trace-policy-"));
    const result = await syncCodexProjectTrace({
      repoRoot,
      projectName: "taskNerve",
      settings: {
        trace_collection_enabled: true,
        trace_capture_controller: true,
        trace_capture_agents: false,
        trace_include_message_content: true,
        trace_max_content_chars: 12,
      },
      threadsPayload: {
        threads: [
          {
            thread_id: "thread-controller",
            role: "controller",
            agent_id: "agent.controller",
            turns: [
              {
                id: "turn-c-1",
                role: "assistant",
                text: "Controller output with lots of characters.",
              },
            ],
          },
          {
            thread_id: "thread-agent",
            role: "agent",
            agent_id: "agent.worker",
            turns: [
              {
                id: "turn-a-1",
                role: "assistant",
                text: "Agent output should be ignored.",
              },
            ],
          },
        ],
      },
      nowIsoUtc: "2026-03-12T00:02:00.000Z",
    });

    expect(result.entries_appended).toBe(2);
    expect(result.threads_seen).toBe(2);
    expect(result.threads_in_scope).toBe(1);

    const entries = await readTraceEntries(repoRoot);
    expect(entries.every((entry) => entry.thread_scope === "controller")).toBe(true);
    const turnEntry = entries.find((entry) => entry.event_type === "turn");
    expect(turnEntry?.content_text).toBe("Controller o");
    expect(turnEntry?.content_chars).toBe(12);
  });
});
