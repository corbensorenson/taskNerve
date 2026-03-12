# TaskNerve Project Goals

Project: taskNerve
Status: active
Owner: TaskNerve controller

## Mission
Deliver a Codex-native TaskNerve runtime that stays responsive under heavy multi-project, multi-agent usage while remaining deterministic and recoverable.

## Product Outcomes
- Sidebar project management feels fast and stable under large project counts.
- Each project has an obvious designated controller thread and a grouped agents section.
- Required TaskNerve contracts are always present and editable in-app.
- Multi-window flow is first-class so one project can map cleanly to one window.

## Performance Outcomes
- Avoid polling churn when host events are available.
- Keep idle CPU/GPU overhead low while many projects are open.
- Minimize unnecessary rerenders and duplicated persisted-state loads.
- Keep bridge calls resilient to startup races and transient local failures.

## Reliability Outcomes
- No gray-screen or startup crash regressions from runtime patches.
- Deterministic project onboarding and import path every time.
- Controller reset/recovery path is explicit and safe.
- Required docs and launch script are auto-provisioned.

## UX Outcomes
- Built-in markdown editing is wide, comfortable, and reliable for long-form writing.
- Project actions are discoverable and consistent in the sidebar.
- Thread navigation aids (jump controls, timestamps, controller labeling) feel native.

## Non-Goals
- No parallel runtime targets for the same shipped behavior.
- No hidden magic state transitions that bypass project contracts.

## Definition Of Done
- Controller orchestration stays healthy while scaling active agents.
- Required contracts are current and used in real workflow.
- Core UI operations remain responsive and predictable.
