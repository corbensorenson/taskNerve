import { CONTROLLER_AGENT_ID } from "../constants.js";
import {
  assertCodexHostServices,
  type CodexHostServices,
} from "../host/codexHostServices.js";
import type { ProjectCodexSettings, TaskRecord } from "../schemas.js";
import { createTaskNerveService, type TaskNerveService } from "./taskNerveService.js";

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
}

export interface CodexTaskNerveHostRuntime {
  snapshot: (options: CodexTaskNerveSnapshotOptions) => Promise<CodexTaskNerveSnapshot>;
  bootstrapControllerThread: (
    options: CodexControllerBootstrapOptions,
  ) => Promise<CodexControllerBootstrapResult>;
}

function parseThreadId(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const payload = value as Record<string, unknown>;
  const direct = payload.thread_id;
  if (typeof direct === "string" && direct.trim()) {
    return direct;
  }
  const camel = payload.threadId;
  if (typeof camel === "string" && camel.trim()) {
    return camel;
  }
  const nested = payload.thread;
  if (nested && typeof nested === "object") {
    const nestedThread = nested as Record<string, unknown>;
    if (typeof nestedThread.id === "string" && nestedThread.id.trim()) {
      return nestedThread.id;
    }
    if (typeof nestedThread.thread_id === "string" && nestedThread.thread_id.trim()) {
      return nestedThread.thread_id;
    }
  }
  const id = payload.id;
  return typeof id === "string" && id.trim() ? id : null;
}

export function createCodexTaskNerveHostRuntime(options: {
  host: Partial<CodexHostServices> | null | undefined;
  taskNerveService?: TaskNerveService;
}): CodexTaskNerveHostRuntime {
  const host = assertCodexHostServices(options.host);
  const taskNerve = options.taskNerveService ?? createTaskNerveService();

  return {
    snapshot: async (snapshotOptions) => {
      const settings = await taskNerve.loadProjectSettings({
        repoRoot: snapshotOptions.repoRoot,
        gitOriginUrl: snapshotOptions.gitOriginUrl,
      });
      const taskSnapshot = taskNerve.taskSnapshot(snapshotOptions.tasks, snapshotOptions.search || "");
      const hostStylingContext =
        typeof host.getCodexStylingContext === "function"
          ? await host.getCodexStylingContext()
          : null;
      return {
        integration_mode: "codex-native-host",
        styling: {
          inherit_codex_host: true,
          render_mode: "host-components-only",
        },
        host_styling_context: hostStylingContext,
        project_name: snapshotOptions.projectName,
        repo_root: snapshotOptions.repoRoot,
        settings,
        task_snapshot: taskSnapshot,
      };
    },

    bootstrapControllerThread: async (bootstrapOptions) => {
      const settings = await taskNerve.loadProjectSettings({
        repoRoot: bootstrapOptions.repoRoot,
      });
      const controllerModel = taskNerve.resolveModelsForTask(settings).controller_model;
      const prompt = taskNerve.buildControllerPrompt({
        projectName: bootstrapOptions.projectName,
        repoRoot: bootstrapOptions.repoRoot,
        projectGoalsPath: bootstrapOptions.projectGoalsPath,
        projectManifestPath: bootstrapOptions.projectManifestPath,
        currentStateSignals: bootstrapOptions.currentStateSignals,
        timelineSignals: bootstrapOptions.timelineSignals,
        queueSummary: bootstrapOptions.queueSummary,
        maintenanceCadence: bootstrapOptions.maintenanceCadence,
        heartbeatCore: bootstrapOptions.heartbeatCore,
        lowQueuePrompt: bootstrapOptions.lowQueuePrompt,
      });

      const title =
        bootstrapOptions.threadTitle?.trim() || `${bootstrapOptions.projectName} TaskNerve Controller`;

      const threadPayload = await host.startThread({
        title,
        role: "controller",
        agent_id: CONTROLLER_AGENT_ID,
        metadata: {
          source: "tasknerve.codex-native-host-runtime",
          repo_root: bootstrapOptions.repoRoot,
          project_name: bootstrapOptions.projectName,
        },
      });
      const threadId = parseThreadId(threadPayload);
      if (!threadId) {
        throw new Error("Codex host startThread did not return a thread identifier");
      }

      await host.setThreadName(threadId, title);
      if (controllerModel) {
        await host.setThreadModel(threadId, controllerModel);
      }
      await host.startTurn({
        thread_id: threadId,
        threadId,
        agent_id: CONTROLLER_AGENT_ID,
        model: controllerModel || undefined,
        prompt,
      });
      await host.pinThread(threadId);
      await host.openThread(threadId);

      return {
        integration_mode: "codex-native-host",
        thread_id: threadId,
        thread_title: title,
        controller_model: controllerModel,
        prompt,
      };
    },
  };
}
