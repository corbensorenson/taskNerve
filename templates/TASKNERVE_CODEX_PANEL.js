const TASKNERVE_BASE_URL = "__TASKNERVE_BASE_URL__";
const TASKNERVE_NATIVE_BRIDGE_URL = "__TASKNERVE_NATIVE_BRIDGE_URL__";
const TASKNERVE_NAV_ID = "tasknerve-codex-nav-entry";
const TASKNERVE_PANEL_ID = "tasknerve-codex-panel-root";
const TASKNERVE_PANEL_STYLE_ID = "tasknerve-codex-panel-style";
const TASKNERVE_BRANCH_CHIP_ID = "tasknerve-codex-branch-chip";
const TASKNERVE_RESOURCE_CHIP_ID = "tasknerve-codex-resource-chip";
const TASKNERVE_BRANCH_MENU_ID = "tasknerve-codex-branch-menu";
const TASKNERVE_TOPBAR_TASK_CHIP_ID = "tasknerve-codex-topbar-task-chip";
const TASKNERVE_TERMINAL_TOGGLE_ID = "tasknerve-codex-terminal-toggle";
const TASKNERVE_STORAGE_PROJECT_KEY = "tasknerve.codex.selectedProject";
const TASKNERVE_STORAGE_TASK_SEARCH_KEY = "tasknerve.codex.taskSearch";
const TASKNERVE_STORAGE_NATIVE_PROJECT_PREFS_KEY = "tasknerve.codex.nativeProjectPrefs";
const TASKNERVE_SKILLS_LABELS = ["Skills", "Skills & Apps", "Skills and Apps"];
const TASKNERVE_CONTROLLER_AGENT_ID = "agent.controller";
const TASKNERVE_INTERACTION_REFRESH_MS = 4500;
const TASKNERVE_POLL_INTERVAL_MS = 8000;
const TASKNERVE_DOCUMENT_AUTOSAVE_MS = 700;
const TASKNERVE_PROJECT_DOCUMENTS = [
  {
    key: "project_goals",
    label: "project_goals.md",
    fileName: "project_goals.md",
    title: "Project Goals",
  },
  {
    key: "project_manifest",
    label: "project_manifest.md",
    fileName: "project_manifest.md",
    title: "Project Manifest",
  },
  {
    key: "contributing_ideas",
    label: "contributing ideas.md",
    fileName: "contributing ideas.md",
    title: "Contributing Ideas",
  },
];
const TASKNERVE_DEFAULT_HEARTBEAT =
  "Please continue working on {project_name} project utilizing the taskNerve system. I believe in you, do your absolute best!";

const tasknerveState = {
  panelOpen: false,
  panelMode: "settings",
  taskModalOpen: false,
  loading: false,
  lastRefreshedAt: 0,
  hostContext: null,
  selectedProject: null,
  snapshot: null,
  projectSnapshots: {},
  editingTaskId: null,
  editorDirty: false,
  refreshTimer: null,
  branchMenuOpen: false,
  flash: { tone: "info", message: "" },
  ensuredProjectDocs: {},
  sidebarFolders: {},
  nativeProjectPrefs: {},
  resourceMonitor: {
    loading: false,
    cpuPercent: null,
    gpuPercent: null,
    memoryPercent: null,
    thermalPressure: null,
    recommendedWorkerCap: null,
    maxWorkers: null,
    capturedAtUtc: null,
  },
  documentEditor: {
    projectKey: null,
    docKey: null,
    path: null,
    title: "",
    label: "",
    projectName: "",
    content: "",
    savedContent: "",
    dirty: false,
    loading: false,
    saving: false,
    lastSavedAt: null,
    error: "",
    saveTimer: null,
  },
};

function tasknerveNormalizeText(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function tasknerveCompactRelativeTime(value) {
  if (!value) {
    return "";
  }
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) {
    return "";
  }
  const deltaSeconds = Math.max(0, Math.round((Date.now() - time) / 1000));
  if (deltaSeconds < 45) {
    return "now";
  }
  if (deltaSeconds < 3600) {
    return `${Math.max(1, Math.round(deltaSeconds / 60))}m`;
  }
  if (deltaSeconds < 86400) {
    return `${Math.max(1, Math.round(deltaSeconds / 3600))}h`;
  }
  return `${Math.max(1, Math.round(deltaSeconds / 86400))}d`;
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

function tasknerveReadStorageJson(key, fallbackValue) {
  const raw = tasknerveReadStorage(key);
  if (!raw) {
    return fallbackValue;
  }
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return fallbackValue;
  }
}

function tasknerveWriteStorage(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch (_error) {}
}

function tasknerveWriteStorageJson(key, value) {
  tasknerveWriteStorage(key, JSON.stringify(value));
}

function tasknerveBaseOrigin() {
  return TASKNERVE_BASE_URL.replace(/\/+$/, "");
}

function tasknerveNativeBridgeOrigin() {
  return TASKNERVE_NATIVE_BRIDGE_URL.replace(/\/+$/, "");
}

function tasknerveProjectQuery(projectKey = tasknerveState.selectedProject) {
  const query = new URLSearchParams();
  if (projectKey) {
    query.set("project", projectKey);
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

function tasknerveRemainingTaskCount(snapshot) {
  return tasknerveTasks(snapshot).filter((task) => task.status !== "done").length;
}

function tasknerveProjectCodexSettings(snapshot) {
  return snapshot?.project_codex_settings || {};
}

function tasknerveNativeProjectPrefs(projectKey = tasknerveState.selectedProject) {
  const defaults = {
    resourceAwareWorkers: true,
    maxActiveWorkers: 4,
    traceCollectionEnabled: false,
    traceAutoCaptureEnabled: true,
    traceCaptureIntervalSeconds: 120,
    traceLastCaptureAtUtc: null,
    traceLastCaptureId: null,
    traceRoot: tasknerveProjectRoot(projectKey)
      ? `${tasknerveProjectRoot(projectKey).replace(/\/+$/, "")}/.tasknerve/codex/traces`
      : "",
  };
  if (!projectKey) {
    return defaults;
  }
  return {
    ...defaults,
    ...(tasknerveState.nativeProjectPrefs?.[projectKey] || {}),
  };
}

function tasknerveSetNativeProjectPrefs(projectKey, partialPrefs) {
  if (!projectKey) {
    return;
  }
  tasknerveState.nativeProjectPrefs = {
    ...(tasknerveState.nativeProjectPrefs || {}),
    [projectKey]: {
      ...tasknerveNativeProjectPrefs(projectKey),
      ...(partialPrefs || {}),
    },
  };
  tasknerveWriteStorageJson(
    TASKNERVE_STORAGE_NATIVE_PROJECT_PREFS_KEY,
    tasknerveState.nativeProjectPrefs,
  );
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

function tasknerveCreateDocumentIcon() {
  const icon = document.createElement("span");
  icon.className = "tasknerve-sidebar-doc-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3.75h6.1L19 8.65V19a1.75 1.75 0 0 1-1.75 1.75h-9.5A1.75 1.75 0 0 1 6 19V5.5A1.75 1.75 0 0 1 7.75 3.75H8Z"></path><path d="M13.75 3.75V8h4.25"></path><path d="M9 12h6"></path><path d="M9 15.5h5"></path></svg>';
  return icon;
}

function tasknerveCreateFolderIcon() {
  const icon = document.createElement("span");
  icon.className = "tasknerve-sidebar-folder-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 8.25c0-1.24 1.01-2.25 2.25-2.25h4.12l1.48 1.5h4.9c1.24 0 2.25 1.01 2.25 2.25v6.5c0 1.24-1.01 2.25-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 16.25v-8Z"></path></svg>';
  return icon;
}

function tasknerveCreateThreadIcon() {
  const icon = document.createElement("span");
  icon.className = "tasknerve-sidebar-thread-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19.25c4 0 7.25-2.85 7.25-6.37S16 6.5 12 6.5 4.75 9.35 4.75 12.88c0 1.53.62 2.94 1.66 4.05L5.6 20.5l3.66-1.39c.83.09 1.62.14 2.74.14Z"></path></svg>';
  return icon;
}

function tasknerveProjectSidebarFolderState(projectKey) {
  if (!tasknerveState.sidebarFolders[projectKey]) {
    tasknerveState.sidebarFolders[projectKey] = {
      documentsOpen: false,
      agentsOpen: true,
    };
  }
  return tasknerveState.sidebarFolders[projectKey];
}

function tasknerveProjectSidebarLabels(project) {
  const labels = [
    project?.name,
    project?.key,
    project?.repo_root ? project.repo_root.split("/").filter(Boolean).pop() : null,
  ]
    .map((value) => tasknerveNormalizeText(value))
    .filter(Boolean);
  return Array.from(new Set(labels));
}

function tasknerveSidebarCandidates() {
  return Array.from(
    document.querySelectorAll("a[href],button,[role='button'],div.cursor-interaction"),
  ).filter((node) => {
    if (
      node.id === TASKNERVE_NAV_ID ||
      node.closest(`#${TASKNERVE_PANEL_ID}`) ||
      node.closest("[data-tasknerve-project-tree]")
    ) {
      return false;
    }
    const rect = node.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return false;
    }
    if (rect.left > 360 || rect.top < 120 || rect.width < 100 || rect.height < 24) {
      return false;
    }
    return true;
  });
}

function tasknerveFindSidebarProjectRow(project) {
  const labels = tasknerveProjectSidebarLabels(project);
  if (labels.length === 0) {
    return null;
  }
  const candidates = tasknerveSidebarCandidates().filter((node) => {
    const text = tasknerveNormalizeText(node.textContent);
    return labels.includes(text);
  });
  return candidates[0] || null;
}

function tasknerveSidebarThreadLabel(thread, fallbackLabel = "Untitled thread") {
  return (
    thread?.display_label ||
    thread?.thread_name ||
    thread?.thread_id_short ||
    thread?.thread_id ||
    fallbackLabel
  );
}

function tasknerveSidebarThreadRowsById(threads) {
  const candidates = tasknerveSidebarCandidates();
  const used = new Set();
  const rows = [];
  (threads || []).forEach((thread) => {
    const threadId = String(thread?.thread_id || "");
    const labels = [
      tasknerveSidebarThreadLabel(thread, ""),
      thread?.thread_name,
      thread?.thread_id_short,
      thread?.thread_id,
    ]
      .map((value) => tasknerveNormalizeText(value))
      .filter(Boolean);
    const match = candidates.find((node) => {
      if (used.has(node)) {
        return false;
      }
      const href = String(node.getAttribute("href") || "").toLowerCase();
      if (threadId && href.includes(threadId.toLowerCase())) {
        return true;
      }
      const text = tasknerveNormalizeText(node.textContent);
      return labels.includes(text);
    });
    if (match) {
      used.add(match);
      rows.push({ threadId, row: match });
    }
  });
  return rows;
}

function tasknerveCreateSidebarFolderRow(projectKey, sectionKey, label, count, open) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "tasknerve-sidebar-folder";
  button.setAttribute("data-tasknerve-folder-project", projectKey);
  button.setAttribute("data-tasknerve-folder-section", sectionKey);
  button.setAttribute("aria-expanded", open ? "true" : "false");
  const chevron = document.createElement("span");
  chevron.className = "tasknerve-sidebar-chevron";
  chevron.textContent = open ? "▾" : "▸";
  button.appendChild(chevron);
  button.appendChild(tasknerveCreateFolderIcon());
  const labelNode = document.createElement("span");
  labelNode.className = "tasknerve-sidebar-folder-label";
  labelNode.textContent = label;
  button.appendChild(labelNode);
  const countNode = document.createElement("span");
  countNode.className = "tasknerve-sidebar-folder-count";
  countNode.textContent = String(count);
  button.appendChild(countNode);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const folderState = tasknerveProjectSidebarFolderState(projectKey);
    if (sectionKey === "documents") {
      folderState.documentsOpen = !folderState.documentsOpen;
    } else if (sectionKey === "agents") {
      folderState.agentsOpen = !folderState.agentsOpen;
    }
    tasknerveEnsureSidebarProjectDocuments();
  });
  return button;
}

function tasknerveCreateSidebarThreadButton({
  label,
  meta = "",
  active = false,
  empty = false,
  onClick,
}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "tasknerve-sidebar-thread";
  if (active) {
    button.classList.add("tasknerve-active");
  }
  if (empty) {
    button.classList.add("tasknerve-empty");
    button.disabled = true;
  }
  button.appendChild(tasknerveCreateThreadIcon());
  const labelNode = document.createElement("span");
  labelNode.className = "tasknerve-sidebar-thread-label";
  labelNode.textContent = label;
  button.appendChild(labelNode);
  const metaNode = document.createElement("span");
  metaNode.className = "tasknerve-sidebar-thread-meta";
  metaNode.textContent = meta;
  button.appendChild(metaNode);
  if (typeof onClick === "function") {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
  }
  return button;
}

