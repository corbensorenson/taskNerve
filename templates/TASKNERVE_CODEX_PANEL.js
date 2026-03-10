const TASKNERVE_BASE_URL = "__TASKNERVE_BASE_URL__";
const TASKNERVE_NAV_ID = "tasknerve-codex-nav-entry";
const TASKNERVE_PANEL_ID = "tasknerve-codex-panel-root";
const TASKNERVE_PANEL_STYLE_ID = "tasknerve-codex-panel-style";
const TASKNERVE_STORAGE_PROJECT_KEY = "tasknerve.codex.selectedProject";
const TASKNERVE_STORAGE_DRAFT_KEY = "tasknerve.codex.controllerDraft";
const TASKNERVE_STORAGE_HEARTBEAT_KEY = "tasknerve.codex.heartbeatTemplate";
const TASKNERVE_SKILLS_LABELS = ["Skills", "Skills & Apps", "Skills and Apps"];
const TASKNERVE_CONTROLLER_AGENT_ID = "agent.controller";
const TASKNERVE_DEFAULT_HEARTBEAT =
  "Please continue working on {project_name} project utilizing the taskNerve system. I believe in you, do your absolute best!";

const tasknerveState = {
  panelOpen: false,
  loading: false,
  selectedProject: null,
  snapshot: null,
  refreshTimer: null,
  flash: { tone: "info", message: "" },
};

