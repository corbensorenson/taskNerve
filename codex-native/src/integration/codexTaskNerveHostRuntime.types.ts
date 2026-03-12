import type { TaskRecord, ProjectCodexSettings } from "../schemas.js";
import type {
  CodexConversationChromeResourceStats,
  CodexConversationChromeSnapshot,
  CodexConversationChromeStateInput,
} from "./codexConversationChrome.js";
import type {
  CodexConversationDisplayOptions,
  CodexConversationDisplaySnapshot,
} from "./codexConversationDisplay.js";
import type {
  CodexConversationInteractionInput,
  CodexConversationInteractionResult,
} from "./codexConversationInteraction.js";
import { planCodexProjectGitSync } from "./codexProjectGitSync.js";
import type { ProjectGitSyncSnapshot } from "../domain/projectGitSync.js";
import type { ProjectCiTaskSyncPlan } from "../domain/projectCiSync.js";
import type { CodexProjectProductionSnapshot } from "./codexProjectProduction.js";
import type {
  CodexProjectProductionRunOptions,
  CodexProjectProductionRunResult,
  CodexProjectProductionSnapshotOptions,
} from "./codexProjectProductionRuntime.js";
import type {
  CodexControllerProjectAutomationOptions,
  CodexControllerProjectAutomationResult,
} from "./codexControllerProjectAutomation.js";
import type { CodexProjectTraceSyncResult } from "./codexProjectTrace.js";
import type {
  CodexAgentWatchdogPolicy,
  CodexAgentWatchdogRunResult,
} from "./codexAgentWatchdog.types.js";
import type {
  CodexModelTransportExecution,
  CodexModelTransportPlan,
} from "./modelTransport.js";
import type { TaskNerveService } from "./taskNerveService.js";
import type {
  BuildThreadDisplayOptions,
  ThreadDisplaySnapshot,
} from "./threadDisplay/index.js";

export interface CodexTaskNerveSnapshotOptions {
  repoRoot: string;
  projectName: string;
  tasks: Partial<TaskRecord>[];
  search?: string;
  gitOriginUrl?: string | null;
}

export interface CodexTaskNerveSnapshot {
  integration_mode: "codex-native-host";
  styling: {
    inherit_codex_host: true;
    render_mode: "host-components-only";
  };
  host_styling_context: unknown;
  project_name: string;
  repo_root: string;
  settings: ProjectCodexSettings;
  task_snapshot: ReturnType<TaskNerveService["taskSnapshot"]>;
}

export interface CodexControllerBootstrapOptions {
  repoRoot: string;
  projectName: string;
  projectGoalsPath?: string;
  projectManifestPath?: string;
  currentStateSignals?: string[];
  timelineSignals?: string[];
  queueSummary?: string;
  maintenanceCadence?: string;
  heartbeatCore?: string | null;
  lowQueuePrompt?: string;
  threadTitle?: string;
}

export interface CodexControllerBootstrapResult {
  integration_mode: "codex-native-host";
  thread_id: string;
  thread_title: string;
  controller_model: string | null;
  prompt: string;
  model_transport: {
    requested_mode: CodexModelTransportPlan["requested_mode"];
    resolved_mode: CodexModelTransportPlan["resolved_mode"];
    executed_mode: CodexModelTransportExecution["executed_mode"];
    websocket_available: boolean;
    fallback_reason: string | null;
    fell_back_to_http: boolean;
    websocket_error: string | null;
  };
}

export interface CodexModelTransportSnapshot {
  integration_mode: "codex-native-host";
  requested_mode: CodexModelTransportPlan["requested_mode"];
  resolved_mode: CodexModelTransportPlan["resolved_mode"];
  websocket_available: boolean;
  fallback_reason: string | null;
}

export interface CodexProjectGitSyncSnapshotOptions {
  repoRoot: string;
  tasks?: Partial<TaskRecord>[];
  nowIsoUtc?: string | null;
  gitState?: unknown;
}

export interface CodexProjectGitSyncRunOptions {
  repoRoot: string;
  tasks?: Partial<TaskRecord>[];
  mode?: "smart" | "pull" | "push";
  autostash?: boolean;
  force?: boolean;
  autoSwitchPreferredBranch?: boolean;
  nowIsoUtc?: string | null;
}

export interface CodexProjectGitSyncRunResult {
  integration_mode: "codex-native-host";
  mode: "smart" | "pull" | "push";
  executed: {
    pull: boolean;
    push: boolean;
  };
  plan_reason: ReturnType<typeof planCodexProjectGitSync>["reason"];
  before: ProjectGitSyncSnapshot;
  after: ProjectGitSyncSnapshot;
  warnings: string[];
}

export interface CodexProjectCiSyncSnapshotOptions {
  repoRoot: string;
  tasks?: Partial<TaskRecord>[];
  ciFailures?: unknown;
  availableAgentIds?: string[];
  nowIsoUtc?: string | null;
}

export interface CodexProjectCiSyncRunOptions {
  repoRoot: string;
  tasks?: Partial<TaskRecord>[];
  ciFailures?: unknown;
  availableAgentIds?: string[];
  persistTasks?: boolean;
  dispatch?: boolean;
  nowIsoUtc?: string | null;
}

export interface CodexProjectCiSyncRunResult {
  integration_mode: "codex-native-host";
  before: ProjectCiTaskSyncPlan;
  settings: ProjectCodexSettings;
  persisted_task_upserts: number;
  dispatched_task_ids: string[];
  warnings: string[];
}

