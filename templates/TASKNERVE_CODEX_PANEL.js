const TASKNERVE_BASE_URL = "__TASKNERVE_BASE_URL__";
const TASKNERVE_NATIVE_BRIDGE_URL = "__TASKNERVE_NATIVE_BRIDGE_URL__";
const TASKNERVE_NAV_ID = "tasknerve-codex-nav-entry";
const TASKNERVE_PANEL_ID = "tasknerve-codex-panel-root";
const TASKNERVE_PANEL_STYLE_ID = "tasknerve-codex-panel-style";
const TASKNERVE_BRANCH_CHIP_ID = "tasknerve-codex-branch-chip";
const TASKNERVE_BRANCH_MENU_ID = "tasknerve-codex-branch-menu";
const TASKNERVE_STORAGE_PROJECT_KEY = "tasknerve.codex.selectedProject";
const TASKNERVE_STORAGE_TASK_SEARCH_KEY = "tasknerve.codex.taskSearch";
const TASKNERVE_SKILLS_LABELS = ["Skills", "Skills & Apps", "Skills and Apps"];
const TASKNERVE_CONTROLLER_AGENT_ID = "agent.controller";
const TASKNERVE_INTERACTION_REFRESH_MS = 4500;
const TASKNERVE_POLL_INTERVAL_MS = 8000;
const TASKNERVE_DEFAULT_HEARTBEAT =
  "Please continue working on {project_name} project utilizing the taskNerve system. I believe in you, do your absolute best!";

const tasknerveState = {
  panelOpen: false,
  settingsOpen: false,
  loading: false,
  lastRefreshedAt: 0,
  hostContext: null,
  selectedProject: null,
  snapshot: null,
  advisor: null,
  editingTaskId: null,
  editorDirty: false,
  settingsDirty: false,
  refreshTimer: null,
  branchMenuOpen: false,
  flash: { tone: "info", message: "" },
};

function tasknerveNormalizeText(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function tasknerveCsvList(value) {
  return String(value || "")
    .split(",")
    .map((entry) => tasknerveNormalizeText(entry))
    .filter(Boolean);
}

function tasknerveEscapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function tasknerveClosestInteractive(node) {
  if (!node) {
    return null;
  }
  return node.closest("a,button,[role='button'],div.cursor-interaction") || node;
}

function tasknerveById(id) {
  return document.getElementById(id);
}

function tasknerveReadStorage(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (_error) {
    return null;
  }
}

function tasknerveWriteStorage(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch (_error) {}
}

function tasknerveBaseOrigin() {
  return TASKNERVE_BASE_URL.replace(/\/+$/, "");
}

function tasknerveNativeBridgeOrigin() {
  return TASKNERVE_NATIVE_BRIDGE_URL.replace(/\/+$/, "");
}

function tasknerveProjectQuery() {
  const query = new URLSearchParams();
  if (tasknerveState.selectedProject) {
    query.set("project", tasknerveState.selectedProject);
  }
  const suffix = query.toString();
  return suffix ? `?${suffix}` : "";
}

function tasknerveTasks(snapshot) {
  return Array.isArray(snapshot?.tasks) ? snapshot.tasks : [];
}

function tasknerveControllerBinding(snapshot) {
  return snapshot?.codex?.controller_binding || null;
}

function tasknerveWorkerBindings(snapshot) {
  return snapshot?.codex?.active_worker_bindings || [];
}

function tasknerveDiscoveredThreads(snapshot) {
  return snapshot?.codex?.discovered_threads || [];
}

function tasknerveReadyCount(snapshot) {
  return tasknerveTasks(snapshot).filter((task) => task.ready).length;
}

function tasknerveProjectCodexSettings(snapshot) {
  return snapshot?.project_codex_settings || {};
}

function tasknerveTimelineSummary(snapshot) {
  return snapshot?.timeline || {
    timeline_initialized: !!snapshot?.timeline_initialized,
    active_branch: null,
    branches: [],
    git_branch_hint: null,
  };
}

function tasknerveActiveTimelineBranch(snapshot) {
  return tasknerveTimelineSummary(snapshot)?.active_branch || "";
}

function tasknerveTimelineBranches(snapshot) {
  const branches = tasknerveTimelineSummary(snapshot)?.branches;
  return Array.isArray(branches) ? branches : [];
}

function tasknerveGitBranchHint(snapshot) {
  return tasknerveTimelineSummary(snapshot)?.git_branch_hint || "";
}

function tasknerveUserTags(task) {
  return (task?.tags || []).filter(
    (tag) => !String(tag).startsWith("intelligence:") && !String(tag).startsWith("model:"),
  );
}

function tasknerveFindSkillsRow() {
  const hrefMatch = Array.from(document.querySelectorAll("a[href]")).find((node) => {
    const href = (node.getAttribute("href") || "").toLowerCase();
    return href.includes("skills");
  });
  if (hrefMatch) {
    return tasknerveClosestInteractive(hrefMatch);
  }
  const textMatch = Array.from(
    document.querySelectorAll("a,button,[role='button'],div.cursor-interaction"),
  ).find((node) =>
    TASKNERVE_SKILLS_LABELS.includes(tasknerveNormalizeText(node.textContent)),
  );
  return tasknerveClosestInteractive(textMatch);
}

function tasknerveReplaceLabel(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let textNode = walker.nextNode();
  while (textNode) {
    const normalized = tasknerveNormalizeText(textNode.nodeValue);
    if (TASKNERVE_SKILLS_LABELS.includes(normalized)) {
      textNode.nodeValue = textNode.nodeValue.replace(normalized, "TaskNerve");
      return true;
    }
    textNode = walker.nextNode();
  }
  return false;
}

function tasknerveCreateIcon() {
  const icon = document.createElement("span");
  icon.className = "tasknerve-codex-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7.5c0-1.38 1.12-2.5 2.5-2.5h4.25l1.5 1.5h3.75C18.88 6.5 20 7.62 20 9v7.5c0 1.38-1.12 2.5-2.5 2.5h-10C6.12 19 5 17.88 5 16.5V7.5Z"></path><path d="M8 12h8"></path><path d="M8 15.5h5"></path></svg>';
  return icon;
}

function tasknerveCreateBranchIcon() {
  const icon = document.createElement("span");
  icon.className = "tasknerve-branch-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 5.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z"></path><path d="M17 13.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z"></path><path d="M7 10.5v6a4 4 0 0 0 4 4h3.5"></path><path d="M14.5 7h-3.5a4 4 0 0 0-4 4"></path><path d="M17 13.5V7"></path></svg>';
  return icon;
}

function tasknerveStatusClass(status) {
  switch (status) {
    case "open":
      return "tasknerve-status-open";
    case "claimed":
      return "tasknerve-status-claimed";
    case "done":
      return "tasknerve-status-done";
    default:
      return "tasknerve-status-default";
  }
}

function tasknerveSortTasks(tasks) {
  const statusRank = {
    open: 0,
    claimed: 1,
    blocked: 2,
    done: 3,
  };
  return (tasks || []).slice().sort((left, right) => {
    const leftRank = statusRank[left.status] ?? 9;
    const rightRank = statusRank[right.status] ?? 9;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    const priorityDelta = Number(right.priority || 0) - Number(left.priority || 0);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }
    return String(left.title || "").localeCompare(String(right.title || ""));
  });
}

