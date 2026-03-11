import type { CodexHostServices } from "../host/codexHostServices.js";
import type { ProjectCodexSettings, TaskRecord } from "../schemas.js";
import type { TaskNerveService } from "./taskNerveService.js";
import {
  syncCodexProjectProduction,
  type CodexProjectProductionRunResult,
} from "./codexProjectProductionRuntime.js";

export type CodexControllerGitBindingSource =
  | "settings"
  | "input"
  | "workspace-context"
  | "unavailable";

export interface CodexControllerProjectAutomationOptions {
  repoRoot: string;
  tasks?: Partial<TaskRecord>[];
  gitOriginUrl?: string | null;
  gitState?: unknown;
  ciFailures?: unknown;
  availableAgentIds?: string[];
  nowIsoUtc?: string | null;
}

export interface CodexControllerProjectAutomationResult {
  integration_mode: "codex-native-host";
  repo_root: string;
  tasknerve_managed_git: true;
  git_binding: {
    configured: boolean;
    source: CodexControllerGitBindingSource;
    git_origin_url: string | null;
  };
  settings: ProjectCodexSettings;
  production_sync: CodexProjectProductionRunResult;
  warnings: string[];
}

interface CodexControllerProjectAutomationDependencies {
  host: CodexHostServices;
  taskNerve: TaskNerveService;
  loadProjectGitState: (repoRoot: string, override?: unknown) => Promise<unknown>;
  loadProjectCiFailures: (repoRoot: string, override?: unknown) => Promise<unknown>;
  loadProjectCiAgentIds: (overrides?: unknown) => Promise<string[]>;
  invalidateProjectGitStateCache: (repoRoot?: string | null) => void;
  invalidateProjectCiFailureCache: (repoRoot?: string | null) => void;
}

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

function parseWorkspaceContext(value: unknown): {
  repoRoot: string | null;
  gitOriginUrl: string | null;
} {
  const record = asRecord(value);
  if (!record) {
    return {
      repoRoot: null,
      gitOriginUrl: null,
    };
  }

  const directRepoRoot =
    normalizeOptionalText(record.repoRoot) ??
    normalizeOptionalText(record.repo_root) ??
    normalizeOptionalText(record.workspaceRoot) ??
    normalizeOptionalText(record.workspace_root) ??
    normalizeOptionalText(record.root) ??
    null;
  const directGitOrigin =
    normalizeOptionalText(record.gitOriginUrl) ??
    normalizeOptionalText(record.git_origin_url) ??
    normalizeOptionalText(record.originUrl) ??
    normalizeOptionalText(record.origin_url) ??
    normalizeOptionalText(record.repositoryUrl) ??
    normalizeOptionalText(record.repository_url) ??
    normalizeOptionalText(record.remoteUrl) ??
    normalizeOptionalText(record.remote_url) ??
    null;
  if (directRepoRoot || directGitOrigin) {
    return {
      repoRoot: directRepoRoot,
      gitOriginUrl: directGitOrigin,
    };
  }

  for (const key of ["repository", "repo", "git", "workspace"]) {
    const nested = asRecord(record[key]);
    if (!nested) {
      continue;
    }
    const nestedRepoRoot =
      normalizeOptionalText(nested.repoRoot) ??
      normalizeOptionalText(nested.repo_root) ??
      normalizeOptionalText(nested.root) ??
      null;
    const nestedGitOrigin =
      normalizeOptionalText(nested.gitOriginUrl) ??
      normalizeOptionalText(nested.git_origin_url) ??
      normalizeOptionalText(nested.originUrl) ??
      normalizeOptionalText(nested.origin_url) ??
      normalizeOptionalText(nested.repositoryUrl) ??
      normalizeOptionalText(nested.repository_url) ??
      normalizeOptionalText(nested.remoteUrl) ??
      normalizeOptionalText(nested.remote_url) ??
      null;
    if (nestedRepoRoot || nestedGitOrigin) {
      return {
        repoRoot: nestedRepoRoot,
        gitOriginUrl: nestedGitOrigin,
      };
    }
  }

  return {
    repoRoot: null,
    gitOriginUrl: null,
  };
}

