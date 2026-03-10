# TaskNerve Native Codex Integration Plan

## Goal

Make TaskNerve feel native inside Codex without reimplementing TaskNerve's queue, timeline, advisor, or bridge logic inside the Codex codebase.

## What We Found

- The public `openai/codex` repository exposes the launcher and app-server surfaces, but not the exact desktop sidebar shell that ships in the installed Electron app.
- The installed `/Applications/Codex.app` bundle contains the real packaged webview frontend in `app.asar`.
- That packaged frontend can be patched locally, but it is not a stable upstream extension API.

## Adopted Approach

### 1. Keep TaskNerve core authoritative

TaskNerve remains the source of truth for:
- task queue
- timeline/checkpoints
- bridge and CI integration
- advisor/reviewer automation
- multi-project discovery

### 2. Add a TaskNerve-managed Codex integration layer

TaskNerve now owns a `tasknerve codex` command surface for:
- install
- doctor
- uninstall

This keeps setup reproducible and lets the repo version the integration instead of relying on ad hoc local patch steps.

### 3. Reuse the existing TaskNerve GUI as the embedded surface

Instead of duplicating the GUI in Codex, the integration embeds TaskNerve's existing task/timeline GUI inside the Codex desktop shell.

Benefits:
- one UI/backend source of truth
- no task semantics drift
- minimal duplicated product logic

### 4. Use a local background panel service

For Codex embedding to feel native, the TaskNerve GUI must already be reachable at a stable local URL.

On macOS the integration installs a LaunchAgent that keeps the panel endpoint alive at a fixed host/port, so the Codex panel does not depend on a browser tab being open first.

### 5. Patch the local Codex desktop bundle only as an explicit opt-in

The local patch:
- widens the packaged webview CSP for the TaskNerve localhost panel
- injects a TaskNerve renderer module into the Codex webview
- adds a TaskNerve sidebar row below Skills
- opens an in-app TaskNerve panel with an embedded iframe

This is intentionally documented and shipped as an experimental local integration path, not represented as an official Codex plugin API.

## Design Constraints

- No secrets are written into Codex bundle assets.
- The panel talks only to localhost TaskNerve endpoints.
- TaskNerve install state and backups live under TaskNerve-controlled user paths.
- The local patch must be reversible with `tasknerve codex uninstall`.
- The user should not have to manually edit `app.asar`.

## Future Upgrade Path

If OpenAI later exposes a real desktop plugin/sidebar extension API, TaskNerve should move to that supported surface and retire the local bundle patcher. The daemonized panel service and embed-friendly GUI remain useful either way.
