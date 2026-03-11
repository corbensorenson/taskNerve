import { INTELLIGENCE_LEVELS } from "../constants.js";
import type { ProjectCodexSettings, TaskRecord } from "../schemas.js";
export declare function normalizeIntelligence(value: unknown): (typeof INTELLIGENCE_LEVELS)[number] | null;
export declare function defaultProjectCodexSettings(options?: {
    nowIso?: string;
    gitOriginUrl?: string | null;
}): ProjectCodexSettings;
export declare function normalizeProjectCodexSettings(value?: Partial<ProjectCodexSettings>, options?: {
    nowIso?: string;
    gitOriginUrl?: string | null;
}): ProjectCodexSettings;
export declare function resolveControllerModel(settings: Partial<ProjectCodexSettings>): string | null;
export declare function resolveControllerModelFromNormalizedSettings(settings: ProjectCodexSettings): string | null;
export declare function resolveWorkerModelForTaskWithNormalizedSettings(settings: ProjectCodexSettings, task?: Partial<TaskRecord>): string | null;
export declare function resolveWorkerModelForTask(settings: Partial<ProjectCodexSettings>, task?: Partial<TaskRecord>): string | null;
//# sourceMappingURL=projectCodexSettings.d.ts.map