function tasknerveVisibleTasks(snapshot) {
  const search = tasknerveNormalizeText(tasknerveById("tasknerveTaskSearchInput")?.value || "")
    .toLowerCase();
  const tasks = tasknerveSortTasks(tasknerveTasks(snapshot));
  if (!search) {
    return tasks;
  }
  return tasks.filter((task) => {
    const haystack = [
      task.task_id,
      task.title,
      task.detail,
      task.claimed_by_agent_id,
      ...(task.tags || []),
      ...(task.depends_on || []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(search);
  });
}

function tasknerveSelectedTask(snapshot) {
  return tasknerveTasks(snapshot).find((task) => task.task_id === tasknerveState.editingTaskId) || null;
}

function tasknerveCurrentHeartbeatTemplate() {
  return (
    tasknerveById("tasknerveHeartbeatTemplate")?.value ||
    tasknerveProjectCodexSettings(tasknerveState.snapshot)?.heartbeat_message_core ||
    TASKNERVE_DEFAULT_HEARTBEAT
  );
}

function tasknerveSetSettingsOpen(open) {
  tasknerveState.settingsOpen = !!open;
  const root = tasknerveById(TASKNERVE_PANEL_ID);
  const drawer = tasknerveById("tasknerveSettingsDrawer");
  const button = tasknerveById("tasknerveSettingsButton");
  if (root) {
    root.classList.toggle("tasknerve-settings-open", tasknerveState.settingsOpen);
  }
  if (drawer) {
    drawer.setAttribute("aria-hidden", tasknerveState.settingsOpen ? "false" : "true");
  }
  if (button) {
    button.classList.toggle("tasknerve-active", tasknerveState.settingsOpen);
  }
}

function tasknerveToggleSettings() {
  tasknerveSetSettingsOpen(!tasknerveState.settingsOpen);
}

function tasknerveEnsurePanelStyles() {
  if (tasknerveById(TASKNERVE_PANEL_STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = TASKNERVE_PANEL_STYLE_ID;
  style.textContent = `
#${TASKNERVE_PANEL_ID} {
  position: fixed;
  inset: 0;
  z-index: 2147483600;
  display: none;
  pointer-events: none;
  color: rgba(245, 247, 250, 0.96);
  font: inherit;
}
#${TASKNERVE_PANEL_ID}.tasknerve-open {
  display: block;
}
#${TASKNERVE_PANEL_ID} .tasknerve-shell {
  position: absolute;
  top: 12px;
  right: 14px;
  bottom: 12px;
  left: auto;
  width: min(1100px, calc(100vw - 328px));
  display: grid;
  grid-template-rows: auto auto 1fr;
  border-radius: 16px;
  overflow: hidden;
  pointer-events: auto;
  background: rgba(21, 24, 31, 0.985);
  border: 1px solid rgba(255, 255, 255, 0.05);
  box-shadow:
    0 18px 48px rgba(0, 0, 0, 0.32),
    0 1px 0 rgba(255, 255, 255, 0.05) inset;
  opacity: 0;
  transform: translateY(10px) scale(0.992);
  transition: opacity 140ms ease, transform 160ms ease;
}
#${TASKNERVE_PANEL_ID}.tasknerve-open .tasknerve-shell {
  opacity: 1;
  transform: translateY(0) scale(1);
}
#${TASKNERVE_PANEL_ID} .tasknerve-topbar {
  display: grid;
  grid-template-columns: minmax(230px, 320px) minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  background: rgba(255, 255, 255, 0.02);
}
#${TASKNERVE_PANEL_ID} .tasknerve-project-slot {
  min-width: 0;
}
#${TASKNERVE_PANEL_ID} .tasknerve-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: flex-end;
}
#${TASKNERVE_PANEL_ID} .tasknerve-search-row {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 16px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  background: rgba(255, 255, 255, 0.014);
}
#${TASKNERVE_PANEL_ID} .tasknerve-search-controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
}
#${TASKNERVE_PANEL_ID} .tasknerve-strip-label,
#${TASKNERVE_PANEL_ID} .tasknerve-field span,
#${TASKNERVE_PANEL_ID} .tasknerve-check span {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(214, 223, 235, 0.58);
}
#${TASKNERVE_PANEL_ID} .tasknerve-project-meta,
#${TASKNERVE_PANEL_ID} .tasknerve-muted,
#${TASKNERVE_PANEL_ID} .tasknerve-card-meta,
#${TASKNERVE_PANEL_ID} .tasknerve-empty {
  font-size: 12px;
  color: rgba(214, 223, 235, 0.62);
}
#${TASKNERVE_PANEL_ID} .tasknerve-project-meta {
  line-height: 1.45;
  word-break: break-word;
}
#${TASKNERVE_PANEL_ID} .tasknerve-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-start;
  min-width: 0;
}
#${TASKNERVE_PANEL_ID} .tasknerve-metric {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(255, 255, 255, 0.06);
  white-space: nowrap;
}
#${TASKNERVE_PANEL_ID} .tasknerve-metric strong {
  font-size: 12px;
  font-weight: 650;
  color: rgba(250, 252, 255, 0.98);
}
#${TASKNERVE_PANEL_ID} .tasknerve-metric span {
  font-size: 11px;
  color: rgba(214, 223, 235, 0.66);
}
#${TASKNERVE_PANEL_ID} .tasknerve-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  min-height: 0;
  background: rgba(13, 16, 22, 0.78);
}
#${TASKNERVE_PANEL_ID} .tasknerve-main-pane,
#${TASKNERVE_PANEL_ID} .tasknerve-side-pane {
  min-height: 0;
  overflow: auto;
  padding: 14px;
}
#${TASKNERVE_PANEL_ID} .tasknerve-side-pane {
  border-left: 1px solid rgba(255, 255, 255, 0.05);
  background: rgba(255, 255, 255, 0.014);
}
#${TASKNERVE_PANEL_ID} .tasknerve-block {
  margin-bottom: 12px;
  padding: 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.022);
  border: 1px solid rgba(255, 255, 255, 0.05);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.014);
}
#${TASKNERVE_PANEL_ID} .tasknerve-block:last-child {
  margin-bottom: 0;
}
#${TASKNERVE_PANEL_ID} .tasknerve-block-header,
#${TASKNERVE_PANEL_ID} .tasknerve-section-header,
#${TASKNERVE_PANEL_ID} .tasknerve-editor-head,
#${TASKNERVE_PANEL_ID} .tasknerve-settings-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
#${TASKNERVE_PANEL_ID} .tasknerve-section-header {
  align-items: center;
  margin-bottom: 10px;
}
#${TASKNERVE_PANEL_ID} .tasknerve-block-title {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(214, 223, 235, 0.62);
}
#${TASKNERVE_PANEL_ID} .tasknerve-section-title {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
  letter-spacing: -0.015em;
}
#${TASKNERVE_PANEL_ID} .tasknerve-select,
#${TASKNERVE_PANEL_ID} .tasknerve-input,
#${TASKNERVE_PANEL_ID} .tasknerve-textarea,
#${TASKNERVE_PANEL_ID} .tasknerve-check input[type="number"] {
  width: 100%;
  appearance: none;
  border: 1px solid rgba(255, 255, 255, 0.09);
  background: rgba(8, 11, 16, 0.92);
  color: rgba(248, 250, 252, 0.98);
  border-radius: 12px;
  padding: 10px 12px;
  font: inherit;
  box-sizing: border-box;
  outline: none;
  transition: border-color 120ms ease, box-shadow 120ms ease, background 120ms ease;
}
#${TASKNERVE_PANEL_ID} .tasknerve-select:focus,
#${TASKNERVE_PANEL_ID} .tasknerve-input:focus,
#${TASKNERVE_PANEL_ID} .tasknerve-textarea:focus,
#${TASKNERVE_PANEL_ID} .tasknerve-check input[type="number"]:focus {
  border-color: rgba(117, 168, 255, 0.78);
  box-shadow: 0 0 0 3px rgba(90, 146, 255, 0.17);
  background: rgba(10, 13, 18, 0.98);
}
#${TASKNERVE_PANEL_ID} .tasknerve-textarea {
  min-height: 120px;
  resize: vertical;
}
#${TASKNERVE_PANEL_ID} .tasknerve-button {
  appearance: none;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.048);
  color: rgba(250, 252, 255, 0.96);
  border-radius: 10px;
  padding: 8px 12px;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, transform 120ms ease;
}
#${TASKNERVE_PANEL_ID} .tasknerve-button:hover {
  background: rgba(255, 255, 255, 0.085);
  border-color: rgba(255, 255, 255, 0.15);
  transform: translateY(-1px);
}
#${TASKNERVE_PANEL_ID} .tasknerve-button:disabled {
  opacity: 0.55;
  cursor: default;
  transform: none;
}
#${TASKNERVE_PANEL_ID} .tasknerve-button.primary {
  background: rgba(82, 129, 255, 0.18);
  border-color: rgba(104, 148, 255, 0.3);
}
#${TASKNERVE_PANEL_ID} .tasknerve-button.ghost {
  background: transparent;
}
#${TASKNERVE_PANEL_ID} .tasknerve-button.subtle {
  padding-left: 10px;
  padding-right: 10px;
}
#${TASKNERVE_PANEL_ID} .tasknerve-button.danger {
  color: rgba(255, 163, 176, 0.98);
}
#${TASKNERVE_PANEL_ID} .tasknerve-icon-button {
  width: 36px;
  height: 36px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
#${TASKNERVE_PANEL_ID} .tasknerve-icon-button svg {
  width: 17px;
  height: 17px;
}
#${TASKNERVE_PANEL_ID} .tasknerve-active {
  background: rgba(255, 255, 255, 0.1);
}
#${TASKNERVE_PANEL_ID} .tasknerve-flash {
  margin: 0;
  padding: 9px 11px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.07);
  background: rgba(255, 255, 255, 0.04);
  font-size: 12px;
  color: rgba(244, 248, 255, 0.9);
}
#${TASKNERVE_PANEL_ID} .tasknerve-flash.error {
  color: rgba(255, 192, 204, 0.96);
  border-color: rgba(255, 112, 134, 0.24);
  background: rgba(84, 24, 34, 0.34);
}
#${TASKNERVE_PANEL_ID} .tasknerve-list {
  display: grid;
  gap: 10px;
}
#${TASKNERVE_PANEL_ID} .tasknerve-task-card,
#${TASKNERVE_PANEL_ID} .tasknerve-card {
  padding: 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.022);
  border: 1px solid rgba(255, 255, 255, 0.05);
  transition: border-color 120ms ease, background 120ms ease, transform 120ms ease;
}
#${TASKNERVE_PANEL_ID} .tasknerve-task-card {
  cursor: pointer;
}
#${TASKNERVE_PANEL_ID} .tasknerve-task-card:hover,
#${TASKNERVE_PANEL_ID} .tasknerve-card:hover {
  border-color: rgba(255, 255, 255, 0.11);
  background: rgba(255, 255, 255, 0.032);
}
#${TASKNERVE_PANEL_ID} .tasknerve-task-card.selected {
  border-color: rgba(103, 148, 255, 0.42);
  background: rgba(68, 92, 138, 0.16);
}
#${TASKNERVE_PANEL_ID} .tasknerve-task-head,
#${TASKNERVE_PANEL_ID} .tasknerve-card-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}
#${TASKNERVE_PANEL_ID} .tasknerve-task-title,
#${TASKNERVE_PANEL_ID} .tasknerve-card-title {
  margin: 0;
  font-size: 14px;
  font-weight: 640;
  line-height: 1.38;
}
#${TASKNERVE_PANEL_ID} .tasknerve-status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 72px;
  padding: 4px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  border: 1px solid transparent;
}
#${TASKNERVE_PANEL_ID} .tasknerve-status-open {
  color: rgba(104, 245, 188, 0.98);
  background: rgba(38, 73, 61, 0.52);
  border-color: rgba(104, 245, 188, 0.16);
}
#${TASKNERVE_PANEL_ID} .tasknerve-status-claimed {
  color: rgba(255, 210, 114, 0.98);
  background: rgba(86, 67, 28, 0.48);
  border-color: rgba(255, 210, 114, 0.16);
}
#${TASKNERVE_PANEL_ID} .tasknerve-status-done {
  color: rgba(144, 196, 255, 0.98);
  background: rgba(30, 56, 94, 0.5);
  border-color: rgba(144, 196, 255, 0.18);
}
#${TASKNERVE_PANEL_ID} .tasknerve-status-default {
  color: rgba(214, 223, 235, 0.88);
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.08);
}
#${TASKNERVE_PANEL_ID} .tasknerve-priority {
  margin-top: 6px;
  font-size: 12px;
  color: rgba(214, 223, 235, 0.66);
}
#${TASKNERVE_PANEL_ID} .tasknerve-detail {
  margin: 9px 0 0;
  font-size: 13px;
  line-height: 1.55;
  color: rgba(232, 239, 248, 0.92);
  white-space: pre-wrap;
}
#${TASKNERVE_PANEL_ID} .tasknerve-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
#${TASKNERVE_PANEL_ID} .tasknerve-tag {
  display: inline-flex;
  align-items: center;
  padding: 4px 8px;
  border-radius: 999px;
  font-size: 11px;
  color: rgba(214, 223, 235, 0.82);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.07);
}
#${TASKNERVE_PANEL_ID} .tasknerve-state-line {
  margin-top: 10px;
  font-size: 12px;
}
#${TASKNERVE_PANEL_ID} .tasknerve-ready {
  color: rgba(113, 242, 181, 0.95);
  font-weight: 600;
}
#${TASKNERVE_PANEL_ID} .tasknerve-blocked {
  color: rgba(255, 182, 112, 0.92);
  font-weight: 600;
}
#${TASKNERVE_PANEL_ID} .tasknerve-card-actions,
#${TASKNERVE_PANEL_ID} .tasknerve-editor-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
#${TASKNERVE_PANEL_ID} .tasknerve-priority-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}
#${TASKNERVE_PANEL_ID} .tasknerve-priority-row input {
  width: 90px;
}
#${TASKNERVE_PANEL_ID} .tasknerve-editor-form {
  display: grid;
  gap: 10px;
}
#${TASKNERVE_PANEL_ID} .tasknerve-editor-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 112px;
  gap: 10px;
}
#${TASKNERVE_PANEL_ID} .tasknerve-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
#${TASKNERVE_PANEL_ID} .tasknerve-field.full {
  grid-column: 1 / -1;
}
#${TASKNERVE_PANEL_ID} .tasknerve-checklist {
  display: grid;
  gap: 10px;
  margin-top: 10px;
}
#${TASKNERVE_PANEL_ID} .tasknerve-check {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
}
#${TASKNERVE_PANEL_ID} .tasknerve-check input[type="checkbox"] {
  width: 16px;
  height: 16px;
  margin: 0;
}
#${TASKNERVE_PANEL_ID} .tasknerve-settings-drawer {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(390px, 100%);
  padding: 18px;
  background:
    linear-gradient(180deg, rgba(19, 23, 30, 0.995) 0%, rgba(15, 18, 24, 0.995) 100%);
  border-left: 1px solid rgba(255, 255, 255, 0.06);
  box-shadow: -22px 0 60px rgba(0, 0, 0, 0.26);
  transform: translateX(104%);
  transition: transform 150ms ease;
  z-index: 2;
  overflow: auto;
}
#${TASKNERVE_PANEL_ID}.tasknerve-settings-open .tasknerve-settings-drawer {
  transform: translateX(0);
}
#${TASKNERVE_PANEL_ID} .tasknerve-settings-section {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}
#${TASKNERVE_PANEL_ID} .tasknerve-settings-section:first-child {
  margin-top: 14px;
}
#${TASKNERVE_PANEL_ID} .tasknerve-settings-title {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(214, 223, 235, 0.62);
}
#${TASKNERVE_PANEL_ID} .tasknerve-settings-copy {
  font-size: 12px;
  line-height: 1.5;
  color: rgba(214, 223, 235, 0.68);
}
#${TASKNERVE_PANEL_ID} .tasknerve-empty {
  padding: 14px;
  border-radius: 12px;
  border: 1px dashed rgba(255, 255, 255, 0.11);
  background: rgba(255, 255, 255, 0.018);
}
#${TASKNERVE_NAV_ID}.tasknerve-active {
  background: rgba(255, 255, 255, 0.08) !important;
}
#${TASKNERVE_BRANCH_CHIP_ID} {
  position: relative;
}
#${TASKNERVE_BRANCH_CHIP_ID} .tasknerve-branch-chip-inner {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
#${TASKNERVE_BRANCH_CHIP_ID} .tasknerve-branch-icon,
#${TASKNERVE_BRANCH_CHIP_ID} .tasknerve-branch-icon svg {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
#${TASKNERVE_BRANCH_CHIP_ID} .tasknerve-branch-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
#${TASKNERVE_BRANCH_CHIP_ID} .tasknerve-branch-caret {
  opacity: 0.72;
  font-size: 11px;
}
#${TASKNERVE_BRANCH_MENU_ID} {
  position: fixed;
  z-index: 2147483604;
  min-width: 240px;
  max-width: min(320px, calc(100vw - 24px));
  padding: 8px;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(23, 26, 33, 0.98);
  box-shadow: 0 20px 44px rgba(0, 0, 0, 0.34);
  color: rgba(245, 247, 250, 0.96);
}
#${TASKNERVE_BRANCH_MENU_ID}[hidden] {
  display: none;
}
#${TASKNERVE_BRANCH_MENU_ID} .tasknerve-branch-menu-copy {
  padding: 8px 10px 10px;
  font-size: 12px;
  line-height: 1.5;
  color: rgba(214, 223, 235, 0.72);
}
#${TASKNERVE_BRANCH_MENU_ID} .tasknerve-branch-menu-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
#${TASKNERVE_BRANCH_MENU_ID} .tasknerve-branch-menu-item {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
  font: inherit;
}
#${TASKNERVE_BRANCH_MENU_ID} .tasknerve-branch-menu-item:hover {
  background: rgba(255, 255, 255, 0.06);
}
#${TASKNERVE_BRANCH_MENU_ID} .tasknerve-branch-menu-item.tasknerve-active {
  background: rgba(68, 142, 255, 0.14);
}
#${TASKNERVE_BRANCH_MENU_ID} .tasknerve-branch-menu-create {
  margin-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
  padding-top: 8px;
}
#${TASKNERVE_BRANCH_MENU_ID} .tasknerve-branch-pill {
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  font-size: 11px;
  color: rgba(214, 223, 235, 0.82);
}
#${TASKNERVE_NAV_ID} .tasknerve-codex-icon,
#${TASKNERVE_NAV_ID} .tasknerve-codex-icon svg {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
@media (max-width: 1460px) {
  #${TASKNERVE_PANEL_ID} .tasknerve-metrics {
    justify-content: flex-start;
  }
}
@media (max-width: 1180px) {
  #${TASKNERVE_PANEL_ID} .tasknerve-topbar {
    grid-template-columns: 1fr;
  }
  #${TASKNERVE_PANEL_ID} .tasknerve-body {
    grid-template-columns: 1fr;
  }
  #${TASKNERVE_PANEL_ID} .tasknerve-side-pane {
    border-left: 0;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
  }
}
@media (max-width: 980px) {
  #${TASKNERVE_PANEL_ID} .tasknerve-shell {
    left: 12px !important;
    width: auto !important;
  }
  #${TASKNERVE_PANEL_ID} .tasknerve-topbar,
  #${TASKNERVE_PANEL_ID} .tasknerve-search-row,
  #${TASKNERVE_PANEL_ID} .tasknerve-main-pane,
  #${TASKNERVE_PANEL_ID} .tasknerve-side-pane {
    padding-left: 14px;
    padding-right: 14px;
  }
  #${TASKNERVE_PANEL_ID} .tasknerve-search-controls {
    grid-template-columns: 1fr;
  }
  #${TASKNERVE_PANEL_ID} .tasknerve-settings-drawer {
    width: 100%;
  }
}
`;
  document.head.appendChild(style);
}

function tasknervePanelRoot() {
  let root = tasknerveById(TASKNERVE_PANEL_ID);
  if (root) {
    return root;
  }
  tasknerveEnsurePanelStyles();
  root = document.createElement("div");
  root.id = TASKNERVE_PANEL_ID;
  root.innerHTML = `
    <div class="tasknerve-shell">
      <div class="tasknerve-topbar">
        <div class="tasknerve-project-slot">
          <select class="tasknerve-select" id="tasknerveProjectSelect" aria-label="TaskNerve project"></select>
        </div>
        <div class="tasknerve-metrics" id="tasknerveMetrics"></div>
        <div class="tasknerve-actions">
          <button
            type="button"
            class="tasknerve-button ghost tasknerve-icon-button"
            id="tasknerveSettingsButton"
            aria-label="Project settings"
            title="Project settings"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3.25"></circle>
              <path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a2 2 0 1 1-2.82 2.82l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.91V20a2 2 0 1 1-4 0v-.16a1 1 0 0 0-.66-.94 1 1 0 0 0-1.08.22l-.11.1a2 2 0 1 1-2.82-2.82l.1-.1a1 1 0 0 0 .22-1.08 1 1 0 0 0-.94-.66H4a2 2 0 1 1 0-4h.16a1 1 0 0 0 .94-.66 1 1 0 0 0-.22-1.08l-.1-.11a2 2 0 1 1 2.82-2.82l.11.1a1 1 0 0 0 1.08.22 1 1 0 0 0 .66-.94V4a2 2 0 1 1 4 0v.16a1 1 0 0 0 .6.91 1 1 0 0 0 1.1-.2l.1-.1a2 2 0 1 1 2.82 2.82l-.1.1a1 1 0 0 0-.2 1.1 1 1 0 0 0 .91.6H20a2 2 0 1 1 0 4h-.16a1 1 0 0 0-.44.09Z"></path>
            </svg>
          </button>
        </div>
      </div>
      <div class="tasknerve-search-row">
        <div class="tasknerve-search-controls">
          <input class="tasknerve-input" id="tasknerveTaskSearchInput" type="text" placeholder="Search tasks by title, detail, tag, or task id" />
          <button type="button" class="tasknerve-button primary" id="tasknerveNewTaskButton">New task</button>
        </div>
        <div class="tasknerve-flash" id="tasknerveFlash" hidden></div>
      </div>
      <div class="tasknerve-body">
        <section class="tasknerve-main-pane">
          <div class="tasknerve-section-header">
            <div class="tasknerve-muted" id="tasknerveTaskCountMeta">Loading queue…</div>
          </div>
          <div class="tasknerve-empty" id="tasknerveTaskEmpty" hidden></div>
          <div class="tasknerve-list" id="tasknerveTaskList"></div>
        </section>
        <aside class="tasknerve-side-pane">
          <section class="tasknerve-block">
            <div class="tasknerve-editor-head">
              <div>
                <h2 class="tasknerve-section-title" id="tasknerveEditorTitle">New task</h2>
                <div class="tasknerve-muted" id="tasknerveEditorMeta">Create a task or select one from the list to edit it.</div>
              </div>
              <button type="button" class="tasknerve-button subtle ghost" id="tasknerveResetEditorButton">Reset</button>
            </div>
            <form class="tasknerve-editor-form" id="tasknerveTaskEditorForm">
              <label class="tasknerve-field">
                <span>Title</span>
                <input class="tasknerve-input" id="tasknerveTaskTitleInput" type="text" placeholder="Describe the work clearly" />
              </label>
              <div class="tasknerve-editor-grid">
                <label class="tasknerve-field">
                  <span>Priority</span>
                  <input class="tasknerve-input" id="tasknerveTaskPriorityInput" type="number" step="1" value="5" />
                </label>
                <label class="tasknerve-field">
                  <span>Suggested intelligence</span>
                  <select class="tasknerve-select" id="tasknerveTaskIntelligenceInput">
                    <option value="">Default / auto</option>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="max">Max</option>
                  </select>
                </label>
                <label class="tasknerve-field">
                  <span>Depends on</span>
                  <input class="tasknerve-input" id="tasknerveTaskDependsInput" type="text" placeholder="task_01, task_02" />
                </label>
                <label class="tasknerve-field">
                  <span>Suggested model</span>
                  <input class="tasknerve-input" id="tasknerveTaskModelInput" type="text" placeholder="Optional exact worker model" />
                </label>
              </div>
              <label class="tasknerve-field">
                <span>Tags</span>
                <input class="tasknerve-input" id="tasknerveTaskTagsInput" type="text" placeholder="ui, codex, native" />
              </label>
              <label class="tasknerve-field">
                <span>Detail</span>
                <textarea class="tasknerve-textarea" id="tasknerveTaskDetailInput" placeholder="Capture context, acceptance criteria, or blockers."></textarea>
              </label>
              <div class="tasknerve-editor-actions">
                <button type="submit" class="tasknerve-button primary" id="tasknerveSaveTaskButton">Create task</button>
                <button type="button" class="tasknerve-button ghost" id="tasknerveBlankTaskButton">New blank</button>
              </div>
            </form>
          </section>
          <section class="tasknerve-block">
            <div class="tasknerve-block-header">
              <h2 class="tasknerve-block-title">Active Codex Threads</h2>
              <div class="tasknerve-muted" id="tasknerveThreadMeta">Loading…</div>
            </div>
            <div class="tasknerve-list" id="tasknerveThreadList"></div>
          </section>
          <section class="tasknerve-block">
            <div class="tasknerve-block-header">
              <h2 class="tasknerve-block-title">Claimed Work</h2>
            </div>
            <div class="tasknerve-list" id="tasknerveClaimedTaskList"></div>
          </section>
        </aside>
      </div>
      <aside class="tasknerve-settings-drawer" id="tasknerveSettingsDrawer" aria-hidden="true">
        <div class="tasknerve-settings-head">
          <div>
            <h2 class="tasknerve-section-title">Project settings</h2>
            <div class="tasknerve-muted" id="tasknerveSettingsMeta">Tune the project policy and Codex worker behavior here.</div>
          </div>
          <button type="button" class="tasknerve-button ghost" id="tasknerveCloseSettingsButton">Close</button>
        </div>
        <section class="tasknerve-settings-section">
          <h3 class="tasknerve-settings-title">Automation</h3>
          <div class="tasknerve-settings-copy" id="tasknerveAdvisorStatus">Advisor state unavailable.</div>
          <div class="tasknerve-checklist">
            <label class="tasknerve-check">
              <input id="tasknerveAdvisorEnabledInput" type="checkbox" />
              <span>Enable project advisor automation</span>
            </label>
            <label class="tasknerve-check">
              <input id="tasknerveAdvisorAutoTaskInput" type="checkbox" />
              <span>Auto-generate tasks when the queue gets low</span>
            </label>
            <label class="tasknerve-check">
              <input id="tasknerveAdvisorAutoReviewInput" type="checkbox" />
              <span>Auto-run maintenance and review passes</span>
            </label>
            <label class="tasknerve-check">
              <input id="tasknerveAdvisorRequireConfirmInput" type="checkbox" />
              <span>Require confirmation before auto-generated work dispatches</span>
            </label>
            <label class="tasknerve-check">
              <input id="tasknerveAdvisorAllowResearchInput" type="checkbox" />
              <span>Allow online research during advisor runs</span>
            </label>
            <label class="tasknerve-field">
              <span>Low task threshold</span>
              <input id="tasknerveAdvisorLowThresholdInput" type="number" min="1" step="1" value="2" />
            </label>
          </div>
          <div class="tasknerve-card-actions">
            <button type="button" class="tasknerve-button primary" id="tasknerveSaveSettingsButton">Save settings</button>
            <button type="button" class="tasknerve-button ghost" id="tasknerveRunReviewButton">Run review</button>
            <button type="button" class="tasknerve-button ghost" id="tasknerveRunResearchButton">Run research</button>
          </div>
        </section>
        <section class="tasknerve-settings-section">
          <h3 class="tasknerve-settings-title">Codex integration</h3>
          <div class="tasknerve-settings-copy" id="tasknerveControllerSettingsSummary">No project selected.</div>
          <label class="tasknerve-field" style="margin-top: 10px;">
            <span>Git origin URL</span>
            <input class="tasknerve-input" id="tasknerveGitOriginInput" type="text" placeholder="https://github.com/org/repo.git" />
          </label>
          <label class="tasknerve-field" style="margin-top: 10px;">
            <span>Heartbeat core prompt</span>
            <textarea class="tasknerve-textarea" id="tasknerveHeartbeatTemplate"></textarea>
          </label>
          <label class="tasknerve-check" style="margin-top: 10px;">
            <input id="tasknerveLowQueueControllerEnabledInput" type="checkbox" />
            <span>Auto-prompt the controller when the task list gets low</span>
          </label>
          <label class="tasknerve-field" style="margin-top: 10px;">
            <span>Low-queue controller prompt</span>
            <textarea class="tasknerve-textarea" id="tasknerveLowQueuePromptInput"></textarea>
          </label>
          <div class="tasknerve-card-actions">
            <button type="button" class="tasknerve-button ghost" id="tasknerveBootstrapControllerButton">Create controller thread</button>
            <button type="button" class="tasknerve-button ghost" id="tasknerveAdoptActiveButton">Adopt active threads</button>
            <button type="button" class="tasknerve-button ghost" id="tasknerveHeartbeatButton">Send heartbeats</button>
          </div>
        </section>
        <section class="tasknerve-settings-section">
          <h3 class="tasknerve-settings-title">Model routing</h3>
          <div class="tasknerve-settings-copy">Route worker prompts with project defaults, task intelligence hints, or explicit task model overrides.</div>
          <div class="tasknerve-checklist">
            <label class="tasknerve-check">
              <input id="tasknerveWorkerSingleMessageInput" type="checkbox" />
              <span>Single-message worker queue mode</span>
            </label>
            <label class="tasknerve-check">
              <input id="tasknerveWorkerModelRoutingInput" type="checkbox" />
              <span>Enable task-aware worker model routing</span>
            </label>
          </div>
          <div class="tasknerve-editor-grid" style="margin-top: 10px;">
            <label class="tasknerve-field">
              <span>Worker default model</span>
              <input class="tasknerve-input" id="tasknerveWorkerDefaultModelInput" type="text" placeholder="Optional worker default" />
            </label>
            <label class="tasknerve-field">
              <span>Controller default model</span>
              <input class="tasknerve-input" id="tasknerveControllerDefaultModelInput" type="text" placeholder="Optional controller default" />
            </label>
            <label class="tasknerve-field">
              <span>Low intelligence model</span>
              <input class="tasknerve-input" id="tasknerveLowModelInput" type="text" placeholder="Cheap / fast model" />
            </label>
            <label class="tasknerve-field">
              <span>Medium intelligence model</span>
              <input class="tasknerve-input" id="tasknerveMediumModelInput" type="text" placeholder="Balanced model" />
            </label>
            <label class="tasknerve-field">
              <span>High intelligence model</span>
              <input class="tasknerve-input" id="tasknerveHighModelInput" type="text" placeholder="Stronger model" />
            </label>
            <label class="tasknerve-field">
              <span>Max intelligence model</span>
              <input class="tasknerve-input" id="tasknerveMaxModelInput" type="text" placeholder="Best available model" />
            </label>
          </div>
        </section>
        <section class="tasknerve-settings-section">
          <h3 class="tasknerve-settings-title">Project summary</h3>
          <div class="tasknerve-settings-copy" id="tasknerveProjectSettingsSummary">No project loaded.</div>
        </section>
      </aside>
    </div>
  `;
  document.body.appendChild(root);

  tasknerveById("tasknerveSettingsButton").addEventListener("click", tasknerveToggleSettings);
  tasknerveById("tasknerveCloseSettingsButton").addEventListener("click", () => {
    tasknerveSetSettingsOpen(false);
  });
  tasknerveById("tasknerveProjectSelect").addEventListener("change", (event) => {
    tasknerveState.selectedProject = event.target.value || null;
    if (tasknerveState.selectedProject) {
      tasknerveWriteStorage(TASKNERVE_STORAGE_PROJECT_KEY, tasknerveState.selectedProject);
    }
    tasknerveState.editingTaskId = null;
    tasknerveState.editorDirty = false;
    tasknerveState.settingsDirty = false;
    void tasknerveRefresh(true);
  });
  tasknerveById("tasknerveTaskSearchInput").value =
    tasknerveReadStorage(TASKNERVE_STORAGE_TASK_SEARCH_KEY) || "";
  tasknerveById("tasknerveTaskSearchInput").addEventListener("input", (event) => {
    tasknerveWriteStorage(TASKNERVE_STORAGE_TASK_SEARCH_KEY, event.target.value || "");
    tasknerveRenderTaskList(tasknerveState.snapshot);
  });
  tasknerveById("tasknerveNewTaskButton").addEventListener("click", () => {
    tasknerveBeginCreateTask();
  });
  tasknerveById("tasknerveResetEditorButton").addEventListener("click", () => {
    const task = tasknerveSelectedTask(tasknerveState.snapshot);
    if (task) {
      tasknervePopulateEditor(task);
    } else {
      tasknerveBeginCreateTask();
    }
  });
  tasknerveById("tasknerveBlankTaskButton").addEventListener("click", () => {
    tasknerveBeginCreateTask();
  });
  tasknerveById("tasknerveTaskEditorForm").addEventListener("submit", (event) => {
    event.preventDefault();
    void tasknerveSaveTask();
  });
  [
    "tasknerveTaskTitleInput",
    "tasknerveTaskPriorityInput",
    "tasknerveTaskIntelligenceInput",
    "tasknerveTaskDependsInput",
    "tasknerveTaskModelInput",
    "tasknerveTaskTagsInput",
    "tasknerveTaskDetailInput",
  ].forEach((id) => {
    const field = tasknerveById(id);
    if (field) {
      field.addEventListener("input", () => {
        tasknerveState.editorDirty = true;
      });
    }
  });
  [
    "tasknerveAdvisorEnabledInput",
    "tasknerveAdvisorAutoTaskInput",
    "tasknerveAdvisorAutoReviewInput",
    "tasknerveAdvisorRequireConfirmInput",
    "tasknerveAdvisorAllowResearchInput",
    "tasknerveAdvisorLowThresholdInput",
    "tasknerveGitOriginInput",
    "tasknerveHeartbeatTemplate",
    "tasknerveLowQueueControllerEnabledInput",
    "tasknerveLowQueuePromptInput",
    "tasknerveWorkerSingleMessageInput",
    "tasknerveWorkerModelRoutingInput",
    "tasknerveWorkerDefaultModelInput",
    "tasknerveControllerDefaultModelInput",
    "tasknerveLowModelInput",
    "tasknerveMediumModelInput",
    "tasknerveHighModelInput",
    "tasknerveMaxModelInput",
  ].forEach((id) => {
    const field = tasknerveById(id);
    if (field) {
      field.addEventListener("input", () => {
        tasknerveState.settingsDirty = true;
      });
      field.addEventListener("change", () => {
        tasknerveState.settingsDirty = true;
      });
    }
  });
  tasknerveById("tasknerveSaveSettingsButton").addEventListener("click", () => {
    void tasknerveSaveSettings();
  });
  tasknerveById("tasknerveRunReviewButton").addEventListener("click", () => {
    void tasknerveRunAdvisor("reviewer");
  });
  tasknerveById("tasknerveRunResearchButton").addEventListener("click", () => {
    void tasknerveRunAdvisor("task_manager");
  });
  tasknerveById("tasknerveAdoptActiveButton").addEventListener("click", () => {
    void tasknerveAdoptActiveThreads();
  });
  tasknerveById("tasknerveHeartbeatButton").addEventListener("click", () => {
    void tasknerveHeartbeatWorkers();
  });
  tasknerveById("tasknerveBootstrapControllerButton").addEventListener("click", () => {
    void tasknerveBootstrapController();
  });
  root.addEventListener("pointerdown", () => {
    tasknerveMaybeRefreshOnInteraction();
  });
  root.addEventListener("focusin", () => {
    tasknerveMaybeRefreshOnInteraction();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !tasknerveState.panelOpen) {
      return;
    }
    if (tasknerveState.settingsOpen) {
      tasknerveSetSettingsOpen(false);
      return;
    }
    tasknerveClosePanel();
  });

  tasknerveBeginCreateTask();
  return root;
}

function tasknerveBranchMenu() {
  let menu = tasknerveById(TASKNERVE_BRANCH_MENU_ID);
  if (menu) {
    return menu;
  }
  tasknerveEnsurePanelStyles();
  menu = document.createElement("div");
  menu.id = TASKNERVE_BRANCH_MENU_ID;
  menu.hidden = true;
  document.body.appendChild(menu);
  return menu;
}

function tasknerveCloseBranchMenu() {
  tasknerveState.branchMenuOpen = false;
  const menu = tasknerveById(TASKNERVE_BRANCH_MENU_ID);
  if (menu) {
    menu.hidden = true;
  }
}

function tasknervePositionBranchMenu(anchor) {
  const menu = tasknerveBranchMenu();
  const rect = anchor.getBoundingClientRect();
  const top = Math.min(window.innerHeight - 16, rect.top - 8);
  menu.hidden = false;
  const width = Math.min(320, Math.max(240, rect.width + 24));
  menu.style.width = `${width}px`;
  const menuRect = menu.getBoundingClientRect();
  const left = Math.min(
    window.innerWidth - menuRect.width - 12,
    Math.max(12, rect.right - menuRect.width),
  );
  const adjustedTop = Math.max(12, top - menuRect.height);
  menu.style.left = `${left}px`;
  menu.style.top = `${adjustedTop}px`;
}

async function tasknerveSwitchTimelineBranch(branch) {
  if (!branch) {
    return;
  }
  try {
    await tasknervePostJson(`/api/timeline/branch/switch${tasknerveProjectQuery()}`, {
      branch,
    });
    tasknerveSetFlash(`Switched TaskNerve branch to ${branch}.`, "info");
    tasknerveCloseBranchMenu();
    await tasknerveRefresh(false);
  } catch (error) {
    tasknerveSetFlash(`TaskNerve branch switch failed: ${error}`, "error");
  }
}

async function tasknerveCreateTimelineBranch() {
  const activeBranch = tasknerveActiveTimelineBranch(tasknerveState.snapshot) || "trunk";
  const suggested = `${activeBranch}-next`;
  const nextName = window.prompt("New TaskNerve branch name", suggested);
  if (!nextName) {
    return;
  }
  try {
    const payload = await tasknervePostJson(`/api/timeline/branch/create${tasknerveProjectQuery()}`, {
      name: nextName,
      switch: true,
    });
    tasknerveSetFlash(
      `Created TaskNerve branch ${payload.created_branch || nextName}.`,
      "info",
    );
    tasknerveCloseBranchMenu();
    await tasknerveRefresh(false);
  } catch (error) {
    tasknerveSetFlash(`TaskNerve branch create failed: ${error}`, "error");
  }
}

function tasknerveRenderBranchMenu(anchor, snapshot) {
  const menu = tasknerveBranchMenu();
  const timeline = tasknerveTimelineSummary(snapshot);
  const activeBranch = timeline?.active_branch || "";
  const branches = tasknerveTimelineBranches(snapshot);
  if (!timeline?.timeline_initialized || branches.length === 0) {
    menu.innerHTML = `
      <div class="tasknerve-branch-menu-copy">
        TaskNerve timeline branches are not available for this project yet. Initialize TaskNerve in the repo first.
      </div>
    `;
    tasknervePositionBranchMenu(anchor);
    tasknerveState.branchMenuOpen = true;
    return;
  }
  menu.innerHTML = `
    <div class="tasknerve-branch-menu-copy">
      TaskNerve branches for ${tasknerveEscapeHtml(
        tasknerveState.snapshot?.selected_project?.name || "this project",
      )}.
    </div>
    <div class="tasknerve-branch-menu-list">
      ${branches
        .map((branch) => {
          const isActive = branch === activeBranch;
          return `
            <button
              type="button"
              class="tasknerve-branch-menu-item${isActive ? " tasknerve-active" : ""}"
              data-tasknerve-switch-branch="${tasknerveEscapeHtml(branch)}"
            >
              <span>${tasknerveEscapeHtml(branch)}</span>
              <span class="tasknerve-branch-pill">${isActive ? "active" : "switch"}</span>
            </button>
          `;
        })
        .join("")}
    </div>
    <div class="tasknerve-branch-menu-create">
      <button type="button" class="tasknerve-branch-menu-item" id="tasknerveCreateBranchMenuButton">
        <span>Create TaskNerve branch…</span>
        <span class="tasknerve-branch-pill">new</span>
      </button>
    </div>
  `;
  menu.querySelectorAll("[data-tasknerve-switch-branch]").forEach((button) => {
    button.addEventListener("click", () => {
      void tasknerveSwitchTimelineBranch(button.getAttribute("data-tasknerve-switch-branch"));
    });
  });
  const createButton = tasknerveById("tasknerveCreateBranchMenuButton");
  if (createButton) {
    createButton.addEventListener("click", () => {
      void tasknerveCreateTimelineBranch();
    });
  }
  tasknervePositionBranchMenu(anchor);
  tasknerveState.branchMenuOpen = true;
}

function tasknerveToggleBranchMenu(anchor) {
  if (tasknerveState.branchMenuOpen) {
    tasknerveCloseBranchMenu();
    return;
  }
  tasknerveRenderBranchMenu(anchor, tasknerveState.snapshot);
}

function tasknerveFindFooterBranchChip(snapshot) {
  const existing = tasknerveById(TASKNERVE_BRANCH_CHIP_ID);
  if (existing) {
    return existing;
  }
  const gitBranchHint = tasknerveNormalizeText(tasknerveGitBranchHint(snapshot));
  const activeBranch = tasknerveNormalizeText(tasknerveActiveTimelineBranch(snapshot));
  const candidates = Array.from(
    document.querySelectorAll("button,[role='button'],a,div.cursor-interaction"),
  )
    .filter((node) => {
      if (node.id === TASKNERVE_NAV_ID || node.closest(`#${TASKNERVE_PANEL_ID}`)) {
        return false;
      }
      const rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height) {
        return false;
      }
      if (rect.bottom < window.innerHeight - 220 || rect.left < window.innerWidth * 0.45) {
        return false;
      }
      const text = tasknerveNormalizeText(node.textContent);
      if (!text) {
        return false;
      }
      return (
        (gitBranchHint && text.includes(gitBranchHint)) ||
        (activeBranch && text.includes(activeBranch))
      );
    })
    .sort((left, right) => {
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      return (
        Math.abs(rightRect.bottom - window.innerHeight) -
        Math.abs(leftRect.bottom - window.innerHeight)
      );
    });
  return candidates[0] || null;
}

function tasknerveEnsureBranchChip(snapshot) {
  if (!snapshot) {
    return;
  }
  const chip = tasknerveFindFooterBranchChip(snapshot);
  if (!chip) {
    return;
  }
  const timeline = tasknerveTimelineSummary(snapshot);
  const activeBranch = timeline?.active_branch || "timeline off";
  chip.id = TASKNERVE_BRANCH_CHIP_ID;
  chip.setAttribute("aria-label", "TaskNerve branches");
  chip.title = timeline?.timeline_initialized
    ? `TaskNerve branch: ${activeBranch}`
    : "TaskNerve timeline is not initialized for this project";
  chip.innerHTML = "";
  const inner = document.createElement("span");
  inner.className = "tasknerve-branch-chip-inner";
  inner.appendChild(tasknerveCreateBranchIcon());
  const label = document.createElement("span");
  label.className = "tasknerve-branch-label";
  label.textContent = activeBranch;
  inner.appendChild(label);
  const caret = document.createElement("span");
  caret.className = "tasknerve-branch-caret";
  caret.textContent = "▾";
  inner.appendChild(caret);
  chip.appendChild(inner);
  if (!chip.dataset.tasknerveBranchBound) {
    chip.dataset.tasknerveBranchBound = "true";
    chip.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        tasknerveToggleBranchMenu(chip);
      },
      true,
    );
    chip.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          tasknerveToggleBranchMenu(chip);
        } else if (event.key === "Escape") {
          tasknerveCloseBranchMenu();
        }
      },
      true,
    );
  }
}