async function tasknerveOpenNativeThread(threadId) {
  if (!threadId) {
    return;
  }
  try {
    await tasknerveFetchNativeJson("/tasknerve/thread/open", { thread_id: threadId });
    tasknerveClosePanel();
  } catch (error) {
    tasknerveSetFlash(`Thread open failed: ${error}`, "error");
  }
}

function tasknerveProjectSidebarThreads(project) {
  const snapshot = tasknerveProjectSnapshot(project?.key);
  const controller = tasknerveControllerBinding(snapshot);
  const controllerThreadId = controller?.thread_id || null;
  const discoveredThreads = tasknerveDiscoveredThreads(snapshot)
    .filter((thread) => thread?.thread_id && thread.thread_id !== controllerThreadId)
    .sort(
      (left, right) =>
        Number(right?.updated_at_unix_seconds || 0) - Number(left?.updated_at_unix_seconds || 0),
    );
  return {
    snapshot,
    controller,
    agents: discoveredThreads,
  };
}

function tasknerveSyncHiddenSidebarRows(activeRows) {
  const activeThreadIds = new Set(activeRows.map((entry) => entry.threadId).filter(Boolean));
  document
    .querySelectorAll("[data-tasknerve-hidden-sidebar-row='true']")
    .forEach((node) => {
      const threadId = node.getAttribute("data-tasknerve-hidden-thread-id") || "";
      if (!activeThreadIds.has(threadId)) {
        node.style.removeProperty("display");
        node.removeAttribute("data-tasknerve-hidden-sidebar-row");
        node.removeAttribute("data-tasknerve-hidden-thread-id");
      }
    });
  activeRows.forEach(({ threadId, row }) => {
    if (!threadId || !row) {
      return;
    }
    row.style.display = "none";
    row.setAttribute("data-tasknerve-hidden-sidebar-row", "true");
    row.setAttribute("data-tasknerve-hidden-thread-id", threadId);
  });
}

function tasknerveEnsureSidebarProjectDocuments() {
  const projects = Array.isArray(tasknerveState.snapshot?.projects) ? tasknerveState.snapshot.projects : [];
  const seen = new Set();
  const hiddenRows = [];
  projects.forEach((project) => {
    if (!project?.key) {
      return;
    }
    const row = tasknerveFindSidebarProjectRow(project);
    if (!row || !row.parentElement) {
      return;
    }
    seen.add(project.key);
    let container = Array.from(row.parentElement.querySelectorAll("[data-tasknerve-project-tree]")).find(
      (node) => node.getAttribute("data-tasknerve-project-tree") === project.key,
    ) || null;
    if (!container) {
      container = document.createElement("div");
      container.setAttribute("data-tasknerve-project-tree", project.key);
      row.insertAdjacentElement("afterend", container);
    } else if (row.nextElementSibling !== container) {
      row.insertAdjacentElement("afterend", container);
    }
    container.innerHTML = "";
    const folderState = tasknerveProjectSidebarFolderState(project.key);
    const { controller, agents } = tasknerveProjectSidebarThreads(project);
    const controllerLabel = controller
      ? tasknerveSidebarThreadLabel(
          controller,
          `${tasknerveProjectName(project.key) || project.name || project.key}-controller`,
        )
      : `Create ${tasknerveProjectName(project.key) || project.name || project.key}-controller`;
    const controllerMeta = controller
      ? tasknerveCompactRelativeTime(controller.updated_at_utc)
      : "new";
    container.appendChild(
      tasknerveCreateSidebarThreadButton({
        label: controllerLabel,
        meta: controllerMeta,
        active: tasknerveState.hostContext?.active_thread_id === controller?.thread_id,
        onClick: controller
          ? () => {
              void tasknerveOpenNativeThread(controller.thread_id);
            }
          : () => {
              void tasknerveBootstrapController(project.key);
            },
      }),
    );
    container.appendChild(
      tasknerveCreateSidebarFolderRow(
        project.key,
        "documents",
        "Project docs",
        TASKNERVE_PROJECT_DOCUMENTS.length,
        folderState.documentsOpen,
      ),
    );
    if (folderState.documentsOpen) {
      const docsList = document.createElement("div");
      docsList.className = "tasknerve-sidebar-folder-children";
      TASKNERVE_PROJECT_DOCUMENTS.forEach((documentDescriptor) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "tasknerve-sidebar-doc";
        if (
          tasknerveState.panelMode === "document" &&
          tasknerveState.documentEditor.projectKey === project.key &&
          tasknerveState.documentEditor.docKey === documentDescriptor.key
        ) {
          button.classList.add("tasknerve-active");
        }
        button.setAttribute("data-tasknerve-doc-project", project.key);
        button.setAttribute("data-tasknerve-doc-key", documentDescriptor.key);
        button.setAttribute(
          "aria-label",
          `${documentDescriptor.label} for ${project.name || project.key || "project"}`,
        );
        button.appendChild(tasknerveCreateDocumentIcon());
        const label = document.createElement("span");
        label.className = "tasknerve-sidebar-doc-label";
        label.textContent = documentDescriptor.label;
        button.appendChild(label);
        button.addEventListener("click", (event) => {
          void tasknerveOpenProjectDocument(event, project.key, documentDescriptor.key);
        });
        docsList.appendChild(button);
      });
      container.appendChild(docsList);
    }
    container.appendChild(
      tasknerveCreateSidebarFolderRow(
        project.key,
        "agents",
        "Agents",
        agents.length,
        folderState.agentsOpen,
      ),
    );
    if (folderState.agentsOpen) {
      const agentsList = document.createElement("div");
      agentsList.className = "tasknerve-sidebar-folder-children";
      if (agents.length === 0) {
        agentsList.appendChild(
          tasknerveCreateSidebarThreadButton({
            label: "No active agents yet",
            meta: "",
            empty: true,
          }),
        );
      } else {
        agents.forEach((thread) => {
          agentsList.appendChild(
            tasknerveCreateSidebarThreadButton({
              label: tasknerveSidebarThreadLabel(thread),
              meta: tasknerveCompactRelativeTime(thread.updated_at_utc),
              active: tasknerveState.hostContext?.active_thread_id === thread.thread_id,
              onClick: () => {
                void tasknerveOpenNativeThread(thread.thread_id);
              },
            }),
          );
        });
      }
      container.appendChild(agentsList);
    }
    hiddenRows.push(...tasknerveSidebarThreadRowsById([controller, ...agents].filter(Boolean)));
    if (!tasknerveState.ensuredProjectDocs[project.key]) {
      void tasknerveEnsureProjectDocuments(project.key).catch(() => {});
    }
  });
  tasknerveSyncHiddenSidebarRows(hiddenRows);
  document.querySelectorAll("[data-tasknerve-project-tree]").forEach((container) => {
    const projectKey = container.getAttribute("data-tasknerve-project-tree") || "";
    if (!seen.has(projectKey)) {
      container.remove();
    }
  });
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

function tasknerveProjectSnapshot(projectKey = tasknerveState.selectedProject) {
  if (!projectKey) {
    return tasknerveState.snapshot;
  }
  if (tasknerveState.snapshot?.selected_project?.key === projectKey) {
    return tasknerveState.snapshot;
  }
  return tasknerveState.projectSnapshots?.[projectKey] || null;
}

function tasknerveProjectCard(projectKey) {
  if (!projectKey) {
    return null;
  }
  return Array.from(document.querySelectorAll("[data-tasknerve-project-card]")).find(
    (card) => card.getAttribute("data-tasknerve-project-card") === projectKey,
  ) || null;
}

function tasknerveProjectCardField(projectKey, field) {
  return tasknerveProjectCard(projectKey)?.querySelector(`[data-tasknerve-setting="${field}"]`) || null;
}

function tasknerveProjectCardNativeField(projectKey, field) {
  return tasknerveProjectCard(projectKey)?.querySelector(`[data-tasknerve-native-setting="${field}"]`) || null;
}

function tasknerveProjectRecord(projectKey = tasknerveState.selectedProject) {
  const projects = Array.isArray(tasknerveState.snapshot?.projects) ? tasknerveState.snapshot.projects : [];
  return projects.find((project) => project?.key === projectKey) || null;
}

function tasknerveProjectName(projectKey = tasknerveState.selectedProject) {
  const project = tasknerveProjectRecord(projectKey);
  return project?.name || project?.key || "project";
}

function tasknerveProjectRoot(projectKey = tasknerveState.selectedProject) {
  const project = tasknerveProjectRecord(projectKey);
  return project?.repo_root || "";
}

function tasknerveProjectDocumentDescriptor(docKey) {
  return TASKNERVE_PROJECT_DOCUMENTS.find((doc) => doc.key === docKey) || null;
}

function tasknerveDocumentStatusText() {
  const documentState = tasknerveState.documentEditor;
  if (documentState.loading) {
    return "Loading document…";
  }
  if (documentState.saving) {
    return "Autosaving…";
  }
  if (documentState.error) {
    return documentState.error;
  }
  if (documentState.dirty) {
    return "Unsaved changes";
  }
  if (documentState.lastSavedAt) {
    return `Saved ${new Date(documentState.lastSavedAt).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    })}`;
  }
  return "Autosave on";
}

function tasknerveCurrentHeartbeatTemplate(projectKey = tasknerveState.selectedProject) {
  const fieldValue = tasknerveProjectCardField(projectKey, "heartbeat_message_core")?.value;
  return (
    fieldValue ||
    tasknerveProjectCodexSettings(tasknerveProjectSnapshot(projectKey))?.heartbeat_message_core ||
    TASKNERVE_DEFAULT_HEARTBEAT
  );
}

function tasknerveSetPanelMode(mode) {
  tasknerveState.panelMode =
    mode === "tasks" ? "tasks" : mode === "document" ? "document" : "settings";
  const root = tasknerveById(TASKNERVE_PANEL_ID);
  const button = tasknerveById("tasknerveSettingsButton");
  const searchRow = tasknerveById("tasknerveTaskSearchRow");
  const taskBody = tasknerveById("tasknerveTaskBody");
  const settingsPage = tasknerveById("tasknerveSettingsPage");
  const documentPage = tasknerveById("tasknerveDocumentPage");
  const selectedProject = tasknerveProjectSnapshot(tasknerveState.selectedProject);
  if (root) {
    root.classList.toggle("tasknerve-mode-settings", tasknerveState.panelMode === "settings");
    root.classList.toggle("tasknerve-mode-tasks", tasknerveState.panelMode === "tasks");
    root.classList.toggle("tasknerve-mode-document", tasknerveState.panelMode === "document");
  }
  if (button) {
    button.classList.toggle("tasknerve-active", tasknerveState.panelMode === "settings");
  }
  if (searchRow) {
    searchRow.hidden = tasknerveState.panelMode !== "tasks";
  }
  if (taskBody) {
    taskBody.hidden = tasknerveState.panelMode !== "tasks";
  }
  if (settingsPage) {
    settingsPage.hidden = tasknerveState.panelMode !== "settings";
  }
  if (documentPage) {
    documentPage.hidden = tasknerveState.panelMode !== "document";
  }
  if (root) {
    root.setAttribute("data-tasknerve-mode", tasknerveState.panelMode);
  }
  if (tasknerveState.panelMode === "tasks" && selectedProject) {
    tasknerveState.selectedProject = selectedProject.selected_project?.key || tasknerveState.selectedProject;
  }
}

function tasknerveSetTaskModalOpen(open) {
  tasknerveState.taskModalOpen = !!open;
  const modal = tasknerveById("tasknerveTaskModal");
  if (!modal) {
    return;
  }
  modal.hidden = !tasknerveState.taskModalOpen;
  modal.setAttribute("aria-hidden", tasknerveState.taskModalOpen ? "false" : "true");
}

function tasknerveOpenTaskModal() {
  tasknerveSetTaskModalOpen(true);
}

function tasknerveCloseTaskModal() {
  tasknerveSetTaskModalOpen(false);
}

function tasknerveShouldPauseRefresh() {
  if (tasknerveState.taskModalOpen && tasknerveState.editorDirty) {
    return true;
  }
  if (tasknerveState.panelMode === "document" && tasknerveState.documentEditor.dirty) {
    return true;
  }
  const root = tasknerveById(TASKNERVE_PANEL_ID);
  const active = document.activeElement;
  if (!root || !active || !root.contains(active)) {
    return false;
  }
  if (active.closest("[data-tasknerve-project-card]")) {
    return true;
  }
  if (active.id === "tasknerveDocumentInput") {
    return true;
  }
  return false;
}

