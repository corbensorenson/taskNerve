---
name: tasknerve-creator
description: Create, modify, and optimize the TaskNerve platform itself (native runtime, UI integration, performance, and TaskNerve skills).
---

# TaskNerve Creator Skill

Use this skill when the user asks to build or change TaskNerve itself.

If you want, I can next add a tiny “skill routing” note so requests automatically prefer tasknerve-creator for platform/dev work and tasknerve for orchestration/use.

## Activation Criteria

Use this skill when any of the following are true:
- The user asks for TaskNerve feature work in native runtime modules.
- The user asks for performance/overhead optimization in TaskNerve internals.
- The user asks for TaskNerve UI behavior changes in Codex integration surfaces.
- The user asks to change TaskNerve architecture, persistence, or host event flow.
- The user asks to create/update TaskNerve skills.

Use `tasknerve` instead when the request is primarily operating project work through TaskNerve.

## Source-of-Truth Rules

- Single implementation target: `codex-native/src`.
- `codex-native/test` is validation coverage, not a second runtime branch.
- Treat `target/*` extracts and built bundles as artifacts, not source.
- Do not maintain duplicate runtime pipelines or parallel editable bundle trees.
- Do not add patching/injection workflows as normal product behavior.

## Implementation Workflow

1. Locate the narrowest native module boundary for the requested change:
- [codex-native/src/integration/](/Users/adimus/Documents/taskNerve/codex-native/src/integration)
- [codex-native/src/domain/](/Users/adimus/Documents/taskNerve/codex-native/src/domain)
- [codex-native/src/io/](/Users/adimus/Documents/taskNerve/codex-native/src/io)

2. Design for low overhead first:
- favor event-driven updates over polling
- reduce redundant file reads and object churn
- keep host/renderer payloads minimal and deterministic

3. Implement in one path only, then verify behavior with targeted checks first.

4. Validate before closure:
```bash
cd /Users/adimus/Documents/taskNerve/codex-native
npm install
npm run typecheck
npm test
```

## Packaging and Recovery Guardrails

- Normal path: change source, rebuild, and package; do not hand-edit installed app bundles.
- If emergency recovery is required for a broken local install:
- patch from one canonical extract tree
- repack once
- set `Info.plist` `ElectronAsarIntegrity:Resources/app.asar:hash` to Electron's ASAR header SHA-256 hex (hash bytes `app.asar[16..16+len]`, where `len = u32le(app.asar[12..16])`)
- re-sign the `.app`
- Before shipping that recovery build, confirm `.vite/build/main.js` has no unresolved placeholders (for example `__TASKNERVE_WINDOW_MANAGER__`).

## Skill-Creation Rules

- Keep TaskNerve skills split by intent (usage vs creator/development).
- Keep skill text concise; move deep details to references when needed.
- Keep `agents/openai.yaml` aligned with each skill's actual trigger and scope.
