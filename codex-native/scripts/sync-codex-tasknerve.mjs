#!/usr/bin/env node

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

const CODEX_PANEL_ASSET_NAME = "tasknerve-codex-panel.js";
const CODEX_PANEL_MARKER = "tasknerve-codex-panel.js";
const CODEX_MAIN_BRIDGE_START_MARKER = "/* tasknerve-codex-main-bridge:start */";
const CODEX_MAIN_BRIDGE_END_MARKER = "/* tasknerve-codex-main-bridge:end */";
const DEFAULT_APP_PATH = "/Applications/Codex TaskNerve.app";
const DEFAULT_BRIDGE_HOST = "127.0.0.1";
const DEFAULT_BRIDGE_PORT = 7791;
function parseArgs(argv) {
  const options = {
    appPath: DEFAULT_APP_PATH,
    bridgeHost: DEFAULT_BRIDGE_HOST,
    bridgePort: DEFAULT_BRIDGE_PORT,
    reopen: true,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--app":
        options.appPath = argv[index + 1];
        index += 1;
        break;
      case "--bridge-host":
        options.bridgeHost = argv[index + 1];
        index += 1;
        break;
      case "--bridge-port":
        options.bridgePort = Number(argv[index + 1] || DEFAULT_BRIDGE_PORT);
        index += 1;
        break;
      case "--no-reopen":
        options.reopen = false;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(" ")} failed with code ${code}: ${stderr.trim() || stdout.trim()}`,
        ),
      );
    });
  });
}

async function readText(filePath) {
  return fs.readFile(filePath, "utf8");
}

async function writeText(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, "utf8");
}

function codexNativeBridgeUrl(host, port) {
  return `http://${String(host).trim()}:${Number(port)}`;
}

function codexLocalOrigins(host, port) {
  const normalized = String(host || "").trim() === "" || String(host).trim() === "0.0.0.0"
    ? "127.0.0.1"
    : String(host).trim() === "::"
      ? "localhost"
      : String(host).trim();
  const origins = new Set();
  if (normalized.includes(":") && !normalized.startsWith("[")) {
    origins.add(`http://[${normalized}]:${port}`);
  } else {
    origins.add(`http://${normalized}:${port}`);
  }
  if (normalized === "127.0.0.1") {
    origins.add(`http://localhost:${port}`);
  } else if (normalized === "localhost") {
    origins.add(`http://127.0.0.1:${port}`);
  }
  return [...origins];
}

function ensureCspDirectiveOrigins(csp, directive, origins) {
  const normalized = String(csp).replace(/&#39;/g, "'").replace(/&apos;/g, "'");
  const parts = normalized
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  let found = false;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part === directive || part.startsWith(`${directive} `)) {
      const tokens = part.split(/\s+/);
      for (const origin of origins) {
        if (!tokens.includes(origin)) {
          tokens.push(origin);
        }
      }
      parts[index] = tokens.join(" ");
      found = true;
      break;
    }
  }
  if (!found) {
    parts.push([directive, ...origins].join(" "));
  }
  return `${parts.join("; ")};`;
}

function patchCodexIndexHtml(input, bridgeHost, bridgePort) {
  const marker = '<meta http-equiv="Content-Security-Policy" content="';
  const cspStart = input.indexOf(marker);
  assert(cspStart >= 0, "Codex webview index is missing CSP meta tag");
  const contentStart = cspStart + marker.length;
  const cspEndOffset = input.slice(contentStart).indexOf('">');
  assert(cspEndOffset >= 0, "Codex webview index has malformed CSP meta tag");
  const cspEnd = contentStart + cspEndOffset;
  const bridgeOrigins = codexLocalOrigins(bridgeHost, bridgePort);
  const updatedCsp = ensureCspDirectiveOrigins(input.slice(contentStart, cspEnd), "connect-src", bridgeOrigins);
  let html = `${input.slice(0, contentStart)}${updatedCsp}${input.slice(cspEnd)}`;
  if (!html.includes(CODEX_PANEL_MARKER)) {
    html = html.replace(
      "</head>",
      `    <script type="module" crossorigin src="./assets/${CODEX_PANEL_ASSET_NAME}"></script>\n</head>`,
    );
  }
  assert(html.includes(CODEX_PANEL_MARKER), "failed injecting TaskNerve panel asset into index.html");
  return html;
}

function isJsIdentifierByte(code) {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 95 ||
    code === 36
  );
}

function extractJsIdentifierBefore(input, endExclusive) {
  const bytes = Buffer.from(input, "utf8");
  let end = Math.min(endExclusive, bytes.length);
  while (end > 0 && /\s/.test(String.fromCharCode(bytes[end - 1]))) {
    end -= 1;
  }
  let start = end;
  while (start > 0 && isJsIdentifierByte(bytes[start - 1])) {
    start -= 1;
  }
  return start === end ? null : input.slice(start, end);
}

