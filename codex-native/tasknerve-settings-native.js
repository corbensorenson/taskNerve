import { t as React } from "./react-DEh3VhWB.js";
import { On as useIntl, m as Button } from "./links-f_CHLUQK.js";
import { c as SettingsSurface, s as SectionCard, o as SettingRow, t as GroupedList, a as SectionTitle } from "./settings-surface-DbZNaw8K.js";
import { r as messageBus } from "./logger-Dlhbocpf.js";
import { n as useToaster } from "./toaster-DVS7CElZ.js";
import { t as ChevronRightIcon } from "./chevron-right-DupmYLAy.js";
import { t as Toggle } from "./toggle-C6Z0GVSX.js";

const DEFAULT_SETTINGS = {
  schema_version: "tasknerve.project_codex_settings.v1",
  updated_at_utc: null,
  heartbeat_message_core:
    "Please continue working on {project_name} project utilizing the taskNerve system. I believe in you, do your absolute best!",
  low_queue_controller_prompt:
    "The TaskNerve queue for {project_name} is running low. Review the current repository state, `project_goals.md`, `project_manifest.md`, and the existing TaskNerve backlog. Add the next best development and maintenance tasks, consolidate stale work, and keep the active workers fed with concrete, high-leverage tasks.",
  low_queue_controller_enabled: true,
  worker_single_message_mode: true,
  worker_model_routing_enabled: false,
  worker_default_model: null,
  controller_default_model: null,
  low_intelligence_model: null,
  medium_intelligence_model: null,
  high_intelligence_model: null,
  max_intelligence_model: null,
  git_origin_url: null,
  git_auto_sync_enabled: true,
  git_tasks_per_push_target: 4,
  git_min_push_interval_minutes: 10,
  git_preferred_branch: null,
  git_auto_sync_allowed_branches: [],
  git_done_task_count_at_last_push: 0,
  git_last_push_at_utc: null,
  git_tasks_before_push_history: [],
  ci_auto_task_enabled: true,
  ci_failure_task_priority: 9,
  ci_default_assignee_agent_id: null,
  ci_last_sync_at_utc: null,
  ci_last_failed_job_count: 0,
};

const TEXT_INPUT_CLASS =
  "bg-token-input-background text-token-input-foreground placeholder:text-token-input-placeholder-foreground rounded-md border border-token-input-border px-2.5 py-1.5 text-sm outline-none focus:border-token-focus-border";

function nowUtc() {
  return new Date().toISOString();
}

function requestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random()}`;
}

function normalizeText(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeNumber(value, fallback, minimum = 0) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(minimum, Math.round(Number(value)));
}

function parseCsvStrings(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseCsvNumbers(value, minimum = 0) {
  return String(value || "")
    .split(",")
    .map((entry) => Number.parseInt(entry.trim(), 10))
    .filter((entry) => Number.isFinite(entry))
    .map((entry) => Math.max(minimum, Math.round(entry)));
}

function toCsv(value) {
  return Array.isArray(value) ? value.join(", ") : "";
}

function normalizeSettings(value = {}) {
  const base = { ...DEFAULT_SETTINGS, ...(value && typeof value === "object" ? value : {}) };
  return {
    schema_version: "tasknerve.project_codex_settings.v1",
    updated_at_utc: normalizeText(base.updated_at_utc) ?? nowUtc(),
    heartbeat_message_core:
      normalizeText(base.heartbeat_message_core) ?? DEFAULT_SETTINGS.heartbeat_message_core,
    low_queue_controller_prompt:
      normalizeText(base.low_queue_controller_prompt) ?? DEFAULT_SETTINGS.low_queue_controller_prompt,
    low_queue_controller_enabled: normalizeBoolean(
      base.low_queue_controller_enabled,
      DEFAULT_SETTINGS.low_queue_controller_enabled,
    ),
    worker_single_message_mode: normalizeBoolean(
      base.worker_single_message_mode,
      DEFAULT_SETTINGS.worker_single_message_mode,
    ),
    worker_model_routing_enabled: normalizeBoolean(
      base.worker_model_routing_enabled,
      DEFAULT_SETTINGS.worker_model_routing_enabled,
    ),
    worker_default_model: normalizeText(base.worker_default_model),
    controller_default_model: normalizeText(base.controller_default_model),
    low_intelligence_model: normalizeText(base.low_intelligence_model),
    medium_intelligence_model: normalizeText(base.medium_intelligence_model),
    high_intelligence_model: normalizeText(base.high_intelligence_model),
    max_intelligence_model: normalizeText(base.max_intelligence_model),
    git_origin_url: normalizeText(base.git_origin_url),
    git_auto_sync_enabled: normalizeBoolean(
      base.git_auto_sync_enabled,
      DEFAULT_SETTINGS.git_auto_sync_enabled,
    ),
    git_tasks_per_push_target: normalizeNumber(
      base.git_tasks_per_push_target,
      DEFAULT_SETTINGS.git_tasks_per_push_target,
      1,
    ),
    git_min_push_interval_minutes: normalizeNumber(
      base.git_min_push_interval_minutes,
      DEFAULT_SETTINGS.git_min_push_interval_minutes,
      0,
    ),
    git_preferred_branch: normalizeText(base.git_preferred_branch),
    git_auto_sync_allowed_branches: Array.isArray(base.git_auto_sync_allowed_branches)
      ? base.git_auto_sync_allowed_branches.map((entry) => String(entry || "").trim()).filter(Boolean)
      : [],
    git_done_task_count_at_last_push: normalizeNumber(
      base.git_done_task_count_at_last_push,
      DEFAULT_SETTINGS.git_done_task_count_at_last_push,
      0,
    ),
    git_last_push_at_utc: normalizeText(base.git_last_push_at_utc),
    git_tasks_before_push_history: Array.isArray(base.git_tasks_before_push_history)
      ? base.git_tasks_before_push_history
          .map((entry) => Number.parseInt(String(entry), 10))
          .filter((entry) => Number.isFinite(entry))
          .map((entry) => Math.max(0, Math.round(entry)))
      : [],
    ci_auto_task_enabled: normalizeBoolean(
      base.ci_auto_task_enabled,
      DEFAULT_SETTINGS.ci_auto_task_enabled,
    ),
    ci_failure_task_priority: normalizeNumber(
      base.ci_failure_task_priority,
      DEFAULT_SETTINGS.ci_failure_task_priority,
      0,
    ),
    ci_default_assignee_agent_id: normalizeText(base.ci_default_assignee_agent_id),
    ci_last_sync_at_utc: normalizeText(base.ci_last_sync_at_utc),
    ci_last_failed_job_count: normalizeNumber(
      base.ci_last_failed_job_count,
      DEFAULT_SETTINGS.ci_last_failed_job_count,
      0,
    ),
  };
}

function sortProjects(projects) {
  return [...projects].sort((left, right) => {
    const leftTime = String(left?.last_opened_at_utc || left?.updated_at_utc || left?.added_at_utc || "");
    const rightTime = String(right?.last_opened_at_utc || right?.updated_at_utc || right?.added_at_utc || "");
    if (leftTime !== rightTime) {
      return leftTime > rightTime ? -1 : 1;
    }
    return String(left?.name || "").localeCompare(String(right?.name || ""));
  });
}

function projectSearchText(project) {
  return [project?.name, project?.repo_root]
    .map((entry) => String(entry || "").toLowerCase())
    .join(" ");
}

function formatRelativeTime(iso) {
  if (typeof iso !== "string") {
    return "";
  }
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) {
    return "";
  }
  const deltaSeconds = Math.max(0, Math.floor((Date.now() - parsed) / 1000));
  if (deltaSeconds < 60) {
    return "now";
  }
  if (deltaSeconds < 3600) {
    return `${Math.floor(deltaSeconds / 60)}m`;
  }
  if (deltaSeconds < 172800) {
    return `${Math.floor(deltaSeconds / 3600)}h`;
  }
  return `${Math.floor(deltaSeconds / 86400)}d`;
}

function textInput(value, onChange, placeholder, disabled = false) {
  return React.createElement("input", {
    className: `${TEXT_INPUT_CLASS} w-[280px]`,
    value,
    onChange,
    placeholder,
    disabled,
  });
}

function numberInput(value, onChange, disabled = false, min = 0) {
  return React.createElement("input", {
    type: "number",
    min,
    className: `${TEXT_INPUT_CLASS} w-[120px]`,
    value,
    onChange,
    disabled,
  });
}

function textArea(value, onChange, placeholder, disabled = false, rows = 4) {
  return React.createElement("textarea", {
    className: `${TEXT_INPUT_CLASS} w-full py-2`,
    value,
    onChange,
    placeholder,
    disabled,
    rows,
  });
}

function projectCard({
  project,
  draft,
  expanded,
  saving,
  dirty,
  onToggle,
  onSave,
  onUpdate,
}) {
  const root = String(project?.repo_root || "");
  const updatedLabel = formatRelativeTime(project?.updated_at_utc || draft?.updated_at_utc);

  const chevronClass = expanded ? "icon-xs rotate-90 text-token-text-secondary" : "icon-xs text-token-text-secondary";

  return React.createElement(
    "section",
    {
      className:
        "bg-token-bg-fog border-token-border flex flex-col overflow-hidden rounded-lg border-[0.5px]",
    },
    React.createElement(
      "button",
      {
        type: "button",
        className:
          "hover:bg-token-list-hover-background flex w-full items-center gap-3 px-4 py-3 text-left",
        onClick: onToggle,
      },
      React.createElement(ChevronRightIcon, { className: chevronClass }),
      React.createElement(
        "div",
        { className: "min-w-0 flex-1" },
        React.createElement(
          "div",
          { className: "text-token-foreground truncate text-base font-medium" },
          project?.name || root,
        ),
        React.createElement(
          "div",
          { className: "text-token-text-secondary truncate text-sm" },
          root,
        ),
      ),
      updatedLabel
        ? React.createElement(
            "span",
            {
              className: "text-token-input-placeholder-foreground shrink-0 text-xs tabular-nums",
            },
            updatedLabel,
          )
        : null,
      dirty
        ? React.createElement(
            "span",
            { className: "text-token-charts-red shrink-0 text-xs font-medium" },
            "Unsaved",
          )
        : null,
    ),
    expanded
      ? React.createElement(
          "div",
          { className: "border-token-border border-t px-4 py-4" },
          React.createElement(
            "div",
            { className: "mb-4 flex items-center justify-end" },
            React.createElement(Button, {
              color: "primary",
              size: "toolbar",
              disabled: !dirty || saving,
              loading: saving,
              onClick: onSave,
              children: "Save project settings",
            }),
          ),
          React.createElement(
            SectionCard,
            null,
            React.createElement(SectionCard.Header, {
              title: "Controller and Worker Policy",
              subtitle: "Core prompts and queue automation behavior.",
            }),
            React.createElement(
              SectionCard.Content,
              null,
              React.createElement(
                GroupedList,
                null,
                React.createElement(SettingRow, {
                  label: "Low-queue controller enabled",
                  description: "Auto-prompt the controller when task queue is low.",
                  control: React.createElement(Toggle, {
                    checked: Boolean(draft.low_queue_controller_enabled),
                    onChange: (checked) => onUpdate({ low_queue_controller_enabled: checked }),
                    ariaLabel: "Low queue controller enabled",
                  }),
                }),
                React.createElement(SettingRow, {
                  label: "Worker single-message mode",
                  description: "Keep worker queue interactions concise.",
                  control: React.createElement(Toggle, {
                    checked: Boolean(draft.worker_single_message_mode),
                    onChange: (checked) => onUpdate({ worker_single_message_mode: checked }),
                    ariaLabel: "Worker single message mode",
                  }),
                }),
                React.createElement(SettingRow, {
                  label: "Task-aware worker model routing",
                  description: "Route by intelligence hints and model overrides.",
                  control: React.createElement(Toggle, {
                    checked: Boolean(draft.worker_model_routing_enabled),
                    onChange: (checked) => onUpdate({ worker_model_routing_enabled: checked }),
                    ariaLabel: "Worker model routing enabled",
                  }),
                }),
              ),
              React.createElement(
                "div",
                { className: "mt-3 flex flex-col gap-3" },
                textArea(
                  draft.heartbeat_message_core,
                  (event) => onUpdate({ heartbeat_message_core: event.currentTarget.value }),
                  "Heartbeat message core",
                  saving,
                  4,
                ),
                textArea(
                  draft.low_queue_controller_prompt,
                  (event) => onUpdate({ low_queue_controller_prompt: event.currentTarget.value }),
                  "Low queue controller prompt",
                  saving,
                  5,
                ),
              ),
            ),
          ),
          React.createElement(
            SectionCard,
            { className: "mt-3" },
            React.createElement(SectionCard.Header, {
              title: "Model Routing",
              subtitle: "Default and intelligence-level model preferences.",
            }),
            React.createElement(
              SectionCard.Content,
              null,
              React.createElement(
                "div",
                { className: "grid gap-3 md:grid-cols-2" },
                textInput(
                  draft.worker_default_model || "",
                  (event) => onUpdate({ worker_default_model: event.currentTarget.value }),
                  "Worker default model",
                  saving,
                ),
                textInput(
                  draft.controller_default_model || "",
                  (event) => onUpdate({ controller_default_model: event.currentTarget.value }),
                  "Controller default model",
                  saving,
                ),
                textInput(
                  draft.low_intelligence_model || "",
                  (event) => onUpdate({ low_intelligence_model: event.currentTarget.value }),
                  "Low intelligence model",
                  saving,
                ),
                textInput(
                  draft.medium_intelligence_model || "",
                  (event) => onUpdate({ medium_intelligence_model: event.currentTarget.value }),
                  "Medium intelligence model",
                  saving,
                ),
                textInput(
                  draft.high_intelligence_model || "",
                  (event) => onUpdate({ high_intelligence_model: event.currentTarget.value }),
                  "High intelligence model",
                  saving,
                ),
                textInput(
                  draft.max_intelligence_model || "",
                  (event) => onUpdate({ max_intelligence_model: event.currentTarget.value }),
                  "Max intelligence model",
                  saving,
                ),
              ),
            ),
          ),
          React.createElement(
            SectionCard,
            { className: "mt-3" },
            React.createElement(SectionCard.Header, {
              title: "Git Sync",
              subtitle: "Repository metadata and task-sync thresholds.",
            }),
            React.createElement(
              SectionCard.Content,
              null,
              React.createElement(
                GroupedList,
                null,
                React.createElement(SettingRow, {
                  label: "Git auto-sync enabled",
                  description: "Allow automatic git task sync.",
                  control: React.createElement(Toggle, {
                    checked: Boolean(draft.git_auto_sync_enabled),
                    onChange: (checked) => onUpdate({ git_auto_sync_enabled: checked }),
                    ariaLabel: "Git auto sync enabled",
                  }),
                }),
                React.createElement(SettingRow, {
                  label: "Tasks per push target",
                  description: "Preferred number of completed tasks between pushes.",
                  control: numberInput(
                    draft.git_tasks_per_push_target,
                    (event) =>
                      onUpdate({
                        git_tasks_per_push_target: Number.parseInt(event.currentTarget.value, 10),
                      }),
                    saving,
                    1,
                  ),
                }),
                React.createElement(SettingRow, {
                  label: "Min push interval (minutes)",
                  description: "Minimum minutes between automatic push attempts.",
                  control: numberInput(
                    draft.git_min_push_interval_minutes,
                    (event) =>
                      onUpdate({
                        git_min_push_interval_minutes: Number.parseInt(event.currentTarget.value, 10),
                      }),
                    saving,
                    0,
                  ),
                }),
              ),
              React.createElement(
                "div",
                { className: "mt-3 grid gap-3 md:grid-cols-2" },
                textInput(
                  draft.git_origin_url || "",
                  (event) => onUpdate({ git_origin_url: event.currentTarget.value }),
                  "Git origin URL",
                  saving,
                ),
                textInput(
                  draft.git_preferred_branch || "",
                  (event) => onUpdate({ git_preferred_branch: event.currentTarget.value }),
                  "Preferred branch",
                  saving,
                ),
                textInput(
                  toCsv(draft.git_auto_sync_allowed_branches),
                  (event) =>
                    onUpdate({
                      git_auto_sync_allowed_branches: parseCsvStrings(event.currentTarget.value),
                    }),
                  "Allowed branches (comma-separated)",
                  saving,
                ),
                textInput(
                  String(draft.git_done_task_count_at_last_push || 0),
                  (event) =>
                    onUpdate({
                      git_done_task_count_at_last_push: Number.parseInt(event.currentTarget.value, 10),
                    }),
                  "Done tasks at last push",
                  saving,
                ),
                textInput(
                  draft.git_last_push_at_utc || "",
                  (event) => onUpdate({ git_last_push_at_utc: event.currentTarget.value }),
                  "Last push timestamp (UTC)",
                  saving,
                ),
                textInput(
                  toCsv(draft.git_tasks_before_push_history),
                  (event) =>
                    onUpdate({
                      git_tasks_before_push_history: parseCsvNumbers(event.currentTarget.value, 0),
                    }),
                  "Tasks-before-push history (comma-separated)",
                  saving,
                ),
              ),
            ),
          ),
          React.createElement(
            SectionCard,
            { className: "mt-3" },
            React.createElement(SectionCard.Header, {
              title: "CI Sync",
              subtitle: "Failure-to-task behavior and CI sync metadata.",
            }),
            React.createElement(
              SectionCard.Content,
              null,
              React.createElement(
                GroupedList,
                null,
                React.createElement(SettingRow, {
                  label: "CI auto-task enabled",
                  description: "Create tasks automatically from CI failures.",
                  control: React.createElement(Toggle, {
                    checked: Boolean(draft.ci_auto_task_enabled),
                    onChange: (checked) => onUpdate({ ci_auto_task_enabled: checked }),
                    ariaLabel: "CI auto task enabled",
                  }),
                }),
                React.createElement(SettingRow, {
                  label: "CI failure task priority",
                  description: "Default priority for tasks generated from failed jobs.",
                  control: numberInput(
                    draft.ci_failure_task_priority,
                    (event) =>
                      onUpdate({ ci_failure_task_priority: Number.parseInt(event.currentTarget.value, 10) }),
                    saving,
                    0,
                  ),
                }),
                React.createElement(SettingRow, {
                  label: "CI last failed job count",
                  description: "Recent failed CI job count used for sync heuristics.",
                  control: numberInput(
                    draft.ci_last_failed_job_count,
                    (event) =>
                      onUpdate({ ci_last_failed_job_count: Number.parseInt(event.currentTarget.value, 10) }),
                    saving,
                    0,
                  ),
                }),
              ),
              React.createElement(
                "div",
                { className: "mt-3 grid gap-3 md:grid-cols-2" },
                textInput(
                  draft.ci_default_assignee_agent_id || "",
                  (event) => onUpdate({ ci_default_assignee_agent_id: event.currentTarget.value }),
                  "Default assignee agent ID",
                  saving,
                ),
                textInput(
                  draft.ci_last_sync_at_utc || "",
                  (event) => onUpdate({ ci_last_sync_at_utc: event.currentTarget.value }),
                  "Last CI sync timestamp (UTC)",
                  saving,
                ),
              ),
            ),
          ),
        )
      : null,
  );
}

function TaskNerveSettings() {
  const intl = useIntl();
  const toaster = useToaster();
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [query, setQuery] = React.useState("");
  const [projects, setProjects] = React.useState([]);
  const [draftsByRoot, setDraftsByRoot] = React.useState({});
  const [savingByRoot, setSavingByRoot] = React.useState({});
  const [expandedByRoot, setExpandedByRoot] = React.useState({});
  const stateRequestRef = React.useRef(null);
  const saveRequestRef = React.useRef({});

  const mergeProjects = React.useCallback((incoming) => {
    const sorted = sortProjects(incoming);
    setProjects(sorted);
    setDraftsByRoot((previous) => {
      const next = { ...previous };
      for (const project of sorted) {
        const root = String(project?.repo_root || "").trim();
        if (!root) {
          continue;
        }
        if (!next[root]) {
          next[root] = normalizeSettings(project?.settings);
        }
      }
      return next;
    });
    setExpandedByRoot((previous) => {
      if (Object.keys(previous).length > 0 || sorted.length === 0) {
        return previous;
      }
      const firstRoot = String(sorted[0]?.repo_root || "").trim();
      return firstRoot ? { [firstRoot]: true } : previous;
    });
  }, []);

  const refresh = React.useCallback((forceFresh = true) => {
    const req = requestId();
    stateRequestRef.current = req;
    setLoading(true);
    messageBus.dispatchMessage("tasknerve-project-settings-state-request", {
      requestId: req,
      forceFresh,
    });
  }, []);

  React.useEffect(() =>
    messageBus.subscribe("tasknerve-project-settings-state", (message) => {
      if (
        message?.requestId != null &&
        stateRequestRef.current != null &&
        message.requestId !== stateRequestRef.current
      ) {
        return;
      }
      stateRequestRef.current = null;
      setLoading(false);
      if (message?.ok !== true) {
        const details =
          typeof message?.error === "string" && message.error.trim().length > 0
            ? message.error
            : "Unknown error";
        setError(details);
        return;
      }
      setError(null);
      const incoming = Array.isArray(message?.state?.projects) ? message.state.projects : [];
      mergeProjects(
        incoming.map((project) => ({
          ...project,
          settings: normalizeSettings(project?.settings),
        })),
      );
    }),
  [mergeProjects]);

  React.useEffect(() =>
    messageBus.subscribe("tasknerve-project-settings-upsert-response", (message) => {
      const root = String(message?.projectRoot || "").trim();
      const requestIdForRoot = root ? saveRequestRef.current[root] : null;
      if (!root || !requestIdForRoot || message?.requestId !== requestIdForRoot) {
        return;
      }
      saveRequestRef.current = { ...saveRequestRef.current, [root]: null };
      setSavingByRoot((previous) => ({ ...previous, [root]: false }));
      if (message?.ok !== true) {
        const details =
          typeof message?.error === "string" && message.error.trim().length > 0
            ? message.error
            : "Unknown error";
        toaster.danger(`Failed to save TaskNerve settings: ${details}`);
        return;
      }
      toaster.success("TaskNerve settings saved");
      refresh(true);
    }),
  [toaster, refresh]);

  React.useEffect(() => {
    refresh(true);
  }, [refresh]);

  const filteredProjects = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return projects;
    }
    return projects.filter((project) => projectSearchText(project).includes(needle));
  }, [projects, query]);

  const updateDraft = React.useCallback((root, patch) => {
    setDraftsByRoot((previous) => ({
      ...previous,
      [root]: normalizeSettings({ ...(previous[root] || DEFAULT_SETTINGS), ...patch }),
    }));
  }, []);

  const saveProject = React.useCallback((project) => {
    const root = String(project?.repo_root || "").trim();
    if (!root) {
      return;
    }
    const draft = normalizeSettings(draftsByRoot[root] || project?.settings || DEFAULT_SETTINGS);
    const req = requestId();
    saveRequestRef.current = { ...saveRequestRef.current, [root]: req };
    setSavingByRoot((previous) => ({ ...previous, [root]: true }));
    messageBus.dispatchMessage("tasknerve-project-settings-upsert-request", {
      requestId: req,
      projectRoot: root,
      settings: draft,
    });
  }, [draftsByRoot]);

  const subtitle =
    "Project-level TaskNerve policy, routing, and sync configuration.";

  let body = null;
  if (loading && projects.length === 0) {
    body = React.createElement(
      "div",
      { className: "text-token-text-secondary py-6 text-sm" },
      "Loading project settings...",
    );
  } else if (error && projects.length === 0) {
    body = React.createElement(
      "div",
      { className: "text-token-charts-red py-6 text-sm" },
      `Unable to load TaskNerve settings: ${error}`,
    );
  } else if (filteredProjects.length === 0) {
    body = React.createElement(
      "div",
      { className: "text-token-text-secondary py-6 text-sm" },
      query.trim().length > 0 ? "No projects match your search." : "No TaskNerve projects found.",
    );
  } else {
    body = React.createElement(
      "div",
      { className: "flex flex-col gap-3" },
      filteredProjects.map((project) => {
        const root = String(project?.repo_root || "").trim();
        const draft = normalizeSettings(draftsByRoot[root] || project?.settings || DEFAULT_SETTINGS);
        const current = normalizeSettings(project?.settings || DEFAULT_SETTINGS);
        const dirty = JSON.stringify(draft) !== JSON.stringify(current);
        const expanded = expandedByRoot[root] === true;
        const saving = savingByRoot[root] === true;

        return React.createElement(projectCard, {
          key: root || String(project?.name || "project"),
          project,
          draft,
          expanded,
          saving,
          dirty,
          onToggle: () =>
            setExpandedByRoot((previous) => ({
              ...previous,
              [root]: !previous[root],
            })),
          onSave: () => saveProject(project),
          onUpdate: (patch) => updateDraft(root, patch),
        });
      }),
    );
  }

  return React.createElement(
    SettingsSurface,
    {
      title: React.createElement(SectionTitle, { slug: "tasknerve-settings" }),
      subtitle,
      children: React.createElement(
        "div",
        { className: "flex flex-col gap-3" },
        React.createElement(
          "div",
          {
            className:
              "bg-token-bg-fog border-token-border flex items-center gap-2 rounded-lg border-[0.5px] p-3",
          },
          React.createElement("input", {
            className: `${TEXT_INPUT_CLASS} w-full`,
            placeholder: intl.formatMessage({
              id: "tasknerve.settings.searchProjects.placeholder",
              defaultMessage: "Search projects",
              description: "TaskNerve settings project search placeholder",
            }),
            value: query,
            onChange: (event) => setQuery(event.currentTarget.value),
          }),
          React.createElement(Button, {
            color: "secondary",
            size: "toolbar",
            onClick: () => refresh(true),
            children: "Refresh",
          }),
        ),
        body,
      ),
    },
  );
}

export { TaskNerveSettings };
