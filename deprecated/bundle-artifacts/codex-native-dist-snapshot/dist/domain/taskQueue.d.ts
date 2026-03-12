import type { PromptQueueRequest, TaskRecord } from "../schemas.js";
export declare function taskUserTags(task: Partial<TaskRecord>): string[];
export declare function sortTasks(tasks: Partial<TaskRecord>[]): Partial<TaskRecord>[];
export declare function filterTasks(tasks: Partial<TaskRecord>[], search?: string, options?: {
    alreadySorted?: boolean;
}): Partial<TaskRecord>[];
export declare function buildProjectTaskStats(tasks: Partial<TaskRecord>[]): {
    total: number;
    open: number;
    claimed: number;
    blocked: number;
    done: number;
    ready: number;
};
export declare function mergePromptQueue(queue: Partial<PromptQueueRequest>[], request: Partial<PromptQueueRequest>, options?: {
    singleMessageMode?: boolean;
}): {
    queue: Partial<{
        prompt_id: string;
        agent_id: string;
        thread_id: string;
        status: "error" | "pending" | "running" | "sent" | "skipped";
    }>[];
    replaced_pending: boolean;
    running_inflight: boolean;
};
//# sourceMappingURL=taskQueue.d.ts.map