function tasknerveNormalizeText(value) {
  return (value || "").replace(/\s+/g, " ").trim();
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

function tasknerveProjectQuery() {
  const query = new URLSearchParams();
  if (tasknerveState.selectedProject) {
    query.set("project", tasknerveState.selectedProject);
  }
  const suffix = query.toString();
  return suffix ? `?${suffix}` : "";
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

function tasknerveQueuedPrompts(snapshot) {
  return snapshot?.codex?.queued_prompts || [];
}

function tasknerveOpenTasks(snapshot) {
  const tasks = snapshot?.tasks || [];
  return tasks.filter((task) => task.status === "open");
}

function tasknerveClaimedTasks(snapshot) {
  const tasks = snapshot?.tasks || [];
  return tasks.filter((task) => task.status === "claimed");
}

function tasknerveReadyCount(snapshot) {
  return (snapshot?.tasks || []).filter((task) => task.ready).length;
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
  color: rgba(250, 252, 255, 0.96);
  font: inherit;
}
#${TASKNERVE_PANEL_ID}.tasknerve-open {
  display: block;
}
#${TASKNERVE_PANEL_ID} .tasknerve-overlay {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at top right, rgba(64, 141, 255, 0.16), transparent 34%),
    radial-gradient(circle at bottom left, rgba(61, 207, 182, 0.12), transparent 32%),
    rgba(6, 10, 16, 0.58);
  backdrop-filter: blur(18px);
  pointer-events: auto;
}
#${TASKNERVE_PANEL_ID} .tasknerve-shell {
  position: absolute;
  top: 12px;
  right: 12px;
  bottom: 12px;
  left: 308px;
  display: grid;
  grid-template-rows: auto 1fr;
  border-radius: 24px;
  overflow: hidden;
  pointer-events: auto;
  background:
    linear-gradient(180deg, rgba(21, 26, 35, 0.98), rgba(10, 13, 19, 0.98)),
    rgba(13, 17, 23, 0.98);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 28px 90px rgba(0, 0, 0, 0.48);
}
#${TASKNERVE_PANEL_ID} .tasknerve-topbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 20px;
  padding: 18px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  background:
    linear-gradient(135deg, rgba(63, 112, 224, 0.18), transparent 44%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.03), transparent);
}
#${TASKNERVE_PANEL_ID} .tasknerve-title-row {
  display: flex;
  align-items: center;
  gap: 14px;
}
#${TASKNERVE_PANEL_ID} .tasknerve-title-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(69, 122, 255, 0.28), rgba(38, 206, 181, 0.22));
  color: rgba(255, 255, 255, 0.96);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
}
#${TASKNERVE_PANEL_ID} .tasknerve-title-icon svg,
#${TASKNERVE_NAV_ID} .tasknerve-codex-icon svg {
  width: 18px;
  height: 18px;
}
#${TASKNERVE_PANEL_ID} .tasknerve-title-block {
  min-width: 0;
}
#${TASKNERVE_PANEL_ID} .tasknerve-title {
  margin: 0;
  font-size: 21px;
  font-weight: 650;
  letter-spacing: -0.02em;
}
#${TASKNERVE_PANEL_ID} .tasknerve-subtitle {
  margin-top: 4px;
  font-size: 13px;
  color: rgba(220, 228, 240, 0.72);
}
#${TASKNERVE_PANEL_ID} .tasknerve-actions {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
#${TASKNERVE_PANEL_ID} .tasknerve-body {
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr) 360px;
  min-height: 0;
}
#${TASKNERVE_PANEL_ID} .tasknerve-column {
  min-height: 0;
  overflow: auto;
  padding: 18px;
}
#${TASKNERVE_PANEL_ID} .tasknerve-column + .tasknerve-column {
  border-left: 1px solid rgba(255, 255, 255, 0.06);
}
#${TASKNERVE_PANEL_ID} .tasknerve-column-left {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.03), transparent 38%),
    rgba(9, 12, 18, 0.9);
}
#${TASKNERVE_PANEL_ID} .tasknerve-column-center {
  background:
    radial-gradient(circle at top right, rgba(60, 109, 214, 0.14), transparent 30%),
    rgba(11, 14, 20, 0.95);
}
#${TASKNERVE_PANEL_ID} .tasknerve-column-right {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.02), transparent 30%),
    rgba(9, 12, 18, 0.94);
}
#${TASKNERVE_PANEL_ID} .tasknerve-block {
  margin-bottom: 16px;
  padding: 16px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.02);
}
#${TASKNERVE_PANEL_ID} .tasknerve-block-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
#${TASKNERVE_PANEL_ID} .tasknerve-block-title {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(214, 223, 235, 0.62);
}
#${TASKNERVE_PANEL_ID} .tasknerve-muted {
  color: rgba(214, 223, 235, 0.66);
}
#${TASKNERVE_PANEL_ID} .tasknerve-grid-meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
#${TASKNERVE_PANEL_ID} .tasknerve-metric {
  padding: 12px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.028);
  border: 1px solid rgba(255, 255, 255, 0.05);
}
#${TASKNERVE_PANEL_ID} .tasknerve-metric strong {
  display: block;
  font-size: 18px;
  font-weight: 650;
  color: rgba(250, 252, 255, 0.96);
}
#${TASKNERVE_PANEL_ID} .tasknerve-metric span {
  display: block;
  margin-top: 3px;
  font-size: 12px;
  color: rgba(214, 223, 235, 0.62);
}
#${TASKNERVE_PANEL_ID} .tasknerve-pill-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
#${TASKNERVE_PANEL_ID} .tasknerve-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 8px 11px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.045);
  border: 1px solid rgba(255, 255, 255, 0.06);
  font-size: 12px;
  color: rgba(244, 248, 255, 0.88);
}
#${TASKNERVE_PANEL_ID} .tasknerve-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: rgba(66, 231, 184, 0.92);
  box-shadow: 0 0 0 6px rgba(66, 231, 184, 0.12);
}
#${TASKNERVE_PANEL_ID} .tasknerve-dot.idle {
  background: rgba(255, 196, 82, 0.9);
  box-shadow: 0 0 0 6px rgba(255, 196, 82, 0.11);
}
#${TASKNERVE_PANEL_ID} .tasknerve-dot.offline {
  background: rgba(255, 112, 134, 0.9);
  box-shadow: 0 0 0 6px rgba(255, 112, 134, 0.11);
}
#${TASKNERVE_PANEL_ID} .tasknerve-select,
#${TASKNERVE_PANEL_ID} .tasknerve-input,
#${TASKNERVE_PANEL_ID} .tasknerve-textarea {
  width: 100%;
  appearance: none;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(6, 10, 16, 0.88);
  color: rgba(250, 252, 255, 0.96);
  border-radius: 14px;
  padding: 12px 13px;
  font: inherit;
  box-sizing: border-box;
  outline: none;
  transition: border-color 120ms ease, box-shadow 120ms ease, background 120ms ease;
}
#${TASKNERVE_PANEL_ID} .tasknerve-select:focus,
#${TASKNERVE_PANEL_ID} .tasknerve-input:focus,
#${TASKNERVE_PANEL_ID} .tasknerve-textarea:focus {
  border-color: rgba(95, 146, 255, 0.85);
  box-shadow: 0 0 0 3px rgba(95, 146, 255, 0.18);
  background: rgba(8, 12, 18, 0.96);
}
#${TASKNERVE_PANEL_ID} .tasknerve-textarea {
  min-height: 176px;
  resize: vertical;
}
#${TASKNERVE_PANEL_ID} .tasknerve-button {
  appearance: none;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(250, 252, 255, 0.94);
  border-radius: 14px;
  padding: 10px 14px;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  transition: transform 120ms ease, background 120ms ease, border-color 120ms ease;
}
#${TASKNERVE_PANEL_ID} .tasknerve-button:hover {
  background: rgba(255, 255, 255, 0.09);
  border-color: rgba(255, 255, 255, 0.14);
  transform: translateY(-1px);
}
#${TASKNERVE_PANEL_ID} .tasknerve-button:disabled {
  opacity: 0.55;
  cursor: default;
  transform: none;
}
#${TASKNERVE_PANEL_ID} .tasknerve-button.primary {
  background: linear-gradient(135deg, rgba(81, 121, 255, 0.96), rgba(57, 201, 186, 0.86));
  border-color: rgba(122, 166, 255, 0.32);
  color: #ffffff;
}
#${TASKNERVE_PANEL_ID} .tasknerve-button.ghost {
  background: transparent;
}
#${TASKNERVE_PANEL_ID} .tasknerve-button.danger {
  color: rgba(255, 137, 159, 0.96);
}
#${TASKNERVE_PANEL_ID} .tasknerve-button-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
#${TASKNERVE_PANEL_ID} .tasknerve-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
#${TASKNERVE_PANEL_ID} .tasknerve-chip {
  padding: 8px 10px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.035);
  font-size: 12px;
  color: rgba(228, 236, 247, 0.86);
  cursor: pointer;
}
#${TASKNERVE_PANEL_ID} .tasknerve-list {
  display: grid;
  gap: 10px;
}
#${TASKNERVE_PANEL_ID} .tasknerve-card {
  padding: 13px 14px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.032);
  border: 1px solid rgba(255, 255, 255, 0.06);
}
#${TASKNERVE_PANEL_ID} .tasknerve-card-title {
  font-size: 14px;
  font-weight: 640;
  line-height: 1.35;
}
#${TASKNERVE_PANEL_ID} .tasknerve-card-meta {
  margin-top: 7px;
  font-size: 12px;
  color: rgba(214, 223, 235, 0.62);
}
#${TASKNERVE_PANEL_ID} .tasknerve-card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}
#${TASKNERVE_PANEL_ID} .tasknerve-empty {
  padding: 14px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px dashed rgba(255, 255, 255, 0.1);
  color: rgba(214, 223, 235, 0.62);
  font-size: 13px;
}
#${TASKNERVE_PANEL_ID} .tasknerve-flash {
  margin-top: 12px;
  padding: 11px 12px;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.04);
  font-size: 12px;
  color: rgba(244, 248, 255, 0.9);
}
#${TASKNERVE_PANEL_ID} .tasknerve-flash.error {
  color: rgba(255, 182, 194, 0.96);
  border-color: rgba(255, 112, 134, 0.26);
  background: rgba(91, 21, 35, 0.35);
}
#${TASKNERVE_PANEL_ID} .tasknerve-form-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 112px;
  gap: 10px;
}
#${TASKNERVE_PANEL_ID} .tasknerve-kicker {
  margin-bottom: 10px;
  font-size: 12px;
  color: rgba(214, 223, 235, 0.66);
}
#${TASKNERVE_NAV_ID}.tasknerve-active {
  background: rgba(255, 255, 255, 0.08) !important;
}
#${TASKNERVE_NAV_ID} .tasknerve-codex-icon,
#${TASKNERVE_PANEL_ID} .tasknerve-title-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
@media (max-width: 1380px) {
  #${TASKNERVE_PANEL_ID} .tasknerve-body {
    grid-template-columns: 280px minmax(0, 1fr);
  }
  #${TASKNERVE_PANEL_ID} .tasknerve-column-right {
    grid-column: 1 / -1;
    border-left: 0;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }
}
@media (max-width: 980px) {
  #${TASKNERVE_PANEL_ID} .tasknerve-shell {
    left: 12px !important;
  }
  #${TASKNERVE_PANEL_ID} .tasknerve-body {
    grid-template-columns: 1fr;
  }
  #${TASKNERVE_PANEL_ID} .tasknerve-column + .tasknerve-column {
    border-left: 0;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
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
    <div class="tasknerve-overlay" data-tasknerve-close></div>
    <div class="tasknerve-shell">
      <div class="tasknerve-topbar">
        <div>
          <div class="tasknerve-title-row">
            <div class="tasknerve-title-icon">${tasknerveCreateIcon().innerHTML}</div>
            <div class="tasknerve-title-block">
              <h1 class="tasknerve-title">TaskNerve Control</h1>
              <div class="tasknerve-subtitle">Manage the project queue, controller thread, and active Codex workers without leaving the app.</div>
            </div>
          </div>
          <div class="tasknerve-flash" id="tasknerveFlash" hidden></div>
        </div>
        <div class="tasknerve-actions">
          <button type="button" class="tasknerve-button ghost" id="tasknerveRefreshButton">Refresh</button>
          <button type="button" class="tasknerve-button ghost" id="tasknerveBrowserButton">Browser</button>
          <button type="button" class="tasknerve-button" id="tasknerveCloseButton">Close</button>
        </div>
      </div>
      <div class="tasknerve-body">
        <section class="tasknerve-column tasknerve-column-left">
          <div class="tasknerve-block">
            <div class="tasknerve-block-header">
              <h2 class="tasknerve-block-title">Project</h2>
            </div>
            <select class="tasknerve-select" id="tasknerveProjectSelect"></select>
            <div class="tasknerve-kicker" id="tasknerveProjectMeta">Pick a registered TaskNerve project.</div>
            <div class="tasknerve-pill-row" id="tasknerveSummaryPills"></div>
          </div>
          <div class="tasknerve-block">
            <div class="tasknerve-block-header">
              <h2 class="tasknerve-block-title">Queue Snapshot</h2>
            </div>
            <div class="tasknerve-grid-meta" id="tasknerveMetrics"></div>
          </div>
          <div class="tasknerve-block">
            <div class="tasknerve-block-header">
              <h2 class="tasknerve-block-title">Quick Task</h2>
            </div>
            <div class="tasknerve-form-grid">
              <input class="tasknerve-input" id="tasknerveQuickTaskTitle" type="text" placeholder="Add a sharp task title" />
              <input class="tasknerve-input" id="tasknerveQuickTaskPriority" type="number" min="0" max="10" value="5" />
            </div>
            <textarea class="tasknerve-textarea" id="tasknerveQuickTaskDetail" placeholder="Capture the ask, acceptance criteria, or blockers." style="min-height: 112px; margin-top: 10px;"></textarea>
            <div class="tasknerve-button-row" style="margin-top: 12px;">
              <button type="button" class="tasknerve-button primary" id="tasknerveQuickTaskButton">Create task</button>
            </div>
          </div>
          <div class="tasknerve-block">
            <div class="tasknerve-block-header">
              <h2 class="tasknerve-block-title">Ready Work</h2>
            </div>
            <div class="tasknerve-list" id="tasknerveOpenTasks"></div>
          </div>
        </section>
        <section class="tasknerve-column tasknerve-column-center">
          <div class="tasknerve-block">
            <div class="tasknerve-block-header">
              <h2 class="tasknerve-block-title">Controller</h2>
              <div class="tasknerve-pill" id="tasknerveControllerStatus"></div>
            </div>
            <div class="tasknerve-kicker" id="tasknerveControllerMeta">Bind any active Codex conversation as the controller, then talk to it from here.</div>
            <textarea class="tasknerve-textarea" id="tasknerveControllerPrompt" placeholder="Ask the controller to review the queue, create backlog, or direct the worker threads."></textarea>
            <div class="tasknerve-chip-row" id="tasknervePromptChips"></div>
            <div class="tasknerve-button-row" style="margin-top: 12px;">
              <button type="button" class="tasknerve-button primary" id="tasknerveSendControllerButton">Send to controller</button>
              <button type="button" class="tasknerve-button ghost" id="tasknerveAdoptButton">Adopt active threads</button>
              <button type="button" class="tasknerve-button ghost" id="tasknerveHeartbeatButton">Heartbeat active workers</button>
            </div>
          </div>
          <div class="tasknerve-block">
            <div class="tasknerve-block-header">
              <h2 class="tasknerve-block-title">Heartbeat Template</h2>
            </div>
            <textarea class="tasknerve-textarea" id="tasknerveHeartbeatTemplate" style="min-height: 104px;"></textarea>
          </div>
          <div class="tasknerve-block">
            <div class="tasknerve-block-header">
              <h2 class="tasknerve-block-title">Recent Queue Activity</h2>
            </div>
            <div class="tasknerve-list" id="tasknerveQueueFeed"></div>
          </div>
        </section>
        <section class="tasknerve-column tasknerve-column-right">
          <div class="tasknerve-block">
            <div class="tasknerve-block-header">
              <h2 class="tasknerve-block-title">Active Codex Threads</h2>
              <div class="tasknerve-muted" id="tasknerveThreadMeta"></div>
            </div>
            <div class="tasknerve-list" id="tasknerveThreadList"></div>
          </div>
          <div class="tasknerve-block">
            <div class="tasknerve-block-header">
              <h2 class="tasknerve-block-title">Claimed Work</h2>
            </div>
            <div class="tasknerve-list" id="tasknerveClaimedTasks"></div>
          </div>
        </section>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  tasknerveById("tasknerveCloseButton").addEventListener("click", tasknerveClosePanel);
  root.querySelector("[data-tasknerve-close]").addEventListener("click", tasknerveClosePanel);
  tasknerveById("tasknerveRefreshButton").addEventListener("click", () => {
    void tasknerveRefresh(true);
  });
  tasknerveById("tasknerveBrowserButton").addEventListener("click", () => {
    const url = `${tasknerveBaseOrigin()}/${tasknerveProjectQuery()}`;
    window.open(url, "_blank");
  });
  tasknerveById("tasknerveProjectSelect").addEventListener("change", (event) => {
    tasknerveState.selectedProject = event.target.value || null;
    if (tasknerveState.selectedProject) {
      tasknerveWriteStorage(TASKNERVE_STORAGE_PROJECT_KEY, tasknerveState.selectedProject);
    }
    void tasknerveRefresh(true);
  });
  tasknerveById("tasknerveControllerPrompt").value =
    tasknerveReadStorage(TASKNERVE_STORAGE_DRAFT_KEY) || "";
  tasknerveById("tasknerveControllerPrompt").addEventListener("input", (event) => {
    tasknerveWriteStorage(TASKNERVE_STORAGE_DRAFT_KEY, event.target.value || "");
  });
  tasknerveById("tasknerveHeartbeatTemplate").value =
    tasknerveReadStorage(TASKNERVE_STORAGE_HEARTBEAT_KEY) || TASKNERVE_DEFAULT_HEARTBEAT;
  tasknerveById("tasknerveHeartbeatTemplate").addEventListener("input", (event) => {
    tasknerveWriteStorage(TASKNERVE_STORAGE_HEARTBEAT_KEY, event.target.value || "");
  });
  tasknerveById("tasknerveSendControllerButton").addEventListener("click", () => {
    void tasknerveSendControllerPrompt();
  });
  tasknerveById("tasknerveAdoptButton").addEventListener("click", () => {
    void tasknerveAdoptActiveThreads();
  });
  tasknerveById("tasknerveHeartbeatButton").addEventListener("click", () => {
    void tasknerveHeartbeatWorkers();
  });
  tasknerveById("tasknerveQuickTaskButton").addEventListener("click", () => {
    void tasknerveCreateQuickTask();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && tasknerveState.panelOpen) {
      tasknerveClosePanel();
    }
  });

  return root;
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

