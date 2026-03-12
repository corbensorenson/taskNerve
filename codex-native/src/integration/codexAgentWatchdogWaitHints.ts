const WAIT_HINT_PHRASES = [
  "waiting for",
  "monitoring",
  "polling",
  "still running",
  "in progress",
  "this may take",
  "can take",
  "check back",
  "will update when",
  "i'll update when",
  "watching",
  "sleeping before retry",
];

const WAIT_HINT_VERBS = [
  "wait",
  "waiting",
  "monitor",
  "monitoring",
  "poll",
  "polling",
  "watch",
  "watching",
  "sleep",
  "sleeping",
  "backoff",
  "retrying",
];

const WAIT_HINT_LONG_RUN_TARGETS = [
  "training",
  "train",
  "finetune",
  "fine-tune",
  "benchmark",
  "build",
  "compile",
  "test",
  "tests",
  "integration",
  "eval",
  "evaluation",
  "deploy",
  "migration",
  "index",
  "indexing",
  "sync",
  "upload",
  "download",
  "backup",
  "restore",
  "job",
  "run",
  "pipeline",
];

const WAIT_HINT_DURATION_PATTERN =
  /\b(\d+(?:\.\d+)?)\s*(seconds?|secs?|sec|s|minutes?|mins?|min|m|hours?|hrs?|hr|h)\b/g;
const WAIT_HINT_MAX_DURATION_MINUTES = 7 * 24 * 60;

function hasAnyTerm(text: string, terms: string[]): boolean {
  for (const term of terms) {
    if (text.includes(term)) {
      return true;
    }
  }
  return false;
}

function unitToMinutes(unit: string): number | null {
  const normalized = unit.toLowerCase();
  if (
    normalized === "s" ||
    normalized === "sec" ||
    normalized === "secs" ||
    normalized === "second" ||
    normalized === "seconds"
  ) {
    return 1 / 60;
  }
  if (
    normalized === "m" ||
    normalized === "min" ||
    normalized === "mins" ||
    normalized === "minute" ||
    normalized === "minutes"
  ) {
    return 1;
  }
  if (
    normalized === "h" ||
    normalized === "hr" ||
    normalized === "hrs" ||
    normalized === "hour" ||
    normalized === "hours"
  ) {
    return 60;
  }
  return null;
}

function parseDurationMinutesFromText(normalizedText: string): number | null {
  let totalMinutes = 0;
  let sawDuration = false;
  for (const match of normalizedText.matchAll(WAIT_HINT_DURATION_PATTERN)) {
    const amount = Number.parseFloat(match[1] ?? "");
    const unit = unitToMinutes(match[2] ?? "");
    if (!Number.isFinite(amount) || amount <= 0 || unit === null) {
      continue;
    }
    totalMinutes += amount * unit;
    sawDuration = true;
    if (totalMinutes >= WAIT_HINT_MAX_DURATION_MINUTES) {
      return WAIT_HINT_MAX_DURATION_MINUTES;
    }
  }
  if (!sawDuration) {
    return null;
  }
  return totalMinutes;
}

export interface WaitHintParseResult {
  suggests_wait: boolean;
  duration_minutes: number | null;
}

export function statusSuggestsWaiting(status: string | null): boolean {
  const normalized = (status || "").toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized.includes("wait") ||
    normalized.includes("poll") ||
    normalized.includes("sleep") ||
    normalized.includes("retry") ||
    normalized.includes("backoff") ||
    normalized.includes("await")
  );
}

export function parseWaitHintDetailsFromText(text: string | null): WaitHintParseResult {
  if (!text) {
    return {
      suggests_wait: false,
      duration_minutes: null,
    };
  }
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized) {
    return {
      suggests_wait: false,
      duration_minutes: null,
    };
  }
  const parsedDurationMinutes = parseDurationMinutesFromText(normalized);
  const hasPhrase = hasAnyTerm(normalized, WAIT_HINT_PHRASES);
  const hasWaitVerb = hasAnyTerm(normalized, WAIT_HINT_VERBS);
  const hasLongRunTarget = hasAnyTerm(normalized, WAIT_HINT_LONG_RUN_TARGETS);
  const hasDuration = parsedDurationMinutes !== null;
  const suggestsWait =
    hasPhrase || (hasWaitVerb && hasLongRunTarget) || (hasWaitVerb && hasDuration);
  return {
    suggests_wait: suggestsWait,
    duration_minutes: suggestsWait ? parsedDurationMinutes : null,
  };
}

export function parseWaitHintFromText(text: string | null): boolean {
  return parseWaitHintDetailsFromText(text).suggests_wait;
}
