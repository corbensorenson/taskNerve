import { type ProjectCodexSettings } from "../schemas.js";
export declare function loadProjectCodexSettings(options: {
    repoRoot: string;
    gitOriginUrl?: string | null;
}): Promise<ProjectCodexSettings>;
export declare function writeProjectCodexSettings(repoRoot: string, settings: Partial<ProjectCodexSettings>): Promise<ProjectCodexSettings>;
export declare function projectCodexSettingsPayload(options: {
    repoRoot: string;
    gitOriginUrl?: string | null;
}): Promise<{
    actual_git_origin_url: string | null;
    schema_version: string;
    updated_at_utc: string;
    heartbeat_message_core: string;
    low_queue_controller_prompt: string;
    low_queue_controller_enabled: boolean;
    worker_single_message_mode: boolean;
    worker_model_routing_enabled: boolean;
    worker_default_model?: string | null | undefined;
    controller_default_model?: string | null | undefined;
    low_intelligence_model?: string | null | undefined;
    medium_intelligence_model?: string | null | undefined;
    high_intelligence_model?: string | null | undefined;
    max_intelligence_model?: string | null | undefined;
    git_origin_url?: string | null | undefined;
}>;
//# sourceMappingURL=projectCodexSettingsStore.d.ts.map