function extractJsIdentifierAt(input, startInclusive) {
  const bytes = Buffer.from(input, "utf8");
  let start = Math.min(startInclusive, bytes.length);
  while (start < bytes.length && /\s/.test(String.fromCharCode(bytes[start]))) {
    start += 1;
  }
  let end = start;
  while (end < bytes.length && isJsIdentifierByte(bytes[end])) {
    end += 1;
  }
  return start === end ? null : input.slice(start, end);
}

function findAnyToken(input, tokens) {
  const indexes = tokens.map((token) => input.indexOf(token)).filter((value) => value >= 0);
  if (indexes.length === 0) {
    return -1;
  }
  return Math.min(...indexes);
}

function findIdentifierAfterMarker(input, marker) {
  let searchFrom = 0;
  while (searchFrom < input.length) {
    const relativeIndex = input.slice(searchFrom).indexOf(marker);
    if (relativeIndex < 0) {
      return null;
    }
    const markerIndex = searchFrom + relativeIndex + marker.length;
    const identifier = extractJsIdentifierAt(input, markerIndex);
    if (identifier) {
      return identifier;
    }
    searchFrom = markerIndex;
  }
  return null;
}

function findIdentifierBeforeMarker(input, marker) {
  const markerIndex = input.indexOf(marker);
  if (markerIndex < 0) {
    return null;
  }
  return extractJsIdentifierBefore(input, markerIndex);
}

function stripInjectedMainBridge(input) {
  if (!input.includes(CODEX_MAIN_BRIDGE_START_MARKER) || !input.includes(CODEX_MAIN_BRIDGE_END_MARKER)) {
    return input;
  }
  const start = input.indexOf(CODEX_MAIN_BRIDGE_START_MARKER);
  const end = input.indexOf(CODEX_MAIN_BRIDGE_END_MARKER) + CODEX_MAIN_BRIDGE_END_MARKER.length;
  return `${input.slice(0, start)}${input.slice(end)}`;
}

function extractExistingBridgeBindings(input) {
  if (!input.includes(CODEX_MAIN_BRIDGE_START_MARKER) || !input.includes(CODEX_MAIN_BRIDGE_END_MARKER)) {
    return null;
  }
  const block = input.slice(
    input.indexOf(CODEX_MAIN_BRIDGE_START_MARKER),
    input.indexOf(CODEX_MAIN_BRIDGE_END_MARKER) + CODEX_MAIN_BRIDGE_END_MARKER.length,
  );
  const pick = (name) => {
    const match = block.match(new RegExp(`const ${name} = ([^;]+);`));
    return match ? match[1].trim() : null;
  };
  const normalizeBinding = (value, required = false) => {
    if (!value || value.includes("__TASKNERVE_")) {
      return required ? null : "null";
    }
    return value;
  };
  const localHostConfig = normalizeBinding(pick("TASKNERVE_LOCAL_HOST_CONFIG"), true);
  const contextResolver = normalizeBinding(pick("TASKNERVE_CONTEXT_RESOLVER"), true);
  if (!localHostConfig || !contextResolver) {
    return null;
  }
  return {
    localHostConfig,
    contextResolver,
    ensureWindow: normalizeBinding(pick("TASKNERVE_ENSURE_WINDOW")),
    navigateRoute: normalizeBinding(pick("TASKNERVE_NAVIGATE_ROUTE")),
    windowManager: normalizeBinding(pick("TASKNERVE_WINDOW_MANAGER")),
  };
}

function findFunctionCallIdentifier(input, argumentIdentifier) {
  const escaped = argumentIdentifier.replace(/\$/g, "\\$");
  const matcher = new RegExp(`([A-Za-z_$][\\w$]*)\\(${escaped}\\)`, "g");
  const match = matcher.exec(input);
  return match ? match[1] : null;
}

