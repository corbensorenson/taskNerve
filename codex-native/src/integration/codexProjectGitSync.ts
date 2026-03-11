import {
  buildProjectGitSyncSnapshot,
  buildProjectSettingsAfterGitPush,
  type BuildProjectSettingsAfterGitPushOptions,
  type BuildProjectGitSyncSnapshotOptions,
  type ProjectGitRepositoryState,
  type ProjectGitSyncSnapshot,
} from "../domain/projectGitSync.js";

type GitSyncMode = "smart" | "pull" | "push";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const text = value.trim();
  return text || null;
}

function normalizeCount(value: unknown): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(Number(value))) : 0;
}

export function parseCodexProjectGitState(value: unknown): Partial<ProjectGitRepositoryState> {
  const record = asRecord(value);
  if (!record) {
    return {};
  }
  const branch =
    normalizeOptionalText(record.branch) ??
    normalizeOptionalText(record.current_branch) ??
    normalizeOptionalText(record.currentBranch) ??
    null;
  const remote =
    normalizeOptionalText(record.remote) ??
    normalizeOptionalText(record.remote_name) ??
    normalizeOptionalText(record.remoteName) ??
    null;
  const changed =
    normalizeCount(record.changed_file_count) ||
    normalizeCount(record.changedFileCount) ||
    normalizeCount(record.modified_file_count) ||
    normalizeCount(record.modifiedFileCount);
  const staged = normalizeCount(record.staged_file_count) || normalizeCount(record.stagedFileCount);
  const untracked =
    normalizeCount(record.untracked_file_count) || normalizeCount(record.untrackedFileCount);
  const ahead = normalizeCount(record.ahead_count) || normalizeCount(record.aheadCount);
  const behind = normalizeCount(record.behind_count) || normalizeCount(record.behindCount);

  return {
    branch,
    remote,
    ahead_count: ahead,
    behind_count: behind,
    changed_file_count: changed,
    staged_file_count: staged,
    untracked_file_count: untracked,
    clean: typeof record.clean === "boolean" ? record.clean : undefined,
  };
}

export function buildCodexProjectGitSyncSnapshot(
  options: Omit<BuildProjectGitSyncSnapshotOptions, "git_state"> & { git_state?: unknown },
): ProjectGitSyncSnapshot {
  return buildProjectGitSyncSnapshot({
    ...options,
    git_state: parseCodexProjectGitState(options.git_state),
  });
}

export function buildProjectSettingsAfterCodexGitPush(
  options: BuildProjectSettingsAfterGitPushOptions,
) {
  return buildProjectSettingsAfterGitPush(options);
}

export function planCodexProjectGitSync(options: {
  mode?: GitSyncMode;
  snapshot: ProjectGitSyncSnapshot;
}): {
  mode: GitSyncMode;
  should_pull: boolean;
  should_push: boolean;
  reason:
    | "mode-pull"
    | "mode-push"
    | "smart-pull"
    | "smart-push"
    | "smart-pull-then-push"
    | "smart-push-blocked"
    | "smart-no-op";
} {
  const mode = options.mode || "smart";
  if (mode === "pull") {
    return {
      mode,
      should_pull: true,
      should_push: false,
      reason: "mode-pull",
    };
  }
  if (mode === "push") {
    return {
      mode,
      should_pull: false,
      should_push: true,
      reason: "mode-push",
    };
  }

  switch (options.snapshot.recommendation.action) {
    case "pull":
      return {
        mode,
        should_pull: true,
        should_push: false,
        reason: "smart-pull",
      };
    case "push":
      return {
        mode,
        should_pull: false,
        should_push: true,
        reason: "smart-push",
      };
    case "pull-then-push":
      return {
        mode,
        should_pull: true,
        should_push: true,
        reason: "smart-pull-then-push",
      };
    default:
      if (options.snapshot.recommendation.reason === "push-blocked") {
        return {
          mode,
          should_pull: false,
          should_push: false,
          reason: "smart-push-blocked",
        };
      }
      return {
        mode,
        should_pull: false,
        should_push: false,
        reason: "smart-no-op",
      };
  }
}
