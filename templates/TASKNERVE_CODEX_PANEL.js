const TASKNERVE_BASE_URL = "__TASKNERVE_BASE_URL__";
const TASKNERVE_NAV_ID = "tasknerve-codex-nav-entry";
const TASKNERVE_PANEL_ID = "tasknerve-codex-panel-root";
const TASKNERVE_PANEL_STYLE_ID = "tasknerve-codex-panel-style";
const TASKNERVE_PANEL_IFRAME_ID = "tasknerve-codex-panel-iframe";
const TASKNERVE_SKILLS_LABELS = ["Skills", "Skills & Apps", "Skills and Apps"];

function tasknerveNormalizeText(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function tasknerveClosestInteractive(node) {
  if (!node) {
    return null;
  }
  return (
    node.closest("a,button,[role='button'],div.cursor-interaction") || node
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
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="6.5" cy="12" r="2.25"></circle><circle cx="17.5" cy="7" r="2.25"></circle><circle cx="17.5" cy="17" r="2.25"></circle><path d="M8.55 10.8l6.8-2.6"></path><path d="M8.55 13.2l6.8 2.6"></path></svg>';
  return icon;
}

function tasknerveEnsurePanelStyles() {
  if (document.getElementById(TASKNERVE_PANEL_STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = TASKNERVE_PANEL_STYLE_ID;
  style.textContent = `
#${TASKNERVE_PANEL_ID} {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 2147483600;
  display: none;
  pointer-events: none;
}
#${TASKNERVE_PANEL_ID}.tasknerve-open {
  display: block;
}
#${TASKNERVE_PANEL_ID} .tasknerve-panel-shell {
  position: absolute;
  top: 12px;
  right: 12px;
  bottom: 12px;
  left: 320px;
  display: flex;
  flex-direction: column;
  border-radius: 16px;
  overflow: hidden;
  pointer-events: auto;
  background: rgba(13, 17, 23, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(16px);
}
#${TASKNERVE_PANEL_ID} .tasknerve-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
#${TASKNERVE_PANEL_ID} .tasknerve-panel-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.96);
}
#${TASKNERVE_PANEL_ID} .tasknerve-panel-title svg {
  width: 18px;
  height: 18px;
}
#${TASKNERVE_PANEL_ID} .tasknerve-panel-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
#${TASKNERVE_PANEL_ID} .tasknerve-panel-status {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.72);
}
#${TASKNERVE_PANEL_ID} button.tasknerve-panel-button {
  appearance: none;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.92);
  padding: 7px 10px;
  border-radius: 10px;
  cursor: pointer;
  font: inherit;
}
#${TASKNERVE_PANEL_ID} button.tasknerve-panel-button:hover {
  background: rgba(255, 255, 255, 0.12);
}
#${TASKNERVE_PANEL_ID} .tasknerve-panel-body {
  position: relative;
  flex: 1;
  min-height: 0;
  background: rgba(7, 11, 16, 0.92);
}
#${TASKNERVE_PANEL_IFRAME_ID} {
  width: 100%;
  height: 100%;
  border: 0;
  background: #0b1117;
}
#${TASKNERVE_PANEL_ID} .tasknerve-panel-fallback {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px;
  text-align: center;
  color: rgba(255, 255, 255, 0.86);
}
#${TASKNERVE_PANEL_ID} .tasknerve-panel-fallback code {
  padding: 2px 6px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.08);
}
#${TASKNERVE_NAV_ID}.tasknerve-active {
  background: rgba(255, 255, 255, 0.08) !important;
}
#${TASKNERVE_NAV_ID} .tasknerve-codex-icon,
#${TASKNERVE_PANEL_ID} .tasknerve-panel-title-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
#${TASKNERVE_NAV_ID} .tasknerve-codex-icon svg,
#${TASKNERVE_PANEL_ID} .tasknerve-panel-title-icon svg {
  width: 18px;
  height: 18px;
}
`;
  document.head.appendChild(style);
}

function tasknervePanelRoot() {
  let root = document.getElementById(TASKNERVE_PANEL_ID);
  if (root) {
    return root;
  }
  tasknerveEnsurePanelStyles();
  root = document.createElement("div");
  root.id = TASKNERVE_PANEL_ID;
  root.innerHTML = `
    <div class="tasknerve-panel-shell">
      <div class="tasknerve-panel-header">
        <div class="tasknerve-panel-title">
          <span class="tasknerve-panel-title-icon" aria-hidden="true">${tasknerveCreateIcon().innerHTML}</span>
          <span>TaskNerve</span>
        </div>
        <div class="tasknerve-panel-actions">
          <span class="tasknerve-panel-status" data-tasknerve-status>Connecting...</span>
          <button type="button" class="tasknerve-panel-button" data-tasknerve-refresh>Refresh</button>
          <button type="button" class="tasknerve-panel-button" data-tasknerve-open-browser>Browser</button>
          <button type="button" class="tasknerve-panel-button" data-tasknerve-close>Close</button>
        </div>
      </div>
      <div class="tasknerve-panel-body">
        <iframe id="${TASKNERVE_PANEL_IFRAME_ID}" title="TaskNerve"></iframe>
        <div class="tasknerve-panel-fallback" data-tasknerve-fallback hidden>
          <strong>TaskNerve panel is not responding yet.</strong>
          <div>Run <code>tasknerve codex doctor --json</code> or reinstall the integration.</div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(root);
  root
    .querySelector("[data-tasknerve-close]")
    .addEventListener("click", tasknerveClosePanel);
  root
    .querySelector("[data-tasknerve-refresh]")
    .addEventListener("click", () => tasknerveRefreshPanel(true));
  root
    .querySelector("[data-tasknerve-open-browser]")
    .addEventListener("click", () => window.open(TASKNERVE_BASE_URL, "_blank"));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && root.classList.contains("tasknerve-open")) {
      tasknerveClosePanel();
    }
  });
  return root;
}

function tasknerveLayoutPanel() {
  const root = tasknervePanelRoot();
  const shell = root.querySelector(".tasknerve-panel-shell");
  const reference = document.getElementById(TASKNERVE_NAV_ID) || tasknerveFindSkillsRow();
  const left = reference
    ? Math.max(Math.round(tasknerveClosestInteractive(reference).getBoundingClientRect().right) + 8, 300)
    : 320;
  shell.style.left = `${left}px`;
}

async function tasknerveRefreshPanel(forceFrameReload) {
  const root = tasknervePanelRoot();
  const iframe = root.querySelector(`#${TASKNERVE_PANEL_IFRAME_ID}`);
  const fallback = root.querySelector("[data-tasknerve-fallback]");
  const status = root.querySelector("[data-tasknerve-status]");
  const targetUrl = `${TASKNERVE_BASE_URL}/`;
  status.textContent = "Connecting...";
  try {
    const response = await fetch(`${TASKNERVE_BASE_URL}/health`, {
      method: "GET",
      cache: "no-store",
      mode: "cors",
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    fallback.hidden = true;
    if (forceFrameReload || iframe.dataset.loadedUrl !== targetUrl) {
      iframe.src = targetUrl;
      iframe.dataset.loadedUrl = targetUrl;
    }
    status.textContent = "Live";
  } catch (_error) {
    iframe.removeAttribute("src");
    delete iframe.dataset.loadedUrl;
    fallback.hidden = false;
    status.textContent = "Offline";
  }
}

function tasknerveOpenPanel(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const root = tasknervePanelRoot();
  root.classList.add("tasknerve-open");
  tasknerveLayoutPanel();
  const nav = document.getElementById(TASKNERVE_NAV_ID);
  if (nav) {
    nav.classList.add("tasknerve-active");
  }
  void tasknerveRefreshPanel(false);
}

function tasknerveClosePanel() {
  const root = document.getElementById(TASKNERVE_PANEL_ID);
  if (root) {
    root.classList.remove("tasknerve-open");
  }
  const nav = document.getElementById(TASKNERVE_NAV_ID);
  if (nav) {
    nav.classList.remove("tasknerve-active");
  }
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
  if (document.getElementById(TASKNERVE_NAV_ID)) {
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
  tasknerveEnsureNav();
  tasknerveLayoutPanel();
  const observer = new MutationObserver(() => {
    tasknerveEnsureNav();
    tasknerveLayoutPanel();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("resize", tasknerveLayoutPanel);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", tasknerveBoot, { once: true });
} else {
  tasknerveBoot();
}