function tasknerveSetFlash(message, tone) {
  const flash = tasknerveById("tasknerveFlash");
  if (!flash) {
    return;
  }
  tasknerveState.flash = {
    tone: tone || "info",
    message: message || "",
  };
  if (!message) {
    flash.hidden = true;
    flash.className = "tasknerve-flash";
    flash.textContent = "";
    return;
  }
  flash.hidden = false;
  flash.className = `tasknerve-flash${tone === "error" ? " error" : ""}`;
  flash.textContent = message;
}

async function tasknerveFetchJson(path, options) {
  const response = await fetch(`${tasknerveBaseOrigin()}${path}`, {
    cache: "no-store",
    mode: "cors",
    ...options,
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (_error) {
    payload = null;
  }
  if (!response.ok) {
    const errorMessage =
      payload?.error ||
      payload?.message ||
      text ||
      `HTTP ${response.status}`;
    throw new Error(errorMessage);
  }
  if (payload && payload.ok === false) {
    throw new Error(payload.error || "TaskNerve request failed");
  }
  return payload;
}

async function tasknerveFetchHostContext() {
  const origin = tasknerveNativeBridgeOrigin();
  if (!origin || origin.includes("__TASKNERVE_NATIVE_BRIDGE_URL__")) {
    return null;
  }
  try {
    const response = await fetch(`${origin}/tasknerve/host/context`, {
      cache: "no-store",
      mode: "cors",
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    if (!payload || payload.ok === false) {
      return null;
    }
    return payload;
  } catch (_error) {
    return null;
  }
}

async function tasknerveSyncProjectFromHost() {
  const hostContext = await tasknerveFetchHostContext();
  tasknerveState.hostContext = hostContext;
  const threadId = tasknerveNormalizeText(hostContext?.active_thread_id || "");
  if (!threadId) {
    return;
  }
  try {
    const resolved = await tasknerveFetchJson(
      `/api/codex/project-for-thread?thread_id=${encodeURIComponent(threadId)}`,
    );
    const projectKey = tasknerveNormalizeText(resolved?.selected_project?.key || "");
    if (!projectKey) {
      return;
    }
    tasknerveState.selectedProject = projectKey;
    tasknerveWriteStorage(TASKNERVE_STORAGE_PROJECT_KEY, projectKey);
  } catch (_error) {}
}

async function tasknerveRefresh(userInitiated) {
  if (tasknerveState.loading) {
    return;
  }
  tasknerveState.loading = true;
  try {
    const [snapshot, advisorResult] = await Promise.all([
      tasknerveFetchJson(`/api/tasks${tasknerveProjectQuery()}`),
      tasknerveFetchJson(`/api/advisor${tasknerveProjectQuery()}`).catch((error) => ({
        __tasknerve_error: String(error),
      })),
    ]);
    tasknerveState.snapshot = snapshot;
    tasknerveState.advisor = advisorResult?.__tasknerve_error ? null : advisorResult;
    const selectedProject =
      snapshot?.selected_project?.key ||
      tasknerveState.selectedProject ||
      null;
    tasknerveState.selectedProject = selectedProject;
    if (selectedProject) {
      tasknerveWriteStorage(TASKNERVE_STORAGE_PROJECT_KEY, selectedProject);
    }
    tasknerveRender();
    if (advisorResult?.__tasknerve_error) {
      tasknerveSetFlash(
        `Task queue loaded, but project settings failed to load: ${advisorResult.__tasknerve_error}`,
        "error",
      );
    } else if (userInitiated) {
      tasknerveSetFlash("TaskNerve state refreshed.", "info");
    }
    tasknerveState.lastRefreshedAt = Date.now();
  } catch (error) {
    tasknerveSetFlash(
      `TaskNerve failed to load. Run "tasknerve codex doctor --json" if this persists. ${error}`,
      "error",
    );
  } finally {
    tasknerveState.loading = false;
  }
}

function tasknerveRenderProjectPicker(snapshot) {
  const select = tasknerveById("tasknerveProjectSelect");
  if (!select) {
    return;
  }
  const projects = snapshot?.projects || [];
  const selectedKey =
    tasknerveState.selectedProject ||
    snapshot?.selected_project?.key ||
    tasknerveReadStorage(TASKNERVE_STORAGE_PROJECT_KEY) ||
    "";
  select.innerHTML = projects
    .map((project) => {
      const selected = project.key === selectedKey ? " selected" : "";
      return `<option value="${tasknerveEscapeHtml(project.key)}"${selected}>${tasknerveEscapeHtml(
        project.name || project.key || "project",
      )}</option>`;
    })
    .join("");
  if (!tasknerveState.selectedProject && select.value) {
    tasknerveState.selectedProject = select.value;
  }
}

function tasknerveRenderMetrics(snapshot) {
  const metrics = tasknerveById("tasknerveMetrics");
  if (!metrics) {
    return;
  }
  const tasks = tasknerveTasks(snapshot);
  const codex = snapshot?.codex || {};
  const openCount = tasks.filter((task) => task.status === "open").length;
  const claimedCount = tasks.filter((task) => task.status === "claimed").length;
  const doneCount = tasks.filter((task) => task.status === "done").length;
  const metricsData = [
    { value: openCount, label: "Open" },
    { value: tasknerveReadyCount(snapshot), label: "Ready" },
    { value: claimedCount, label: "Claimed" },
    { value: doneCount, label: "Done" },
    { value: codex.active_worker_count || 0, label: "Workers" },
    {
      value: snapshot?.policy?.pending_confirmation_count || 0,
      label: "Awaiting approval",
    },
  ];
  metrics.innerHTML = metricsData
    .map(
      (metric) => `
        <div class="tasknerve-metric">
          <strong>${tasknerveEscapeHtml(metric.value)}</strong>
          <span>${tasknerveEscapeHtml(metric.label)}</span>
        </div>
      `,
    )
    .join("");
}

function tasknerveRenderTaskList(snapshot) {
  const container = tasknerveById("tasknerveTaskList");
  const empty = tasknerveById("tasknerveTaskEmpty");
  const meta = tasknerveById("tasknerveTaskCountMeta");
  if (!container || !empty || !meta) {
    return;
  }

  const allTasks = tasknerveSortTasks(tasknerveTasks(snapshot));
  const visibleTasks = tasknerveVisibleTasks(snapshot);
  const query = tasknerveNormalizeText(tasknerveById("tasknerveTaskSearchInput")?.value || "");
  meta.textContent = `${visibleTasks.length} visible of ${allTasks.length} total`;

  if (visibleTasks.length === 0) {
    empty.hidden = false;
    empty.innerHTML = allTasks.length === 0
      ? "No tasks exist for this project yet. Create one here, or let the controller build the initial backlog."
      : `No tasks match "${tasknerveEscapeHtml(query)}".`;
    container.innerHTML = "";
    return;
  }

  empty.hidden = true;
  container.innerHTML = visibleTasks
    .map((task) => {
      const tags = tasknerveUserTags(task)
        .map((tag) => `<span class="tasknerve-tag">${tasknerveEscapeHtml(tag)}</span>`)
        .join("");
      const routing = [
        task.suggested_intelligence ? `intelligence ${task.suggested_intelligence}` : "",
        task.suggested_model ? `model ${task.suggested_model}` : "",
      ]
        .filter(Boolean)
        .join(" • ");
      const detail = task.detail
        ? `<p class="tasknerve-detail">${tasknerveEscapeHtml(task.detail)}</p>`
        : "";
      const deps = (task.depends_on || []).join(", ");
      const blockedBy = (task.blocked_by || []).join(", ");
      const awaitingConfirmation = !!task.awaiting_confirmation;
      const stateLine = task.ready
        ? `<span class="tasknerve-ready">Ready to dispatch</span>`
        : awaitingConfirmation
          ? `<span class="tasknerve-blocked">Awaiting approval before dispatch</span>`
          : `<span class="tasknerve-blocked">Blocked by: ${tasknerveEscapeHtml(blockedBy || "unknown")}</span>`;
      const approveButton = awaitingConfirmation
        ? `<button type="button" class="tasknerve-button ghost" data-tasknerve-approve="${tasknerveEscapeHtml(task.task_id)}">Approve</button>`
        : "";
      const selected = task.task_id === tasknerveState.editingTaskId ? " selected" : "";
      const inlinePriorityInputId = `tasknerveInlinePriority_${task.task_id}`;
      return `
        <article class="tasknerve-task-card${selected}" data-tasknerve-task-card="${tasknerveEscapeHtml(task.task_id)}">
          <div class="tasknerve-task-head">
            <div>
              <h3 class="tasknerve-task-title">${tasknerveEscapeHtml(task.title || "(untitled)")}</h3>
              <div class="tasknerve-priority">id ${tasknerveEscapeHtml(task.task_id)} • priority ${tasknerveEscapeHtml(task.priority || 0)}</div>
              <div class="tasknerve-card-meta">claimed by ${tasknerveEscapeHtml(task.claimed_by_agent_id || "none")} • depends on ${tasknerveEscapeHtml(deps || "none")}</div>
              ${routing ? `<div class="tasknerve-card-meta">${tasknerveEscapeHtml(routing)}</div>` : ""}
            </div>
            <span class="tasknerve-status ${tasknerveStatusClass(task.status)}">${tasknerveEscapeHtml(task.status || "open")}</span>
          </div>
          ${detail}
          <div class="tasknerve-state-line">${stateLine}</div>
          <div class="tasknerve-tags">${tags || '<span class="tasknerve-tag">no tags</span>'}</div>
          <div class="tasknerve-priority-row">
            <span class="tasknerve-muted">priority</span>
            <input class="tasknerve-input" id="${tasknerveEscapeHtml(inlinePriorityInputId)}" type="number" step="1" value="${tasknerveEscapeHtml(task.priority || 0)}" />
            <button type="button" class="tasknerve-button ghost" data-tasknerve-save-priority="${tasknerveEscapeHtml(task.task_id)}" data-tasknerve-input-id="${tasknerveEscapeHtml(inlinePriorityInputId)}">Save</button>
            <button type="button" class="tasknerve-button ghost" data-tasknerve-shift-priority="${tasknerveEscapeHtml(task.task_id)}" data-tasknerve-direction="up">Earlier</button>
            <button type="button" class="tasknerve-button ghost" data-tasknerve-shift-priority="${tasknerveEscapeHtml(task.task_id)}" data-tasknerve-direction="down">Later</button>
          </div>
          <div class="tasknerve-card-actions">
            ${approveButton}
            <button type="button" class="tasknerve-button ghost" data-tasknerve-edit="${tasknerveEscapeHtml(task.task_id)}">Edit</button>
            <button type="button" class="tasknerve-button danger" data-tasknerve-remove="${tasknerveEscapeHtml(task.task_id)}">Remove</button>
          </div>
        </article>
      `;
    })
    .join("");

  container.querySelectorAll("[data-tasknerve-task-card]").forEach((card) => {
    card.addEventListener("click", (event) => {
      if (event.target.closest("button,input,textarea,select,label")) {
        return;
      }
      tasknerveBeginEditTask(card.getAttribute("data-tasknerve-task-card"));
    });
  });
  container.querySelectorAll("[data-tasknerve-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      tasknerveBeginEditTask(button.getAttribute("data-tasknerve-edit"));
    });
  });
  container.querySelectorAll("[data-tasknerve-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      void tasknerveRemoveTask(button.getAttribute("data-tasknerve-remove"));
    });
  });
  container.querySelectorAll("[data-tasknerve-approve]").forEach((button) => {
    button.addEventListener("click", () => {
      void tasknerveApproveTask(button.getAttribute("data-tasknerve-approve"));
    });
  });
  container.querySelectorAll("[data-tasknerve-save-priority]").forEach((button) => {
    button.addEventListener("click", () => {
      const taskId = button.getAttribute("data-tasknerve-save-priority");
      const input = tasknerveById(button.getAttribute("data-tasknerve-input-id") || "");
      const task = tasknerveTasks(snapshot).find((candidate) => candidate.task_id === taskId);
      void tasknervePersistPriority(task, input?.value);
    });
  });
  container.querySelectorAll("[data-tasknerve-shift-priority]").forEach((button) => {
    button.addEventListener("click", () => {
      const taskId = button.getAttribute("data-tasknerve-shift-priority");
      const direction = button.getAttribute("data-tasknerve-direction");
      const task = tasknerveTasks(snapshot).find((candidate) => candidate.task_id === taskId);
      const nextPriority = tasknerveShiftedPriority(tasknerveSortTasks(tasknerveTasks(snapshot)), task, direction);
      void tasknervePersistPriority(task, nextPriority);
    });
  });
}