function tasknerveToggleSettings() {
  if (!tasknerveState.panelOpen) {
    void tasknerveOpenPanel(null, "settings");
    return;
  }
  tasknerveSetPanelMode("settings");
  tasknerveLayoutPanel();
  void tasknerveRefreshAllProjectSnapshots();
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
  width: min(980px, calc(100vw - 328px));
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
#${TASKNERVE_PANEL_ID}.tasknerve-mode-tasks .tasknerve-shell {
  width: min(760px, calc(100vw - 328px));
}
#${TASKNERVE_PANEL_ID}.tasknerve-mode-settings .tasknerve-shell {
  width: min(1120px, calc(100vw - 328px));
}
#${TASKNERVE_PANEL_ID}.tasknerve-mode-document .tasknerve-shell {
  width: min(820px, calc(100vw - 328px));
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
  padding: 10px 16px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  background: rgba(255, 255, 255, 0.014);
}
#${TASKNERVE_PANEL_ID} .tasknerve-flash-bar {
  padding: 10px 16px 0;
  background: rgba(255, 255, 255, 0.014);
}
#${TASKNERVE_PANEL_ID} .tasknerve-search-row[hidden] {
  display: none;
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
#${TASKNERVE_PANEL_ID} .tasknerve-content {
  min-height: 0;
  position: relative;
}
#${TASKNERVE_PANEL_ID} .tasknerve-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  min-height: 0;
  height: 100%;
  background: rgba(13, 16, 22, 0.78);
}
#${TASKNERVE_PANEL_ID} .tasknerve-body[hidden] {
  display: none;
}
#${TASKNERVE_PANEL_ID} .tasknerve-main-pane,
#${TASKNERVE_PANEL_ID} .tasknerve-settings-page,
#${TASKNERVE_PANEL_ID} .tasknerve-document-page {
  min-height: 0;
  overflow: auto;
  padding: 14px;
}
#${TASKNERVE_PANEL_ID} .tasknerve-settings-page {
  display: grid;
  gap: 14px;
  background: rgba(13, 16, 22, 0.78);
}
#${TASKNERVE_PANEL_ID} .tasknerve-settings-page[hidden] {
  display: none;
}
#${TASKNERVE_PANEL_ID} .tasknerve-document-page {
  display: grid;
  grid-template-rows: auto 1fr;
  gap: 12px;
  background: rgba(13, 16, 22, 0.78);
}
#${TASKNERVE_PANEL_ID} .tasknerve-document-page[hidden] {
  display: none;
}
#${TASKNERVE_PANEL_ID} .tasknerve-document-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}
#${TASKNERVE_PANEL_ID} .tasknerve-document-shell {
  min-height: 0;
  display: grid;
  grid-template-rows: auto 1fr;
  gap: 10px;
}
#${TASKNERVE_PANEL_ID} .tasknerve-document-status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.07);
  font-size: 11px;
  font-weight: 650;
  color: rgba(214, 223, 235, 0.78);
  white-space: nowrap;
}
#${TASKNERVE_PANEL_ID} .tasknerve-document-editor {
  width: 100%;
  min-height: 0;
  height: 100%;
  resize: none;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(10, 13, 18, 0.96);
  color: rgba(242, 246, 252, 0.98);
  padding: 14px 16px;
  box-sizing: border-box;
  font: 13px/1.7 ui-monospace, SFMono-Regular, SF Mono, Menlo, Monaco, Consolas, monospace;
  outline: none;
  transition: border-color 120ms ease, box-shadow 120ms ease, background 120ms ease;
}
#${TASKNERVE_PANEL_ID} .tasknerve-document-editor:focus {
  border-color: rgba(117, 168, 255, 0.78);
  box-shadow: 0 0 0 3px rgba(90, 146, 255, 0.17);
  background: rgba(10, 13, 18, 0.985);
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
#${TASKNERVE_PANEL_ID} .tasknerve-settings-head,
#${TASKNERVE_PANEL_ID} .tasknerve-project-card-head {
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
#${TASKNERVE_PANEL_ID} .tasknerve-button.icon {
  width: 34px;
  height: 34px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
#${TASKNERVE_PANEL_ID} .tasknerve-button.icon svg {
  width: 15px;
  height: 15px;
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
#${TASKNERVE_PANEL_ID} .tasknerve-task-card.tasknerve-done {
  opacity: 0.72;
}
#${TASKNERVE_PANEL_ID} .tasknerve-task-head,
#${TASKNERVE_PANEL_ID} .tasknerve-card-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}
#${TASKNERVE_PANEL_ID} .tasknerve-task-head-main {
  min-width: 0;
}
#${TASKNERVE_PANEL_ID} .tasknerve-task-head-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
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
#${TASKNERVE_PANEL_ID} .tasknerve-editor-form {
  display: grid;
  gap: 10px;
}
#${TASKNERVE_PANEL_ID} .tasknerve-editor-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
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
#${TASKNERVE_PANEL_ID} .tasknerve-empty {
  padding: 14px;
  border-radius: 12px;
  border: 1px dashed rgba(255, 255, 255, 0.11);
  background: rgba(255, 255, 255, 0.018);
}
#${TASKNERVE_PANEL_ID} .tasknerve-settings-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  padding: 4px 2px;
}
#${TASKNERVE_PANEL_ID} .tasknerve-settings-copy {
  font-size: 12px;
  line-height: 1.55;
  color: rgba(214, 223, 235, 0.7);
}
#${TASKNERVE_PANEL_ID} .tasknerve-settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
#${TASKNERVE_PANEL_ID} .tasknerve-project-card {
  padding: 14px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.022);
  border: 1px solid rgba(255, 255, 255, 0.05);
  display: grid;
  gap: 12px;
}
#${TASKNERVE_PANEL_ID} .tasknerve-project-card-head {
  align-items: center;
}
#${TASKNERVE_PANEL_ID} .tasknerve-project-card-title {
  margin: 0;
  font-size: 16px;
  font-weight: 650;
  letter-spacing: -0.02em;
}
#${TASKNERVE_PANEL_ID} .tasknerve-project-card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}
#${TASKNERVE_PANEL_ID} .tasknerve-project-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
#${TASKNERVE_PANEL_ID} .tasknerve-project-stat {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.036);
  border: 1px solid rgba(255, 255, 255, 0.06);
  font-size: 12px;
  color: rgba(232, 239, 248, 0.88);
}
#${TASKNERVE_PANEL_ID} .tasknerve-project-settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
#${TASKNERVE_PANEL_ID} .tasknerve-project-settings-grid .tasknerve-field.full {
  grid-column: 1 / -1;
}
#${TASKNERVE_PANEL_ID} .tasknerve-section-divider {
  margin-top: 4px;
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}
#${TASKNERVE_PANEL_ID} .tasknerve-modal {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 18px;
  background: rgba(7, 10, 14, 0.72);
  backdrop-filter: blur(6px);
}
#${TASKNERVE_PANEL_ID} .tasknerve-modal[hidden] {
  display: none;
}
#${TASKNERVE_PANEL_ID} .tasknerve-modal-card {
  width: min(720px, calc(100vw - 64px));
  max-height: calc(100vh - 80px);
  overflow: auto;
  padding: 16px;
  border-radius: 16px;
  background: rgba(20, 24, 30, 0.99);
  border: 1px solid rgba(255, 255, 255, 0.07);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.38);
}
#${TASKNERVE_PANEL_ID} .tasknerve-modal-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
#${TASKNERVE_PANEL_ID} .tasknerve-modal-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
#${TASKNERVE_NAV_ID}.tasknerve-active {
  background: rgba(255, 255, 255, 0.08) !important;
}
#${TASKNERVE_PANEL_ID} .tasknerve-sidebar-docs,
[data-tasknerve-project-tree] {
  display: grid;
  gap: 2px;
  margin: 2px 0 6px;
}
.tasknerve-sidebar-folder,
.tasknerve-sidebar-thread,
.tasknerve-sidebar-doc {
  appearance: none;
  border: 0;
  background: transparent;
  color: rgba(231, 236, 244, 0.86);
  display: grid;
  grid-template-columns: 12px 16px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 34px;
  padding: 0 10px 0 28px;
  border-radius: 10px;
  font: inherit;
  cursor: pointer;
  text-align: left;
}
.tasknerve-sidebar-doc {
  grid-template-columns: 12px 16px minmax(0, 1fr) auto;
}
.tasknerve-sidebar-folder:hover,
.tasknerve-sidebar-folder:focus-visible,
.tasknerve-sidebar-thread:hover,
.tasknerve-sidebar-thread:focus-visible,
.tasknerve-sidebar-doc:hover,
.tasknerve-sidebar-doc:focus-visible {
  background: rgba(255, 255, 255, 0.06);
  outline: none;
}
.tasknerve-sidebar-thread.tasknerve-active,
.tasknerve-sidebar-doc.tasknerve-active {
  background: rgba(86, 126, 210, 0.18);
}
.tasknerve-sidebar-folder {
  color: rgba(214, 220, 230, 0.9);
}
.tasknerve-sidebar-thread.tasknerve-empty {
  cursor: default;
  opacity: 0.58;
}
.tasknerve-sidebar-chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: rgba(176, 186, 202, 0.7);
  font-size: 11px;
}
.tasknerve-sidebar-folder-icon,
.tasknerve-sidebar-folder-icon svg,
.tasknerve-sidebar-thread-icon,
.tasknerve-sidebar-thread-icon svg,
.tasknerve-sidebar-doc-icon,
.tasknerve-sidebar-doc-icon svg {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.tasknerve-sidebar-folder-icon svg,
.tasknerve-sidebar-thread-icon svg,
.tasknerve-sidebar-doc-icon svg {
  width: 14px;
  height: 14px;
}
.tasknerve-sidebar-folder-icon,
.tasknerve-sidebar-thread-icon,
.tasknerve-sidebar-doc-icon {
  grid-column: 2;
}
.tasknerve-sidebar-folder-label,
.tasknerve-sidebar-thread-label,
.tasknerve-sidebar-doc-label {
  grid-column: 3;
}
.tasknerve-sidebar-folder-count,
.tasknerve-sidebar-thread-meta {
  grid-column: 4;
}
.tasknerve-sidebar-folder-label,
.tasknerve-sidebar-thread-label,
.tasknerve-sidebar-doc-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: rgba(220, 226, 236, 0.82);
}
.tasknerve-sidebar-folder-label {
  font-size: 12px;
  letter-spacing: 0.01em;
}
.tasknerve-sidebar-folder-count,
.tasknerve-sidebar-thread-meta {
  font-size: 12px;
  color: rgba(165, 175, 191, 0.7);
}
.tasknerve-sidebar-folder-count {
  min-width: 18px;
  text-align: right;
}
.tasknerve-sidebar-folder-children {
  display: grid;
  gap: 2px;
}
.tasknerve-sidebar-folder-children .tasknerve-sidebar-thread,
.tasknerve-sidebar-folder-children .tasknerve-sidebar-doc {
  padding-left: 48px;
}
#${TASKNERVE_BRANCH_CHIP_ID} {
  position: relative;
}
#${TASKNERVE_RESOURCE_CHIP_ID} {
  margin-right: 8px;
}
#${TASKNERVE_RESOURCE_CHIP_ID} .tasknerve-resource-chip-inner {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
#${TASKNERVE_RESOURCE_CHIP_ID} .tasknerve-resource-pair {
  font-size: 12px;
  color: rgba(220, 228, 238, 0.88);
  white-space: nowrap;
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
#${TASKNERVE_TOPBAR_TASK_CHIP_ID} {
  position: relative;
  color: rgba(245, 247, 250, 0.96) !important;
}
#${TASKNERVE_TOPBAR_TASK_CHIP_ID} .tasknerve-topbar-task-inner {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
#${TASKNERVE_TOPBAR_TASK_CHIP_ID} .tasknerve-topbar-task-count {
  font-size: 16px;
  font-weight: 700;
  color: rgba(244, 247, 252, 0.98);
}
#${TASKNERVE_TOPBAR_TASK_CHIP_ID} .tasknerve-topbar-task-label {
  font-size: 12px;
  font-weight: 600;
  color: rgba(214, 223, 235, 0.72);
  white-space: nowrap;
}
#${TASKNERVE_TOPBAR_TASK_CHIP_ID} [style*="color"],
#${TASKNERVE_TOPBAR_TASK_CHIP_ID} .text-green-500,
#${TASKNERVE_TOPBAR_TASK_CHIP_ID} .text-red-500,
#${TASKNERVE_TOPBAR_TASK_CHIP_ID} .text-success,
#${TASKNERVE_TOPBAR_TASK_CHIP_ID} .text-danger {
  color: inherit !important;
}
#${TASKNERVE_TERMINAL_TOGGLE_ID} {
  position: fixed !important;
  top: auto !important;
  left: auto !important;
  right: 18px !important;
  bottom: 18px !important;
  z-index: 2147483588 !important;
  margin: 0 !important;
}
#${TASKNERVE_TERMINAL_TOGGLE_ID}.tasknerve-terminal-stacked {
  bottom: 70px !important;
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
  #${TASKNERVE_PANEL_ID} .tasknerve-settings-grid,
  #${TASKNERVE_PANEL_ID} .tasknerve-project-settings-grid,
  #${TASKNERVE_PANEL_ID} .tasknerve-editor-grid {
    grid-template-columns: 1fr;
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
  #${TASKNERVE_PANEL_ID} .tasknerve-settings-page {
    padding-left: 14px;
    padding-right: 14px;
  }
  #${TASKNERVE_PANEL_ID} .tasknerve-search-controls {
    grid-template-columns: 1fr;
  }
  #${TASKNERVE_PANEL_ID} .tasknerve-modal {
    padding: 10px;
  }
  #${TASKNERVE_PANEL_ID} .tasknerve-modal-card {
    width: calc(100vw - 24px);
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
      <div class="tasknerve-flash-bar">
        <div class="tasknerve-flash" id="tasknerveFlash" hidden></div>
      </div>
      <div class="tasknerve-search-row" id="tasknerveTaskSearchRow">
        <div class="tasknerve-search-controls">
          <input class="tasknerve-input" id="tasknerveTaskSearchInput" type="text" placeholder="Search tasks by title, detail, tag, or task id" />
          <button type="button" class="tasknerve-button primary" id="tasknerveNewTaskButton">Add new task</button>
        </div>
      </div>
      <div class="tasknerve-content">
        <div class="tasknerve-body" id="tasknerveTaskBody">
          <section class="tasknerve-main-pane">
            <div class="tasknerve-section-header">
              <div class="tasknerve-muted" id="tasknerveTaskCountMeta">Loading queue…</div>
            </div>
            <div class="tasknerve-empty" id="tasknerveTaskEmpty" hidden></div>
            <div class="tasknerve-list" id="tasknerveTaskList"></div>
          </section>
        </div>
        <section class="tasknerve-settings-page" id="tasknerveSettingsPage" hidden></section>
        <section class="tasknerve-document-page" id="tasknerveDocumentPage" hidden>
          <div class="tasknerve-document-head">
            <div>
              <div class="tasknerve-strip-label" id="tasknerveDocumentProjectLabel">Project document</div>
              <h2 class="tasknerve-section-title" id="tasknerveDocumentTitle">project_goals.md</h2>
              <div class="tasknerve-muted" id="tasknerveDocumentMeta">Autosave on.</div>
            </div>
            <div class="tasknerve-document-status" id="tasknerveDocumentStatus">Loading document…</div>
          </div>
          <div class="tasknerve-document-shell">
            <textarea
              class="tasknerve-document-editor"
              id="tasknerveDocumentInput"
              spellcheck="false"
              placeholder="Loading document…"
            ></textarea>
          </div>
        </section>
        <div class="tasknerve-modal" id="tasknerveTaskModal" hidden aria-hidden="true">
          <div class="tasknerve-modal-card" role="dialog" aria-modal="true" aria-labelledby="tasknerveEditorTitle">
            <div class="tasknerve-modal-head">
              <div>
                <h2 class="tasknerve-section-title" id="tasknerveEditorTitle">New task</h2>
                <div class="tasknerve-muted" id="tasknerveEditorMeta">Create a task or select one from the list to edit it.</div>
              </div>
              <button type="button" class="tasknerve-button ghost icon" id="tasknerveCloseTaskModalButton" aria-label="Close task editor">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M6 6l12 12"></path>
                  <path d="M18 6l-12 12"></path>
                </svg>
              </button>
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
              <div class="tasknerve-modal-actions">
                <button type="submit" class="tasknerve-button primary" id="tasknerveSaveTaskButton">Create task</button>
                <button type="button" class="tasknerve-button ghost" id="tasknerveBlankTaskButton">New blank</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  tasknerveById("tasknerveSettingsButton").addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!tasknerveState.panelOpen) {
      void tasknerveOpenPanel(event, "settings");
      return;
    }
    tasknerveSetPanelMode("settings");
    tasknerveLayoutPanel();
    void tasknerveRefreshAllProjectSnapshots();
  });
  tasknerveById("tasknerveProjectSelect").addEventListener("change", (event) => {
    tasknerveState.selectedProject = event.target.value || null;
    if (tasknerveState.selectedProject) {
      tasknerveWriteStorage(TASKNERVE_STORAGE_PROJECT_KEY, tasknerveState.selectedProject);
    }
    tasknerveState.editingTaskId = null;
    tasknerveState.editorDirty = false;
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
  tasknerveById("tasknerveBlankTaskButton").addEventListener("click", () => {
    tasknerveBeginCreateTask();
  });
  tasknerveById("tasknerveCloseTaskModalButton").addEventListener("click", () => {
    tasknerveCloseTaskModal();
  });
  tasknerveById("tasknerveTaskModal").addEventListener("click", (event) => {
    if (event.target === tasknerveById("tasknerveTaskModal")) {
      tasknerveCloseTaskModal();
    }
  });
  tasknerveById("tasknerveDocumentInput").addEventListener("input", (event) => {
    tasknerveUpdateDocumentDraft(event.target.value || "");
  });
  tasknerveById("tasknerveDocumentInput").addEventListener("blur", () => {
    void tasknerveFlushDocumentAutosave();
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
    if (tasknerveState.taskModalOpen) {
      tasknerveCloseTaskModal();
      return;
    }
    tasknerveClosePanel();
  });

  tasknerveState.editingTaskId = null;
  tasknervePopulateEditor(null);
  tasknerveCloseTaskModal();
  tasknerveSetPanelMode(tasknerveState.panelMode);
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

function tasknerveFindTopbarCommitControls() {
  return Array.from(
    document.querySelectorAll("button,[role='button'],a,div.cursor-interaction"),
  ).filter((node) => {
    if (
      node.id === TASKNERVE_NAV_ID ||
      node.id === TASKNERVE_BRANCH_CHIP_ID ||
      node.id === TASKNERVE_TOPBAR_TASK_CHIP_ID ||
      node.closest(`#${TASKNERVE_PANEL_ID}`)
    ) {
      return false;
    }
    const rect = node.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return false;
    }
    if (rect.top > 140 || rect.right < window.innerWidth * 0.45) {
      return false;
    }
    const text = tasknerveNormalizeText(node.textContent).toLowerCase();
    return text === "commit" || text.startsWith("commit ") || text.startsWith("push ");
  });
}

function tasknerveHideCommitControls() {
  const controls = tasknerveFindTopbarCommitControls();
  controls.forEach((node) => {
    if (node.dataset.tasknerveCommitHidden === "true") {
      return;
    }
    node.dataset.tasknerveCommitHidden = "true";
    node.style.display = "none";
    const parent = node.parentElement;
    if (!parent) {
      return;
    }
    Array.from(parent.children).forEach((sibling) => {
      if (sibling === node || sibling.dataset.tasknerveDividerHidden === "true") {
        return;
      }
      const rect = sibling.getBoundingClientRect();
      const nodeRect = node.getBoundingClientRect();
      const text = tasknerveNormalizeText(sibling.textContent);
      if (!text && rect.height > 10 && rect.width <= 6 && Math.abs(rect.left - nodeRect.right) <= 20) {
        sibling.dataset.tasknerveDividerHidden = "true";
        sibling.style.display = "none";
      }
    });
  });
}

function tasknerveFindTopbarTaskChipCandidate() {
  const existing = tasknerveById(TASKNERVE_TOPBAR_TASK_CHIP_ID);
  if (existing) {
    return existing;
  }
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
      if (rect.top > 140 || rect.right < window.innerWidth * 0.55) {
        return false;
      }
      const text = tasknerveNormalizeText(node.textContent);
      return /[+]\s?\d[\d,]*/.test(text) && /[-−]\s?\d[\d,]*/.test(text);
    })
    .sort((left, right) => left.getBoundingClientRect().left - right.getBoundingClientRect().left);
  return candidates[0] || null;
}