async function resolveControllerGitBinding(options: {
  host: CodexHostServices;
  taskNerve: TaskNerveService;
  repoRoot: string;
  gitOriginUrl?: string | null;
}): Promise<{
  settings: ProjectCodexSettings;
  source: CodexControllerGitBindingSource;
  gitOriginUrl: string | null;
  warnings: string[];
}> {
  const warnings: string[] = [];
  const explicitOrigin = normalizeOptionalText(options.gitOriginUrl);
  if (explicitOrigin) {
    const settings = await options.taskNerve.loadProjectSettings({
      repoRoot: options.repoRoot,
      gitOriginUrl: explicitOrigin,
    });
    return {
      settings,
      source: "input",
      gitOriginUrl: normalizeOptionalText(settings.git_origin_url),
      warnings,
    };
  }

  let settings = await options.taskNerve.loadProjectSettings({
    repoRoot: options.repoRoot,
  });
  if (normalizeOptionalText(settings.git_origin_url)) {
    return {
      settings,
      source: "settings",
      gitOriginUrl: normalizeOptionalText(settings.git_origin_url),
      warnings,
    };
  }

  const workspaceContext = await Promise.resolve(options.host.getActiveWorkspaceContext());
  const parsedWorkspace = parseWorkspaceContext(workspaceContext);
  const workspaceGitOrigin = normalizeOptionalText(parsedWorkspace.gitOriginUrl);
  const workspaceRepoRoot = normalizeOptionalText(parsedWorkspace.repoRoot);
  const expectedRepoRoot = normalizeOptionalText(options.repoRoot);
  const repoMatches = !workspaceRepoRoot || !expectedRepoRoot || workspaceRepoRoot === expectedRepoRoot;

  if (workspaceGitOrigin && repoMatches) {
    settings = await options.taskNerve.writeProjectSettings(options.repoRoot, {
      ...settings,
      git_origin_url: workspaceGitOrigin,
    });
    return {
      settings,
      source: "workspace-context",
      gitOriginUrl: normalizeOptionalText(settings.git_origin_url),
      warnings,
    };
  }

  warnings.push(
    "TaskNerve git origin is not configured; set git_origin_url once in project settings to fully automate git",
  );
  return {
    settings,
    source: "unavailable",
    gitOriginUrl: null,
    warnings,
  };
}

export async function runCodexControllerProjectAutomation(
  dependencies: CodexControllerProjectAutomationDependencies,
  options: CodexControllerProjectAutomationOptions,
): Promise<CodexControllerProjectAutomationResult> {
  const gitBinding = await resolveControllerGitBinding({
    host: dependencies.host,
    taskNerve: dependencies.taskNerve,
    repoRoot: options.repoRoot,
    gitOriginUrl: options.gitOriginUrl,
  });

  const productionSync = await syncCodexProjectProduction(
    {
      host: dependencies.host,
      taskNerve: dependencies.taskNerve,
      loadProjectGitState: dependencies.loadProjectGitState,
      loadProjectCiFailures: dependencies.loadProjectCiFailures,
      loadProjectCiAgentIds: dependencies.loadProjectCiAgentIds,
      invalidateProjectGitStateCache: dependencies.invalidateProjectGitStateCache,
      invalidateProjectCiFailureCache: dependencies.invalidateProjectCiFailureCache,
    },
    {
      repoRoot: options.repoRoot,
      tasks: options.tasks,
      gitOriginUrl: gitBinding.gitOriginUrl,
      gitState: options.gitState,
      ciFailures: options.ciFailures,
      availableAgentIds: options.availableAgentIds,
      mode: "smart",
      autostash: true,
      forcePush: false,
      autoSwitchPreferredBranch: true,
      persistCiTasks: true,
      dispatchCiTasks: true,
      nowIsoUtc: options.nowIsoUtc,
    },
  );

  const settings = await dependencies.taskNerve.loadProjectSettings({
    repoRoot: options.repoRoot,
    gitOriginUrl: gitBinding.gitOriginUrl,
  });

  return {
    integration_mode: "codex-native-host",
    repo_root: options.repoRoot,
    tasknerve_managed_git: true,
    git_binding: {
      configured: Boolean(gitBinding.gitOriginUrl),
      source: gitBinding.source,
      git_origin_url: gitBinding.gitOriginUrl,
    },
    settings,
    production_sync: productionSync,
    warnings: [...new Set([...gitBinding.warnings, ...productionSync.warnings])],
  };
}
