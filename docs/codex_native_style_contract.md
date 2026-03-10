# Codex TaskNerve Style Contract

Date: 2026-03-10
Source: local inspection of `/Applications/Codex.app`

## Observed Codex Desktop Shape

The installed Codex desktop app is not Rust-native. It is an Electron application built around a TypeScript/JavaScript runtime.

Observed from the shipped app bundle:
- `app.asar` contains `.vite/build/main.js`
- `app.asar` contains `.vite/build/preload.js`
- package metadata reports `name: openai-codex-electron`
- the shipped package scripts are TypeScript-first
- tests run through Vitest
- runtime validation/tooling already includes `zod`

## Required TaskNerve Native Conventions

To stay as close as possible to Codex's original implementation model, native TaskNerve work should follow these rules:

1. TypeScript-first
- New native modules belong in `codex-native/` as `.ts`
- Do not add new product logic to Rust unless it is required for compatibility during cutover

2. Electron-compatible boundaries
- Keep a clear split between future `main`, `preload`, and `renderer` responsibilities
- Do not design the steady-state product around a localhost sidecar

3. Repo-local durable state
- Keep `.tasknerve/`, `project_goals.md`, and `project_manifest.md` as the durable source of truth
- Native modules should read and write those files directly

4. Runtime validation
- Use `zod` for TaskNerve state contracts that cross process or persistence boundaries

5. Testing style
- Use Vitest for native module tests
- Keep portable domain logic independent from the temporary Rust runtime

6. Host integration
- Reuse Codex workspace, thread, settings, auth, and git surfaces instead of reproducing them in TaskNerve

## Immediate Implication

TaskNerve is closest to Codex when:
- orchestration logic lives in TypeScript
- state is repo-local
- UI and thread orchestration use Codex-native host services
- Rust is reduced to a temporary migration layer and then removed