function tasknerveRenderClaimedTasks(snapshot) {
  const container = tasknerveById("tasknerveClaimedTaskList");
  if (!container) {
    return;
  }
  const tasks = tasknerveSortTasks(tasknerveTasks(snapshot)).filter((task) => task.status === "claimed");
  if (tasks.length === 0) {
    container.innerHTML =
      '<div class="tasknerve-empty">No agents currently hold claimed work in this project.</div>';
    return;
  }
  container.innerHTML = tasks
    .slice(0, 8)
    .map(
      (task) => `
        <article class="tasknerve-card">
          <div class="tasknerve-card-head">
            <h3 class="tasknerve-card-title">${tasknerveEscapeHtml(task.title || "claimed task")}</h3>
            <span class="tasknerve-status ${tasknerveStatusClass(task.status)}">${tasknerveEscapeHtml(task.status)}</span>
          </div>
          <div class="tasknerve-card-meta">task ${tasknerveEscapeHtml(task.task_id || "")} • agent ${tasknerveEscapeHtml(task.claimed_by_agent_id || "unknown")}</div>
          <div class="tasknerve-card-meta">${tasknerveEscapeHtml(task.detail || "No detail recorded.")}</div>
        </article>
      `,
    )
    .join("");
}

function tasknerveRenderThreadList(snapshot) {
  const container = tasknerveById("tasknerveThreadList");
  const meta = tasknerveById("tasknerveThreadMeta");
  if (!container || !meta) {
    return;
  }
  const bindings = new Map(
    (snapshot?.codex?.bindings || []).map((binding) => [binding.thread_id, binding]),
  );
  const threads = tasknerveDiscoveredThreads(snapshot);
  meta.textContent = `${threads.length} active project threads`;
  if (threads.length === 0) {
    container.innerHTML =
      '<div class="tasknerve-empty">No active Codex conversations were discovered for this project yet. Open or unarchive a few worker threads first.</div>';
    return;
  }
  container.innerHTML = threads
    .map((thread) => {
      const binding = bindings.get(thread.thread_id);
      const isController = binding?.agent_id === TASKNERVE_CONTROLLER_AGENT_ID;
      const workerAgent = !isController && binding?.agent_id ? binding.agent_id : null;
      const statusLabel = isController
        ? "controller"
        : workerAgent
          ? `worker ${workerAgent}`
          : "unbound";
      const actionButtons = isController
        ? `<button type="button" class="tasknerve-button ghost" data-tasknerve-unbind="${tasknerveEscapeHtml(binding.agent_id)}">Unbind</button>`
        : `
            <button type="button" class="tasknerve-button ghost" data-tasknerve-bind-controller="${tasknerveEscapeHtml(thread.thread_id)}" data-tasknerve-label="${tasknerveEscapeHtml(thread.display_label || thread.thread_name || "")}">Set controller</button>
            ${
              workerAgent
                ? `<button type="button" class="tasknerve-button ghost" data-tasknerve-unbind="${tasknerveEscapeHtml(workerAgent)}">Unbind</button>`
                : `<button type="button" class="tasknerve-button ghost" data-tasknerve-bind-worker="${tasknerveEscapeHtml(thread.thread_id)}" data-tasknerve-label="${tasknerveEscapeHtml(thread.display_label || thread.thread_name || "")}">Adopt worker</button>`
            }
          `;
      return `
        <article class="tasknerve-card">
          <div class="tasknerve-card-head">
            <h3 class="tasknerve-card-title">${tasknerveEscapeHtml(
              thread.display_label || thread.thread_name || thread.thread_id_short || "thread",
            )}</h3>
            <span class="tasknerve-status ${isController ? "tasknerve-status-open" : workerAgent ? "tasknerve-status-claimed" : "tasknerve-status-default"}">${tasknerveEscapeHtml(statusLabel)}</span>
          </div>
          <div class="tasknerve-card-meta">thread ${tasknerveEscapeHtml(thread.thread_id_short || thread.thread_id || "")}</div>
          <div class="tasknerve-card-meta">updated ${tasknerveEscapeHtml(thread.updated_at_utc || "unknown")}</div>
          <div class="tasknerve-card-actions">${actionButtons}</div>
        </article>
      `;
    })
    .join("");

  container.querySelectorAll("[data-tasknerve-bind-controller]").forEach((button) => {
    button.addEventListener("click", () => {
      void tasknerveBindThread(
        button.getAttribute("data-tasknerve-bind-controller"),
        button.getAttribute("data-tasknerve-label"),
        true,
      );
    });
  });
  container.querySelectorAll("[data-tasknerve-bind-worker]").forEach((button) => {
    button.addEventListener("click", () => {
      void tasknerveBindThread(
        button.getAttribute("data-tasknerve-bind-worker"),
        button.getAttribute("data-tasknerve-label"),
        false,
      );
    });
  });
  container.querySelectorAll("[data-tasknerve-unbind]").forEach((button) => {
    button.addEventListener("click", () => {
      void tasknerveUnbindAgent(button.getAttribute("data-tasknerve-unbind"));
    });
  });
}

