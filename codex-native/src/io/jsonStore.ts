import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ZodType } from "zod";

export interface JsonOptionalReadResult<T> {
  value: T | null;
  raw: string | null;
}

function formatPrettyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function readJsonOptionalWithRaw<T>(
  filePath: string,
  schema: ZodType<T>,
): Promise<JsonOptionalReadResult<T>> {
  try {
    const raw = await readFile(filePath, "utf8");
    return {
      value: schema.parse(JSON.parse(raw)),
      raw,
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return {
        value: null,
        raw: null,
      };
    }
    throw error;
  }
}

export async function readJsonOptional<T>(
  filePath: string,
  schema: ZodType<T>,
): Promise<T | null> {
  const result = await readJsonOptionalWithRaw(filePath, schema);
  return result.value;
}

export async function writePrettyJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, formatPrettyJson(value), "utf8");
}

export async function writePrettyJsonIfChanged(
  filePath: string,
  value: unknown,
  options: { existingRaw?: string | null } = {},
): Promise<boolean> {
  const nextRaw = formatPrettyJson(value);
  let currentRaw = options.existingRaw;
  if (currentRaw === undefined) {
    try {
      currentRaw = await readFile(filePath, "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        currentRaw = null;
      } else {
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
