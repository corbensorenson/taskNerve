import { stat } from "node:fs/promises";
import { SCHEMA_PROJECTS, nowIsoUtc } from "../constants.js";
import { projectRegistrySchema } from "../schemas.js";
import { formatPrettyJson, readJsonOptionalWithRaw, writePrettyJsonIfChanged, } from "./jsonStore.js";
import { taskNerveProjectsRegistryPath } from "./paths.js";
const FILE_MISSING_MTIME_MS = -1;
const projectRegistryCache = new Map();
const projectRegistryInflight = new Map();
async function fileMtimeMs(filePath) {
    try {
        const metadata = await stat(filePath);
        return metadata.mtimeMs;
    }
    catch (error) {
        if (error.code === "ENOENT") {
            return FILE_MISSING_MTIME_MS;
        }
        throw error;
    }
}
export async function loadProjectRegistry(env = process.env) {
    const filePath = taskNerveProjectsRegistryPath(env);
    const inflight = projectRegistryInflight.get(filePath);
    if (inflight) {
        return inflight;
    }
    const promise = (async () => {
        const currentMtimeMs = await fileMtimeMs(filePath);
        const cached = projectRegistryCache.get(filePath);
        if (cached && cached.mtimeMs === currentMtimeMs) {
            return cached.value;
        }
        const { value: current, raw } = await readJsonOptionalWithRaw(filePath, projectRegistrySchema);
        const normalized = projectRegistrySchema.parse(current || {
            schema_version: SCHEMA_PROJECTS,
            updated_at_utc: nowIsoUtc(),
            default_project: null,
            projects: [],
        });
        normalized.projects.sort((left, right) => left.name.localeCompare(right.name));
        const wrote = await writePrettyJsonIfChanged(filePath, normalized, { existingRaw: raw });
        const nextMtimeMs = wrote || currentMtimeMs === FILE_MISSING_MTIME_MS ? await fileMtimeMs(filePath) : currentMtimeMs;
        const nextRaw = wrote ? formatPrettyJson(normalized) : raw ?? formatPrettyJson(normalized);
        projectRegistryCache.set(filePath, {
            mtimeMs: nextMtimeMs,
            value: normalized,
            raw: nextRaw,
        });
        return normalized;
    })();
    projectRegistryInflight.set(filePath, promise);
    return promise.finally(() => {
        projectRegistryInflight.delete(filePath);
    });
}
export async function writeProjectRegistry(registry, env = process.env) {
    const filePath = taskNerveProjectsRegistryPath(env);
    const normalized = projectRegistrySchema.parse(registry);
    normalized.projects.sort((left, right) => left.name.localeCompare(right.name));
    const currentMtimeMs = await fileMtimeMs(filePath);
    const cached = projectRegistryCache.get(filePath);
    const existingRaw = cached && cached.mtimeMs === currentMtimeMs ? cached.raw : undefined;
    const wrote = await writePrettyJsonIfChanged(filePath, normalized, { existingRaw });
    const nextMtimeMs = wrote || currentMtimeMs === FILE_MISSING_MTIME_MS ? await fileMtimeMs(filePath) : currentMtimeMs;
    projectRegistryCache.set(filePath, {
        mtimeMs: nextMtimeMs,
        value: normalized,
        raw: formatPrettyJson(normalized),
    });
    return normalized;
}
//# sourceMappingURL=projectRegistryStore.js.map