function tasknerveFindTerminalToggleCandidate() {
  const existing = tasknerveById(TASKNERVE_TERMINAL_TOGGLE_ID);
  if (existing) {
    return existing;
  }
  const candidates = Array.from(
    document.querySelectorAll("button,[role='button'],a,div.cursor-interaction"),
  ).filter((node) => {
    if (
      node.id === TASKNERVE_NAV_ID ||
      node.id === TASKNERVE_BRANCH_CHIP_ID ||
      node.id === TASKNERVE_TOPBAR_TASK_CHIP_ID ||
      node.closest(`#${TASKNERVE_PANEL_ID}`)
    ) {
      return false;
    }
    const rect = node.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return false;
    }
    if (rect.top > 140 || rect.right < window.innerWidth * 0.35) {
      return false;
    }
    const label = [
      node.getAttribute("aria-label"),
      node.getAttribute("title"),
      node.getAttribute("data-tooltip"),
      node.textContent,
    ]
      .filter(Boolean)
      .map((value) => tasknerveNormalizeText(value).toLowerCase())
      .join(" ");
    return label.includes("terminal");
  });
  return candidates[0] || null;
}

function tasknerveEnsureTerminalTogglePosition(snapshot) {
  const button = tasknerveFindTerminalToggleCandidate();
  if (!button) {
    return;
  }
  button.id = TASKNERVE_TERMINAL_TOGGLE_ID;
  button.style.position = "fixed";
  button.style.left = "auto";
  button.style.top = "auto";
  button.style.right = "18px";
  button.style.bottom = "18px";
  button.style.zIndex = "2147483588";
  button.style.margin = "0";
  const branchChip = tasknerveFindFooterBranchChip(snapshot);
  if (branchChip) {
    const branchRect = branchChip.getBoundingClientRect();
    const overlapLikely = branchRect.bottom > window.innerHeight - 140;
    button.classList.toggle("tasknerve-terminal-stacked", overlapLikely);
  } else {
    button.classList.remove("tasknerve-terminal-stacked");
  }
}

function tasknerveOpenTaskListPanel(event) {
  return tasknerveTogglePanel(event, "tasks");
}

function tasknerveEnsureTopbarTaskChip(snapshot) {
  if (!snapshot) {
    return;
  }
  tasknerveHideCommitControls();
  const chip = tasknerveFindTopbarTaskChipCandidate();
  if (!chip) {
    return;
  }
  const remaining = tasknerveRemainingTaskCount(snapshot);
  chip.id = TASKNERVE_TOPBAR_TASK_CHIP_ID;
  chip.setAttribute("aria-label", "Open TaskNerve project task list");
  chip.title = `${remaining} TaskNerve task${remaining === 1 ? "" : "s"} left in this project`;
  chip.innerHTML = "";
  const inner = document.createElement("span");
  inner.className = "tasknerve-topbar-task-inner";
  const count = document.createElement("span");
  count.className = "tasknerve-topbar-task-count";
  count.textContent = String(remaining);
  inner.appendChild(count);
  const label = document.createElement("span");
  label.className = "tasknerve-topbar-task-label";
  label.textContent = remaining === 1 ? "task left" : "tasks left";
  inner.appendChild(label);
  chip.appendChild(inner);
  if (!chip.dataset.tasknerveTaskChipBound) {
    chip.dataset.tasknerveTaskChipBound = "true";
    chip.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        void tasknerveOpenTaskListPanel(event);
      },
      true,
    );
    chip.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          void tasknerveOpenTaskListPanel(event);
        }
      },
      true,
    );
  }
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

function tasknerveMetricPercentText(label, value) {
  if (!Number.isFinite(Number(value))) {
    return `${label} --`;
  }
  return `${label} ${Math.max(0, Math.min(100, Math.round(Number(value))))}%`;
}

