# Deprecated

This directory is reserved for code that has already been removed from the live TaskNerve runtime.

Rust is not moved here yet.

On `codex/codex-native`, the current app still depends on the Rust runtime for:
- task and project persistence
- Codex patch install/sync/uninstall
- native panel transport and localhost APIs
- controller and worker orchestration state

Moving `src/main.rs` here before the native runtime reaches parity would break the working product.

Use these documents before archiving any Rust runtime code:
- `/Users/adimus/Documents/taskNerve/docs/codex_native_cutover_audit.md`
- `/Users/adimus/Documents/taskNerve/docs/codex_native_integration_plan.md`
