# TaskNerve Native Codex Integration Plan

## Goal

Make TaskNerve feel first-class inside Codex:
- no browser-tab dependency
- no iframe as the primary product surface
- no second sign-in for advisor/controller turns
- no dependence on visible chat titles for worker routing

TaskNerve should own project/task orchestration while Codex continues to own authenticated inference and conversation UX.

## Adopted Architecture

### 1. TaskNerve stays authoritative for project state

TaskNerve remains the system of record for:
- project registry
- task queue and claims
- timeline/checkpoints
- bridge/CI flows
- advisor workflow state
- Codex thread bindings and queued heartbeats

### 2. Codex becomes the native execution surface

The installed `Codex.app` bundle is patched locally by `tasknerve codex install` so TaskNerve can:
- add a `TaskNerve` entry to the Codex shell
- open a native TaskNerve overlay instead of an iframe
- route controller and worker prompt injection through Codex desktop itself

The overlay is intentionally designed around the user flow:
- select project
- bind one active Codex thread as controller
- let TaskNerve adopt active non-archived project threads as workers
- talk to the controller from the TaskNerve panel
- queue project-wide heartbeats to active workers

### 3. Native inference bridge, not a separate provider path

TaskNerve now patches Codex main-process code to expose a localhost bridge backed by Codex's own authenticated app-server connection.

That bridge currently supports:
- `startThread`
- `startTurn`
- `setThreadName`
- `updateThreadTitle`
- opening a specific thread in the Codex UI

This keeps controller/advisor-style prompting on the user's Codex/ChatGPT subscription path instead of requiring a separate Claude/OpenRouter-style login.

### 4. Local panel service remains useful, but only as TaskNerve data transport

TaskNerve still runs a localhost panel/backend service under a LaunchAgent because the native overlay needs stable access to project/task APIs.

That service is no longer the product surface by itself. Its job is:
- serve project/task/codex snapshot APIs
- accept queue mutations
- accept controller/heartbeat requests
- keep the native overlay lightweight

### 5. Patch-and-sync update model

Codex does not currently expose a stable plugin/sidebar extension API for this integration, so TaskNerve treats the desktop integration as a managed patch layer.

`tasknerve codex sync` is the important operational command:
- detect when `Codex.app` updated
- compare current `app.asar` hash against the last patched hash
- reapply the TaskNerve renderer patch
- reapply the TaskNerve native bridge patch
- refresh LaunchAgents and local skill state

On macOS, install also writes a sync LaunchAgent that watches the patched app/tasknerve executable and periodically reruns `tasknerve codex sync --quiet`.

## Update Resilience Strategy

The main integration risk is Codex desktop internals changing between app updates. To reduce that risk:
- patch application is marker-based and idempotent
- TaskNerve keeps a clean backup of the original `app.asar`
- the bridge injector now derives the current main-process symbol names from the shipped `main.js` during patch time instead of hardcoding one build's obfuscated names
- `doctor` reports hash drift, patch health, panel health, native bridge health, and LaunchAgent state

This is still an unsupported local patch path. Automatic reapply is realistic across normal Codex updates, but a major upstream desktop refactor can still require TaskNerve patch updates.

## Constraints

- macOS-only for now
- no secrets are embedded into patched assets
- TaskNerve writes only to TaskNerve-controlled state plus the user-approved local Codex bundle patch
- uninstall must be reversible through `tasknerve codex uninstall`

## Future Direction

If Codex eventually ships a supported desktop extension API, TaskNerve should move to it and retire the bundle patcher.

Until then, the right model is:
- native overlay inside Codex
- Codex-authenticated inference for controller/advisor turns
- TaskNerve-owned orchestration and project memory
- syncable patch layer that can keep up with Codex desktop updates