function tasknervePopulateEditor(task) {
  const loadedTaskId = task?.task_id || "";
  const titleInput = tasknerveById("tasknerveTaskTitleInput");
  const priorityInput = tasknerveById("tasknerveTaskPriorityInput");
  const detailInput = tasknerveById("tasknerveTaskDetailInput");
  const tagsInput = tasknerveById("tasknerveTaskTagsInput");
  const dependsInput = tasknerveById("tasknerveTaskDependsInput");
  const intelligenceInput = tasknerveById("tasknerveTaskIntelligenceInput");
  const modelInput = tasknerveById("tasknerveTaskModelInput");
  const editorTitle = tasknerveById("tasknerveEditorTitle");
  const editorMeta = tasknerveById("tasknerveEditorMeta");
  const saveButton = tasknerveById("tasknerveSaveTaskButton");
  const form = tasknerveById("tasknerveTaskEditorForm");
  if (!titleInput || !priorityInput || !detailInput || !tagsInput || !dependsInput || !intelligenceInput || !modelInput || !editorTitle || !editorMeta || !saveButton || !form) {
    return;
  }
  form.dataset.loadedTaskId = loadedTaskId;
  titleInput.value = task?.title || "";
  priorityInput.value = String(task?.priority ?? 5);
  detailInput.value = task?.detail || "";
  tagsInput.value = tasknerveUserTags(task).join(", ");
  dependsInput.value = (task?.depends_on || []).join(", ");
  intelligenceInput.value = task?.suggested_intelligence || "";
  modelInput.value = task?.suggested_model || "";
  editorTitle.textContent = task ? `Edit ${task.task_id}` : "New task";
  editorMeta.textContent = task
    ? "Editing replaces the current title, detail, priority, routing hints, tags, and dependency list."
    : "Create a new task directly from the native Codex panel.";
  saveButton.textContent = task ? "Save changes" : "Create task";
  tasknerveState.editorDirty = false;
}

