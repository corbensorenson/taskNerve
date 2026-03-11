import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
export function formatPrettyJson(value) {
    return `${JSON.stringify(value, null, 2)}\n`;
}
export async function readJsonOptionalWithRaw(filePath, schema) {
    try {
        const raw = await readFile(filePath, "utf8");
        return {
            value: schema.parse(JSON.parse(raw)),
            raw,
        };
    }
    catch (error) {
        const code = error.code;
        if (code === "ENOENT") {
            return {
                value: null,
                raw: null,
            };
        }
        throw error;
    }
}
export async function readJsonOptional(filePath, schema) {
    const result = await readJsonOptionalWithRaw(filePath, schema);
    return result.value;
}
export async function writePrettyJson(filePath, value) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, formatPrettyJson(value), "utf8");
}
export async function writePrettyJsonIfChanged(filePath, value, options = {}) {
    const nextRaw = formatPrettyJson(value);
    let currentRaw = options.existingRaw;
    if (currentRaw === undefined) {
        try {
            currentRaw = await readFile(filePath, "utf8");
        }
        catch (error) {
            const code = error.code;
            if (code === "ENOENT") {
                currentRaw = null;
            }
            else {
                throw error;
            }
        }
    }
    if (currentRaw === nextRaw) {
        return false;
    }
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, nextRaw, "utf8");
    return true;
}
//# sourceMappingURL=jsonStore.js.map