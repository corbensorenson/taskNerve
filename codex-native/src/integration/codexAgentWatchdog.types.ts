import type { ProjectCodexSettings, TaskRecord } from "../schemas.js";

export interface CodexAgentWatchdogPolicy {
  enabled: boolean;
  min_runtime_minutes: number;
  max_output_gap_minutes: number;
  min_gap_runtime_ratio: number;
  waiting_hint_grace_minutes: number;
  task_recovery_cooldown_minutes: number;
  controller_recovery_cooldown_minutes: number;
  max_resets_per_run: number;
}

export interface CodexAgentWatchdogRunOptions {
  repoRoot: string;
  projectName?: string | null;
  tasks?: Partial<TaskRecord>[];
  settings: Partial<ProjectCodexSettings>;
  nowIsoUtc?: string | null;
  threadsPayload?: unknown;
  policy?: Partial<CodexAgentWatchdogPolicy>;
}

export interface CodexAgentWatchdogAction {
  type: "worker-reset" | "controller-reset";
  agent_id: string;
  stalled_thread_id: string;
  recovery_thread_id: string;
  task_id: string | null;
  reason: string;
}

export interface CodexAgentWatchdogRunResult {
  integration_mode: "codex-native-host";
  repo_root: string;
  project_name: string | null;
  checked_at_utc: string;
  policy: CodexAgentWatchdogPolicy;
  threads_seen: number;
  threads_scanned: number;
  stalled_worker_candidates: number;
  stalled_controller_candidates: number;
  worker_resets: number;
  controller_resets: number;
  recovered_task_ids: string[];
  actions: CodexAgentWatchdogAction[];
  warnings: string[];
}