async function tasknerveRefresh(userInitiated) {
  if (tasknerveState.loading) {
    return;
  }
  tasknerveState.loading = true;
  const refreshButton = tasknerveById("tasknerveRefreshButton");
  if (refreshButton) {
    refreshButton.disabled = true;
  }
  try {
    const snapshot = await tasknerveFetchJson(`/api/tasks${tasknerveProjectQuery()}`);
    tasknerveState.snapshot = snapshot;
    const selectedProject =
      snapshot?.selected_project?.key ||
      tasknerveState.selectedProject ||
      null;
    tasknerveState.selectedProject = selectedProject;
    if (selectedProject) {
      tasknerveWriteStorage(TASKNERVE_STORAGE_PROJECT_KEY, selectedProject);
    }
    tasknerveRender();
    if (userInitiated) {
      tasknerveSetFlash("TaskNerve state refreshed.", "info");
    }
  } catch (error) {
    tasknerveSetFlash(
      `TaskNerve failed to load. Run "tasknerve codex doctor --json" if this persists. ${error}`,
      "error",
    );
  } finally {
    tasknerveState.loading = false;
    if (refreshButton) {
      refreshButton.disabled = false;
    }
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
  const meta = tasknerveById("tasknerveProjectMeta");
  if (meta) {
    meta.textContent = snapshot?.selected_project?.repo_root
      ? `${snapshot.selected_project.repo_root}`
      : "No TaskNerve project selected.";
  }
}

function tasknerveRenderMetrics(snapshot) {
  const metrics = tasknerveById("tasknerveMetrics");
  if (!metrics) {
    return;
  }
  const tasks = snapshot?.tasks || [];
  const codex = snapshot?.codex || {};
  const openTasks = tasks.filter((task) => task.status === "open").length;
  const claimedTasks = tasks.filter((task) => task.status === "claimed").length;
  const metricsData = [
    { value: openTasks, label: "Open tasks" },
    { value: claimedTasks, label: "Claimed now" },
    { value: tasknerveReadyCount(snapshot), label: "Ready to dispatch" },
    { value: codex.active_worker_count || 0, label: "Active workers" },
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

function tasknerveRenderSummaryPills(snapshot) {
  const pills = tasknerveById("tasknerveSummaryPills");
  if (!pills) {
    return;
  }
  const controller = tasknerveControllerBinding(snapshot);
  const workers = tasknerveWorkerBindings(snapshot);
  const activeThreads = tasknerveDiscoveredThreads(snapshot);
  const ready = tasknerveReadyCount(snapshot);
  const entries = [
    {
      dot: controller ? "live" : "idle",
      label: controller
        ? `Controller: ${controller.display_label || controller.thread_id_short || "bound"}`
        : "Controller: not bound",
    },
    {
      dot: workers.length > 0 ? "live" : "idle",
      label: `Workers: ${workers.length}`,
    },
    {
      dot: ready > 0 ? "live" : "idle",
      label: `Ready queue: ${ready}`,
    },
    {
      dot: activeThreads.length > 0 ? "live" : "offline",
      label: `Active threads: ${activeThreads.length}`,
    },
  ];
  pills.innerHTML = entries
    .map(
      (entry) => `
        <div class="tasknerve-pill">
          <span class="tasknerve-dot ${entry.dot}"></span>
          <span>${tasknerveEscapeHtml(entry.label)}</span>
        </div>
      `,
    )
    .join("");
}

function tasknerveRenderOpenTasks(snapshot) {
  const container = tasknerveById("tasknerveOpenTasks");
  if (!container) {
    return;
  }
  const tasks = tasknerveOpenTasks(snapshot).slice(0, 8);
  if (tasks.length === 0) {
    container.innerHTML =
      '<div class="tasknerve-empty">No open work is visible yet. Ask the controller to create or reprioritize backlog.</div>';
    return;
  }
  container.innerHTML = tasks
    .map((task) => {
      const tags = Array.isArray(task.tags) && task.tags.length > 0 ? task.tags.join(", ") : "no tags";
      return `
        <article class="tasknerve-card">
          <div class="tasknerve-card-title">${tasknerveEscapeHtml(task.title || "untitled task")}</div>
          <div class="tasknerve-card-meta">task=${tasknerveEscapeHtml(task.task_id || "")} . priority=${tasknerveEscapeHtml(task.priority || 0)} . ${tasknerveEscapeHtml(tags)}</div>
          <div class="tasknerve-card-meta">${tasknerveEscapeHtml(task.detail || "No detail recorded.")}</div>
        </article>
      `;
    })
    .join("");
}

function tasknerveRenderClaimedTasks(snapshot) {
  const container = tasknerveById("tasknerveClaimedTasks");
  if (!container) {
    return;
  }
  const tasks = tasknerveClaimedTasks(snapshot).slice(0, 8);
  if (tasks.length === 0) {
    container.innerHTML =
      '<div class="tasknerve-empty">No agents currently hold claims under this project.</div>';
    return;
  }
  container.innerHTML = tasks
    .map((task) => {
      return `
        <article class="tasknerve-card">
          <div class="tasknerve-card-title">${tasknerveEscapeHtml(task.title || "claimed task")}</div>
          <div class="tasknerve-card-meta">task=${tasknerveEscapeHtml(task.task_id || "")} . agent=${tasknerveEscapeHtml(
            task.claim?.agent_id || "unknown",
          )}</div>
          <div class="tasknerve-card-meta">${tasknerveEscapeHtml(task.detail || "No detail recorded.")}</div>
        </article>
      `;
    })
    .join("");
}

function tasknerveRenderController(snapshot) {
  const controller = tasknerveControllerBinding(snapshot);
  const status = tasknerveById("tasknerveControllerStatus");
  const meta = tasknerveById("tasknerveControllerMeta");
  if (status) {
    const label = controller
      ? `Bound to ${controller.display_label || controller.thread_id_short || "thread"}`
      : "No controller bound";
    status.innerHTML = `
      <span class="tasknerve-dot ${controller ? "live" : "idle"}"></span>
      <span>${tasknerveEscapeHtml(label)}</span>
    `;
  }
  if (meta) {
    meta.textContent = controller
      ? `Project-scoped controller turns run through Codex desktop using the app's own authenticated inference path.`
      : "Bind any active Codex thread as the controller, then drive the project from this panel.";
  }
  const savedHeartbeat = tasknerveReadStorage(TASKNERVE_STORAGE_HEARTBEAT_KEY);
  const heartbeatBox = tasknerveById("tasknerveHeartbeatTemplate");
  if (heartbeatBox && !heartbeatBox.value.trim()) {
    heartbeatBox.value = savedHeartbeat || TASKNERVE_DEFAULT_HEARTBEAT;
  }
}

function tasknerveRenderPromptChips(snapshot) {
  const chips = tasknerveById("tasknervePromptChips");
  if (!chips) {
    return;
  }
  const projectName = snapshot?.selected_project?.name || "this project";
  const prompts = [
    `Review ${projectName} and create the next best backlog.`,
    `Review the open tasks, remove weak ones, and sequence the strongest next tasks for the worker threads.`,
    `Look for blockers or duplicated work across the active agents, then update the task list and direct the workers.`,
    `Summarize current progress across the active workers and decide what each active thread should tackle next.`,
  ];
  chips.innerHTML = prompts
    .map(
      (prompt) => `
        <button type="button" class="tasknerve-chip" data-tasknerve-prompt="${tasknerveEscapeHtml(prompt)}">${tasknerveEscapeHtml(prompt)}</button>
      `,
    )
    .join("");
  chips.querySelectorAll("[data-tasknerve-prompt]").forEach((button) => {
    button.addEventListener("click", () => {
      const textarea = tasknerveById("tasknerveControllerPrompt");
      if (!textarea) {
        return;
      }
      textarea.value = button.getAttribute("data-tasknerve-prompt") || "";
      tasknerveWriteStorage(TASKNERVE_STORAGE_DRAFT_KEY, textarea.value);
      textarea.focus();
    });
  });
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
      '<div class="tasknerve-empty">No active Codex conversations were discovered under this project yet. Open or unarchive a few threads first.</div>';
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
          ? `worker: ${workerAgent}`
          : "unbound";
      return `
        <article class="tasknerve-card">
          <div class="tasknerve-card-title">${tasknerveEscapeHtml(
            thread.display_label || thread.thread_name || thread.thread_id_short || "thread",
          )}</div>
          <div class="tasknerve-card-meta">thread=${tasknerveEscapeHtml(
            thread.thread_id_short || thread.thread_id || "",
          )} . ${tasknerveEscapeHtml(statusLabel)} . updated=${tasknerveEscapeHtml(
            thread.updated_at_utc || "unknown",
          )}</div>
          <div class="tasknerve-card-actions">
            <button type="button" class="tasknerve-button ghost" data-tasknerve-bind="controller" data-thread-id="${tasknerveEscapeHtml(
              thread.thread_id,
            )}" data-thread-label="${tasknerveEscapeHtml(thread.display_label || "")}" ${
              isController ? "disabled" : ""
            }>Set controller</button>
            <button type="button" class="tasknerve-button ghost" data-tasknerve-bind="worker" data-thread-id="${tasknerveEscapeHtml(
              thread.thread_id,
            )}" data-thread-label="${tasknerveEscapeHtml(thread.display_label || "")}" ${
              workerAgent ? "disabled" : ""
            }>Adopt worker</button>
            ${
              binding
                ? `<button type="button" class="tasknerve-button danger ghost" data-tasknerve-unbind="${tasknerveEscapeHtml(
                    binding.agent_id,
                  )}">Unbind</button>`
                : ""
            }
          </div>
        </article>
      `;
    })
    .join("");
  container.querySelectorAll("[data-tasknerve-bind]").forEach((button) => {
    button.addEventListener("click", () => {
      void tasknerveBindThread(
        button.getAttribute("data-thread-id"),
        button.getAttribute("data-thread-label"),
        button.getAttribute("data-tasknerve-bind") === "controller",
      );
    });
  });
  container.querySelectorAll("[data-tasknerve-unbind]").forEach((button) => {
    button.addEventListener("click", () => {
      void tasknerveUnbindAgent(button.getAttribute("data-tasknerve-unbind"));
    });
  });
}

function tasknerveRenderQueueFeed(snapshot) {
  const container = tasknerveById("tasknerveQueueFeed");
  if (!container) {
    return;
  }
  const entries = tasknerveQueuedPrompts(snapshot).slice(0, 10);
  if (entries.length === 0) {
    container.innerHTML =
      '<div class="tasknerve-empty">No recent TaskNerve prompt activity has been recorded yet.</div>';
    return;
  }
  container.innerHTML = entries
    .map((entry) => {
      const summary = entry.result_excerpt || entry.error || "Prompt queued.";
      return `
        <article class="tasknerve-card">
          <div class="tasknerve-card-title">${tasknerveEscapeHtml(entry.agent_id || "agent")} . ${tasknerveEscapeHtml(
            entry.kind || "prompt",
          )}</div>
          <div class="tasknerve-card-meta">thread=${tasknerveEscapeHtml(
            entry.thread_id_short || entry.thread_id || "",
          )} . status=${tasknerveEscapeHtml(entry.status || "unknown")}</div>
          <div class="tasknerve-card-meta">${tasknerveEscapeHtml(summary)}</div>
        </article>
      `;
    })
    .join("");
}

function tasknerveRender() {
  const snapshot = tasknerveState.snapshot;
  if (!snapshot) {
    return;
  }
  tasknerveRenderProjectPicker(snapshot);
  tasknerveRenderMetrics(snapshot);
  tasknerveRenderSummaryPills(snapshot);
  tasknerveRenderOpenTasks(snapshot);
  tasknerveRenderClaimedTasks(snapshot);
  tasknerveRenderController(snapshot);
  tasknerveRenderPromptChips(snapshot);
  tasknerveRenderThreadList(snapshot);
  tasknerveRenderQueueFeed(snapshot);
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
      heartbeat_message: controller ? null : tasknerveById("tasknerveHeartbeatTemplate")?.value || null,
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

async function tasknerveSendControllerPrompt() {
  const snapshot = tasknerveState.snapshot;
  const controller = tasknerveControllerBinding(snapshot);
  const textarea = tasknerveById("tasknerveControllerPrompt");
  const button = tasknerveById("tasknerveSendControllerButton");
  if (!controller) {
    tasknerveSetFlash("Bind a controller thread before sending prompts.", "error");
    return;
  }
  const prompt = tasknerveNormalizeText(textarea?.value || "");
  if (!prompt) {
    tasknerveSetFlash("Controller prompt is empty.", "error");
    return;
  }
  try {
    if (button) {
      button.disabled = true;
    }
    await tasknervePostJson(`/api/codex/inject${tasknerveProjectQuery()}`, {
      agent_id: TASKNERVE_CONTROLLER_AGENT_ID,
      prompt,
      background: false,
    });
    tasknerveSetFlash("Controller prompt sent through Codex native inference.", "info");
    await tasknerveRefresh(false);
  } catch (error) {
    tasknerveSetFlash(`Controller send failed: ${error}`, "error");
  } finally {
    if (button) {
      button.disabled = false;
    }
  }
}

async function tasknerveAdoptActiveThreads() {
  const button = tasknerveById("tasknerveAdoptButton");
  try {
    if (button) {
      button.disabled = true;
    }
    await tasknervePostJson(`/api/codex/adopt-active${tasknerveProjectQuery()}`, {
      heartbeat_message: tasknerveById("tasknerveHeartbeatTemplate")?.value || null,
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

async function tasknerveHeartbeatWorkers() {
  const button = tasknerveById("tasknerveHeartbeatButton");
  try {
    if (button) {
      button.disabled = true;
    }
    await tasknervePostJson(`/api/codex/heartbeat-active${tasknerveProjectQuery()}`, {
      cycles: 1,
      background: true,
      heartbeat_message: tasknerveById("tasknerveHeartbeatTemplate")?.value || null,
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

async function tasknerveCreateQuickTask() {
  const titleInput = tasknerveById("tasknerveQuickTaskTitle");
  const detailInput = tasknerveById("tasknerveQuickTaskDetail");
  const priorityInput = tasknerveById("tasknerveQuickTaskPriority");
  const title = tasknerveNormalizeText(titleInput?.value || "");
  if (!title) {
    tasknerveSetFlash("Task title is required.", "error");
    return;
  }
  try {
    await tasknervePostJson(`/api/tasks/add${tasknerveProjectQuery()}`, {
      title,
      detail: tasknerveNormalizeText(detailInput?.value || "") || null,
      priority: Number(priorityInput?.value || "5"),
      agent: "tasknerve.native",
    });
    if (titleInput) {
      titleInput.value = "";
    }
    if (detailInput) {
      detailInput.value = "";
    }
    tasknerveSetFlash("Task added to the TaskNerve queue.", "info");
    await tasknerveRefresh(false);
  } catch (error) {
    tasknerveSetFlash(`Task creation failed: ${error}`, "error");
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
  }, 15000);
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
  shell.style.left = `${left}px`;
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
  await tasknerveRefresh(false);
}

function tasknerveClosePanel() {
  tasknerveState.panelOpen = false;
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

function tasknerveDecorateNavRow(row) {
  row.id = TASKNERVE_NAV_ID;
  row.setAttribute("role", row.getAttribute("role") || "button");
  row.setAttribute("aria-label", "TaskNerve");
  row.removeAttribute("href");
  row.addEventListener("click", tasknerveOpenPanel);
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      tasknerveOpenPanel(event);
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
  const observer = new MutationObserver(() => {
    tasknerveEnsureNav();
    tasknerveLayoutPanel();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("resize", tasknerveLayoutPanel);
  window.addEventListener("focus", () => {
    if (tasknerveState.panelOpen) {
      void tasknerveRefresh(false);
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", tasknerveBoot, { once: true });
} else {
  tasknerveBoot();
}
