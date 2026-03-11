# Codex Native Integration Surface

Date: 2026-03-11

TaskNerve exposes direct in-process integration APIs from:

- [codex-native/src/integration/taskNerveService.ts](/Users/adimus/Documents/taskNerve/codex-native/src/integration/taskNerveService.ts)
- [codex-native/src/integration/codexTaskNerveHostRuntime.ts](/Users/adimus/Documents/taskNerve/codex-native/src/integration/codexTaskNerveHostRuntime.ts)

## Purpose

These surfaces let Codex host code call TaskNerve orchestration logic directly while inheriting Codex routing, threads, models, and styling.

## Core Services

`createTaskNerveService()`:
- project settings and registry IO
- task queue sorting/filtering/stats
- prompt queue merge semantics
- model routing
- project contract generation
- controller bootstrap prompt generation

`createCodexTaskNerveHostRuntime()`:
- host-integrated snapshots with explicit host-styling contract
- direct controller-thread bootstrapping through Codex host service methods

## Example

```ts
import {
  createTaskNerveService,
  createCodexTaskNerveHostRuntime,
} from "codex-tasknerve-native";

const taskNerve = createTaskNerveService();
const runtime = createCodexTaskNerveHostRuntime({ host: codexHostServices, taskNerveService: taskNerve });

const snapshot = await runtime.snapshot({
  repoRoot,
  projectName,
  tasks,
  search,
});

const controller = await runtime.bootstrapControllerThread({
  repoRoot,
  projectName,
});
```

## Styling Contract

TaskNerve views should be rendered using Codex host components/styles.

No custom DOM overlay layer or external panel runtime is supported.
