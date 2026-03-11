import { PROJECT_GOALS_FILE, PROJECT_MANIFEST_FILE, nowIsoUtc } from "../constants.js";
export function renderMarkdownBullets(items = [], fallback) {
    if (items.length === 0) {
        return `- ${fallback}`;
    }
    return items.map((line) => `- ${line}`).join("\n");
}
export function renderProjectGoalsTemplate(summary) {
    const generatedAt = summary.generatedAt ?? nowIsoUtc();
    return `# Project Goals

Status: draft
Managed by: TaskNerve
Last generated: ${generatedAt}

This file locks the user-approved outcomes for this project. Update it when goals change. Technical implementation choices belong in \`${PROJECT_MANIFEST_FILE}\`.

## Current Project Snapshot
- Repository: \`${summary.repoName}\`
- Repo root: \`${summary.repoRoot}\`

### Detected languages
${renderMarkdownBullets(summary.languages, "Fill in the primary implementation language once the project is reviewed.")}

### Detected toolchains and package managers
${renderMarkdownBullets(summary.toolchains, "Fill in the intended build and package toolchain.")}

### Notable files
${renderMarkdownBullets(summary.notableFiles, "Add the most important files or directories once they are identified.")}

### Current project structure signals
${renderMarkdownBullets(summary.patterns, "Describe the repo layout and architectural shape after the first review pass.")}

## Overarching Goals
- [ ] Define the primary outcome this project must achieve.
- [ ] Define the next major milestone that matters most right now.
- [ ] Define the quality bar that decides when the project is meaningfully "done".

## Non-Goals
- [ ] Record work that this project should explicitly avoid.

## Constraints
- [ ] Record hard constraints: platform, compatibility, performance, cost, UX, security, deadline, or legal requirements.

## Open Questions For The User
- [ ] Which outcome matters most right now?
- [ ] Which tradeoffs are unacceptable?
- [ ] Which parts of the current repo are experimental versus locked in?
- [ ] What would make the project feel complete?

## Lock Status
- [ ] Mark this file as locked once the user and controller agree the goals are stable.
`;
}
export function renderProjectManifestTemplate(summary) {
    const generatedAt = summary.generatedAt ?? nowIsoUtc();
    return `# Project Manifest

Status: draft
Managed by: TaskNerve
Last generated: ${generatedAt}

This file locks the technical contract for how \`${PROJECT_GOALS_FILE}\` will be achieved. Use it to record approved languages, libraries, software patterns, commands, and engineering constraints.

## Current Technical Snapshot
- Repository: \`${summary.repoName}\`
- Repo root: \`${summary.repoRoot}\`

### Languages and runtimes detected
${renderMarkdownBullets(summary.languages, "Fill in the intended implementation language and runtime targets.")}

### Toolchains and package managers detected
${renderMarkdownBullets(summary.toolchains, "Fill in the intended toolchain and package manager.")}

### Likely frameworks and libraries detected
${renderMarkdownBullets(summary.libraries, "Fill in the approved core libraries or frameworks after review.")}

### Notable files
${renderMarkdownBullets(summary.notableFiles, "Add the main entrypoints, docs, or config files once identified.")}

### Current project structure signals
${renderMarkdownBullets(summary.patterns, "Describe the architectural patterns the repo should follow.")}

### Suggested working commands
${renderMarkdownBullets(summary.suggestedCommands, "Add build, test, run, and lint commands after the first controller pass.")}

### Top-level entries
${renderMarkdownBullets(summary.topLevelEntries, "Record the top-level repo layout after initial review.")}

## Technical Contract

### Languages and runtimes
- Primary implementation language(s):
- Approved secondary language(s):
- Runtime targets and supported platforms:

### Libraries and frameworks
- Preferred libraries and frameworks:
- Libraries that should be avoided unless explicitly approved:

### Architecture and software patterns
- Module or service boundaries:
- State and data-flow rules:
- Error handling and logging expectations:
- Concurrency, async, or threading model:
- UI, API, or storage patterns that should be followed:

### Quality gates
- Required build, lint, test, and verification commands:
- Required review expectations:
- Required docs or release notes updates:

### Delivery rules
- Migration and compatibility strategy:
- Performance, security, and cost constraints:
- Rules for introducing new dependencies or patterns:

## Open Questions For The User
- [ ] Which current stack choices are intentional versus historical accidents?
- [ ] Which libraries are mandatory versus replaceable?
- [ ] Which software patterns should never be introduced here?
- [ ] Which quality gates are non-negotiable before work is considered done?

## Lock Status
- [ ] Mark this file as locked once the user and controller agree the technical contract is stable.
`;
}
//# sourceMappingURL=projectContracts.js.map