export interface CodexRuntimeProjectTraceSyncOptions {
  repoRoot: string;
  projectName?: string | null;
  settings?: Partial<ProjectCodexSettings>;
  threadsPayload?: unknown;
  nowIsoUtc?: string | null;
  force?: boolean;
}

export interface CodexAgentWatchdogRunOptions {
  repoRoot: string;
  projectName?: string | null;
  tasks?: Partial<TaskRecord>[];
  settings?: Partial<ProjectCodexSettings>;
  threadsPayload?: unknown;
  nowIsoUtc?: string | null;
  policy?: Partial<CodexAgentWatchdogPolicy>;
}

export interface CodexProjectProductionRunWithTraceResult
  extends CodexProjectProductionRunResult {
  trace_sync: CodexProjectTraceSyncResult;
}

export interface CodexControllerProjectAutomationWithTraceResult
  extends CodexControllerProjectAutomationResult {
  trace_sync: CodexProjectTraceSyncResult;
}

export type CodexConversationChromeAction =
  | { type: "topbar-task-count-click" }
  | { type: "topbar-import-project-click" }
  | { type: "topbar-new-project-click" }
  | { type: "footer-terminal-toggle-click" }
  | { type: "footer-branch-switch"; branch: string };

export interface CodexConversationChromeActionResult {
  ok: boolean;
  integration_mode: "codex-native-host";
  action: CodexConversationChromeAction["type"];
  task_drawer_open?: boolean;
  terminal_open?: boolean;
  branch?: string;
  error?: string;
}

export interface CodexHostRefreshSubscription {
  mode: "host-event-subscription" | "fallback-manual-refresh";
  dispose: () => void;
}

export interface ObserveThreadRefreshOptions {
  threadId?: string | null;
  onEvent: (event: unknown) => void;
  onFallbackRefresh?: () => void;
}

export interface ObserveRepositorySettingsRefreshOptions {
  onEvent: (event: unknown) => void;
  onFallbackRefresh?: () => void;
}

export type CodexConversationChromeRefreshSource =
  | "task-count"
  | "task-drawer"
  | "terminal-panel"
  | "branch-state"
  | "resource-stats";

export interface CodexConversationChromeRefreshEvent {
  source: CodexConversationChromeRefreshSource;
  payload: unknown;
}

export interface ObserveConversationChromeRefreshOptions {
  onEvent: (event: CodexConversationChromeRefreshEvent) => void;
  onFallbackRefresh?: () => void;
}

export interface CodexTaskNerveHostRuntime {
  snapshot: (options: CodexTaskNerveSnapshotOptions) => Promise<CodexTaskNerveSnapshot>;
  bootstrapControllerThread: (
    options: CodexControllerBootstrapOptions,
  ) => Promise<CodexControllerBootstrapResult>;
  projectGitSyncSnapshot: (
    options: CodexProjectGitSyncSnapshotOptions,
  ) => Promise<ProjectGitSyncSnapshot>;
  syncProjectGit: (options: CodexProjectGitSyncRunOptions) => Promise<CodexProjectGitSyncRunResult>;
  projectCiSyncSnapshot: (
    options: CodexProjectCiSyncSnapshotOptions,
  ) => Promise<ProjectCiTaskSyncPlan>;
  syncProjectCi: (options: CodexProjectCiSyncRunOptions) => Promise<CodexProjectCiSyncRunResult>;
  syncProjectTrace: (
    options: CodexRuntimeProjectTraceSyncOptions,
  ) => Promise<CodexProjectTraceSyncResult>;
  syncAgentWatchdog: (
    options: CodexAgentWatchdogRunOptions,
  ) => Promise<CodexAgentWatchdogRunResult>;
  projectProductionSnapshot: (
    options: CodexProjectProductionSnapshotOptions,
  ) => Promise<CodexProjectProductionSnapshot>;
  syncProjectProduction: (
    options: CodexProjectProductionRunOptions,
  ) => Promise<CodexProjectProductionRunWithTraceResult>;
  controllerProjectAutomation: (
    options: CodexControllerProjectAutomationOptions,
  ) => Promise<CodexControllerProjectAutomationWithTraceResult>;
  conversationDisplaySnapshot: (
    options: CodexConversationDisplayOptions,
  ) => Promise<CodexConversationDisplaySnapshot>;
  conversationInteractionStep: (
    input: CodexConversationInteractionInput,
  ) => Promise<CodexConversationInteractionResult>;
  applyConversationInteraction: (
    input: CodexConversationInteractionInput,
  ) => Promise<
    CodexConversationInteractionResult & {
      apply_summary: {
        applied: number;
        skipped: number;
      };
    }
  >;
  threadDisplaySnapshot: (options: BuildThreadDisplayOptions) => Promise<ThreadDisplaySnapshot>;
  conversationChromeSnapshot: (
    options?: CodexConversationChromeStateInput,
  ) => Promise<CodexConversationChromeSnapshot>;
  handleConversationChromeAction: (
    action: CodexConversationChromeAction,
  ) => Promise<CodexConversationChromeActionResult>;
  observeThreadRefresh: (
    options: ObserveThreadRefreshOptions,
  ) => Promise<CodexHostRefreshSubscription>;
  observeRepositorySettingsRefresh: (
    options: ObserveRepositorySettingsRefreshOptions,
  ) => Promise<CodexHostRefreshSubscription>;
  observeConversationChromeRefresh: (
    options: ObserveConversationChromeRefreshOptions,
  ) => Promise<CodexHostRefreshSubscription>;
  modelTransportSnapshot: () => CodexModelTransportSnapshot;
}