function tasknerveBeginCreateTask() {
  tasknerveState.editingTaskId = null;
  tasknervePopulateEditor(null);
  tasknerveRenderTaskList(tasknerveState.snapshot);
}

function tasknerveBeginEditTask(taskId) {
  if (!taskId || !tasknerveState.snapshot) {
    return;
  }
  const task = tasknerveTasks(tasknerveState.snapshot).find((candidate) => candidate.task_id === taskId);
  if (!task) {
    return;
  }
  tasknerveState.editingTaskId = taskId;
  tasknervePopulateEditor(task);
  tasknerveRenderTaskList(tasknerveState.snapshot);
}

function tasknerveRenderEditor(snapshot) {
  const task = tasknerveSelectedTask(snapshot);
  const loadedTaskId = tasknerveById("tasknerveTaskEditorForm")?.dataset.loadedTaskId || "";
  const expectedLoadedTaskId = task?.task_id || "";
  if (!tasknerveState.editorDirty && loadedTaskId !== expectedLoadedTaskId) {
    tasknervePopulateEditor(task);
    return;
  }
  if (!tasknerveState.editorDirty && task && loadedTaskId === expectedLoadedTaskId) {
    tasknervePopulateEditor(task);
    return;
  }
  if (!task && !tasknerveState.editorDirty && loadedTaskId) {
    tasknervePopulateEditor(null);
  }
}

