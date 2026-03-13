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
- The user asks to add or modify TaskNerve external-notification bridges (for example Discord webhook/relay).

Use `tasknerve` instead when the request is primarily operating project work through TaskNerve.

## Source-of-Truth Rules

- Single implementation target: `codex-native/src`.
- `codex-native/test` is validation coverage, not a second runtime branch.
- Treat `target/*` extracts and built bundles as artifacts, not source.
- Never hand-edit generated bundle artifacts (for example `target/codex-tasknerve-app-live-extract/webview/assets/index-*.js`).
- Do not maintain duplicate runtime pipelines or parallel editable bundle trees.
- Do not add patching/injection workflows as normal product behavior.
- When validating UI/runtime changes in a local installed app, always deploy from one canonical extract tree: `target/codex-tasknerve-app-live-extract`.

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

5. If adding chat-bridge integrations (Discord, etc.):
- keep per-project config in TaskNerve project settings
- keep outbound notifications optional and easy to mute
- clearly separate outbound webhook capability from inbound relay/bot requirements

## Packaging and Recovery Guardrails

- Normal path: change source, rebuild, and package; do not hand-edit installed app bundles.
- Emergency recovery may repackage canonical generated artifacts, but still never hand-edit minified bundle files.

## Local Visibility Workflow (Required)

When the user expects visible desktop app changes immediately, run this flow before claiming completion:

1. Apply changes in source (`codex-native/src`) and any required canonical extract updates.
2. Deploy the deterministic source-first local build:
```bash
bash /Users/adimus/Documents/taskNerve/scripts/deploy-tasknerve-from-source.sh
```
3. Verify installed artifact contains expected markers using extracted verify files under `target/install-backups/<timestamp>/verify-installed`.
4. Relaunch the app and confirm the changed UI/behavior is visible.

Do not report success until steps 2-4 are complete.

## Skill-Creation Rules

- Keep TaskNerve skills split by intent (usage vs creator/development).
- Keep skill text concise; move deep details to references when needed.
- Keep `agents/openai.yaml` aligned with each skill's actual trigger and scope.
