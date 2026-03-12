export interface ProjectContractSummary {
    repoName: string;
    repoRoot: string;
    languages?: string[];
    toolchains?: string[];
    libraries?: string[];
    patterns?: string[];
    notableFiles?: string[];
    topLevelEntries?: string[];
    suggestedCommands?: string[];
    generatedAt?: string;
}
export declare function renderMarkdownBullets(items: string[] | undefined, fallback: string): string;
export declare function renderProjectGoalsTemplate(summary: ProjectContractSummary): string;
export declare function renderProjectManifestTemplate(summary: ProjectContractSummary): string;
//# sourceMappingURL=projectContracts.d.ts.map