function tasknerveEnsureResourceChip(snapshot) {
  const branchChip = tasknerveFindFooterBranchChip(snapshot);
  if (!branchChip || !branchChip.parentElement) {
    return;
  }
  let chip = tasknerveById(TASKNERVE_RESOURCE_CHIP_ID);
  if (!chip) {
    chip = branchChip.cloneNode(false);
    chip.id = TASKNERVE_RESOURCE_CHIP_ID;
    chip.setAttribute("aria-label", "TaskNerve system resources");
    chip.setAttribute("role", "status");
    chip.classList.add("tasknerve-resource-chip");
    branchChip.insertAdjacentElement("beforebegin", chip);
  } else if (chip.nextElementSibling !== branchChip) {
    branchChip.insertAdjacentElement("beforebegin", chip);
  }
  const monitor = tasknerveState.resourceMonitor || {};
  chip.title = monitor.recommendedWorkerCap && monitor.maxWorkers
    ? `CPU ${tasknerveMetricPercentText("", monitor.cpuPercent).trim()} | GPU ${tasknerveMetricPercentText("", monitor.gpuPercent).trim()} | Recommended workers ${monitor.recommendedWorkerCap}/${monitor.maxWorkers}`
    : "TaskNerve system resources";
  chip.innerHTML = `
    <span class="tasknerve-resource-chip-inner">
      <span class="tasknerve-resource-pair">${tasknerveEscapeHtml(tasknerveMetricPercentText("CPU", monitor.cpuPercent))}</span>
      <span class="tasknerve-resource-pair">${tasknerveEscapeHtml(tasknerveMetricPercentText("GPU", monitor.gpuPercent))}</span>
    </span>
  `;
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
  tasknerveEnsureResourceChip(snapshot);
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

async function tasknerveFetchNativeJson(path, payload) {
  const origin = tasknerveNativeBridgeOrigin();
  if (!origin || origin.includes("__TASKNERVE_NATIVE_BRIDGE_URL__")) {
    throw new Error("TaskNerve native bridge is unavailable");
  }
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    mode: "cors",
    body: JSON.stringify(payload || {}),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (_error) {
    body = null;
  }
  if (!response.ok) {
    throw new Error(body?.error || text || `HTTP ${response.status}`);
  }
  if (body && body.ok === false) {
    throw new Error(body.error || "TaskNerve native bridge request failed");
  }
  return body;
}

async function tasknerveFetchNativeGetJson(path, params) {
  const origin = tasknerveNativeBridgeOrigin();
  if (!origin || origin.includes("__TASKNERVE_NATIVE_BRIDGE_URL__")) {
    throw new Error("TaskNerve native bridge is unavailable");
  }
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value != null && value !== "") {
      query.set(key, String(value));
    }
  });
  const response = await fetch(`${origin}${path}?${query.toString()}`, {
    cache: "no-store",
    mode: "cors",
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (_error) {
    body = null;
  }
  if (!response.ok) {
    throw new Error(body?.error || text || `HTTP ${response.status}`);
  }
  if (body && body.ok === false) {
    throw new Error(body.error || "TaskNerve native bridge request failed");
  }
  return body;
}

function tasknerveBase64Encode(value) {
  const bytes = new TextEncoder().encode(String(value || ""));
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return window.btoa(binary);
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

function tasknerveProjectFromWindowContext(hostContext = tasknerveState.hostContext) {
  const candidates = [];
  if (hostContext?.window_url) {
    candidates.push(hostContext.window_url);
  }
  if (typeof window !== "undefined" && window.location?.href) {
    candidates.push(window.location.href);
  }
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate, window.location.origin);
      const projectKey = tasknerveNormalizeText(url.searchParams.get("tasknerveProject") || "");
      if (projectKey) {
        return projectKey;
      }
    } catch (_error) {}
  }
  return "";
}

function tasknerveThreadIdFromWindowContext(hostContext = tasknerveState.hostContext) {
  const candidates = [];
  if (typeof window !== "undefined" && window.location?.href) {
    candidates.push(window.location.href);
  }
  if (hostContext?.window_url) {
    candidates.push(hostContext.window_url);
  }
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate, window.location.origin);
      const match = String(url.pathname || "").match(/^\/local\/([^/?#]+)/);
      if (match && match[1]) {
        return decodeURIComponent(match[1]);
      }
    } catch (_error) {}
  }
  return tasknerveNormalizeText(hostContext?.active_thread_id || "");
}

function tasknerveProjectWindowThread(snapshot) {
  const controller = tasknerveControllerBinding(snapshot);
  if (controller?.thread_id) {
    return controller;
  }
  return tasknerveDiscoveredThreads(snapshot)
    .filter((thread) => thread?.thread_id)
    .sort(
      (left, right) =>
        Number(right?.updated_at_unix_seconds || 0) - Number(left?.updated_at_unix_seconds || 0),
    )[0] || null;
}

async function tasknerveFetchProjectNativePrefs(projectKey = tasknerveState.selectedProject) {
  const projectRoot = tasknerveProjectRoot(projectKey);
  if (!projectRoot) {
    return null;
  }
  const payload = await tasknerveFetchNativeGetJson("/tasknerve/project/native-settings", {
    project_root: projectRoot,
    project_name: tasknerveProjectName(projectKey),
  });
  const settings = payload?.settings || {};
  const normalized = {
    resourceAwareWorkers: settings.resource_aware_workers !== false,
    maxActiveWorkers: Number(settings.max_active_workers || 0) > 0 ? Number(settings.max_active_workers) : 4,
    traceCollectionEnabled: Boolean(settings.trace_collection_enabled),
    traceAutoCaptureEnabled: settings.trace_auto_capture_enabled !== false,
    traceCaptureIntervalSeconds:
      Number(settings.trace_capture_interval_seconds || 0) > 0
        ? Number(settings.trace_capture_interval_seconds)
        : 120,
    traceLastCaptureAtUtc: settings.trace_last_capture_at_utc || null,
    traceLastCaptureId: settings.trace_last_capture_id || null,
    traceRoot: payload?.trace_root || "",
  };
  tasknerveSetNativeProjectPrefs(projectKey, normalized);
  return normalized;
}

async function tasknervePersistProjectNativePrefs(projectKey = tasknerveState.selectedProject, prefs = {}) {
  const projectRoot = tasknerveProjectRoot(projectKey);
  if (!projectRoot) {
    return null;
  }
  const payload = await tasknerveFetchNativeJson("/tasknerve/project/native-settings", {
    project_root: projectRoot,
    project_name: tasknerveProjectName(projectKey),
    settings: {
      resource_aware_workers: prefs.resourceAwareWorkers !== false,
      max_active_workers:
        Number(prefs.maxActiveWorkers || 0) > 0 ? Math.max(1, Math.floor(Number(prefs.maxActiveWorkers))) : 4,
      trace_collection_enabled: Boolean(prefs.traceCollectionEnabled),
      trace_auto_capture_enabled: prefs.traceAutoCaptureEnabled !== false,
      trace_capture_interval_seconds:
        Number(prefs.traceCaptureIntervalSeconds || 0) > 0
          ? Math.max(15, Math.floor(Number(prefs.traceCaptureIntervalSeconds)))
          : 120,
      trace_last_capture_at_utc: prefs.traceLastCaptureAtUtc || null,
      trace_last_capture_id: prefs.traceLastCaptureId || null,
    },
  });
  return tasknerveFetchProjectNativePrefs(projectKey).catch(() => payload);
}

async function tasknerveOpenProjectWindow(projectKey = tasknerveState.selectedProject) {
  if (!projectKey) {
    return;
  }
  const snapshot = tasknerveProjectSnapshot(projectKey);
  const project = tasknerveProjectRecord(projectKey);
  const preferredThread = tasknerveProjectWindowThread(snapshot);
  try {
    await tasknerveFetchNativeJson("/tasknerve/window/open-project", {
      project_key: projectKey,
      project_name: project?.name || projectKey,
      thread_id: preferredThread?.thread_id || null,
      title: project?.name
        ? `${project.name} · Codex TaskNerve`
        : `Codex TaskNerve · ${projectKey}`,
    });
    tasknerveSetFlash(`Opened a new project window for ${project?.name || projectKey}.`, "info");
  } catch (error) {
    tasknerveSetFlash(`Project window open failed: ${error}`, "error");
  }
}

function tasknerveTraceStatusText(projectKey = tasknerveState.selectedProject) {
  const prefs = tasknerveNativeProjectPrefs(projectKey);
  if (!prefs.traceCollectionEnabled) {
    return "Trace capture is off for this project.";
  }
  const lastStamp = prefs.traceLastCaptureAtUtc
    ? new Date(prefs.traceLastCaptureAtUtc).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "never";
  return `Trace root: ${prefs.traceRoot || ".tasknerve/codex/traces"} • last capture ${lastStamp}`;
}

async function tasknerveCaptureProjectTrace(projectKey = tasknerveState.selectedProject, reason = "manual", force = false) {
  const prefs = tasknerveNativeProjectPrefs(projectKey);
  if (!prefs.traceCollectionEnabled && !force) {
    return null;
  }
  const snapshot = tasknerveProjectSnapshot(projectKey);
  if (!snapshot) {
    return null;
  }
  const payload = await tasknerveFetchNativeJson("/tasknerve/project/trace/capture", {
    project_root: tasknerveProjectRoot(projectKey),
    project_name: tasknerveProjectName(projectKey),
    reason,
    timeline: snapshot.timeline || {},
    tasks: tasknerveTasks(snapshot),
    codex_snapshot: snapshot.codex || {},
    project_codex_settings: tasknerveProjectCodexSettings(snapshot),
    native_project_settings: {
      resource_aware_workers: prefs.resourceAwareWorkers !== false,
      max_active_workers: prefs.maxActiveWorkers,
      trace_collection_enabled: prefs.traceCollectionEnabled,
      trace_auto_capture_enabled: prefs.traceAutoCaptureEnabled,
      trace_capture_interval_seconds: prefs.traceCaptureIntervalSeconds,
      trace_last_capture_at_utc: prefs.traceLastCaptureAtUtc || null,
      trace_last_capture_id: prefs.traceLastCaptureId || null,
    },
  });
  if (payload?.settings) {
    tasknerveSetNativeProjectPrefs(projectKey, {
      resourceAwareWorkers: payload.settings.resource_aware_workers !== false,
      maxActiveWorkers: Number(payload.settings.max_active_workers || prefs.maxActiveWorkers || 4),
      traceCollectionEnabled: Boolean(payload.settings.trace_collection_enabled),
      traceAutoCaptureEnabled: payload.settings.trace_auto_capture_enabled !== false,
      traceCaptureIntervalSeconds:
        Number(payload.settings.trace_capture_interval_seconds || prefs.traceCaptureIntervalSeconds || 120),
      traceLastCaptureAtUtc: payload.settings.trace_last_capture_at_utc || null,
      traceLastCaptureId: payload.settings.trace_last_capture_id || null,
      traceRoot: payload.trace_root || prefs.traceRoot || "",
    });
  }
  return payload;
}

async function tasknerveMaybeAutoCaptureTrace(projectKey = tasknerveState.selectedProject, reason = "auto.refresh") {
  const prefs = tasknerveNativeProjectPrefs(projectKey);
  if (!prefs.traceCollectionEnabled || !prefs.traceAutoCaptureEnabled) {
    return null;
  }
  const lastCapture = prefs.traceLastCaptureAtUtc ? new Date(prefs.traceLastCaptureAtUtc).getTime() : 0;
  const intervalMs = Math.max(15, Number(prefs.traceCaptureIntervalSeconds || 120)) * 1000;
  if (lastCapture > 0 && Date.now() - lastCapture < intervalMs) {
    return null;
  }
  try {
    return await tasknerveCaptureProjectTrace(projectKey, reason, false);
  } catch (_error) {
    return null;
  }
}

function tasknerveRequestedWorkerCap(projectKey = tasknerveState.selectedProject) {
  const prefs = tasknerveNativeProjectPrefs(projectKey);
  const configured = Number(prefs.maxActiveWorkers || 0);
  return Number.isFinite(configured) && configured > 0 ? Math.max(1, Math.floor(configured)) : 4;
}

async function tasknerveRefreshResources(projectKey = tasknerveState.selectedProject, forceFresh = false) {
  if (tasknerveState.resourceMonitor.loading) {
    return;
  }
  tasknerveState.resourceMonitor.loading = true;
  try {
    const payload = await tasknerveFetchNativeGetJson("/tasknerve/system/resources", {
      max_workers: tasknerveRequestedWorkerCap(projectKey),
      force_fresh: forceFresh ? "true" : "",
    });
    const resources = payload?.resources || {};
    tasknerveState.resourceMonitor = {
      loading: false,
      cpuPercent: resources.cpu_percent ?? null,
      gpuPercent: resources.gpu_percent ?? null,
      memoryPercent: resources.memory_percent ?? null,
      thermalPressure: resources.thermal_pressure ?? null,
      recommendedWorkerCap: payload?.recommended_worker_cap ?? null,
      maxWorkers: payload?.max_workers ?? tasknerveRequestedWorkerCap(projectKey),
      capturedAtUtc: resources.captured_at_utc ?? null,
    };
  } catch (_error) {
    tasknerveState.resourceMonitor = {
      ...tasknerveState.resourceMonitor,
      loading: false,
    };
  }
  tasknerveEnsureResourceChip(tasknerveState.snapshot);
}