function discoverCodexMainBridgeBindings(input) {
  const localKindIndex = findAnyToken(input, ['kind:`local`', "kind:'local'", 'kind:"local"']);
  assert(localKindIndex >= 0, "failed locating Codex local host config in main.js");
  const localAssignmentIndex = input.slice(0, localKindIndex).lastIndexOf("=");
  assert(localAssignmentIndex >= 0, "failed locating local host config assignment in main.js");
  const localHostConfig = extractJsIdentifierBefore(input, localAssignmentIndex);
  assert(localHostConfig, "failed parsing local host config identifier in main.js");

  const contextResolver =
    findFunctionCallIdentifier(input.slice(localKindIndex), localHostConfig) ||
    findIdentifierBeforeMarker(input, `(${localHostConfig})`);
  assert(contextResolver, "failed parsing Codex context resolver identifier in main.js");

  return {
    localHostConfig,
    contextResolver,
    ensureWindow:
      findIdentifierAfterMarker(input, "ensurePrimaryWindowVisible:") ||
      findIdentifierAfterMarker(input, "selectHost:") ||
      "null",
    navigateRoute: findIdentifierAfterMarker(input, "navigateToRoute:") || "null",
    windowManager:
      findIdentifierAfterMarker(input, "windowManager:") ||
      findIdentifierBeforeMarker(input, ".createWindow({") ||
      findIdentifierBeforeMarker(input, ".getPrimaryWindow(") ||
      "null",
  };
}

function extractCodexMainBridgeBindings(input, fallbackInput = null) {
  return (
    extractExistingBridgeBindings(input) ||
    (() => {
      try {
        return discoverCodexMainBridgeBindings(stripInjectedMainBridge(input));
      } catch (_error) {
        if (fallbackInput) {
          return discoverCodexMainBridgeBindings(stripInjectedMainBridge(fallbackInput));
        }
        throw _error;
      }
    })()
  );
}

function renderCodexPanelScript(bridgeHost, bridgePort) {
  const templatePath = path.join(repoRoot, "templates", "TASKNERVE_CODEX_PANEL.js");
  return readText(templatePath).then((template) =>
    template.replaceAll("__TASKNERVE_NATIVE_BRIDGE_URL__", codexNativeBridgeUrl(bridgeHost, bridgePort)),
  );
}

function renderCodexMainBridgeScript(bindings, bridgeHost, bridgePort) {
  const templatePath = path.join(repoRoot, "templates", "TASKNERVE_CODEX_MAIN_BRIDGE.js");
  return readText(templatePath).then((template) =>
    `${CODEX_MAIN_BRIDGE_START_MARKER}\n${
      template
        .replaceAll("__TASKNERVE_BRIDGE_HOST__", bridgeHost)
        .replaceAll("__TASKNERVE_BRIDGE_PORT__", String(bridgePort))
        .replaceAll("__TASKNERVE_LOCAL_HOST_CONFIG__", bindings.localHostConfig)
        .replaceAll("__TASKNERVE_CONTEXT_RESOLVER__", bindings.contextResolver)
        .replaceAll("__TASKNERVE_ENSURE_WINDOW__", bindings.ensureWindow || "null")
        .replaceAll("__TASKNERVE_NAVIGATE_ROUTE__", bindings.navigateRoute || "null")
        .replaceAll("__TASKNERVE_WINDOW_MANAGER__", bindings.windowManager || "null")
    }\n${CODEX_MAIN_BRIDGE_END_MARKER}`,
  );
}

async function patchCodexMainJs(input, bridgeHost, bridgePort, fallbackInput = null) {
  const bindings = extractCodexMainBridgeBindings(input, fallbackInput);
  const rendered = await renderCodexMainBridgeScript(bindings, bridgeHost, bridgePort);
  if (input.includes(CODEX_MAIN_BRIDGE_START_MARKER) && input.includes(CODEX_MAIN_BRIDGE_END_MARKER)) {
    const start = input.indexOf(CODEX_MAIN_BRIDGE_START_MARKER);
    const end = input.indexOf(CODEX_MAIN_BRIDGE_END_MARKER) + CODEX_MAIN_BRIDGE_END_MARKER.length;
    return `${input.slice(0, start)}${rendered}${input.slice(end)}`;
  }
  const sourceMapIndex = input.lastIndexOf("//# sourceMappingURL=");
  if (sourceMapIndex >= 0) {
    return `${input.slice(0, sourceMapIndex)}${rendered}\n${input.slice(sourceMapIndex)}`;
  }
  return `${input}\n${rendered}`;
}

async function readMacosPlistJson(plistPath) {
  const { stdout } = await run("plutil", ["-convert", "json", "-o", "-", plistPath]);
  return JSON.parse(stdout.trim());
}

async function writeMacosPlistJson(plistPath, value) {
  const tempPath = path.join(os.tmpdir(), `tasknerve-plist-${crypto.randomUUID()}.json`);
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    await run("plutil", ["-convert", "xml1", "-o", plistPath, tempPath]);
  } finally {
    await fs.rm(tempPath, { force: true });
  }
}

