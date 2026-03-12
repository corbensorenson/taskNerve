import type { ZodType } from "zod";
export interface JsonOptionalReadResult<T> {
    value: T | null;
    raw: string | null;
}
export declare function formatPrettyJson(value: unknown): string;
export declare function readJsonOptionalWithRaw<T>(filePath: string, schema: ZodType<T>): Promise<JsonOptionalReadResult<T>>;
export declare function readJsonOptional<T>(filePath: string, schema: ZodType<T>): Promise<T | null>;
export declare function writePrettyJson(filePath: string, value: unknown): Promise<void>;
export declare function writePrettyJsonIfChanged(filePath: string, value: unknown, options?: {
    existingRaw?: string | null;
}): Promise<boolean>;
//# sourceMappingURL=jsonStore.d.ts.map