async function tasknerveSyncProjectFromHost() {
  const hostContext = await tasknerveFetchHostContext();
  tasknerveState.hostContext = hostContext;
  const projectFromWindow = tasknerveProjectFromWindowContext(hostContext);
  if (projectFromWindow) {
    tasknerveState.selectedProject = projectFromWindow;
    tasknerveWriteStorage(TASKNERVE_STORAGE_PROJECT_KEY, projectFromWindow);
  }
  const threadId = tasknerveThreadIdFromWindowContext(hostContext);
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
    const snapshot = await tasknerveFetchJson(`/api/tasks${tasknerveProjectQuery()}`);
    tasknerveState.snapshot = snapshot;
    const selectedProject =
      snapshot?.selected_project?.key ||
      tasknerveState.selectedProject ||
      null;
    tasknerveState.selectedProject = selectedProject;
    if (selectedProject) {
      tasknerveState.projectSnapshots[selectedProject] = snapshot;
    }
    if (selectedProject) {
      tasknerveWriteStorage(TASKNERVE_STORAGE_PROJECT_KEY, selectedProject);
    }
    tasknerveRender();
    void tasknerveRefreshResources(selectedProject, false).catch(() => {});
    void tasknerveRefreshAllProjectSnapshots()
      .then(() => {
        return tasknerveRefreshAllNativeProjectPrefs().then(() => {
          const projectsToCapture = Array.isArray(snapshot?.projects) ? snapshot.projects : [];
          projectsToCapture.forEach((project) => {
            if (project?.key) {
              void tasknerveMaybeAutoCaptureTrace(project.key, "auto.refresh");
            }
          });
        });
      })
      .then(() => {
        tasknerveEnsureSidebarProjectDocuments();
      })
      .catch(() => {});
    const projects = Array.isArray(snapshot?.projects) ? snapshot.projects : [];
    projects.forEach((project) => {
      if (project?.key && !tasknerveState.ensuredProjectDocs[project.key]) {
        void tasknerveEnsureProjectDocuments(project.key).catch(() => {});
      }
    });
    if (userInitiated) {
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
  if (tasknerveState.panelOpen && tasknerveState.panelMode === "settings") {
    void tasknerveRefreshAllProjectSnapshots();
  }
}

async function tasknerveRefreshAllProjectSnapshots() {
  const projects = Array.isArray(tasknerveState.snapshot?.projects) ? tasknerveState.snapshot.projects : [];
  if (projects.length === 0) {
    return;
  }
  const nextSnapshots = { ...tasknerveState.projectSnapshots };
  await Promise.all(
    projects.map(async (project) => {
      if (!project?.key) {
        return;
      }
      if (project.key === tasknerveState.snapshot?.selected_project?.key && tasknerveState.snapshot) {
        nextSnapshots[project.key] = tasknerveState.snapshot;
        return;
      }
      try {
        nextSnapshots[project.key] = await tasknerveFetchJson(
          `/api/tasks${tasknerveProjectQuery(project.key)}`,
        );
      } catch (_error) {
        nextSnapshots[project.key] =
          nextSnapshots[project.key] ||
          {
            selected_project: project,
            projects,
            tasks: [],
            codex: {},
            project_codex_settings: {},
          };
      }
    }),
  );
  tasknerveState.projectSnapshots = nextSnapshots;
  if (tasknerveState.panelOpen && tasknerveState.panelMode === "settings") {
    tasknerveRenderSettings(tasknerveState.snapshot);
  }
}

async function tasknerveRefreshAllNativeProjectPrefs() {
  const projects = Array.isArray(tasknerveState.snapshot?.projects) ? tasknerveState.snapshot.projects : [];
  if (projects.length === 0) {
    return;
  }
  await Promise.all(
    projects.map(async (project) => {
      if (!project?.key || !project?.repo_root) {
        return;
      }
      try {
        await tasknerveFetchProjectNativePrefs(project.key);
      } catch (_error) {}
    }),
  );
  if (tasknerveState.panelOpen && tasknerveState.panelMode === "settings") {
    tasknerveRenderSettings(tasknerveState.snapshot);
  }
}

function tasknerveClearDocumentSaveTimer() {
  if (tasknerveState.documentEditor.saveTimer) {
    window.clearTimeout(tasknerveState.documentEditor.saveTimer);
    tasknerveState.documentEditor.saveTimer = null;
  }
}

async function tasknerveEnsureProjectDocuments(projectKey) {
  const projectRoot = tasknerveProjectRoot(projectKey);
  if (!projectRoot) {
    return null;
  }
  if (tasknerveState.ensuredProjectDocs[projectKey]) {
    return tasknerveState.ensuredProjectDocs[projectKey];
  }
  const payload = await tasknerveFetchNativeGetJson("/tasknerve/project/documents/ensure", {
    project_root: projectRoot,
    project_name: tasknerveProjectName(projectKey),
  });
  tasknerveState.ensuredProjectDocs[projectKey] = payload?.documents || [];
  return tasknerveState.ensuredProjectDocs[projectKey];
}

async function tasknerveLoadProjectDocument(projectKey, docKey) {
  const documentState = tasknerveState.documentEditor;
  documentState.loading = true;
  documentState.error = "";
  documentState.projectKey = projectKey;
  documentState.docKey = docKey;
  tasknerveRenderDocumentEditor(true);
  try {
    await tasknerveEnsureProjectDocuments(projectKey);
    const payload = await tasknerveFetchNativeGetJson("/tasknerve/project/document/read", {
      project_root: tasknerveProjectRoot(projectKey),
      project_name: tasknerveProjectName(projectKey),
      doc_key: docKey,
    });
    const documentRecord = payload?.document || {};
    documentState.projectKey = projectKey;
    documentState.docKey = docKey;
    documentState.path = documentRecord.path || null;
    documentState.title = documentRecord.title || tasknerveProjectDocumentDescriptor(docKey)?.title || docKey;
    documentState.label = documentRecord.label || tasknerveProjectDocumentDescriptor(docKey)?.label || docKey;
    documentState.projectName = tasknerveProjectName(projectKey);
    documentState.content = documentRecord.content || "";
    documentState.savedContent = documentRecord.content || "";
    documentState.dirty = false;
    documentState.saving = false;
    documentState.loading = false;
    documentState.lastSavedAt = documentRecord.updated_at || new Date().toISOString();
    documentState.error = "";
  } catch (error) {
    documentState.loading = false;
    documentState.saving = false;
    documentState.error = String(error);
  }
  tasknerveRenderDocumentEditor(true);
}

async function tasknerveSaveProjectDocument() {
  const documentState = tasknerveState.documentEditor;
  if (
    !documentState.projectKey ||
    !documentState.docKey ||
    documentState.loading ||
    documentState.saving ||
    !documentState.dirty
  ) {
    return;
  }
  documentState.saving = true;
  documentState.error = "";
  tasknerveRenderDocumentEditor();
  try {
    const payload = await tasknerveFetchNativeGetJson("/tasknerve/project/document/write", {
      project_root: tasknerveProjectRoot(documentState.projectKey),
      project_name: tasknerveProjectName(documentState.projectKey),
      doc_key: documentState.docKey,
      content_b64: tasknerveBase64Encode(documentState.content),
    });
    documentState.savedContent = documentState.content;
    documentState.dirty = false;
    documentState.saving = false;
    documentState.lastSavedAt = payload?.document?.updated_at || new Date().toISOString();
    documentState.error = "";
    tasknerveSetFlash(`Autosaved ${documentState.label || documentState.docKey}.`, "info");
    void tasknerveMaybeAutoCaptureTrace(documentState.projectKey, "document.save");
  } catch (error) {
    documentState.saving = false;
    documentState.error = `Autosave failed: ${error}`;
    tasknerveSetFlash(documentState.error, "error");
  }
  tasknerveRenderDocumentEditor();
}

function tasknerveScheduleDocumentAutosave() {
  tasknerveClearDocumentSaveTimer();
  if (!tasknerveState.documentEditor.dirty) {
    return;
  }
  tasknerveState.documentEditor.saveTimer = window.setTimeout(() => {
    tasknerveState.documentEditor.saveTimer = null;
    void tasknerveSaveProjectDocument();
  }, TASKNERVE_DOCUMENT_AUTOSAVE_MS);
}

function tasknerveUpdateDocumentDraft(value) {
  const documentState = tasknerveState.documentEditor;
  documentState.content = value;
  documentState.dirty = value !== documentState.savedContent;
  documentState.error = "";
  tasknerveRenderDocumentEditor();
  tasknerveScheduleDocumentAutosave();
}

async function tasknerveFlushDocumentAutosave() {
  tasknerveClearDocumentSaveTimer();
  if (tasknerveState.documentEditor.dirty) {
    await tasknerveSaveProjectDocument();
  }
}

async function tasknerveOpenProjectDocument(event, projectKey, docKey) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  await tasknerveFlushDocumentAutosave();
  tasknerveState.selectedProject = projectKey;
  if (projectKey) {
    tasknerveWriteStorage(TASKNERVE_STORAGE_PROJECT_KEY, projectKey);
  }
  const root = tasknervePanelRoot();
  tasknerveSetPanelMode("document");
  tasknerveState.panelOpen = true;
  root.classList.add("tasknerve-open");
  tasknerveLayoutPanel();
  const nav = tasknerveById(TASKNERVE_NAV_ID);
  if (nav) {
    nav.classList.add("tasknerve-active");
  }
  tasknerveStartPolling();
  tasknerveRenderDocumentEditor(true);
  await tasknerveLoadProjectDocument(projectKey, docKey);
}