async function updateMacosAppAsarIntegrity(appPath, asarHash) {
  const plistPath = path.join(appPath, "Contents", "Info.plist");
  const plist = await readMacosPlistJson(plistPath);
  plist.ElectronAsarIntegrity = {
    "Resources/app.asar": {
      algorithm: "SHA256",
      hash: asarHash,
    },
  };
  await writeMacosPlistJson(plistPath, plist);
}

function readLeU32(bytes, offset = 0) {
  return bytes.readUInt32LE(offset);
}

async function electronAsarHeaderHash(asarPath) {
  const handle = await fs.open(asarPath, "r");
  try {
    const sizePickle = Buffer.alloc(8);
    await handle.read(sizePickle, 0, 8, 0);
    const headerPickleSize = readLeU32(sizePickle, 4);
    const headerPickle = Buffer.alloc(headerPickleSize);
    await handle.read(headerPickle, 0, headerPickleSize, 8);
    const headerLen = readLeU32(headerPickle, 4);
    const headerBytes = headerPickle.subarray(8, 8 + headerLen);
    return crypto.createHash("sha256").update(headerBytes).digest("hex");
  } finally {
    await handle.close();
  }
}

async function maybeQuitApp(appPath) {
  const plist = await readMacosPlistJson(path.join(appPath, "Contents", "Info.plist"));
  const displayName = plist.CFBundleDisplayName || plist.CFBundleName || path.basename(appPath, ".app");
  try {
    await run("osascript", ["-e", `tell application "${String(displayName).replaceAll('"', '\\"')}" to quit`]);
  } catch (_error) {
    return false;
  }
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await run("pgrep", ["-f", appPath]);
    } catch (_error) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function maybeOpenApp(appPath, reopen) {
  if (!reopen) {
    return;
  }
  await run("open", ["-a", appPath]);
}

async function syncApp(options) {
  const appPath = path.resolve(options.appPath);
  const appAsarPath = path.join(appPath, "Contents", "Resources", "app.asar");
  const sourceAppAsarPath = "/Applications/Codex.app/Contents/Resources/app.asar";
  assert(existsSync(appPath), `Codex TaskNerve app not found at ${appPath}`);
  assert(existsSync(appAsarPath), `Codex TaskNerve app bundle is missing ${appAsarPath}`);
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "tasknerve-codex-native-"));
  const extractDir = path.join(workDir, "extract");
  const referenceDir = path.join(workDir, "reference");
  const packedAsarPath = path.join(workDir, "app.patched.asar");
  try {
    await maybeQuitApp(appPath);
    await run("npx", ["--yes", "@electron/asar", "extract", appAsarPath, extractDir], {
      cwd: repoRoot,
    });
    if (existsSync(sourceAppAsarPath)) {
      await run("npx", ["--yes", "@electron/asar", "extract", sourceAppAsarPath, referenceDir], {
        cwd: repoRoot,
      });
    }
    const indexPath = path.join(extractDir, "webview", "index.html");
    const mainPath = path.join(extractDir, ".vite", "build", "main.js");
    const assetPath = path.join(extractDir, "webview", "assets", CODEX_PANEL_ASSET_NAME);
    const referenceMainPath = path.join(referenceDir, ".vite", "build", "main.js");
    const [indexHtml, mainJs, referenceMainJs] = await Promise.all([
      readText(indexPath),
      readText(mainPath),
      existsSync(referenceMainPath) ? readText(referenceMainPath) : Promise.resolve(null),
    ]);
    const [patchedMain, panelAsset] = await Promise.all([
      patchCodexMainJs(mainJs, options.bridgeHost, options.bridgePort, referenceMainJs),
      renderCodexPanelScript(options.bridgeHost, options.bridgePort),
    ]);
    const patchedIndex = patchCodexIndexHtml(indexHtml, options.bridgeHost, options.bridgePort);
    await Promise.all([
      writeText(indexPath, patchedIndex),
      writeText(mainPath, patchedMain),
      writeText(assetPath, panelAsset),
    ]);
    await run("npx", ["--yes", "@electron/asar", "pack", extractDir, packedAsarPath], {
      cwd: repoRoot,
    });
    await fs.copyFile(packedAsarPath, appAsarPath);
    const asarHash = await electronAsarHeaderHash(appAsarPath);
    await updateMacosAppAsarIntegrity(appPath, asarHash);
    await run("codesign", ["--force", "--deep", "--sign", "-", appPath]);
    await maybeOpenApp(appPath, options.reopen);
    return {
      ok: true,
      app_path: appPath,
      app_asar_path: appAsarPath,
      bridge_url: codexNativeBridgeUrl(options.bridgeHost, options.bridgePort),
      panel_asset: CODEX_PANEL_ASSET_NAME,
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

try {
  const options = parseArgs(process.argv.slice(2));
  const result = await syncApp(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error && error.message ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
