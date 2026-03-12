export interface ControllerBootstrapOptions {
    projectName: string;
    repoRoot: string;
    projectGoalsPath?: string;
    projectManifestPath?: string;
    currentStateSignals?: string[];
    timelineSignals?: string[];
    queueSummary?: string;
    maintenanceCadence?: string;
    heartbeatCore?: string | null;
    lowQueuePrompt?: string;
}
export declare function buildControllerBootstrapPrompt(options: ControllerBootstrapOptions): string;
//# sourceMappingURL=controllerBootstrap.d.ts.map