function tasknerveRenderSettings(snapshot, advisor) {
  const settingsMeta = tasknerveById("tasknerveSettingsMeta");
  const advisorStatus = tasknerveById("tasknerveAdvisorStatus");
  const projectSummary = tasknerveById("tasknerveProjectSettingsSummary");
  const controllerSummary = tasknerveById("tasknerveControllerSettingsSummary");
  const bootstrapButton = tasknerveById("tasknerveBootstrapControllerButton");
  if (!settingsMeta || !advisorStatus || !projectSummary || !controllerSummary || !bootstrapButton) {
    return;
  }
  const project = snapshot?.selected_project || null;
  const projectSettings = tasknerveProjectCodexSettings(snapshot);
  const controller = tasknerveControllerBinding(snapshot);
  const workers = tasknerveWorkerBindings(snapshot);
  settingsMeta.textContent = project
    ? `${project.name || project.key} • ${project.repo_root}`
    : "No project selected.";
  projectSummary.textContent = project
    ? `${controller ? "Controller bound" : "No controller bound"} • ${workers.length} worker bindings • ${tasknerveDiscoveredThreads(snapshot).length} active threads`
    : "Select a TaskNerve project to configure it.";
  controllerSummary.textContent = controller
    ? `Controller ${controller.display_label || controller.thread_id_short || controller.thread_id} is bound for this project.`
    : "No controller thread is bound yet. Create one here or adopt an existing active thread.";
  bootstrapButton.textContent = controller ? "Replace controller thread" : "Create controller thread";
  const policy = advisor?.policy || {};
  const workersState = advisor?.workers || {};
  const reviewerStatus = workersState.reviewer?.status || "idle";
  const taskManagerStatus = workersState.task_manager?.status || "idle";
  advisorStatus.textContent = advisor
    ? `reviewer ${reviewerStatus} • task manager ${taskManagerStatus}`
    : "Project advisor settings are unavailable right now.";

  if (tasknerveState.settingsDirty) {
    return;
  }

  tasknerveById("tasknerveAdvisorEnabledInput").checked = Boolean(policy.enabled);
  tasknerveById("tasknerveAdvisorAutoTaskInput").checked = Boolean(policy.auto_task_generation);
  tasknerveById("tasknerveAdvisorAutoReviewInput").checked = Boolean(policy.auto_review);
  tasknerveById("tasknerveAdvisorRequireConfirmInput").checked = Boolean(policy.require_confirmation);
  tasknerveById("tasknerveAdvisorAllowResearchInput").checked = Boolean(policy.allow_online_research);
  tasknerveById("tasknerveAdvisorLowThresholdInput").value = String(policy.low_task_threshold || 2);
  tasknerveById("tasknerveGitOriginInput").value =
    projectSettings.git_origin_url || projectSettings.actual_git_origin_url || "";
  tasknerveById("tasknerveHeartbeatTemplate").value =
    projectSettings.heartbeat_message_core || TASKNERVE_DEFAULT_HEARTBEAT;
  tasknerveById("tasknerveLowQueueControllerEnabledInput").checked = Boolean(
    projectSettings.low_queue_controller_enabled,
  );
  tasknerveById("tasknerveLowQueuePromptInput").value =
    projectSettings.low_queue_controller_prompt || "";
  tasknerveById("tasknerveWorkerSingleMessageInput").checked = Boolean(
    projectSettings.worker_single_message_mode,
  );
  tasknerveById("tasknerveWorkerModelRoutingInput").checked = Boolean(
    projectSettings.worker_model_routing_enabled,
  );
  tasknerveById("tasknerveWorkerDefaultModelInput").value =
    projectSettings.worker_default_model || "";
  tasknerveById("tasknerveControllerDefaultModelInput").value =
    projectSettings.controller_default_model || "";
  tasknerveById("tasknerveLowModelInput").value =
    projectSettings.low_intelligence_model || "";
  tasknerveById("tasknerveMediumModelInput").value =
    projectSettings.medium_intelligence_model || "";
  tasknerveById("tasknerveHighModelInput").value =
    projectSettings.high_intelligence_model || "";
  tasknerveById("tasknerveMaxModelInput").value =
    projectSettings.max_intelligence_model || "";
}

function tasknerveRender() {
  const snapshot = tasknerveState.snapshot;
  if (!snapshot) {
    return;
  }
  tasknerveRenderProjectPicker(snapshot);
  tasknerveRenderMetrics(snapshot);
  tasknerveRenderTaskList(snapshot);
  tasknerveRenderClaimedTasks(snapshot);
  tasknerveRenderThreadList(snapshot);
  tasknerveRenderEditor(snapshot);
  tasknerveRenderSettings(snapshot, tasknerveState.advisor);
  tasknerveEnsureBranchChip(snapshot);
}