function tasknerveRenderDocumentEditor(forceValue = false) {
  const page = tasknerveById("tasknerveDocumentPage");
  const title = tasknerveById("tasknerveDocumentTitle");
  const meta = tasknerveById("tasknerveDocumentMeta");
  const status = tasknerveById("tasknerveDocumentStatus");
  const input = tasknerveById("tasknerveDocumentInput");
  const projectLabel = tasknerveById("tasknerveDocumentProjectLabel");
  if (!page || !title || !meta || !status || !input || !projectLabel) {
    return;
  }
  const documentState = tasknerveState.documentEditor;
  const descriptor = tasknerveProjectDocumentDescriptor(documentState.docKey);
  title.textContent = documentState.label || descriptor?.label || "Project document";
  meta.textContent =
    documentState.path ||
    "Lightweight markdown editor with autosave enabled.";
  status.textContent = tasknerveDocumentStatusText();
  projectLabel.textContent = documentState.projectName
    ? `${documentState.projectName} document`
    : "Project document";
  const nextValue = documentState.content || "";
  if (input.value !== nextValue && (forceValue || document.activeElement !== input)) {
    input.value = nextValue;
  }
  input.placeholder = documentState.loading ? "Loading document…" : "Start writing in markdown…";
  input.disabled = documentState.loading;
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
      return `
        <article class="tasknerve-task-card${selected}${task.status === "done" ? " tasknerve-done" : ""}" data-tasknerve-task-card="${tasknerveEscapeHtml(task.task_id)}">
          <div class="tasknerve-task-head">
            <div class="tasknerve-task-head-main">
              <h3 class="tasknerve-task-title">${tasknerveEscapeHtml(task.title || "(untitled)")}</h3>
              <div class="tasknerve-priority">id ${tasknerveEscapeHtml(task.task_id)} • priority ${tasknerveEscapeHtml(task.priority || 0)}</div>
              <div class="tasknerve-card-meta">claimed by ${tasknerveEscapeHtml(task.claimed_by_agent_id || "none")} • depends on ${tasknerveEscapeHtml(deps || "none")}</div>
              ${routing ? `<div class="tasknerve-card-meta">${tasknerveEscapeHtml(routing)}</div>` : ""}
            </div>
            <div class="tasknerve-task-head-actions">
              <button type="button" class="tasknerve-button ghost icon" data-tasknerve-edit="${tasknerveEscapeHtml(task.task_id)}" aria-label="Edit ${tasknerveEscapeHtml(task.title || task.task_id)}" title="Edit task">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M12 20h9"></path>
                  <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"></path>
                </svg>
              </button>
              <span class="tasknerve-status ${tasknerveStatusClass(task.status)}">${tasknerveEscapeHtml(task.status || "open")}</span>
            </div>
          </div>
          ${detail}
          <div class="tasknerve-state-line">${stateLine}</div>
          <div class="tasknerve-tags">${tags || '<span class="tasknerve-tag">no tags</span>'}</div>
          <div class="tasknerve-card-actions">
            ${approveButton}
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
  tasknerveSetPanelMode("tasks");
  tasknerveOpenTaskModal();
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
  tasknerveSetPanelMode("tasks");
  tasknerveOpenTaskModal();
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

function tasknerveRenderSettings(snapshot) {
  const container = tasknerveById("tasknerveSettingsPage");
  if (!container) {
    return;
  }
  const projects = Array.isArray(snapshot?.projects) ? snapshot.projects : [];
  if (projects.length === 0) {
    container.innerHTML = `
      <div class="tasknerve-empty">
        No TaskNerve projects are registered yet. Add or import a project first, then return here to tune its controller, heartbeat policy, and worker routing.
      </div>
    `;
    return;
  }
  container.innerHTML = `
    <div class="tasknerve-settings-header">
      <div>
        <div class="tasknerve-strip-label">Registered Projects</div>
        <div class="tasknerve-settings-copy">TaskNerve page is now the project control surface. Use the top-right task chip for day-to-day queue work.</div>
      </div>
      <div class="tasknerve-muted">${projects.length} project${projects.length === 1 ? "" : "s"}</div>
    </div>
    <div class="tasknerve-settings-grid">
      ${projects
        .map((project) => {
          const projectSnapshot =
            tasknerveProjectSnapshot(project.key) ||
            {
              selected_project: project,
              tasks: [],
              codex: {},
              project_codex_settings: {},
            };
          const tasks = tasknerveTasks(projectSnapshot);
          const settings = tasknerveProjectCodexSettings(projectSnapshot);
          const nativePrefs = tasknerveNativeProjectPrefs(project.key);
          const controller = tasknerveControllerBinding(projectSnapshot);
          const workers = tasknerveWorkerBindings(projectSnapshot);
          const activeThreads = tasknerveDiscoveredThreads(projectSnapshot);
          const projectName = project.name || project.key || "project";
          const openCount = tasks.filter((task) => task.status === "open").length;
          const claimedCount = tasks.filter((task) => task.status === "claimed").length;
          const doneCount = tasks.filter((task) => task.status === "done").length;
          const lowQueueChecked = settings.low_queue_controller_enabled ? " checked" : "";
          const singleMessageChecked = settings.worker_single_message_mode ? " checked" : "";
          const routingChecked = settings.worker_model_routing_enabled ? " checked" : "";
          const resourceAwareChecked = nativePrefs.resourceAwareWorkers ? " checked" : "";
          const isSelected = tasknerveState.selectedProject === project.key;
          return `
            <article class="tasknerve-project-card" data-tasknerve-project-card="${tasknerveEscapeHtml(project.key)}">
              <div class="tasknerve-project-card-head">
                <div>
                  <h2 class="tasknerve-project-card-title">${tasknerveEscapeHtml(projectName)}</h2>
                  <div class="tasknerve-project-meta">${tasknerveEscapeHtml(project.repo_root || "")}</div>
                </div>
                <div class="tasknerve-project-card-actions">
                  ${isSelected ? '<span class="tasknerve-project-stat">Current project</span>' : ""}
                  <button type="button" class="tasknerve-button ghost" data-tasknerve-open-tasks="${tasknerveEscapeHtml(project.key)}">Open tasks</button>
                </div>
              </div>
              <div class="tasknerve-project-stats">
                <div class="tasknerve-project-stat">${tasknerveEscapeHtml(tasknerveRemainingTaskCount(projectSnapshot))} left</div>
                <div class="tasknerve-project-stat">${tasknerveEscapeHtml(openCount)} open</div>
                <div class="tasknerve-project-stat">${tasknerveEscapeHtml(claimedCount)} claimed</div>
                <div class="tasknerve-project-stat">${tasknerveEscapeHtml(doneCount)} done</div>
                <div class="tasknerve-project-stat">${tasknerveEscapeHtml(workers.length)} workers</div>
                <div class="tasknerve-project-stat">${tasknerveEscapeHtml(activeThreads.length)} active threads</div>
              </div>
              <div class="tasknerve-settings-copy">
                ${tasknerveEscapeHtml(
                  controller
                    ? `Controller ${controller.display_label || controller.thread_id_short || controller.thread_id} is bound for this project.`
                    : "No controller thread is bound yet.",
                )}
              </div>
              <div class="tasknerve-project-settings-grid">
                <label class="tasknerve-field">
                  <span>Git origin URL</span>
                  <input class="tasknerve-input" data-tasknerve-setting="git_origin_url" type="text" value="${tasknerveEscapeHtml(settings.git_origin_url || settings.actual_git_origin_url || "")}" placeholder="https://github.com/org/repo.git" />
                </label>
                <label class="tasknerve-field">
                  <span>Controller default model</span>
                  <input class="tasknerve-input" data-tasknerve-setting="controller_default_model" type="text" value="${tasknerveEscapeHtml(settings.controller_default_model || "")}" placeholder="Optional controller default" />
                </label>
                <label class="tasknerve-field full">
                  <span>Heartbeat core prompt</span>
                  <textarea class="tasknerve-textarea" data-tasknerve-setting="heartbeat_message_core" placeholder="Project heartbeat core prompt">${tasknerveEscapeHtml(settings.heartbeat_message_core || TASKNERVE_DEFAULT_HEARTBEAT)}</textarea>
                </label>
                <label class="tasknerve-field full">
                  <span>Low-queue controller prompt</span>
                  <textarea class="tasknerve-textarea" data-tasknerve-setting="low_queue_controller_prompt" placeholder="Prompt to inject when the queue runs low">${tasknerveEscapeHtml(settings.low_queue_controller_prompt || "")}</textarea>
                </label>
                <label class="tasknerve-check">
                  <input data-tasknerve-setting="low_queue_controller_enabled" type="checkbox"${lowQueueChecked} />
                  <span>Auto-prompt the controller when the task list gets low</span>
                </label>
                <label class="tasknerve-check">
                  <input data-tasknerve-setting="worker_single_message_mode" type="checkbox"${singleMessageChecked} />
                  <span>Single-message worker queue mode</span>
                </label>
                <label class="tasknerve-check">
                  <input data-tasknerve-setting="worker_model_routing_enabled" type="checkbox"${routingChecked} />
                  <span>Enable task-aware worker model routing</span>
                </label>
                <label class="tasknerve-check">
                  <input data-tasknerve-native-setting="resourceAwareWorkers" type="checkbox"${resourceAwareChecked} />
                  <span>Resource-aware worker throttling</span>
                </label>
                <label class="tasknerve-check">
                  <input data-tasknerve-native-setting="traceCollectionEnabled" type="checkbox"${nativePrefs.traceCollectionEnabled ? " checked" : ""} />
                  <span>Collect project traces for training/export</span>
                </label>
                <label class="tasknerve-field">
                  <span>Worker default model</span>
                  <input class="tasknerve-input" data-tasknerve-setting="worker_default_model" type="text" value="${tasknerveEscapeHtml(settings.worker_default_model || "")}" placeholder="Optional worker default" />
                </label>
                <label class="tasknerve-field">
                  <span>Max active workers</span>
                  <input class="tasknerve-input" data-tasknerve-native-setting="maxActiveWorkers" type="number" min="1" step="1" value="${tasknerveEscapeHtml(nativePrefs.maxActiveWorkers || 4)}" />
                </label>
                <label class="tasknerve-field">
                  <span>Trace auto-capture interval (seconds)</span>
                  <input class="tasknerve-input" data-tasknerve-native-setting="traceCaptureIntervalSeconds" type="number" min="15" step="15" value="${tasknerveEscapeHtml(nativePrefs.traceCaptureIntervalSeconds || 120)}" />
                </label>
                <label class="tasknerve-check">
                  <input data-tasknerve-native-setting="traceAutoCaptureEnabled" type="checkbox"${nativePrefs.traceAutoCaptureEnabled ? " checked" : ""} />
                  <span>Auto-capture controller, worker, task, and doc traces</span>
                </label>
                <label class="tasknerve-field">
                  <span>Low intelligence model</span>
                  <input class="tasknerve-input" data-tasknerve-setting="low_intelligence_model" type="text" value="${tasknerveEscapeHtml(settings.low_intelligence_model || "")}" placeholder="Cheap / fast model" />
                </label>
                <label class="tasknerve-field">
                  <span>Medium intelligence model</span>
                  <input class="tasknerve-input" data-tasknerve-setting="medium_intelligence_model" type="text" value="${tasknerveEscapeHtml(settings.medium_intelligence_model || "")}" placeholder="Balanced model" />
                </label>
                <label class="tasknerve-field">
                  <span>High intelligence model</span>
                  <input class="tasknerve-input" data-tasknerve-setting="high_intelligence_model" type="text" value="${tasknerveEscapeHtml(settings.high_intelligence_model || "")}" placeholder="Stronger model" />
                </label>
                <label class="tasknerve-field">
                  <span>Max intelligence model</span>
                  <input class="tasknerve-input" data-tasknerve-setting="max_intelligence_model" type="text" value="${tasknerveEscapeHtml(settings.max_intelligence_model || "")}" placeholder="Best available model" />
                </label>
              </div>
              <div class="tasknerve-settings-copy tasknerve-section-divider">
                ${tasknerveEscapeHtml(tasknerveTraceStatusText(project.key))}
              </div>
              <div class="tasknerve-card-actions tasknerve-section-divider">
                <button type="button" class="tasknerve-button primary" data-tasknerve-project-save="${tasknerveEscapeHtml(project.key)}">Save settings</button>
                <button type="button" class="tasknerve-button ghost" data-tasknerve-project-window="${tasknerveEscapeHtml(project.key)}">Open window</button>
                <button type="button" class="tasknerve-button ghost" data-tasknerve-project-trace-capture="${tasknerveEscapeHtml(project.key)}">Capture traces now</button>
                <button type="button" class="tasknerve-button ghost" data-tasknerve-project-bootstrap="${tasknerveEscapeHtml(project.key)}">${controller ? "Replace controller" : "Create controller"}</button>
                <button type="button" class="tasknerve-button ghost" data-tasknerve-project-adopt="${tasknerveEscapeHtml(project.key)}">Adopt active threads</button>
                <button type="button" class="tasknerve-button ghost" data-tasknerve-project-heartbeat="${tasknerveEscapeHtml(project.key)}">Send heartbeats</button>
              </div>
            </article>
          `;
        })
        .join("")}
    </div>
  `;

  container.querySelectorAll("[data-tasknerve-open-tasks]").forEach((button) => {
    button.addEventListener("click", (event) => {
      const projectKey = button.getAttribute("data-tasknerve-open-tasks") || null;
      if (projectKey) {
        tasknerveState.selectedProject = projectKey;
        tasknerveWriteStorage(TASKNERVE_STORAGE_PROJECT_KEY, projectKey);
      }
      void tasknerveOpenPanel(event, "tasks");
    });
  });
  container.querySelectorAll("[data-tasknerve-project-save]").forEach((button) => {
    button.addEventListener("click", () => {
      void tasknerveSaveSettings(button.getAttribute("data-tasknerve-project-save"));
    });
  });
  container.querySelectorAll("[data-tasknerve-project-window]").forEach((button) => {
    button.addEventListener("click", () => {
      void tasknerveOpenProjectWindow(button.getAttribute("data-tasknerve-project-window"));
    });
  });
  container.querySelectorAll("[data-tasknerve-project-trace-capture]").forEach((button) => {
    button.addEventListener("click", () => {
      const projectKey = button.getAttribute("data-tasknerve-project-trace-capture");
      void (async () => {
        try {
          const payload = await tasknerveCaptureProjectTrace(projectKey, "manual.capture", true);
          if (payload?.capture_id) {
            tasknerveSetFlash(`Saved trace capture ${payload.capture_id}.`, "info");
            tasknerveRenderSettings(tasknerveState.snapshot);
          }
        } catch (error) {
          tasknerveSetFlash(`Trace capture failed: ${error}`, "error");
        }
      })();
    });
  });
  container.querySelectorAll("[data-tasknerve-project-bootstrap]").forEach((button) => {
    button.addEventListener("click", () => {
      void tasknerveBootstrapController(button.getAttribute("data-tasknerve-project-bootstrap"));
    });
  });
  container.querySelectorAll("[data-tasknerve-project-adopt]").forEach((button) => {
    button.addEventListener("click", () => {
      void tasknerveAdoptActiveThreads(button.getAttribute("data-tasknerve-project-adopt"));
    });
  });
  container.querySelectorAll("[data-tasknerve-project-heartbeat]").forEach((button) => {
    button.addEventListener("click", () => {
      void tasknerveHeartbeatWorkers(button.getAttribute("data-tasknerve-project-heartbeat"));
    });
  });
}

function tasknerveRender() {
  const snapshot = tasknerveState.snapshot;
  if (!snapshot) {
    return;
  }
  tasknerveRenderProjectPicker(snapshot);
  tasknerveRenderMetrics(snapshot);
  tasknerveRenderTaskList(snapshot);
  tasknerveRenderEditor(snapshot);
  tasknerveRenderSettings(snapshot);
  tasknerveRenderDocumentEditor();
  tasknerveSetPanelMode(tasknerveState.panelMode);
  tasknerveEnsureTopbarTaskChip(snapshot);
  tasknerveEnsureBranchChip(snapshot);
  tasknerveEnsureTerminalTogglePosition(snapshot);
  tasknerveEnsureSidebarProjectDocuments();
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
    void tasknerveMaybeAutoCaptureTrace(tasknerveState.selectedProject, controller ? "controller.bind" : "worker.bind");
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
    tasknerveCloseTaskModal();
    if (savedTaskId) {
      tasknerveState.editingTaskId = savedTaskId;
      tasknerveRenderTaskList(tasknerveState.snapshot);
    } else {
      tasknerveState.editingTaskId = null;
      tasknerveRenderTaskList(tasknerveState.snapshot);
    }
    void tasknerveMaybeAutoCaptureTrace(tasknerveState.selectedProject, editingTask ? "task.edit" : "task.add");
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
      tasknerveState.editingTaskId = null;
      tasknerveCloseTaskModal();
    }
    tasknerveSetFlash(`Removed ${task.task_id}.`, "info");
    await tasknerveRefresh(false);
    void tasknerveMaybeAutoCaptureTrace(tasknerveState.selectedProject, "task.remove");
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
    void tasknerveMaybeAutoCaptureTrace(tasknerveState.selectedProject, "task.approve");
  } catch (error) {
    tasknerveSetFlash(`Task approval failed: ${error}`, "error");
  }
}

function tasknerveCollectProjectCodexSettingsPayload(projectKey = tasknerveState.selectedProject) {
  const readField = (field) => tasknerveProjectCardField(projectKey, field);
  return {
    git_origin_url: readField("git_origin_url")?.value || "",
    heartbeat_message_core: readField("heartbeat_message_core")?.value || "",
    low_queue_controller_enabled: Boolean(readField("low_queue_controller_enabled")?.checked),
    low_queue_controller_prompt: readField("low_queue_controller_prompt")?.value || "",
    worker_single_message_mode: Boolean(readField("worker_single_message_mode")?.checked),
    worker_model_routing_enabled: Boolean(readField("worker_model_routing_enabled")?.checked),
    worker_default_model: readField("worker_default_model")?.value || "",
    controller_default_model: readField("controller_default_model")?.value || "",
    low_intelligence_model: readField("low_intelligence_model")?.value || "",
    medium_intelligence_model: readField("medium_intelligence_model")?.value || "",
    high_intelligence_model: readField("high_intelligence_model")?.value || "",
    max_intelligence_model: readField("max_intelligence_model")?.value || "",
  };
}

function tasknerveCollectNativeProjectPrefs(projectKey = tasknerveState.selectedProject) {
  const readField = (field) => tasknerveProjectCardNativeField(projectKey, field);
  const maxActiveWorkers = Number(readField("maxActiveWorkers")?.value || 0);
  const traceCaptureIntervalSeconds = Number(readField("traceCaptureIntervalSeconds")?.value || 0);
  return {
    resourceAwareWorkers: Boolean(readField("resourceAwareWorkers")?.checked),
    maxActiveWorkers:
      Number.isFinite(maxActiveWorkers) && maxActiveWorkers > 0
        ? Math.max(1, Math.floor(maxActiveWorkers))
        : tasknerveNativeProjectPrefs(projectKey).maxActiveWorkers,
    traceCollectionEnabled: Boolean(readField("traceCollectionEnabled")?.checked),
    traceAutoCaptureEnabled: Boolean(readField("traceAutoCaptureEnabled")?.checked),
    traceCaptureIntervalSeconds:
      Number.isFinite(traceCaptureIntervalSeconds) && traceCaptureIntervalSeconds > 0
        ? Math.max(15, Math.floor(traceCaptureIntervalSeconds))
        : tasknerveNativeProjectPrefs(projectKey).traceCaptureIntervalSeconds,
    traceLastCaptureAtUtc: tasknerveNativeProjectPrefs(projectKey).traceLastCaptureAtUtc || null,
    traceLastCaptureId: tasknerveNativeProjectPrefs(projectKey).traceLastCaptureId || null,
    traceRoot: tasknerveNativeProjectPrefs(projectKey).traceRoot || "",
  };
}

async function tasknerveSaveSettings(projectKey = tasknerveState.selectedProject) {
  if (!projectKey) {
    return;
  }
  try {
    const nextNativePrefs = tasknerveCollectNativeProjectPrefs(projectKey);
    tasknerveSetNativeProjectPrefs(projectKey, nextNativePrefs);
    await tasknervePersistProjectNativePrefs(projectKey, nextNativePrefs);
    await tasknervePostJson(
      `/api/project/codex-settings${tasknerveProjectQuery(projectKey)}`,
      tasknerveCollectProjectCodexSettingsPayload(projectKey),
    );
    tasknerveSetFlash(`Saved settings for ${projectKey}.`, "info");
    await tasknerveRefresh(false);
    await tasknerveRefreshAllProjectSnapshots();
    await tasknerveRefreshResources(projectKey, true);
    void tasknerveMaybeAutoCaptureTrace(projectKey, "settings.save");
  } catch (error) {
    tasknerveSetFlash(`Project settings save failed: ${error}`, "error");
  }
}

async function tasknerveAdoptActiveThreads(projectKey = tasknerveState.selectedProject) {
  const button = tasknerveProjectCard(projectKey)?.querySelector(
    `[data-tasknerve-project-adopt="${projectKey}"]`,
  );
  try {
    if (button) {
      button.disabled = true;
    }
    await tasknervePostJson(`/api/codex/adopt-active${tasknerveProjectQuery(projectKey)}`, {
      heartbeat_message: tasknerveCurrentHeartbeatTemplate(projectKey),
    });
    tasknerveSetFlash("Active project threads adopted into TaskNerve.", "info");
    await tasknerveRefresh(false);
    await tasknerveRefreshAllProjectSnapshots();
    void tasknerveMaybeAutoCaptureTrace(projectKey, "threads.adopt");
  } catch (error) {
    tasknerveSetFlash(`Adopt-active failed: ${error}`, "error");
  } finally {
    if (button) {
      button.disabled = false;
    }
  }
}

async function tasknerveBootstrapController(projectKey = tasknerveState.selectedProject) {
  const button = tasknerveProjectCard(projectKey)?.querySelector(
    `[data-tasknerve-project-bootstrap="${projectKey}"]`,
  );
  const hasController = Boolean(tasknerveControllerBinding(tasknerveProjectSnapshot(projectKey)));
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
    await tasknervePostJson(`/api/codex/controller/bootstrap${tasknerveProjectQuery(projectKey)}`, {
      force_new: forceNew,
      open_thread: true,
    });
    tasknerveSetFlash("Controller thread is ready for this project.", "info");
    await tasknerveRefresh(false);
    await tasknerveRefreshAllProjectSnapshots();
    void tasknerveMaybeAutoCaptureTrace(projectKey, "controller.bootstrap");
  } catch (error) {
    tasknerveSetFlash(`Controller bootstrap failed: ${error}`, "error");
  } finally {
    if (button) {
      button.disabled = false;
    }
  }
}

async function tasknerveStartWorkerHeartbeatTurns(projectKey, threads) {
  const projectRoot = tasknerveProjectRoot(projectKey);
  const projectSnapshot = tasknerveProjectSnapshot(projectKey);
  const settings = tasknerveProjectCodexSettings(projectSnapshot);
  const prompt = tasknerveCurrentHeartbeatTemplate(projectKey).replaceAll(
    "{project_name}",
    tasknerveProjectName(projectKey),
  );
  await Promise.all(
    threads.map((thread) =>
      tasknerveFetchNativeJson("/tasknerve/thread/start-turn", {
        thread_id: thread.thread_id,
        prompt,
        cwd: thread.cwd || projectRoot || null,
        model: settings.worker_default_model || null,
        summary: "tasknerve heartbeat",
      }),
    ),
  );
}

async function tasknerveHeartbeatWorkers(projectKey = tasknerveState.selectedProject) {
  const button = tasknerveProjectCard(projectKey)?.querySelector(
    `[data-tasknerve-project-heartbeat="${projectKey}"]`,
  );
  try {
    if (button) {
      button.disabled = true;
    }
    const snapshot = tasknerveProjectSnapshot(projectKey);
    const controllerThreadId = tasknerveControllerBinding(snapshot)?.thread_id || null;
    const threads = tasknerveDiscoveredThreads(snapshot).filter(
      (thread) => thread?.thread_id && thread.thread_id !== controllerThreadId,
    );
    if (threads.length === 0) {
      tasknerveSetFlash("No active worker threads are available for this project.", "error");
      return;
    }
    const nativePrefs = tasknerveNativeProjectPrefs(projectKey);
    const maxWorkers = Math.max(1, tasknerveRequestedWorkerCap(projectKey));
    let targetCount = Math.min(maxWorkers, threads.length);
    if (nativePrefs.resourceAwareWorkers) {
      await tasknerveRefreshResources(projectKey, true);
      const recommended = Number(tasknerveState.resourceMonitor.recommendedWorkerCap || 0);
      if (Number.isFinite(recommended) && recommended > 0) {
        targetCount = Math.min(targetCount, recommended);
      }
    }
    const selectedThreads = threads
      .slice()
      .sort(
        (left, right) =>
          Number(left?.updated_at_unix_seconds || 0) - Number(right?.updated_at_unix_seconds || 0),
      )
      .slice(0, targetCount);
    if (selectedThreads.length === threads.length) {
      await tasknervePostJson(`/api/codex/heartbeat-active${tasknerveProjectQuery(projectKey)}`, {
        cycles: 1,
        background: true,
        heartbeat_message: tasknerveCurrentHeartbeatTemplate(projectKey),
      });
    } else {
      await tasknerveStartWorkerHeartbeatTurns(projectKey, selectedThreads);
    }
    const capSuffix =
      nativePrefs.resourceAwareWorkers && tasknerveState.resourceMonitor.recommendedWorkerCap
        ? ` (resource cap ${tasknerveState.resourceMonitor.recommendedWorkerCap}/${maxWorkers})`
        : "";
    tasknerveSetFlash(
      `TaskNerve queued heartbeats for ${selectedThreads.length}/${threads.length} workers${capSuffix}.`,
      "info",
    );
    await tasknerveRefresh(false);
    await tasknerveRefreshAllProjectSnapshots();
    void tasknerveMaybeAutoCaptureTrace(projectKey, "heartbeat.dispatch");
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
    if (tasknerveState.panelOpen && !tasknerveShouldPauseRefresh()) {
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
  const maxWidth =
    tasknerveState.panelMode === "settings"
      ? 1120
      : tasknerveState.panelMode === "document"
        ? 820
        : 760;
  const width = window.innerWidth <= 980
    ? Math.max(320, window.innerWidth - 24)
    : Math.min(maxWidth, availableWidth);
  shell.style.left = "auto";
  shell.style.width = `${width}px`;
}

async function tasknerveOpenPanel(event, mode = "settings") {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const root = tasknervePanelRoot();
  tasknerveSetPanelMode(mode);
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
  if (tasknerveState.panelMode === "settings") {
    await tasknerveRefreshAllProjectSnapshots();
  }
}

function tasknerveMaybeRefreshOnInteraction() {
  if (!tasknerveState.panelOpen || tasknerveState.loading || tasknerveShouldPauseRefresh()) {
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
  tasknerveCloseTaskModal();
  void tasknerveFlushDocumentAutosave();
  const root = tasknerveById(TASKNERVE_PANEL_ID);
  if (root) {
    root.classList.remove("tasknerve-open");
  }
  const nav = tasknerveById(TASKNERVE_NAV_ID);
  if (nav) {
    nav.classList.remove("tasknerve-active");
  }
  tasknerveStopPolling();
  tasknerveEnsureSidebarProjectDocuments();
}

function tasknerveTogglePanel(event, mode = "settings") {
  if (tasknerveState.panelOpen && tasknerveState.panelMode === mode) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    tasknerveClosePanel();
    return;
  }
  void tasknerveOpenPanel(event, mode);
}

function tasknerveDecorateNavRow(row) {
  row.id = TASKNERVE_NAV_ID;
  row.setAttribute("role", row.getAttribute("role") || "button");
  row.setAttribute("aria-label", "TaskNerve");
  row.removeAttribute("href");
  row.addEventListener("click", (event) => {
    tasknerveTogglePanel(event, "settings");
  });
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      tasknerveTogglePanel(event, "settings");
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
  tasknerveState.nativeProjectPrefs = tasknerveReadStorageJson(
    TASKNERVE_STORAGE_NATIVE_PROJECT_PREFS_KEY,
    {},
  );
  tasknerveEnsureNav();
  tasknerveLayoutPanel();
  void tasknerveSyncProjectFromHost().then(() => tasknerveRefresh(false)).catch(() => {});
  const observer = new MutationObserver(() => {
    tasknerveEnsureNav();
    tasknerveLayoutPanel();
    tasknerveHideCommitControls();
    tasknerveEnsureTopbarTaskChip(tasknerveState.snapshot);
    tasknerveEnsureBranchChip(tasknerveState.snapshot);
    tasknerveEnsureTerminalTogglePosition(tasknerveState.snapshot);
    tasknerveEnsureSidebarProjectDocuments();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("resize", tasknerveLayoutPanel);
  window.addEventListener("resize", tasknerveCloseBranchMenu);
  window.addEventListener("resize", () => {
    tasknerveEnsureTerminalTogglePosition(tasknerveState.snapshot);
  });
  document.addEventListener("click", (event) => {
    const root = tasknerveById(TASKNERVE_PANEL_ID);
    const shell = root?.querySelector(".tasknerve-shell");
    const menu = tasknerveById(TASKNERVE_BRANCH_MENU_ID);
    const chip = tasknerveById(TASKNERVE_BRANCH_CHIP_ID);
    if (
      tasknerveState.panelOpen &&
      shell &&
      !shell.contains(event.target) &&
      !tasknerveById(TASKNERVE_NAV_ID)?.contains(event.target) &&
      !tasknerveById(TASKNERVE_TOPBAR_TASK_CHIP_ID)?.contains(event.target)
    ) {
      tasknerveClosePanel();
    }
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
