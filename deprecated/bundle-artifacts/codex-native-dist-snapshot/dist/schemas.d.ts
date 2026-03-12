import { z } from "zod";
export declare const taskStatusSchema: z.ZodEnum<{
    open: "open";
    claimed: "claimed";
    blocked: "blocked";
    done: "done";
}>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export declare const intelligenceLevelSchema: z.ZodEnum<{
    low: "low";
    medium: "medium";
    high: "high";
    max: "max";
}>;
export type IntelligenceLevel = z.infer<typeof intelligenceLevelSchema>;
export declare const taskSchema: z.ZodObject<{
    task_id: z.ZodString;
    title: z.ZodString;
    detail: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    priority: z.ZodDefault<z.ZodNumber>;
    tags: z.ZodDefault<z.ZodArray<z.ZodString>>;
    depends_on: z.ZodDefault<z.ZodArray<z.ZodString>>;
    status: z.ZodDefault<z.ZodEnum<{
        open: "open";
        claimed: "claimed";
        blocked: "blocked";
        done: "done";
    }>>;
    ready: z.ZodOptional<z.ZodBoolean>;
    claimed_by_agent_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    suggested_intelligence: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
        low: "low";
        medium: "medium";
        high: "high";
        max: "max";
    }>>>;
    suggested_model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
export type TaskRecord = z.infer<typeof taskSchema>;
export declare const projectCodexSettingsSchema: z.ZodObject<{
    schema_version: z.ZodDefault<z.ZodString>;
    updated_at_utc: z.ZodString;
    heartbeat_message_core: z.ZodString;
    low_queue_controller_prompt: z.ZodString;
    low_queue_controller_enabled: z.ZodDefault<z.ZodBoolean>;
    worker_single_message_mode: z.ZodDefault<z.ZodBoolean>;
    worker_model_routing_enabled: z.ZodDefault<z.ZodBoolean>;
    worker_default_model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    controller_default_model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    low_intelligence_model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    medium_intelligence_model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    high_intelligence_model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    max_intelligence_model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    git_origin_url: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
export type ProjectCodexSettings = z.infer<typeof projectCodexSettingsSchema>;
export declare const registeredProjectSchema: z.ZodObject<{
    name: z.ZodString;
    repo_root: z.ZodString;
    added_at_utc: z.ZodString;
    updated_at_utc: z.ZodString;
    last_activity_at_utc: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    last_opened_at_utc: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
export type RegisteredProject = z.infer<typeof registeredProjectSchema>;
export declare const projectRegistrySchema: z.ZodObject<{
    schema_version: z.ZodDefault<z.ZodString>;
    updated_at_utc: z.ZodString;
    default_project: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    projects: z.ZodDefault<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        repo_root: z.ZodString;
        added_at_utc: z.ZodString;
        updated_at_utc: z.ZodString;
        last_activity_at_utc: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        last_opened_at_utc: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export type ProjectRegistry = z.infer<typeof projectRegistrySchema>;
export declare const promptQueueRequestSchema: z.ZodObject<{
    prompt_id: z.ZodString;
    agent_id: z.ZodString;
    thread_id: z.ZodString;
    status: z.ZodDefault<z.ZodEnum<{
        error: "error";
        pending: "pending";
        running: "running";
        sent: "sent";
        skipped: "skipped";
    }>>;
}, z.core.$strip>;
export type PromptQueueRequest = z.infer<typeof promptQueueRequestSchema>;
//# sourceMappingURL=schemas.d.ts.map