async function tasknervePostJson(path, payload) {
  return tasknerveFetchJson(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
}

async function tasknerveBindThread(threadId, label, controller) {
  if (!threadId) {
    return;
  }
  try {
    await tasknervePostJson(`/api/codex/bind${tasknerveProjectQuery()}`, {
      thread_id: threadId,
      label: label || null,
      controller: !!controller,
      heartbeat_message: controller ? null : tasknerveCurrentHeartbeatTemplate(),
    });
    tasknerveSetFlash(
      controller ? "Controller thread bound." : "Worker thread adopted.",
      "info",
    );
    await tasknerveRefresh(false);
  } catch (error) {
    tasknerveSetFlash(`Thread binding failed: ${error}`, "error");
  }
}

async function tasknerveUnbindAgent(agentId) {
  if (!agentId) {
    return;
  }
  try {
    await tasknervePostJson(`/api/codex/unbind${tasknerveProjectQuery()}`, {
      agent_id: agentId,
    });
    tasknerveSetFlash(`Unbound ${agentId}.`, "info");
    await tasknerveRefresh(false);
  } catch (error) {
    tasknerveSetFlash(`Unbind failed: ${error}`, "error");
  }
}

async function tasknerveSaveTask() {
  const title = tasknerveNormalizeText(tasknerveById("tasknerveTaskTitleInput")?.value || "");
  const priorityText = tasknerveNormalizeText(tasknerveById("tasknerveTaskPriorityInput")?.value || "");
  if (!title) {
    tasknerveSetFlash("Task title is required.", "error");
    return;
  }
  const priority = priorityText === "" ? 0 : Number(priorityText);
  if (!Number.isFinite(priority)) {
    tasknerveSetFlash("Priority must be a number.", "error");
    return;
  }
  const editingTask = tasknerveSelectedTask(tasknerveState.snapshot);
  const payload = {
    title,
    detail: tasknerveNormalizeText(tasknerveById("tasknerveTaskDetailInput")?.value || "") || null,
    priority,
    tags: tasknerveCsvList(tasknerveById("tasknerveTaskTagsInput")?.value || ""),
    depends_on: tasknerveCsvList(tasknerveById("tasknerveTaskDependsInput")?.value || ""),
    suggested_intelligence:
      tasknerveNormalizeText(tasknerveById("tasknerveTaskIntelligenceInput")?.value || ""),
    suggested_model:
      tasknerveNormalizeText(tasknerveById("tasknerveTaskModelInput")?.value || ""),
    agent: "tasknerve.native",
  };
  if (editingTask) {
    payload.task_id = editingTask.task_id;
  }
  try {
    const result = await tasknervePostJson(
      `${editingTask ? "/api/tasks/edit" : "/api/tasks/add"}${tasknerveProjectQuery()}`,
      payload,
    );
    const savedTaskId = result?.task?.task_id || editingTask?.task_id || null;
    tasknerveState.editorDirty = false;
    tasknerveSetFlash(
      `${editingTask ? "Saved" : "Created"} ${savedTaskId || title}.`,
      "info",
    );
    await tasknerveRefresh(false);
    if (savedTaskId) {
      tasknerveBeginEditTask(savedTaskId);
    } else {
      tasknerveBeginCreateTask();
    }
  } catch (error) {
    tasknerveSetFlash(`Task save failed: ${error}`, "error");
  }
}

async function tasknerveRemoveTask(taskId) {
  if (!taskId) {
    return;
  }
  const task = tasknerveTasks(tasknerveState.snapshot).find((candidate) => candidate.task_id === taskId);
  if (!task) {
    return;
  }
  const confirmed = window.confirm(`Remove ${task.task_id}: ${task.title || "(untitled)"}?`);
  if (!confirmed) {
    return;
  }
  try {
    await tasknervePostJson(`/api/tasks/remove${tasknerveProjectQuery()}`, {
      task_id: task.task_id,
      agent: "tasknerve.native",
    });
    if (tasknerveState.editingTaskId === task.task_id) {
      tasknerveBeginCreateTask();
    }
    tasknerveSetFlash(`Removed ${task.task_id}.`, "info");
    await tasknerveRefresh(false);
  } catch (error) {
    tasknerveSetFlash(`Task removal failed: ${error}`, "error");
  }
}

async function tasknerveApproveTask(taskId) {
  if (!taskId) {
    return;
  }
  try {
    await tasknervePostJson(`/api/tasks/approve${tasknerveProjectQuery()}`, {
      task_id: taskId,
      agent: "tasknerve.native",
    });
    tasknerveSetFlash(`Approved ${taskId}.`, "info");
    await tasknerveRefresh(false);
  } catch (error) {
    tasknerveSetFlash(`Task approval failed: ${error}`, "error");
  }
}

function tasknerveShiftedPriority(tasks, task, direction) {
  if (!task || task.status === "done") {
    return null;
  }
  const activeTasks = (tasks || []).filter((candidate) => candidate.status !== "done");
  const index = activeTasks.findIndex((candidate) => candidate.task_id === task.task_id);
  if (index === -1) {
    return null;
  }
  if (direction === "up") {
    if (index === 0) {
      return Number(task.priority || 0) + 1;
    }
    return Number(activeTasks[index - 1].priority || 0) + 1;
  }
  if (direction === "down") {
    if (index === activeTasks.length - 1) {
      return Number(task.priority || 0) - 1;
    }
    return Number(activeTasks[index + 1].priority || 0) - 1;
  }
  return null;
}

async function tasknervePersistPriority(task, nextPriority) {
  if (!task) {
    return;
  }
  if (nextPriority == null || nextPriority === "") {
    tasknerveSetFlash("Priority update is unavailable for that task.", "error");
    return;
  }
  const parsed = Number(nextPriority);
  if (!Number.isFinite(parsed)) {
    tasknerveSetFlash("Priority must be a number.", "error");
    return;
  }
  if (parsed === Number(task.priority || 0)) {
    return;
  }
  try {
    await tasknervePostJson(`/api/tasks/edit${tasknerveProjectQuery()}`, {
      task_id: task.task_id,
      priority: parsed,
      agent: "tasknerve.native",
    });
    tasknerveSetFlash(`Reprioritized ${task.task_id} to ${parsed}.`, "info");
    await tasknerveRefresh(false);
  } catch (error) {
    tasknerveSetFlash(`Priority update failed: ${error}`, "error");
  }
}

function tasknerveCollectSettingsPayload() {
  return {
    enabled: Boolean(tasknerveById("tasknerveAdvisorEnabledInput")?.checked),
    auto_task_generation: Boolean(tasknerveById("tasknerveAdvisorAutoTaskInput")?.checked),
    auto_review: Boolean(tasknerveById("tasknerveAdvisorAutoReviewInput")?.checked),
    require_confirmation: Boolean(tasknerveById("tasknerveAdvisorRequireConfirmInput")?.checked),
    allow_online_research: Boolean(tasknerveById("tasknerveAdvisorAllowResearchInput")?.checked),
    low_task_threshold: Number(tasknerveById("tasknerveAdvisorLowThresholdInput")?.value || "2"),
  };
}

function tasknerveCollectProjectCodexSettingsPayload() {
  return {
    git_origin_url: tasknerveById("tasknerveGitOriginInput")?.value || "",
    heartbeat_message_core: tasknerveById("tasknerveHeartbeatTemplate")?.value || "",
    low_queue_controller_enabled: Boolean(
      tasknerveById("tasknerveLowQueueControllerEnabledInput")?.checked,
    ),
    low_queue_controller_prompt: tasknerveById("tasknerveLowQueuePromptInput")?.value || "",
    worker_single_message_mode: Boolean(
      tasknerveById("tasknerveWorkerSingleMessageInput")?.checked,
    ),
    worker_model_routing_enabled: Boolean(
      tasknerveById("tasknerveWorkerModelRoutingInput")?.checked,
    ),
    worker_default_model: tasknerveById("tasknerveWorkerDefaultModelInput")?.value || "",
    controller_default_model:
      tasknerveById("tasknerveControllerDefaultModelInput")?.value || "",
    low_intelligence_model: tasknerveById("tasknerveLowModelInput")?.value || "",
    medium_intelligence_model: tasknerveById("tasknerveMediumModelInput")?.value || "",
    high_intelligence_model: tasknerveById("tasknerveHighModelInput")?.value || "",
    max_intelligence_model: tasknerveById("tasknerveMaxModelInput")?.value || "",
  };
}

async function tasknerveSaveSettings() {
  try {
    await Promise.all([
      tasknervePostJson(
        `/api/advisor/policy${tasknerveProjectQuery()}`,
        tasknerveCollectSettingsPayload(),
      ),
      tasknervePostJson(
        `/api/project/codex-settings${tasknerveProjectQuery()}`,
        tasknerveCollectProjectCodexSettingsPayload(),
      ),
    ]);
    tasknerveState.settingsDirty = false;
    tasknerveSetFlash("Project settings saved.", "info");
    await tasknerveRefresh(false);
  } catch (error) {
    tasknerveSetFlash(`Project settings save failed: ${error}`, "error");
  }
}

async function tasknerveRunAdvisor(role) {
  try {
    const result = await tasknervePostJson(`/api/advisor/run${tasknerveProjectQuery()}`, {
      role,
      background: true,
      allow_online_research: Boolean(tasknerveById("tasknerveAdvisorAllowResearchInput")?.checked),
    });
    tasknerveSetFlash(
      `Queued ${role === "reviewer" ? "review" : "research"} run (${result?.result?.status || result?.result?.trigger || "ok"}).`,
      "info",
    );
    await tasknerveRefresh(false);
  } catch (error) {
    tasknerveSetFlash(`Advisor run failed: ${error}`, "error");
  }
}

async function tasknerveAdoptActiveThreads() {
  const button = tasknerveById("tasknerveAdoptActiveButton");
  try {
    if (button) {
      button.disabled = true;
    }
    await tasknervePostJson(`/api/codex/adopt-active${tasknerveProjectQuery()}`, {
      heartbeat_message: tasknerveCurrentHeartbeatTemplate(),
    });
    tasknerveSetFlash("Active project threads adopted into TaskNerve.", "info");
    await tasknerveRefresh(false);
  } catch (error) {
    tasknerveSetFlash(`Adopt-active failed: ${error}`, "error");
  } finally {
    if (button) {
      button.disabled = false;
    }
  }
}

async function tasknerveBootstrapController() {
  const button = tasknerveById("tasknerveBootstrapControllerButton");
  const hasController = Boolean(tasknerveControllerBinding(tasknerveState.snapshot));
  const forceNew = hasController
    ? window.confirm("Replace the current controller binding with a fresh controller thread?")
    : false;
  if (hasController && !forceNew) {
    return;
  }
  try {
    if (button) {
      button.disabled = true;
    }
    await tasknervePostJson(`/api/codex/controller/bootstrap${tasknerveProjectQuery()}`, {
      force_new: forceNew,
      open_thread: true,
    });
    tasknerveSetFlash("Controller thread is ready for this project.", "info");
    await tasknerveRefresh(false);
  } catch (error) {
    tasknerveSetFlash(`Controller bootstrap failed: ${error}`, "error");
  } finally {
    if (button) {
      button.disabled = false;
    }
  }
}

async function tasknerveHeartbeatWorkers() {
  const button = tasknerveById("tasknerveHeartbeatButton");
  try {
    if (button) {
      button.disabled = true;
    }
    await tasknervePostJson(`/api/codex/heartbeat-active${tasknerveProjectQuery()}`, {
      cycles: 1,
      background: true,
      heartbeat_message: tasknerveCurrentHeartbeatTemplate(),
    });
    tasknerveSetFlash("TaskNerve queued native heartbeats for the active workers.", "info");
    await tasknerveRefresh(false);
  } catch (error) {
    tasknerveSetFlash(`Heartbeat dispatch failed: ${error}`, "error");
  } finally {
    if (button) {
      button.disabled = false;
    }
  }
}

function tasknerveStartPolling() {
  if (tasknerveState.refreshTimer) {
    return;
  }
  tasknerveState.refreshTimer = window.setInterval(() => {
    if (tasknerveState.panelOpen) {
      void tasknerveRefresh(false);
    }
  }, TASKNERVE_POLL_INTERVAL_MS);
}

function tasknerveStopPolling() {
  if (tasknerveState.refreshTimer) {
    window.clearInterval(tasknerveState.refreshTimer);
    tasknerveState.refreshTimer = null;
  }
}

function tasknerveLayoutPanel() {
  const root = tasknervePanelRoot();
  const shell = root.querySelector(".tasknerve-shell");
  const reference = tasknerveById(TASKNERVE_NAV_ID) || tasknerveFindSkillsRow();
  const left = reference
    ? Math.max(Math.round(tasknerveClosestInteractive(reference).getBoundingClientRect().right) + 8, 292)
    : 308;
  const availableWidth = Math.max(420, window.innerWidth - left - 18);
  const width = window.innerWidth <= 980
    ? Math.max(320, window.innerWidth - 24)
    : Math.min(1100, availableWidth);
  shell.style.left = "auto";
  shell.style.width = `${width}px`;
}

async function tasknerveOpenPanel(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const root = tasknervePanelRoot();
  tasknerveState.panelOpen = true;
  root.classList.add("tasknerve-open");
  tasknerveLayoutPanel();
  const nav = tasknerveById(TASKNERVE_NAV_ID);
  if (nav) {
    nav.classList.add("tasknerve-active");
  }
  tasknerveStartPolling();
  await tasknerveSyncProjectFromHost();
  await tasknerveRefresh(false);
}

function tasknerveMaybeRefreshOnInteraction() {
  if (!tasknerveState.panelOpen || tasknerveState.loading) {
    return;
  }
  if (
    !tasknerveState.lastRefreshedAt ||
    Date.now() - tasknerveState.lastRefreshedAt >= TASKNERVE_INTERACTION_REFRESH_MS
  ) {
    void tasknerveRefresh(false);
  }
}

function tasknerveClosePanel() {
  tasknerveState.panelOpen = false;
  tasknerveSetSettingsOpen(false);
  const root = tasknerveById(TASKNERVE_PANEL_ID);
  if (root) {
    root.classList.remove("tasknerve-open");
  }
  const nav = tasknerveById(TASKNERVE_NAV_ID);
  if (nav) {
    nav.classList.remove("tasknerve-active");
  }
  tasknerveStopPolling();
}

function tasknerveTogglePanel(event) {
  if (tasknerveState.panelOpen) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    tasknerveClosePanel();
    return;
  }
  void tasknerveOpenPanel(event);
}

function tasknerveDecorateNavRow(row) {
  row.id = TASKNERVE_NAV_ID;
  row.setAttribute("role", row.getAttribute("role") || "button");
  row.setAttribute("aria-label", "TaskNerve");
  row.removeAttribute("href");
  row.addEventListener("click", tasknerveTogglePanel);
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      tasknerveTogglePanel(event);
    }
  });
  const existingIcon = row.querySelector("svg,img");
  if (existingIcon) {
    existingIcon.replaceWith(tasknerveCreateIcon());
  } else {
    row.insertAdjacentElement("afterbegin", tasknerveCreateIcon());
  }
  if (!tasknerveReplaceLabel(row)) {
    const label = document.createElement("span");
    label.textContent = "TaskNerve";
    row.appendChild(label);
  }
}

function tasknerveEnsureNav() {
  if (tasknerveById(TASKNERVE_NAV_ID)) {
    return;
  }
  const skillsRow = tasknerveFindSkillsRow();
  if (!skillsRow || !skillsRow.parentElement) {
    return;
  }
  const cloned = skillsRow.cloneNode(true);
  tasknerveDecorateNavRow(cloned);
  skillsRow.insertAdjacentElement("afterend", cloned);
}

function tasknerveBoot() {
  const rememberedProject = tasknerveReadStorage(TASKNERVE_STORAGE_PROJECT_KEY);
  if (rememberedProject) {
    tasknerveState.selectedProject = rememberedProject;
  }
  tasknerveEnsureNav();
  tasknerveLayoutPanel();
  void tasknerveSyncProjectFromHost().then(() => tasknerveRefresh(false)).catch(() => {});
  const observer = new MutationObserver(() => {
    tasknerveEnsureNav();
    tasknerveLayoutPanel();
    tasknerveEnsureBranchChip(tasknerveState.snapshot);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("resize", tasknerveLayoutPanel);
  window.addEventListener("resize", tasknerveCloseBranchMenu);
  document.addEventListener("click", (event) => {
    const menu = tasknerveById(TASKNERVE_BRANCH_MENU_ID);
    const chip = tasknerveById(TASKNERVE_BRANCH_CHIP_ID);
    if (!tasknerveState.branchMenuOpen) {
      return;
    }
    if (menu?.contains(event.target) || chip?.contains(event.target)) {
      return;
    }
    tasknerveCloseBranchMenu();
  });
  window.addEventListener("focus", () => {
    void tasknerveSyncProjectFromHost().then(() => tasknerveRefresh(false)).catch(() => {});
    if (tasknerveState.panelOpen) {
      tasknerveMaybeRefreshOnInteraction();
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", tasknerveBoot, { once: true });
} else {
  tasknerveBoot();
}
