use std::{
    cmp::Ordering,
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Command as ProcessCommand, ExitCode, Stdio},
    time::UNIX_EPOCH,
};

use anyhow::{Context, Result, anyhow, bail};
use chrono::{DateTime, Duration, Utc};
use clap::{Parser, Subcommand, ValueEnum};
use globset::Glob;
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use rayon::prelude::*;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::json;
use sha2::{Digest, Sha256};
use uuid::Uuid;
use walkdir::WalkDir;

const TIMELINE_ROOT_DIR: &str = ".fugit";
const SCHEMA_CONFIG: &str = "timeline.config.v1";
const SCHEMA_BRANCHES: &str = "timeline.branches.v1";
const SCHEMA_FILE_RECORD: &str = "timeline.file_record.v1";
const SCHEMA_EVENT: &str = "timeline.event.v1";
const SCHEMA_LOCKS: &str = "timeline.locks.v1";
const SCHEMA_TASKS: &str = "timeline.tasks.v1";
const SCHEMA_PROJECTS: &str = "fugit.projects.v1";
const SCHEMA_BRIDGE_AUTH: &str = "timeline.bridge_auth.v1";
const SCHEMA_BRIDGE_AUTO_SYNC: &str = "timeline.bridge_auto_sync.v1";
const SCHEMA_BRIDGE_AUTO_SYNC_LOCK: &str = "timeline.bridge_auto_sync_lock.v1";
const BACKEND_MODE_GIT_BRIDGE: &str = "git_bridge";
const BACKEND_MODE_FUGIT_CLOUD: &str = "fugit_cloud";
const AUTO_REPLENISH_SOURCE_PLAN: &str = ".fugit:auto_replenish";
const SYSTEM_AGENT_ID: &str = "fugit.system";
const AUTO_BRIDGE_SYNC_STALE_MINUTES: i64 = 30;
const TASK_GUI_MAX_REQUEST_BYTES: usize = 1024 * 1024;
const FUGIT_SKILL_ID: &str = "fugit";
const FUGIT_SKILL_MD: &str = include_str!("../skills/fugit/SKILL.md");
const FUGIT_SKILL_OPENAI_YAML: &str = include_str!("../skills/fugit/agents/openai.yaml");
const FUGIT_SKILL_REF_WORKFLOW_PROFILES: &str =
    include_str!("../skills/fugit/references/workflow-profiles.md");
const FUGIT_SKILL_REF_RECOVERY_PLAYBOOKS: &str =
    include_str!("../skills/fugit/references/recovery-playbooks.md");

const IGNORE_ROOT_ENTRIES: &[&str] = &[
    ".git",
    ".fugit",
    ".tmp",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    ".turbo",
    ".cache",
    ".idea",
    ".vscode",
];

#[derive(Debug, Parser)]
#[command(name = "fugit")]
#[command(version = env!("CARGO_PKG_VERSION"))]
#[command(about = "Timeline-first versioning with GitHub bridge for multi-agent work")]
struct Cli {
    #[arg(long, default_value = ".")]
    repo_root: PathBuf,
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    Init(InitArgs),
    Quickstart(QuickstartArgs),
    Doctor(DoctorArgs),
    Skill(SkillArgs),
    Status(StatusArgs),
    Checkpoint(CheckpointArgs),
    Log(LogArgs),
    Branch(BranchArgs),
    Backend(BackendArgs),
    Bridge(BridgeArgs),
    Checkout(CheckoutArgs),
    Gc(GcArgs),
    Lock(LockArgs),
    Task(TaskArgs),
    Project(ProjectArgs),
    Mcp(McpArgs),
}

#[derive(Debug, Parser)]
struct SkillArgs {
    #[command(subcommand)]
    action: SkillAction,
}

#[derive(Debug, Subcommand)]
enum SkillAction {
    Show {
        #[arg(long, default_value_t = false)]
        json: bool,
        #[arg(long, default_value_t = false)]
        include_openai_yaml: bool,
    },
    InstallCodex {
        #[arg(long, default_value_t = false)]
        overwrite: bool,
    },
    Doctor {
        #[arg(long, default_value_t = false)]
        json: bool,
    },
}

#[derive(Debug, Parser)]
struct InitArgs {
    #[arg(long, default_value = "trunk")]
    branch: String,
    #[arg(long)]
    bridge_branch: Option<String>,
    #[arg(long, default_value = "origin")]
    bridge_remote: String,
}

#[derive(Debug, Parser)]
struct QuickstartArgs {
    #[arg(long, default_value = "trunk")]
    branch: String,
    #[arg(long)]
    summary: Option<String>,
    #[arg(long)]
    agent: Option<String>,
    #[arg(long = "tag")]
    tags: Vec<String>,
    #[arg(long, default_value_t = false)]
    status_only: bool,
}

#[derive(Debug, Parser)]
struct DoctorArgs {
    #[arg(long, default_value_t = false)]
    json: bool,
    #[arg(long, default_value_t = false)]
    fix: bool,
}

#[derive(Debug, Parser)]
struct StatusArgs {
    #[arg(long, default_value_t = 50)]
    limit: usize,
    #[arg(long, default_value_t = false)]
    json: bool,
    #[arg(long, default_value_t = false)]
    strict_hash: bool,
    #[arg(long)]
    hash_jobs: Option<usize>,
    #[arg(long, default_value_t = false)]
    burst: bool,
}

#[derive(Debug, Parser)]
struct CheckpointArgs {
    #[arg(long)]
    summary: String,
    #[arg(long)]
    agent: Option<String>,
    #[arg(long = "tag")]
    tags: Vec<String>,
    #[arg(long = "file")]
    files: Vec<String>,
    #[arg(long, default_value_t = false)]
    strict_hash: bool,
    #[arg(long, default_value_t = false)]
    ignore_locks: bool,
    #[arg(long)]
    hash_jobs: Option<usize>,
    #[arg(long)]
    object_jobs: Option<usize>,
    #[arg(long, default_value_t = false)]
    burst: bool,
    #[arg(long, value_enum, default_value_t = CheckpointRepairModeArg::Auto)]
    repair: CheckpointRepairModeArg,
    #[arg(long, hide = true, default_value_t = false)]
    allow_lossy_repair: bool,
    #[arg(long, default_value_t = false)]
    json: bool,
}

#[derive(Debug, Parser)]
struct LogArgs {
    #[arg(long, default_value_t = 20)]
    limit: usize,
    #[arg(long, default_value_t = false)]
    json: bool,
    #[arg(long)]
    branch: Option<String>,
}

#[derive(Debug, Parser)]
struct BranchArgs {
    #[command(subcommand)]
    action: BranchAction,
}

#[derive(Debug, Subcommand)]
enum BranchAction {
    List,
    Create {
        name: String,
        #[arg(long, default_value_t = false)]
        switch: bool,
    },
    Switch {
        name: String,
    },
}

#[derive(Debug, Parser)]
struct BackendArgs {
    #[command(subcommand)]
    action: BackendAction,
}

#[derive(Debug, Subcommand)]
enum BackendAction {
    Show {
        #[arg(long, default_value_t = false)]
        json: bool,
    },
    Set {
        #[arg(long, value_enum)]
        mode: BackendModeArg,
        #[arg(long)]
        cloud_endpoint: Option<String>,
        #[arg(long)]
        storage_namespace: Option<String>,
        #[arg(long)]
        billing_account_id: Option<String>,
        #[arg(long)]
        bridge_remote: Option<String>,
        #[arg(long)]
        bridge_branch: Option<String>,
    },
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum BackendModeArg {
    GitBridge,
    FugitCloud,
}

#[derive(Debug, Parser)]
struct BridgeArgs {
    #[command(subcommand)]
    action: BridgeAction,
}

#[derive(Debug, Subcommand)]
enum BridgeAction {
    Summary {
        #[arg(long, default_value_t = 20)]
        limit: usize,
        #[arg(long, default_value_t = false)]
        markdown: bool,
    },
    Auth(BridgeAuthArgs),
    AutoSync {
        #[command(subcommand)]
        action: BridgeAutoSyncAction,
    },
    SyncGithub {
        #[arg(long)]
        remote: Option<String>,
        #[arg(long)]
        branch: Option<String>,
        #[arg(long, default_value_t = 10)]
        event_count: usize,
        #[arg(long, default_value_t = false)]
        no_push: bool,
        #[arg(long)]
        pack_threads: Option<usize>,
        #[arg(long, default_value_t = false)]
        burst_push: bool,
        #[arg(long, default_value_t = false)]
        repair_journal: bool,
        #[arg(long)]
        note: Option<String>,
        #[arg(long, default_value_t = false)]
        background: bool,
        #[arg(long, hide = true, default_value_t = false)]
        background_worker: bool,
        #[arg(long, hide = true)]
        trigger: Option<String>,
    },
    PullGithub {
        #[arg(long)]
        remote: Option<String>,
        #[arg(long)]
        branch: Option<String>,
        #[arg(long, default_value_t = false)]
        ff_only: bool,
        #[arg(long, default_value_t = false)]
        rebase: bool,
        #[arg(long, default_value_t = false)]
        autostash: bool,
    },
}

#[derive(Debug, Parser)]
struct BridgeAuthArgs {
    #[command(subcommand)]
    action: BridgeAuthAction,
}

#[derive(Debug, Subcommand)]
enum BridgeAuthAction {
    Status {
        #[arg(long)]
        remote: Option<String>,
        #[arg(long)]
        host: Option<String>,
        #[arg(long, default_value_t = false)]
        json: bool,
    },
    Login {
        #[arg(long)]
        remote: Option<String>,
        #[arg(long)]
        host: Option<String>,
        #[arg(long)]
        username: Option<String>,
        #[arg(long)]
        token: Option<String>,
        #[arg(long, default_value = "FUGIT_GIT_TOKEN")]
        token_env: String,
        #[arg(long)]
        helper: Option<String>,
    },
    Logout {
        #[arg(long)]
        remote: Option<String>,
        #[arg(long)]
        host: Option<String>,
        #[arg(long)]
        username: Option<String>,
    },
}

#[derive(Debug, Subcommand)]
enum BridgeAutoSyncAction {
    Show {
        #[arg(long, default_value_t = false)]
        json: bool,
    },
    Set {
        #[arg(long)]
        enabled: Option<bool>,
        #[arg(long)]
        on_task_done: Option<bool>,
        #[arg(long)]
        event_count: Option<usize>,
        #[arg(long)]
        no_push: Option<bool>,
        #[arg(long, default_value_t = false)]
        json: bool,
    },
}

#[derive(Debug, Parser)]
struct CheckoutArgs {
    #[arg(long)]
    event: Option<String>,
    #[arg(long)]
    branch: Option<String>,
    #[arg(long, default_value_t = false)]
    dry_run: bool,
    #[arg(long, default_value_t = false)]
    force: bool,
    #[arg(long, default_value_t = false)]
    strict_hash: bool,
    #[arg(long, default_value_t = false)]
    move_head: bool,
    #[arg(long)]
    hash_jobs: Option<usize>,
    #[arg(long, default_value_t = false)]
    burst: bool,
}

#[derive(Debug, Parser)]
struct GcArgs {
    #[arg(long, default_value_t = false)]
    dry_run: bool,
    #[arg(long, default_value_t = false)]
    json: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct FileLock {
    lock_id: String,
    pattern: String,
    agent_id: String,
    created_at_utc: String,
    expires_at_utc: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct LockState {
    schema_version: String,
    locks: Vec<FileLock>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum TaskStatus {
    Open,
    Claimed,
    Done,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct FugitTask {
    task_id: String,
    title: String,
    detail: Option<String>,
    priority: i32,
    tags: Vec<String>,
    depends_on: Vec<String>,
    status: TaskStatus,
    created_at_utc: String,
    updated_at_utc: String,
    created_by_agent_id: String,
    claimed_by_agent_id: Option<String>,
    claim_started_at_utc: Option<String>,
    claim_expires_at_utc: Option<String>,
    completed_at_utc: Option<String>,
    completed_by_agent_id: Option<String>,
    #[serde(default)]
    completed_summary: Option<String>,
    #[serde(default)]
    completion_notes: Vec<String>,
    #[serde(default)]
    completion_artifacts: Vec<String>,
    #[serde(default)]
    completion_commands: Vec<String>,
    #[serde(default)]
    source_key: Option<String>,
    #[serde(default)]
    source_plan: Option<String>,
    #[serde(default)]
    awaiting_confirmation: bool,
    #[serde(default)]
    approved_at_utc: Option<String>,
    #[serde(default)]
    approved_by_agent_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TaskState {
    schema_version: String,
    updated_at_utc: String,
    tasks: Vec<FugitTask>,
}

#[derive(Debug, Clone)]
struct TaskImportRow {
    key: String,
    source_key: Option<String>,
    title: String,
    detail: Option<String>,
    priority: Option<i32>,
    tags: Vec<String>,
    depends_on_keys: Vec<String>,
    agent: Option<String>,
}

#[derive(Debug, Clone)]
enum TaskTextPatch {
    Keep,
    Clear,
    Set(String),
}

impl Default for TaskTextPatch {
    fn default() -> Self {
        Self::Keep
    }
}

#[derive(Debug, Clone, Default)]
struct TaskEditPatch {
    title: Option<String>,
    detail: TaskTextPatch,
    priority: Option<i32>,
    tags: Option<Vec<String>>,
    depends_on: Option<Vec<String>>,
}

#[derive(Debug, Clone, Default)]
struct TaskQueryFilter {
    required_tags: Vec<String>,
    focus: Option<String>,
    prefix: Option<String>,
    contains: Option<String>,
}

#[derive(Debug, Clone, Default)]
struct AutoReplenishEnsureResult {
    created_task_ids: Vec<String>,
    updated_task_ids: Vec<String>,
    available_task_ids: Vec<String>,
    pending_confirmation_task_ids: Vec<String>,
    agent_ids: Vec<String>,
}

#[derive(Debug, Clone)]
struct MissingTimelineObject {
    scope: String,
    branch: String,
    event_id: Option<String>,
    edge: Option<String>,
    path: String,
    hash: String,
}

impl MissingTimelineObject {
    fn render(&self) -> String {
        match self.scope.as_str() {
            "index" => format!("index:{}:{} ({})", self.branch, self.path, self.hash),
            "event" => format!(
                "event:{}:{}:{}:{} ({})",
                self.branch,
                self.event_id.as_deref().unwrap_or("unknown"),
                self.edge.as_deref().unwrap_or("unknown"),
                self.path,
                self.hash
            ),
            _ => format!("{}:{} ({})", self.scope, self.path, self.hash),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
struct CheckpointMissingBlob {
    path: String,
    hash: String,
    change_kind: String,
}

#[derive(Debug, Clone, Serialize)]
struct TaskSyncBlockedTask {
    action: String,
    task_id: String,
    title: String,
    reason: String,
}

#[derive(Debug, Clone, Serialize)]
struct TaskSyncTaskRecord {
    task_id: String,
    title: String,
    status: String,
    source_key: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct TaskSyncReport {
    schema_version: String,
    generated_at_utc: String,
    plan: String,
    format: String,
    dry_run: bool,
    keep_missing: bool,
    created: Vec<TaskSyncTaskRecord>,
    updated: Vec<TaskSyncTaskRecord>,
    reopened: Vec<TaskSyncTaskRecord>,
    removed: Vec<TaskSyncTaskRecord>,
    unchanged: Vec<TaskSyncTaskRecord>,
    matched_by_title: Vec<TaskSyncTaskRecord>,
    blocked: Vec<TaskSyncBlockedTask>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RegisteredProject {
    name: String,
    repo_root: String,
    added_at_utc: String,
    updated_at_utc: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ProjectRegistry {
    schema_version: String,
    updated_at_utc: String,
    default_project: Option<String>,
    projects: Vec<RegisteredProject>,
}

#[derive(Debug, Clone, Serialize)]
struct TaskGuiProject {
    key: String,
    name: String,
    repo_root: String,
    is_default: bool,
    is_current_repo: bool,
}

#[derive(Debug, Deserialize)]
struct TaskGuiCreateRequest {
    title: String,
    detail: Option<String>,
    priority: Option<i32>,
    tags: Option<Vec<String>>,
    depends_on: Option<Vec<String>>,
    agent: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TaskGuiEditRequest {
    task_id: String,
    title: Option<String>,
    detail: Option<Option<String>>,
    priority: Option<i32>,
    tags: Option<Vec<String>>,
    depends_on: Option<Vec<String>>,
    agent: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TaskGuiRemoveRequest {
    task_id: String,
    agent: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TaskGuiApproveRequest {
    task_id: Option<String>,
    all_pending_auto_replenish: Option<bool>,
    agent: Option<String>,
}

#[derive(Debug, Parser)]
struct LockArgs {
    #[command(subcommand)]
    action: LockAction,
}

#[derive(Debug, Subcommand)]
enum LockAction {
    List {
        #[arg(long, default_value_t = false)]
        json: bool,
    },
    Add {
        #[arg(long)]
        pattern: String,
        #[arg(long)]
        agent: Option<String>,
        #[arg(long)]
        ttl_minutes: Option<i64>,
    },
    Remove {
        #[arg(long)]
        lock_id: String,
    },
}

#[derive(Debug, Parser)]
struct TaskArgs {
    #[command(subcommand)]
    action: TaskAction,
}

#[derive(Debug, Subcommand)]
enum TaskAction {
    List {
        #[arg(long, default_value_t = false)]
        json: bool,
        #[arg(long, default_value_t = false)]
        jsonl: bool,
        #[arg(long, value_enum)]
        status: Option<TaskStatusArg>,
        #[arg(long)]
        agent: Option<String>,
        #[arg(long, default_value_t = false)]
        ready_only: bool,
        #[arg(long, value_delimiter = ',')]
        fields: Vec<String>,
        #[arg(long, default_value_t = 200)]
        limit: usize,
    },
    Show {
        #[arg(long)]
        task_id: String,
        #[arg(long, default_value_t = false)]
        json: bool,
    },
    Current {
        #[arg(long)]
        agent: Option<String>,
        #[arg(long, default_value_t = false)]
        json: bool,
    },
    Add {
        #[arg(long)]
        title: String,
        #[arg(long)]
        detail: Option<String>,
        #[arg(long)]
        agent: Option<String>,
        #[arg(long, default_value_t = 0)]
        priority: i32,
        #[arg(long = "tag")]
        tags: Vec<String>,
        #[arg(long = "depends-on")]
        depends_on: Vec<String>,
        #[arg(long, default_value_t = false)]
        json: bool,
    },
    Edit {
        #[arg(long)]
        task_id: String,
        #[arg(long)]
        title: Option<String>,
        #[arg(long)]
        detail: Option<String>,
        #[arg(long, default_value_t = false)]
        clear_detail: bool,
        #[arg(long)]
        agent: Option<String>,
        #[arg(long)]
        priority: Option<i32>,
        #[arg(long = "tag")]
        tags: Vec<String>,
        #[arg(long, default_value_t = false)]
        clear_tags: bool,
        #[arg(long = "depends-on")]
        depends_on: Vec<String>,
        #[arg(long, default_value_t = false)]
        clear_depends_on: bool,
        #[arg(long, default_value_t = false)]
        json: bool,
    },
    Remove {
        #[arg(long)]
        task_id: String,
        #[arg(long)]
        agent: Option<String>,
        #[arg(long, default_value_t = false)]
        json: bool,
    },
    Approve {
        #[arg(long)]
        task_id: Option<String>,
        #[arg(long, default_value_t = false)]
        all_pending_auto_replenish: bool,
        #[arg(long)]
        agent: Option<String>,
        #[arg(long, default_value_t = false)]
        json: bool,
    },
    Policy {
        #[command(subcommand)]
        action: TaskPolicyAction,
    },
    Sync {
        #[arg(long)]
        plan: PathBuf,
        #[arg(long)]
        agent: Option<String>,
        #[arg(long, default_value_t = 0)]
        default_priority: i32,
        #[arg(long, value_enum, default_value_t = TaskImportFormatArg::Auto)]
        format: TaskImportFormatArg,
        #[arg(long, default_value_t = false)]
        keep_missing: bool,
        #[arg(long, default_value_t = false)]
        dry_run: bool,
        #[arg(long, default_value_t = false)]
        json: bool,
    },
    Import {
        #[arg(long)]
        file: PathBuf,
        #[arg(long)]
        agent: Option<String>,
        #[arg(long, default_value_t = 0)]
        default_priority: i32,
        #[arg(long, value_enum, default_value_t = TaskImportFormatArg::Auto)]
        format: TaskImportFormatArg,
        #[arg(long, default_value_t = false)]
        dry_run: bool,
        #[arg(long, default_value_t = false)]
        json: bool,
    },
    Request {
        #[arg(long)]
        agent: Option<String>,
        #[arg(long = "tag")]
        tags: Vec<String>,
        #[arg(long)]
        focus: Option<String>,
        #[arg(long)]
        prefix: Option<String>,
        #[arg(long)]
        contains: Option<String>,
        #[arg(long, default_value_t = 1)]
        max: usize,
        #[arg(long, default_value_t = 30)]
        claim_ttl_minutes: i64,
        #[arg(long, default_value_t = 90)]
        steal_after_minutes: i64,
        #[arg(long, default_value_t = false)]
        no_steal: bool,
        #[arg(long, default_value_t = false)]
        skip_owned: bool,
        #[arg(long, default_value_t = false)]
        no_claim: bool,
        #[arg(long, default_value_t = false)]
        json: bool,
    },
    Claim {
        #[arg(long)]
        task_id: String,
        #[arg(long)]
        agent: Option<String>,
        #[arg(long, default_value_t = 30)]
        claim_ttl_minutes: i64,
        #[arg(long, default_value_t = false)]
        steal: bool,
        #[arg(long, default_value_t = false)]
        json: bool,
    },
    Done {
        #[arg(long)]
        task_id: String,
        #[arg(long)]
        agent: Option<String>,
        #[arg(long)]
        summary: Option<String>,
        #[arg(long = "note")]
        notes: Vec<String>,
        #[arg(long = "artifact")]
        artifacts: Vec<String>,
        #[arg(long = "command")]
        commands: Vec<String>,
        #[arg(long, default_value_t = false)]
        json: bool,
    },
    Reopen {
        #[arg(long)]
        task_id: String,
        #[arg(long)]
        agent: Option<String>,
        #[arg(long, default_value_t = false)]
        json: bool,
    },
    Release {
        #[arg(long)]
        task_id: String,
        #[arg(long)]
        agent: Option<String>,
        #[arg(long, default_value_t = false)]
        json: bool,
    },
    Gui {
        #[arg(long)]
        project: Option<String>,
        #[arg(long, default_value = "127.0.0.1")]
        host: String,
        #[arg(long, default_value_t = 7788)]
        port: u16,
        #[arg(long, default_value_t = false)]
        no_open: bool,
        #[arg(long, default_value_t = false)]
        background: bool,
        #[arg(long, default_value_t = false)]
        json: bool,
    },
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum TaskStatusArg {
    Open,
    #[value(alias = "in_progress")]
    Claimed,
    Done,
}

#[derive(Debug, Subcommand)]
enum TaskPolicyAction {
    Show {
        #[arg(long, default_value_t = false)]
        json: bool,
    },
    Set {
        #[arg(long)]
        auto_replenish_enabled: Option<bool>,
        #[arg(long)]
        auto_replenish_confirmation: Option<bool>,
        #[arg(long = "replenish-agent")]
        replenish_agents: Vec<String>,
        #[arg(long, default_value_t = false)]
        clear_replenish_agents: bool,
        #[arg(long)]
        agent: Option<String>,
        #[arg(long, default_value_t = false)]
        json: bool,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
enum TaskImportFormatArg {
    Auto,
    Tsv,
    Markdown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
enum CheckpointRepairModeArg {
    Auto,
    Strict,
    Lossy,
}

#[derive(Debug)]
struct JsonCommandError {
    payload: serde_json::Value,
}

impl std::fmt::Display for JsonCommandError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.payload)
    }
}

impl std::error::Error for JsonCommandError {}

impl TaskStatusArg {
    fn matches(self, status: &TaskStatus) -> bool {
        matches!(
            (self, status),
            (TaskStatusArg::Open, TaskStatus::Open)
                | (TaskStatusArg::Claimed, TaskStatus::Claimed)
                | (TaskStatusArg::Done, TaskStatus::Done)
        )
    }
}

#[derive(Debug, Parser)]
struct ProjectArgs {
    #[command(subcommand)]
    action: ProjectAction,
}

#[derive(Debug, Subcommand)]
enum ProjectAction {
    List {
        #[arg(long, default_value_t = false)]
        json: bool,
    },
    Add {
        #[arg(long)]
        name: String,
        #[arg(long)]
        repo_root: PathBuf,
        #[arg(long, default_value_t = false)]
        set_default: bool,
        #[arg(long, default_value_t = false)]
        json: bool,
    },
    Remove {
        #[arg(long)]
        name: String,
        #[arg(long, default_value_t = false)]
        json: bool,
    },
    Use {
        #[arg(long)]
        name: String,
        #[arg(long, default_value_t = false)]
        json: bool,
    },
}

#[derive(Debug, Parser)]
struct McpArgs {
    #[command(subcommand)]
    action: McpAction,
}

#[derive(Debug, Subcommand)]
enum McpAction {
    Serve,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TimelineConfig {
    schema_version: String,
    repo_root: String,
    created_at_utc: String,
    updated_at_utc: String,
    #[serde(default = "default_backend_mode")]
    backend_mode: String,
    default_bridge_remote: String,
    default_bridge_branch: String,
    #[serde(default)]
    cloud_endpoint: Option<String>,
    #[serde(default)]
    storage_namespace: Option<String>,
    #[serde(default)]
    billing_account_id: Option<String>,
    #[serde(default = "default_auto_bridge_sync_enabled")]
    auto_bridge_sync_enabled: bool,
    #[serde(default = "default_auto_bridge_sync_on_task_done")]
    auto_bridge_sync_on_task_done: bool,
    #[serde(default = "default_auto_bridge_sync_event_count")]
    auto_bridge_sync_event_count: usize,
    #[serde(default = "default_auto_bridge_sync_no_push")]
    auto_bridge_sync_no_push: bool,
    #[serde(default = "default_auto_replenish_enabled")]
    auto_replenish_enabled: bool,
    #[serde(default = "default_auto_replenish_require_confirmation")]
    auto_replenish_require_confirmation: bool,
    #[serde(default)]
    auto_replenish_agents: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BranchPointer {
    name: String,
    head_event_id: Option<String>,
    created_at_utc: String,
    from_branch: Option<String>,
    from_event_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BranchesState {
    schema_version: String,
    active_branch: String,
    branches: BTreeMap<String, BranchPointer>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct FileRecord {
    schema_version: String,
    hash: String,
    size_bytes: u64,
    modified_unix_secs: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum ChangeKind {
    Added,
    Modified,
    Deleted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ChangeRecord {
    path: String,
    kind: ChangeKind,
    old_hash: Option<String>,
    new_hash: Option<String>,
    old_size_bytes: Option<u64>,
    new_size_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct EventMetrics {
    tracked_file_count: usize,
    changed_file_count: usize,
    added_count: usize,
    modified_count: usize,
    deleted_count: usize,
    changed_bytes_total: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TimelineEvent {
    schema_version: String,
    event_id: String,
    created_at_utc: String,
    branch: String,
    parent_event_id: Option<String>,
    agent_id: String,
    summary: String,
    tags: Vec<String>,
    metrics: EventMetrics,
    changes: Vec<ChangeRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BridgeAuthState {
    schema_version: String,
    updated_at_utc: String,
    host: String,
    username: String,
    helper: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BridgeAutoSyncState {
    schema_version: String,
    updated_at_utc: String,
    status: String,
    enabled: bool,
    on_task_done: bool,
    event_count: usize,
    no_push: bool,
    last_requested_at_utc: Option<String>,
    last_started_at_utc: Option<String>,
    last_finished_at_utc: Option<String>,
    last_note: Option<String>,
    last_trigger: Option<String>,
    last_remote: Option<String>,
    last_branch: Option<String>,
    last_result: Option<String>,
    last_error: Option<String>,
    pending_trigger: bool,
    pending_note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BridgeAutoSyncLock {
    schema_version: String,
    lock_id: String,
    created_at_utc: String,
}

#[derive(Debug, Clone)]
struct BridgeSyncGithubOptions {
    remote: String,
    branch: String,
    event_count: usize,
    no_push: bool,
    pack_threads: Option<usize>,
    burst_push: bool,
    repair_journal: bool,
    note: Option<String>,
    trigger: Option<String>,
}

fn main() -> ExitCode {
    match try_main() {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            if let Some(json_err) = err.downcast_ref::<JsonCommandError>() {
                match serde_json::to_string_pretty(&json_err.payload) {
                    Ok(rendered) => println!("{rendered}"),
                    Err(_) => println!("{}", json_err.payload),
                }
            } else {
                eprintln!("Error: {err:#}");
            }
            ExitCode::FAILURE
        }
    }
}

fn try_main() -> Result<()> {
    let cli = Cli::parse();
    let repo_root = resolve_repo_root(&cli.repo_root)?;

    match cli.command {
        Command::Init(args) => cmd_init(&repo_root, args),
        Command::Quickstart(args) => cmd_quickstart(&repo_root, args),
        Command::Doctor(args) => cmd_doctor(&repo_root, args),
        Command::Skill(args) => cmd_skill(args),
        Command::Status(args) => cmd_status(&repo_root, args),
        Command::Checkpoint(args) => cmd_checkpoint(&repo_root, args),
        Command::Log(args) => cmd_log(&repo_root, args),
        Command::Branch(args) => cmd_branch(&repo_root, args),
        Command::Backend(args) => cmd_backend(&repo_root, args),
        Command::Bridge(args) => cmd_bridge(&repo_root, args),
        Command::Checkout(args) => cmd_checkout(&repo_root, args),
        Command::Gc(args) => cmd_gc(&repo_root, args),
        Command::Lock(args) => cmd_lock(&repo_root, args),
        Command::Task(args) => cmd_task(&repo_root, args),
        Command::Project(args) => cmd_project(args),
        Command::Mcp(args) => cmd_mcp(&repo_root, args),
    }
}

fn cmd_init(repo_root: &Path, args: InitArgs) -> Result<()> {
    validate_branch_name(&args.branch)?;
    fs::create_dir_all(timeline_objects_dir(repo_root)).with_context(|| {
        format!(
            "failed creating {}",
            timeline_objects_dir(repo_root).display()
        )
    })?;

    let now = now_utc();
    let detected_branch = detect_git_branch(repo_root).unwrap_or_else(|| args.branch.clone());
    let bridge_branch = args.bridge_branch.unwrap_or(detected_branch);

    let mut config = load_timeline_config_or_default(repo_root)?;
    config.default_bridge_remote = args.bridge_remote;
    config.default_bridge_branch = bridge_branch;
    config.updated_at_utc = now.clone();
    write_pretty_json(&timeline_config_path(repo_root), &config)?;

    let mut branches = load_json_optional::<BranchesState>(&timeline_branches_path(repo_root))?
        .unwrap_or(BranchesState {
            schema_version: SCHEMA_BRANCHES.to_string(),
            active_branch: args.branch.clone(),
            branches: BTreeMap::new(),
        });

    if !branches.branches.contains_key(&args.branch) {
        branches.branches.insert(
            args.branch.clone(),
            BranchPointer {
                name: args.branch.clone(),
                head_event_id: None,
                created_at_utc: now.clone(),
                from_branch: None,
                from_event_id: None,
            },
        );
    }
    branches.active_branch = args.branch.clone();

    let branch_root = timeline_branch_root(repo_root, &args.branch);
    fs::create_dir_all(&branch_root)
        .with_context(|| format!("failed creating {}", branch_root.display()))?;

    if !timeline_branch_events_path(repo_root, &args.branch).exists() {
        fs::write(timeline_branch_events_path(repo_root, &args.branch), b"")
            .with_context(|| "failed creating branch events log")?;
    }

    if !timeline_branch_index_path(repo_root, &args.branch).exists() {
        let index = scan_repo(repo_root, None, true, 1)?;
        // Capture a baseline snapshot so checkout can always materialize branch history.
        for (rel, row) in &index {
            let abs = repo_root.join(rel);
            if abs.exists() {
                store_object(repo_root, &row.hash, &abs)?;
            }
        }
        write_pretty_json(&timeline_branch_index_path(repo_root, &args.branch), &index)?;
    }

    write_pretty_json(&timeline_branches_path(repo_root), &branches)?;

    println!(
        "[fugit] initialized repo=. root=.fugit active_branch={} bridge={}/{}",
        branches.active_branch, config.default_bridge_remote, config.default_bridge_branch
    );
    Ok(())
}

fn cmd_quickstart(repo_root: &Path, args: QuickstartArgs) -> Result<()> {
    if !timeline_is_initialized(repo_root) {
        let init_args = InitArgs {
            branch: args.branch.clone(),
            bridge_branch: None,
            bridge_remote: "origin".to_string(),
        };
        cmd_init(repo_root, init_args)?;
    }

    cmd_status(
        repo_root,
        StatusArgs {
            limit: 20,
            json: false,
            strict_hash: false,
            hash_jobs: None,
            burst: false,
        },
    )?;

    if args.status_only {
        return Ok(());
    }

    let summary = args
        .summary
        .unwrap_or_else(|| "quickstart checkpoint".to_string());
    let mut tags = args.tags;
    if tags.is_empty() {
        tags.push("quickstart".to_string());
    }
    cmd_checkpoint(
        repo_root,
        CheckpointArgs {
            summary,
            agent: args.agent,
            tags,
            files: Vec::new(),
            strict_hash: false,
            ignore_locks: false,
            hash_jobs: None,
            object_jobs: None,
            burst: false,
            repair: CheckpointRepairModeArg::Auto,
            allow_lossy_repair: false,
            json: false,
        },
    )?;
    Ok(())
}

fn cmd_doctor(repo_root: &Path, args: DoctorArgs) -> Result<()> {
    let timeline_initialized = timeline_is_initialized(repo_root);
    let git_available = ProcessCommand::new("git")
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false);
    let git_work_tree = ProcessCommand::new("git")
        .current_dir(repo_root)
        .args(["rev-parse", "--is-inside-work-tree"])
        .output()
        .map(|output| {
            output.status.success() && String::from_utf8_lossy(&output.stdout).trim() == "true"
        })
        .unwrap_or(false);

    let fugit_root = timeline_root(repo_root);
    let write_test_dir = fugit_root.join(".doctor");
    let write_test_file = write_test_dir.join("write_test.tmp");
    let writable = fs::create_dir_all(&write_test_dir)
        .and_then(|_| fs::write(&write_test_file, b"ok"))
        .and_then(|_| fs::remove_file(&write_test_file))
        .is_ok();
    let _ = fs::remove_dir_all(&write_test_dir);
    let mut missing_timeline_objects = if timeline_initialized {
        collect_missing_timeline_objects_detailed(repo_root)?
    } else {
        Vec::new()
    };
    let repair_attempted = args.fix && timeline_initialized && !missing_timeline_objects.is_empty();
    let mut repaired_timeline_objects = Vec::<MissingTimelineObject>::new();
    if repair_attempted {
        repaired_timeline_objects =
            repair_missing_timeline_objects_from_git(repo_root, &missing_timeline_objects)?;
        missing_timeline_objects = collect_missing_timeline_objects_detailed(repo_root)?;
    }
    let timeline_object_integrity = missing_timeline_objects.is_empty();
    let missing_rendered = missing_timeline_objects
        .iter()
        .map(MissingTimelineObject::render)
        .collect::<Vec<_>>();
    let repaired_rendered = repaired_timeline_objects
        .iter()
        .map(MissingTimelineObject::render)
        .collect::<Vec<_>>();

    let report = json!({
        "schema_version": "fugit.doctor_report.v1",
        "generated_at_utc": now_utc(),
        "repo_root": ".",
        "checks": {
            "timeline_initialized": timeline_initialized,
            "repo_writable": writable,
            "git_available": git_available,
            "git_work_tree": git_work_tree,
            "timeline_object_integrity": timeline_object_integrity
        },
        "repair": {
            "requested": args.fix,
            "attempted": repair_attempted,
            "repaired_count": repaired_rendered.len(),
            "repaired_timeline_objects": repaired_rendered,
            "remaining_missing_count": missing_rendered.len()
        },
        "missing_timeline_objects": missing_rendered,
        "summary": {
            "pass": timeline_initialized && writable && timeline_object_integrity
        }
    });

    if args.json {
        println!("{}", serde_json::to_string_pretty(&report)?);
    } else {
        println!(
            "[fugit-doctor] initialized={} writable={} git_available={} git_work_tree={} object_integrity={} missing_objects={} pass={}",
            timeline_initialized,
            writable,
            git_available,
            git_work_tree,
            timeline_object_integrity,
            report
                .get("missing_timeline_objects")
                .and_then(serde_json::Value::as_array)
                .map(|rows| rows.len())
                .unwrap_or(0),
            report
                .get("summary")
                .and_then(|v| v.get("pass"))
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false)
        );
        if !timeline_initialized {
            println!(
                "[fugit-doctor] hint: run `fugit --repo-root {} init --branch trunk`",
                repo_root.display()
            );
        } else if !timeline_object_integrity {
            println!(
                "[fugit-doctor] hint: run `fugit --repo-root {} doctor --fix` to attempt safe Git-backed object rehydration",
                repo_root.display()
            );
        }
        if args.fix {
            println!(
                "[fugit-doctor] repair requested repaired_missing_objects={} remaining_missing_objects={}",
                report["repair"]["repaired_count"].as_u64().unwrap_or(0),
                report["repair"]["remaining_missing_count"]
                    .as_u64()
                    .unwrap_or(0)
            );
        }
    }
    Ok(())
}

fn cmd_skill(args: SkillArgs) -> Result<()> {
    match args.action {
        SkillAction::Show {
            json,
            include_openai_yaml,
        } => {
            if json {
                let bundle = fugit_skill_bundle(true, include_openai_yaml);
                println!("{}", serde_json::to_string_pretty(&bundle)?);
            } else {
                println!("{}", FUGIT_SKILL_MD.trim_end());
                if include_openai_yaml {
                    println!("\n---\n");
                    println!("{}", FUGIT_SKILL_OPENAI_YAML.trim_end());
                }
            }
        }
        SkillAction::InstallCodex { overwrite } => {
            let install_path = install_fugit_skill_to_codex(overwrite)?;
            println!(
                "[fugit-skill] installed skill={} path={}",
                FUGIT_SKILL_ID,
                install_path.display()
            );
        }
        SkillAction::Doctor { json } => {
            let (ok, checks) = fugit_skill_doctor_checks();
            if json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&json!({
                        "schema_version": "fugit.skill.doctor.v1",
                        "generated_at_utc": now_utc(),
                        "skill_id": FUGIT_SKILL_ID,
                        "ok": ok,
                        "checks": checks
                    }))?
                );
            } else {
                println!(
                    "[fugit-skill] skill={} ok={} checks={}",
                    FUGIT_SKILL_ID,
                    ok,
                    checks.len()
                );
                for check in checks {
                    println!(
                        "- {}: {}",
                        check["name"].as_str().unwrap_or("unknown"),
                        check["pass"].as_bool().unwrap_or(false)
                    );
                }
            }
        }
    }
    Ok(())
}

fn fugit_skill_bundle(include_skill_body: bool, include_openai_yaml: bool) -> serde_json::Value {
    let mut bundle = json!({
        "schema_version": "fugit.skill.bundle.v1",
        "generated_at_utc": now_utc(),
        "skill_id": FUGIT_SKILL_ID,
        "delivery": {
            "cli": {
                "show": "fugit skill show",
                "show_json": "fugit skill show --json",
                "install_codex": "fugit skill install-codex"
            },
            "mcp_tools": [
                "fugit_status",
                "fugit_checkpoint",
                "fugit_log",
                "fugit_checkout",
                "fugit_lock_add",
                "fugit_lock_list",
                "fugit_task_show",
                "fugit_task_current",
                "fugit_task_add",
                "fugit_task_edit",
                "fugit_task_remove",
                "fugit_task_approve",
                "fugit_task_policy_show",
                "fugit_task_policy_set",
                "fugit_task_sync",
                "fugit_task_import",
                "fugit_task_list",
                "fugit_task_request",
                "fugit_task_claim",
                "fugit_task_done",
                "fugit_task_reopen",
                "fugit_task_release",
                "fugit_skill_bundle",
                "fugit_skill_install_codex",
                "fugit_task_gui_launch",
                "fugit_project_list",
                "fugit_project_add",
                "fugit_project_use",
                "fugit_project_remove",
                "fugit_gc"
            ]
        },
        "references": [
            {
                "path": "skills/fugit/references/workflow-profiles.md",
                "title": "Workflow Profiles"
            },
            {
                "path": "skills/fugit/references/recovery-playbooks.md",
                "title": "Recovery Playbooks"
            }
        ]
    });

    if include_skill_body && let Some(map) = bundle.as_object_mut() {
        map.insert("skill_md".to_string(), json!(FUGIT_SKILL_MD));
        map.insert(
            "reference_workflow_profiles_md".to_string(),
            json!(FUGIT_SKILL_REF_WORKFLOW_PROFILES),
        );
        map.insert(
            "reference_recovery_playbooks_md".to_string(),
            json!(FUGIT_SKILL_REF_RECOVERY_PLAYBOOKS),
        );
    }
    if include_openai_yaml && let Some(map) = bundle.as_object_mut() {
        map.insert("openai_yaml".to_string(), json!(FUGIT_SKILL_OPENAI_YAML));
    }

    bundle
}

fn fugit_skill_doctor_checks() -> (bool, Vec<serde_json::Value>) {
    let checks = vec![
        json!({
            "name": "frontmatter_present",
            "pass": FUGIT_SKILL_MD.trim_start().starts_with("---"),
            "detail": "SKILL.md starts with YAML frontmatter."
        }),
        json!({
            "name": "skill_name_matches",
            "pass": FUGIT_SKILL_MD.contains("\nname: fugit\n"),
            "detail": "SKILL.md frontmatter name matches fugit."
        }),
        json!({
            "name": "skill_description_present",
            "pass": FUGIT_SKILL_MD.contains("\ndescription: "),
            "detail": "SKILL.md frontmatter description exists."
        }),
        json!({
            "name": "openai_yaml_id_matches",
            "pass": FUGIT_SKILL_OPENAI_YAML.contains("\n  id: fugit\n") || FUGIT_SKILL_OPENAI_YAML.contains("\nid: fugit\n"),
            "detail": "agents/openai.yaml includes id: fugit."
        }),
        json!({
            "name": "workflow_section_present",
            "pass": FUGIT_SKILL_MD.contains("## Workflow"),
            "detail": "SKILL.md includes a workflow section."
        }),
        json!({
            "name": "task_contract_present",
            "pass": FUGIT_SKILL_MD.contains("## Task System Contract") && FUGIT_SKILL_MD.contains("task request"),
            "detail": "SKILL.md includes explicit task-system operating contract."
        }),
        json!({
            "name": "task_import_guidance_present",
            "pass": FUGIT_SKILL_MD.contains("task import"),
            "detail": "SKILL.md includes bulk task import guidance."
        }),
        json!({
            "name": "project_registry_guidance_present",
            "pass": FUGIT_SKILL_MD.contains("fugit project add"),
            "detail": "SKILL.md includes multi-project registry guidance."
        }),
        json!({
            "name": "openai_yaml_multi_project_present",
            "pass": FUGIT_SKILL_OPENAI_YAML.contains("multi-project"),
            "detail": "agents/openai.yaml mentions multi-project behavior."
        }),
        json!({
            "name": "references_present",
            "pass": !FUGIT_SKILL_REF_WORKFLOW_PROFILES.trim().is_empty() && !FUGIT_SKILL_REF_RECOVERY_PLAYBOOKS.trim().is_empty(),
            "detail": "Bundled reference files are embedded and non-empty."
        }),
    ];
    let ok = checks.iter().all(|check| {
        check
            .get("pass")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false)
    });
    (ok, checks)
}

fn install_fugit_skill_to_codex(overwrite: bool) -> Result<PathBuf> {
    let codex_home = resolve_codex_home()?;
    let skill_root = codex_home.join("skills").join(FUGIT_SKILL_ID);
    let skill_path = skill_root.join("SKILL.md");
    let agents_path = skill_root.join("agents").join("openai.yaml");
    let ref_workflow_path = skill_root.join("references").join("workflow-profiles.md");
    let ref_recovery_path = skill_root.join("references").join("recovery-playbooks.md");

    write_text_file_with_overwrite(&skill_path, FUGIT_SKILL_MD, overwrite)?;
    write_text_file_with_overwrite(&agents_path, FUGIT_SKILL_OPENAI_YAML, overwrite)?;
    write_text_file_with_overwrite(
        &ref_workflow_path,
        FUGIT_SKILL_REF_WORKFLOW_PROFILES,
        overwrite,
    )?;
    write_text_file_with_overwrite(
        &ref_recovery_path,
        FUGIT_SKILL_REF_RECOVERY_PLAYBOOKS,
        overwrite,
    )?;
    Ok(skill_root)
}

fn resolve_codex_home() -> Result<PathBuf> {
    if let Ok(path) = std::env::var("CODEX_HOME")
        && !path.trim().is_empty()
    {
        return Ok(PathBuf::from(path.trim()));
    }
    if let Ok(home) = std::env::var("HOME")
        && !home.trim().is_empty()
    {
        return Ok(PathBuf::from(home.trim()).join(".codex"));
    }
    if let Ok(profile) = std::env::var("USERPROFILE")
        && !profile.trim().is_empty()
    {
        return Ok(PathBuf::from(profile.trim()).join(".codex"));
    }
    bail!("unable to resolve CODEX_HOME; set CODEX_HOME, HOME, or USERPROFILE")
}

fn write_text_file_with_overwrite(path: &Path, content: &str, overwrite: bool) -> Result<()> {
    if path.exists() && !overwrite {
        bail!(
            "path already exists (use --overwrite to replace): {}",
            path.display()
        );
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed creating {}", parent.display()))?;
    }
    fs::write(path, content).with_context(|| format!("failed writing {}", path.display()))
}

fn cmd_status(repo_root: &Path, args: StatusArgs) -> Result<()> {
    let (_config, branches) = load_initialized_state(repo_root)?;
    let active_branch = branches.active_branch;
    let old_index = load_branch_index(repo_root, &active_branch)?;
    let hash_jobs = resolve_parallel_jobs(args.hash_jobs, args.burst);
    let new_index = scan_repo(repo_root, Some(&old_index), args.strict_hash, hash_jobs)?;
    let changes = diff_indexes(&old_index, &new_index);

    let summary = json!({
        "schema_version": "timeline.status.v1",
        "generated_at_utc": now_utc(),
        "branch": active_branch,
        "hash_jobs": hash_jobs,
        "tracked_file_count": new_index.len(),
        "changed_file_count": changes.len(),
        "added_count": changes.iter().filter(|c| matches!(c.kind, ChangeKind::Added)).count(),
        "modified_count": changes.iter().filter(|c| matches!(c.kind, ChangeKind::Modified)).count(),
        "deleted_count": changes.iter().filter(|c| matches!(c.kind, ChangeKind::Deleted)).count(),
        "changes": changes.iter().take(args.limit).collect::<Vec<_>>()
    });

    if args.json {
        println!("{}", serde_json::to_string_pretty(&summary)?);
    } else {
        println!(
            "[fugit] branch={} tracked={} changed={} (+{} ~{} -{}) hash_jobs={}",
            summary["branch"].as_str().unwrap_or("unknown"),
            summary["tracked_file_count"].as_u64().unwrap_or(0),
            summary["changed_file_count"].as_u64().unwrap_or(0),
            summary["added_count"].as_u64().unwrap_or(0),
            summary["modified_count"].as_u64().unwrap_or(0),
            summary["deleted_count"].as_u64().unwrap_or(0),
            hash_jobs
        );
        for change in changes.iter().take(args.limit) {
            let prefix = match change.kind {
                ChangeKind::Added => "+",
                ChangeKind::Modified => "~",
                ChangeKind::Deleted => "-",
            };
            println!("{} {}", prefix, change.path);
        }
    }

    Ok(())
}

fn checkpoint_repair_mode_label(mode: CheckpointRepairModeArg) -> &'static str {
    match mode {
        CheckpointRepairModeArg::Auto => "auto",
        CheckpointRepairModeArg::Strict => "strict",
        CheckpointRepairModeArg::Lossy => "lossy",
    }
}

fn checkpoint_json_error(
    repo_root: &Path,
    branch: Option<&str>,
    summary: &str,
    repair_mode: CheckpointRepairModeArg,
    code: &str,
    message: String,
    missing_blobs: Vec<CheckpointMissingBlob>,
    suggested_commands: Vec<String>,
) -> anyhow::Error {
    JsonCommandError {
        payload: json!({
            "schema_version": "fugit.checkpoint.v1",
            "generated_at_utc": now_utc(),
            "ok": false,
            "repo_root": repo_root.display().to_string(),
            "branch": branch,
            "summary": summary,
            "repair_mode": checkpoint_repair_mode_label(repair_mode),
            "error": {
                "code": code,
                "message": message,
                "missing_blobs": missing_blobs,
                "suggested_commands": suggested_commands
            }
        }),
    }
    .into()
}

fn render_checkpoint_missing_blob_rows(
    changes: &[ChangeRecord],
    repo_root: &Path,
) -> Vec<CheckpointMissingBlob> {
    let mut rows = Vec::<CheckpointMissingBlob>::new();
    for change in changes {
        if !matches!(change.kind, ChangeKind::Modified | ChangeKind::Deleted) {
            continue;
        }
        if let Some(old_hash) = change.old_hash.as_deref()
            && !timeline_objects_dir(repo_root).join(old_hash).exists()
        {
            rows.push(CheckpointMissingBlob {
                path: change.path.clone(),
                hash: old_hash.to_string(),
                change_kind: match change.kind {
                    ChangeKind::Added => "added".to_string(),
                    ChangeKind::Modified => "modified".to_string(),
                    ChangeKind::Deleted => "deleted".to_string(),
                },
            });
        }
    }
    rows
}

fn cmd_checkpoint(repo_root: &Path, args: CheckpointArgs) -> Result<()> {
    if args.summary.trim().is_empty() {
        if args.json {
            return Err(checkpoint_json_error(
                repo_root,
                None,
                args.summary.trim(),
                args.repair,
                "invalid_summary",
                "checkpoint summary cannot be empty".to_string(),
                Vec::new(),
                Vec::new(),
            ));
        }
        bail!("checkpoint summary cannot be empty");
    }

    let (_config, mut branches) = load_initialized_state(repo_root)?;
    let active_branch = branches.active_branch.clone();
    let old_index = load_branch_index(repo_root, &active_branch)?;
    let hash_jobs = resolve_parallel_jobs(args.hash_jobs, args.burst);
    let object_jobs = resolve_parallel_jobs(args.object_jobs.or(args.hash_jobs), args.burst);
    let new_index = scan_repo(repo_root, Some(&old_index), args.strict_hash, hash_jobs)?;
    let repair_mode = resolve_checkpoint_repair_mode(args.repair, args.allow_lossy_repair);

    let allowed_paths = args
        .files
        .iter()
        .map(|path| normalize_user_path(path))
        .collect::<BTreeSet<_>>();

    let mut changes = diff_indexes(&old_index, &new_index);
    if !allowed_paths.is_empty() {
        changes.retain(|change| allowed_paths.contains(&change.path));
    }

    let agent_id = args.agent.clone().unwrap_or_else(default_agent_id);
    if !args.ignore_locks {
        let conflicts = collect_lock_conflicts(repo_root, &changes, &agent_id)?;
        if !conflicts.is_empty() {
            let mut lines = Vec::<String>::new();
            for lock in &conflicts {
                lines.push(format!(
                    "lock_id={} pattern={} owner={}",
                    lock.lock_id, lock.pattern, lock.agent_id
                ));
            }
            let message = format!(
                "checkpoint blocked by active locks held by other agents:\n{}\nUse --ignore-locks to bypass.",
                lines.join("\n")
            );
            if args.json {
                return Err(checkpoint_json_error(
                    repo_root,
                    Some(&active_branch),
                    args.summary.trim(),
                    repair_mode,
                    "lock_conflict",
                    message,
                    Vec::new(),
                    vec![
                        "fugit lock list".to_string(),
                        format!(
                            "fugit --repo-root {} checkpoint --summary {:?} --ignore-locks",
                            repo_root.display(),
                            args.summary.trim()
                        ),
                    ],
                ));
            }
            bail!("{message}");
        }
    }

    let mut missing_old_objects = render_checkpoint_missing_blob_rows(&changes, repo_root);
    let repaired_old_objects = if matches!(repair_mode, CheckpointRepairModeArg::Strict) {
        Vec::new()
    } else {
        repair_missing_change_objects_from_git(repo_root, &changes, false)?
    };
    if !repaired_old_objects.is_empty() {
        missing_old_objects.retain(|row| !timeline_objects_dir(repo_root).join(&row.hash).exists());
    }
    if !missing_old_objects.is_empty() {
        if !matches!(repair_mode, CheckpointRepairModeArg::Lossy) {
            let rendered_missing = missing_old_objects
                .iter()
                .map(|row| format!("{} ({})", row.path, row.hash))
                .collect::<Vec<_>>()
                .join("\n");
            let message = format!(
                "checkpoint would lose recoverability because old object blobs are missing:\n{}\nRecreate the baseline snapshot first (for new repos, run `fugit init` before edits).\nTry `fugit doctor --fix` for safe Git-backed repair, rerun with `--repair auto` to auto-heal during checkpoint, or use `--repair lossy` only when those blobs are irrecoverable.",
                rendered_missing,
            );
            if args.json {
                return Err(checkpoint_json_error(
                    repo_root,
                    Some(&active_branch),
                    args.summary.trim(),
                    repair_mode,
                    "missing_old_objects",
                    message,
                    missing_old_objects,
                    vec![
                        format!("fugit --repo-root {} doctor --fix", repo_root.display()),
                        format!(
                            "fugit --repo-root {} checkpoint --summary {:?} --repair auto",
                            repo_root.display(),
                            args.summary.trim()
                        ),
                        format!(
                            "fugit --repo-root {} checkpoint --summary {:?} --repair lossy",
                            repo_root.display(),
                            args.summary.trim()
                        ),
                    ],
                ));
            }
            bail!("{message}");
        }
        if !args.json {
            println!(
                "[fugit] warning=lossy_repair missing_old_objects={} historical_checkout_before_this_checkpoint_may_fail repair_mode=lossy",
                missing_old_objects.len(),
            );
        }
    }
    if !repaired_old_objects.is_empty() && !args.json {
        println!(
            "[fugit] repaired_missing_old_objects={} source=git_history repair_mode={}",
            repaired_old_objects.len(),
            checkpoint_repair_mode_label(repair_mode)
        );
    }

    let mut object_candidates = BTreeMap::<String, PathBuf>::new();
    for change in &changes {
        if matches!(change.kind, ChangeKind::Added | ChangeKind::Modified)
            && let Some(new_hash) = &change.new_hash
        {
            let rel = PathBuf::from(&change.path);
            let abs = repo_root.join(&rel);
            if abs.exists() {
                object_candidates.entry(new_hash.clone()).or_insert(abs);
            }
        }
    }
    let object_queue = object_candidates.into_iter().collect::<Vec<_>>();
    store_objects(repo_root, &object_queue, object_jobs)?;

    let mut changed_bytes_total = 0_u64;
    let mut added_count = 0_usize;
    let mut modified_count = 0_usize;
    let mut deleted_count = 0_usize;

    for change in &changes {
        match change.kind {
            ChangeKind::Added => {
                added_count += 1;
                changed_bytes_total += change.new_size_bytes.unwrap_or(0);
            }
            ChangeKind::Modified => {
                modified_count += 1;
                changed_bytes_total += change.new_size_bytes.unwrap_or(0);
            }
            ChangeKind::Deleted => {
                deleted_count += 1;
                changed_bytes_total += change.old_size_bytes.unwrap_or(0);
            }
        }
    }

    let event_id = format!("evt_{}", Uuid::new_v4().simple());
    let parent_event_id = branches
        .branches
        .get(&active_branch)
        .and_then(|row| row.head_event_id.clone());
    let mut event_tags = dedupe_keep_order(args.tags);
    if matches!(repair_mode, CheckpointRepairModeArg::Lossy) && !missing_old_objects.is_empty() {
        event_tags.push("lossy_repair".to_string());
        event_tags = dedupe_keep_order(event_tags);
    }
    let event = TimelineEvent {
        schema_version: SCHEMA_EVENT.to_string(),
        event_id: event_id.clone(),
        created_at_utc: now_utc(),
        branch: active_branch.clone(),
        parent_event_id,
        agent_id,
        summary: args.summary.trim().to_string(),
        tags: event_tags,
        metrics: EventMetrics {
            tracked_file_count: new_index.len(),
            changed_file_count: changes.len(),
            added_count,
            modified_count,
            deleted_count,
            changed_bytes_total,
        },
        changes,
    };

    append_jsonl(
        &timeline_branch_events_path(repo_root, &active_branch),
        &event,
    )?;
    write_pretty_json(
        &timeline_branch_index_path(repo_root, &active_branch),
        &new_index,
    )?;

    if let Some(pointer) = branches.branches.get_mut(&active_branch) {
        pointer.head_event_id = Some(event_id.clone());
    }
    write_pretty_json(&timeline_branches_path(repo_root), &branches)?;

    if args.json {
        println!(
            "{}",
            serde_json::to_string_pretty(&json!({
                "schema_version": "fugit.checkpoint.v1",
                "generated_at_utc": now_utc(),
                "ok": true,
                "repo_root": repo_root.display().to_string(),
                "branch": active_branch,
                "event_id": event_id,
                "summary": event.summary,
                "repair_mode": checkpoint_repair_mode_label(repair_mode),
                "lossy_repair": matches!(repair_mode, CheckpointRepairModeArg::Lossy) && !missing_old_objects.is_empty(),
                "repaired_old_objects": repaired_old_objects,
                "metrics": {
                    "tracked_file_count": event.metrics.tracked_file_count,
                    "changed_file_count": event.metrics.changed_file_count,
                    "added_count": event.metrics.added_count,
                    "modified_count": event.metrics.modified_count,
                    "deleted_count": event.metrics.deleted_count,
                    "changed_bytes_total": event.metrics.changed_bytes_total,
                    "hash_jobs": hash_jobs,
                    "object_jobs": object_jobs
                },
                "changes": event.changes
            }))?
        );
    } else {
        println!(
            "[fugit] checkpoint={} branch={} changed={} summary={} hash_jobs={} object_jobs={}",
            event_id,
            active_branch,
            event.metrics.changed_file_count,
            event.summary,
            hash_jobs,
            object_jobs
        );
    }
    Ok(())
}

fn cmd_log(repo_root: &Path, args: LogArgs) -> Result<()> {
    let (_config, branches) = load_initialized_state(repo_root)?;
    let active_branch = args.branch.unwrap_or(branches.active_branch);
    let events = read_branch_events_tail(repo_root, &active_branch, args.limit)?;

    if args.json {
        println!("{}", serde_json::to_string_pretty(&events)?);
    } else {
        println!(
            "[fugit] branch={} events={} (showing up to {})",
            active_branch,
            events.len(),
            args.limit
        );
        for event in events {
            println!(
                "{} {} [{}] {}",
                event.created_at_utc, event.event_id, event.agent_id, event.summary
            );
        }
    }
    Ok(())
}

fn cmd_branch(repo_root: &Path, args: BranchArgs) -> Result<()> {
    let (_config, mut branches) = load_initialized_state(repo_root)?;
    let active = branches.active_branch.clone();

    match args.action {
        BranchAction::List => {
            for (name, pointer) in branches.branches {
                let marker = if name == active { "*" } else { " " };
                println!(
                    "{} {} head={}",
                    marker,
                    name,
                    pointer.head_event_id.unwrap_or_else(|| "none".to_string())
                );
            }
        }
        BranchAction::Create { name, switch } => {
            validate_branch_name(&name)?;
            if branches.branches.contains_key(&name) {
                bail!("timeline branch already exists: {}", name);
            }

            let from_pointer = branches
                .branches
                .get(&active)
                .ok_or_else(|| anyhow!("active branch pointer missing: {}", active))?
                .clone();

            fs::create_dir_all(timeline_branch_root(repo_root, &name)).with_context(|| {
                format!(
                    "failed creating timeline branch root {}",
                    timeline_branch_root(repo_root, &name).display()
                )
            })?;

            let from_events = timeline_branch_events_path(repo_root, &active);
            let to_events = timeline_branch_events_path(repo_root, &name);
            if from_events.exists() {
                fs::copy(&from_events, &to_events).with_context(|| {
                    format!(
                        "failed copying branch events {} -> {}",
                        from_events.display(),
                        to_events.display()
                    )
                })?;
            } else {
                fs::write(&to_events, b"")?;
            }

            let from_index = timeline_branch_index_path(repo_root, &active);
            let to_index = timeline_branch_index_path(repo_root, &name);
            if from_index.exists() {
                fs::copy(&from_index, &to_index).with_context(|| {
                    format!(
                        "failed copying branch index {} -> {}",
                        from_index.display(),
                        to_index.display()
                    )
                })?;
            } else {
                write_pretty_json(&to_index, &BTreeMap::<String, FileRecord>::new())?;
            }

            branches.branches.insert(
                name.clone(),
                BranchPointer {
                    name: name.clone(),
                    head_event_id: from_pointer.head_event_id.clone(),
                    created_at_utc: now_utc(),
                    from_branch: Some(active.clone()),
                    from_event_id: from_pointer.head_event_id,
                },
            );
            if switch {
                branches.active_branch = name.clone();
            }
            write_pretty_json(&timeline_branches_path(repo_root), &branches)?;

            println!(
                "[fugit] branch created={} from={} switched={}",
                name,
                active,
                if switch { "true" } else { "false" }
            );
        }
        BranchAction::Switch { name } => {
            if !branches.branches.contains_key(&name) {
                bail!("timeline branch does not exist: {}", name);
            }
            branches.active_branch = name.clone();
            write_pretty_json(&timeline_branches_path(repo_root), &branches)?;
            println!("[fugit] active branch={}", name);
        }
    }

    Ok(())
}

fn cmd_backend(repo_root: &Path, args: BackendArgs) -> Result<()> {
    let (_config, branches) = load_initialized_state(repo_root)?;
    let mut config = load_json_optional::<TimelineConfig>(&timeline_config_path(repo_root))?
        .ok_or_else(|| {
            anyhow!(
                "timeline not initialized: missing {}",
                timeline_config_path(repo_root).display()
            )
        })?;

    match args.action {
        BackendAction::Show { json } => {
            let summary = json!({
                "schema_version": "fugit.backend.summary.v1",
                "generated_at_utc": now_utc(),
                "active_branch": branches.active_branch,
                "backend_mode": config.backend_mode,
                "default_bridge_remote": config.default_bridge_remote,
                "default_bridge_branch": config.default_bridge_branch,
                "cloud_endpoint": config.cloud_endpoint,
                "storage_namespace": config.storage_namespace,
                "billing_account_id": config.billing_account_id
            });
            if json {
                println!("{}", serde_json::to_string_pretty(&summary)?);
            } else {
                println!(
                    "[fugit-backend] mode={} bridge={}/{} storage_namespace={} billing_account_id={}",
                    summary["backend_mode"].as_str().unwrap_or("unknown"),
                    summary["default_bridge_remote"]
                        .as_str()
                        .unwrap_or("origin"),
                    summary["default_bridge_branch"].as_str().unwrap_or("trunk"),
                    summary["storage_namespace"].as_str().unwrap_or("unset"),
                    summary["billing_account_id"].as_str().unwrap_or("unset")
                );
            }
        }
        BackendAction::Set {
            mode,
            cloud_endpoint,
            storage_namespace,
            billing_account_id,
            bridge_remote,
            bridge_branch,
        } => {
            config.backend_mode = match mode {
                BackendModeArg::GitBridge => BACKEND_MODE_GIT_BRIDGE.to_string(),
                BackendModeArg::FugitCloud => BACKEND_MODE_FUGIT_CLOUD.to_string(),
            };

            if let Some(remote) = bridge_remote
                && !remote.trim().is_empty()
            {
                config.default_bridge_remote = remote.trim().to_string();
            }
            if let Some(branch) = bridge_branch
                && !branch.trim().is_empty()
            {
                config.default_bridge_branch = branch.trim().to_string();
            }
            if cloud_endpoint.is_some() {
                config.cloud_endpoint = cloud_endpoint.and_then(|v| {
                    let token = v.trim().to_string();
                    if token.is_empty() { None } else { Some(token) }
                });
            }
            if storage_namespace.is_some() {
                config.storage_namespace = storage_namespace.and_then(|v| {
                    let token = v.trim().to_string();
                    if token.is_empty() { None } else { Some(token) }
                });
            }
            if billing_account_id.is_some() {
                config.billing_account_id = billing_account_id.and_then(|v| {
                    let token = v.trim().to_string();
                    if token.is_empty() { None } else { Some(token) }
                });
            }
            config.updated_at_utc = now_utc();
            write_pretty_json(&timeline_config_path(repo_root), &config)?;
            println!(
                "[fugit-backend] updated mode={} bridge={}/{} storage_namespace={} billing_account_id={}",
                config.backend_mode,
                config.default_bridge_remote,
                config.default_bridge_branch,
                config.storage_namespace.as_deref().unwrap_or("unset"),
                config.billing_account_id.as_deref().unwrap_or("unset")
            );
        }
    }

    Ok(())
}

fn cmd_bridge(repo_root: &Path, args: BridgeArgs) -> Result<()> {
    let (config, branches) = load_initialized_state(repo_root)?;

    match args.action {
        BridgeAction::Summary { limit, markdown } => {
            let mut events = read_branch_events(repo_root, &branches.active_branch)?;
            if events.len() > limit {
                let start = events.len().saturating_sub(limit);
                events = events.split_off(start);
            }

            if markdown {
                println!("# Timeline Summary ({})", branches.active_branch);
                for event in &events {
                    println!(
                        "- `{}` `{}` `{}` {}",
                        event.created_at_utc, event.event_id, event.agent_id, event.summary
                    );
                }
            } else {
                println!(
                    "[fugit-bridge] branch={} events={} (last {})",
                    branches.active_branch,
                    events.len(),
                    limit
                );
                for event in &events {
                    println!(
                        "{} {} [{}] {}",
                        event.created_at_utc, event.event_id, event.agent_id, event.summary
                    );
                }
            }
        }
        BridgeAction::Auth(auth_args) => {
            ensure_git_repo(repo_root)?;
            cmd_bridge_auth(repo_root, &config, auth_args)?;
        }
        BridgeAction::AutoSync { action } => match action {
            BridgeAutoSyncAction::Show { json } => {
                let state = load_bridge_auto_sync_state(repo_root, &config)?;
                let payload = bridge_auto_sync_payload(&config, &state);
                if json {
                    println!("{}", serde_json::to_string_pretty(&payload)?);
                } else {
                    println!(
                        "[fugit-bridge-auto-sync] enabled={} on_task_done={} status={} pending={} remote={} branch={}",
                        payload["enabled"].as_bool().unwrap_or(true),
                        payload["on_task_done"].as_bool().unwrap_or(true),
                        payload["status"].as_str().unwrap_or("unknown"),
                        payload["pending_trigger"].as_bool().unwrap_or(false),
                        config.default_bridge_remote,
                        config.default_bridge_branch
                    );
                }
            }
            BridgeAutoSyncAction::Set {
                enabled,
                on_task_done,
                event_count,
                no_push,
                json,
            } => {
                let mut next_config = config.clone();
                let mut changed = false;
                if let Some(enabled) = enabled
                    && next_config.auto_bridge_sync_enabled != enabled
                {
                    next_config.auto_bridge_sync_enabled = enabled;
                    changed = true;
                }
                if let Some(on_task_done) = on_task_done
                    && next_config.auto_bridge_sync_on_task_done != on_task_done
                {
                    next_config.auto_bridge_sync_on_task_done = on_task_done;
                    changed = true;
                }
                if let Some(event_count) = event_count
                    && next_config.auto_bridge_sync_event_count != event_count.max(1)
                {
                    next_config.auto_bridge_sync_event_count = event_count.max(1);
                    changed = true;
                }
                if let Some(no_push) = no_push
                    && next_config.auto_bridge_sync_no_push != no_push
                {
                    next_config.auto_bridge_sync_no_push = no_push;
                    changed = true;
                }
                if changed {
                    next_config.updated_at_utc = now_utc();
                    write_pretty_json(&timeline_config_path(repo_root), &next_config)?;
                }
                let mut state = load_bridge_auto_sync_state(repo_root, &next_config)?;
                state.updated_at_utc = now_utc();
                write_bridge_auto_sync_state(repo_root, &state)?;
                let payload = bridge_auto_sync_payload(&next_config, &state);
                if json {
                    println!("{}", serde_json::to_string_pretty(&payload)?);
                } else {
                    println!(
                        "[fugit-bridge-auto-sync] enabled={} on_task_done={} event_count={} no_push={}",
                        payload["enabled"].as_bool().unwrap_or(true),
                        payload["on_task_done"].as_bool().unwrap_or(true),
                        payload["event_count"].as_u64().unwrap_or(0),
                        payload["no_push"].as_bool().unwrap_or(false)
                    );
                }
            }
        },
        BridgeAction::SyncGithub {
            remote,
            branch,
            event_count,
            no_push,
            pack_threads,
            burst_push,
            repair_journal,
            note,
            background,
            background_worker,
            trigger,
        } => {
            let options = BridgeSyncGithubOptions {
                remote: remote.unwrap_or(config.default_bridge_remote.clone()),
                branch: branch.unwrap_or(config.default_bridge_branch.clone()),
                event_count: event_count.max(1),
                no_push,
                pack_threads,
                burst_push,
                repair_journal,
                note: normalize_optional_text(note, "bridge sync note")?,
                trigger: normalize_optional_text(trigger, "bridge sync trigger")?,
            };
            if background {
                let payload = queue_bridge_auto_sync_background(repo_root, &config, &options)?;
                println!(
                    "[fugit-bridge] background_sync queued={} already_running={} remote={} branch={} trigger={}",
                    payload["queued"].as_bool().unwrap_or(false),
                    payload["already_running"].as_bool().unwrap_or(false),
                    payload["remote"].as_str().unwrap_or("origin"),
                    payload["branch"].as_str().unwrap_or("trunk"),
                    payload["trigger"].as_str().unwrap_or("manual")
                );
            } else if background_worker {
                if let Err(err) = run_bridge_auto_sync_worker(
                    repo_root,
                    &config,
                    &branches.active_branch,
                    options,
                ) {
                    let mut state = load_bridge_auto_sync_state(repo_root, &config)
                        .unwrap_or_else(|_| default_bridge_auto_sync_state(&config));
                    state.updated_at_utc = now_utc();
                    state.status = "error".to_string();
                    state.last_error = Some(err.to_string());
                    let _ = write_bridge_auto_sync_state(repo_root, &state);
                    remove_bridge_auto_sync_lock(repo_root);
                }
            } else {
                let report =
                    perform_bridge_sync_github(repo_root, &branches.active_branch, &options)?;
                if !report["committed"].as_bool().unwrap_or(false) {
                    println!(
                        "[fugit-bridge] {}",
                        report["message"]
                            .as_str()
                            .unwrap_or("no staged changes after git add -A; skipping commit/push")
                    );
                } else if report["pushed"].as_bool().unwrap_or(false) {
                    println!(
                        "[fugit-bridge] committed+pushed remote={} branch={}",
                        report["remote"].as_str().unwrap_or("origin"),
                        report["branch"].as_str().unwrap_or("trunk")
                    );
                } else {
                    println!(
                        "[fugit-bridge] committed locally (push skipped): remote={} branch={}",
                        report["remote"].as_str().unwrap_or("origin"),
                        report["branch"].as_str().unwrap_or("trunk")
                    );
                }
            }
        }
        BridgeAction::PullGithub {
            remote,
            branch,
            ff_only,
            rebase,
            autostash,
        } => {
            ensure_git_repo(repo_root)?;
            let remote = remote.unwrap_or(config.default_bridge_remote);
            let branch = branch.unwrap_or(config.default_bridge_branch);

            let mut created_autostash = false;
            if autostash && git_has_worktree_changes(repo_root)? {
                let mut stash_cmd = ProcessCommand::new("git");
                stash_cmd
                    .current_dir(repo_root)
                    .arg("stash")
                    .arg("push")
                    .arg("--include-untracked")
                    .arg("-m")
                    .arg(format!("fugit-autostash-{}", now_utc()));
                run_process(stash_cmd, "failed creating autostash before pull")?;
                created_autostash = true;
            }

            let mut pull_cmd = ProcessCommand::new("git");
            pull_cmd.current_dir(repo_root).arg("pull");
            if ff_only {
                pull_cmd.arg("--ff-only");
            }
            if rebase {
                pull_cmd.arg("--rebase");
            }
            pull_cmd.arg(&remote).arg(&branch);
            run_process(pull_cmd, "failed pulling from git remote")?;

            if created_autostash {
                let mut pop_cmd = ProcessCommand::new("git");
                pop_cmd.current_dir(repo_root).arg("stash").arg("pop");
                if let Err(err) = run_process(pop_cmd, "failed applying autostash after pull") {
                    bail!(
                        "pull succeeded but autostash pop failed; run `git stash list`/`git stash pop` to recover.\n{}",
                        err
                    );
                }
            }

            println!(
                "[fugit-bridge] pulled remote={} branch={} ff_only={} rebase={} autostash={}",
                remote, branch, ff_only, rebase, created_autostash
            );
        }
    }

    Ok(())
}

#[derive(Debug, Clone)]
struct GitCredential {
    username: Option<String>,
    password: Option<String>,
}

fn cmd_bridge_auth(repo_root: &Path, config: &TimelineConfig, args: BridgeAuthArgs) -> Result<()> {
    match args.action {
        BridgeAuthAction::Status { remote, host, json } => {
            let remote_name = remote.unwrap_or_else(|| config.default_bridge_remote.clone());
            let remote_url = git_remote_url(repo_root, &remote_name)?;
            let resolved_host = resolve_bridge_host(host.as_deref(), remote_url.as_deref())
                .unwrap_or_else(|| "github.com".to_string());
            let helper =
                configured_credential_helper(repo_root)?.unwrap_or_else(|| "unset".to_string());
            let cred = git_credential_fill(repo_root, &resolved_host, None)?;
            let state =
                load_json_optional::<BridgeAuthState>(&timeline_bridge_auth_path(repo_root))?;
            let username = cred
                .as_ref()
                .and_then(|row| row.username.clone())
                .or_else(|| state.as_ref().map(|row| row.username.clone()))
                .unwrap_or_else(|| "unset".to_string());
            let has_credential = cred.as_ref().and_then(|row| row.password.clone()).is_some();
            let summary = json!({
                "schema_version": "fugit.bridge_auth.status.v1",
                "generated_at_utc": now_utc(),
                "remote": remote_name,
                "remote_url": remote_url,
                "host": resolved_host,
                "username": username,
                "credential_helper": helper,
                "credential_present": has_credential
            });
            if json {
                println!("{}", serde_json::to_string_pretty(&summary)?);
            } else {
                println!(
                    "[fugit-bridge-auth] remote={} host={} helper={} username={} credential_present={}",
                    summary["remote"].as_str().unwrap_or("origin"),
                    summary["host"].as_str().unwrap_or("github.com"),
                    summary["credential_helper"].as_str().unwrap_or("unset"),
                    summary["username"].as_str().unwrap_or("unset"),
                    summary["credential_present"].as_bool().unwrap_or(false)
                );
            }
        }
        BridgeAuthAction::Login {
            remote,
            host,
            username,
            token,
            token_env,
            helper,
        } => {
            let remote_name = remote.unwrap_or_else(|| config.default_bridge_remote.clone());
            let remote_url = git_remote_url(repo_root, &remote_name)?;
            let resolved_host = resolve_bridge_host(host.as_deref(), remote_url.as_deref())
                .unwrap_or_else(|| "github.com".to_string());
            let username = username
                .filter(|row| !row.trim().is_empty())
                .unwrap_or_else(|| "x-access-token".to_string());
            let token = token
                .or_else(|| std::env::var(&token_env).ok())
                .filter(|row| !row.trim().is_empty())
                .ok_or_else(|| {
                    anyhow!(
                        "missing token; pass --token or export {} before login",
                        token_env
                    )
                })?;

            let (helper, used_store_fallback) = ensure_credential_helper(repo_root, helper)?;
            git_credential_approve(repo_root, &resolved_host, &username, token.trim())?;

            let mut access_verified = false;
            if let Some(url) = remote_url.as_deref()
                && (url.starts_with("http://") || url.starts_with("https://"))
            {
                access_verified = verify_git_remote_access(repo_root, url)?;
            }

            let state = BridgeAuthState {
                schema_version: SCHEMA_BRIDGE_AUTH.to_string(),
                updated_at_utc: now_utc(),
                host: resolved_host.clone(),
                username: username.clone(),
                helper: helper.clone(),
            };
            write_pretty_json(&timeline_bridge_auth_path(repo_root), &state)?;

            println!(
                "[fugit-bridge-auth] login complete host={} username={} helper={} verified_remote_access={}",
                resolved_host, username, helper, access_verified
            );
            if used_store_fallback {
                println!(
                    "[fugit-bridge-auth] note: credential.helper was unset; defaulted to 'store'. Switch to a secure helper (manager-core/osxkeychain/libsecret/wincred) for long-term use."
                );
            }
            if !access_verified {
                println!(
                    "[fugit-bridge-auth] note: remote access verification skipped/failed (non-HTTPS remote or insufficient token scope)"
                );
            }
        }
        BridgeAuthAction::Logout {
            remote,
            host,
            username,
        } => {
            let remote_name = remote.unwrap_or_else(|| config.default_bridge_remote.clone());
            let remote_url = git_remote_url(repo_root, &remote_name)?;
            let resolved_host = resolve_bridge_host(host.as_deref(), remote_url.as_deref())
                .unwrap_or_else(|| "github.com".to_string());
            let fallback_state =
                load_json_optional::<BridgeAuthState>(&timeline_bridge_auth_path(repo_root))?;
            let username = username
                .filter(|row| !row.trim().is_empty())
                .or_else(|| fallback_state.map(|row| row.username))
                .unwrap_or_else(|| "x-access-token".to_string());

            git_credential_reject(repo_root, &resolved_host, &username)?;
            let auth_path = timeline_bridge_auth_path(repo_root);
            if auth_path.exists() {
                let _ = fs::remove_file(auth_path);
            }
            println!(
                "[fugit-bridge-auth] logout complete host={} username={}",
                resolved_host, username
            );
        }
    }
    Ok(())
}

fn resolve_bridge_host(host_arg: Option<&str>, remote_url: Option<&str>) -> Option<String> {
    if let Some(host) = host_arg {
        let token = host.trim();
        if !token.is_empty() {
            return Some(token.to_string());
        }
    }
    if let Some(url) = remote_url {
        return parse_git_host(url);
    }
    None
}

fn parse_git_host(remote_url: &str) -> Option<String> {
    let trimmed = remote_url.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Some((_, tail)) = trimmed.split_once("://") {
        let host_port = tail.split('/').next().unwrap_or_default();
        if host_port.is_empty() {
            return None;
        }
        let without_user = host_port.rsplit('@').next().unwrap_or(host_port);
        let host = without_user.split(':').next().unwrap_or_default().trim();
        if host.is_empty() {
            None
        } else {
            Some(host.to_string())
        }
    } else if trimmed.contains('@') && trimmed.contains(':') {
        let tail = trimmed.split('@').nth(1).unwrap_or_default();
        let host = tail.split(':').next().unwrap_or_default().trim();
        if host.is_empty() {
            None
        } else {
            Some(host.to_string())
        }
    } else {
        None
    }
}

fn git_remote_url(repo_root: &Path, remote: &str) -> Result<Option<String>> {
    let output = ProcessCommand::new("git")
        .current_dir(repo_root)
        .args(["remote", "get-url", remote])
        .output()
        .with_context(|| format!("failed reading git remote URL for '{}'", remote))?;
    if !output.status.success() {
        return Ok(None);
    }
    let remote_url = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if remote_url.is_empty() {
        Ok(None)
    } else {
        Ok(Some(remote_url))
    }
}

fn configured_credential_helper(repo_root: &Path) -> Result<Option<String>> {
    let output = ProcessCommand::new("git")
        .current_dir(repo_root)
        .args(["config", "--get", "credential.helper"])
        .output()
        .with_context(|| "failed reading git credential.helper")?;
    if !output.status.success() {
        return Ok(None);
    }
    let helper = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if helper.is_empty() {
        Ok(None)
    } else {
        Ok(Some(helper))
    }
}

fn ensure_credential_helper(repo_root: &Path, requested: Option<String>) -> Result<(String, bool)> {
    if let Some(helper) = requested {
        let helper = helper.trim().to_string();
        if helper.is_empty() {
            bail!("credential helper cannot be empty");
        }
        run_git(repo_root, &["config", "credential.helper", &helper])?;
        return Ok((helper, false));
    }

    if let Some(helper) = configured_credential_helper(repo_root)? {
        return Ok((helper, false));
    }

    // Portable fallback so auth works end-to-end even on clean machines.
    let helper = "store".to_string();
    run_git(repo_root, &["config", "credential.helper", &helper])?;
    Ok((helper, true))
}

fn git_credential_fill(
    repo_root: &Path,
    host: &str,
    username: Option<&str>,
) -> Result<Option<GitCredential>> {
    let mut payload = format!("protocol=https\nhost={}\n", host);
    if let Some(username) = username
        && !username.trim().is_empty()
    {
        payload.push_str(&format!("username={}\n", username.trim()));
    }
    payload.push('\n');

    let mut cmd = ProcessCommand::new("git");
    cmd.current_dir(repo_root)
        .arg("credential")
        .arg("fill")
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .with_context(|| "failed spawning git credential fill")?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(payload.as_bytes())
            .with_context(|| "failed writing git credential fill payload")?;
    }
    let output = child
        .wait_with_output()
        .with_context(|| "failed waiting on git credential fill")?;
    if !output.status.success() {
        return Ok(None);
    }
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if stdout.trim().is_empty() {
        return Ok(None);
    }
    Ok(parse_git_credential_output(&stdout))
}

fn git_credential_approve(repo_root: &Path, host: &str, username: &str, token: &str) -> Result<()> {
    let payload = format!(
        "protocol=https\nhost={}\nusername={}\npassword={}\n\n",
        host, username, token
    );
    let mut cmd = ProcessCommand::new("git");
    cmd.current_dir(repo_root)
        .arg("credential")
        .arg("approve")
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    let mut child = cmd
        .spawn()
        .with_context(|| "failed spawning git credential approve")?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(payload.as_bytes())
            .with_context(|| "failed writing git credential approve payload")?;
    }
    let output = child
        .wait_with_output()
        .with_context(|| "failed waiting on git credential approve")?;
    if !output.status.success() {
        bail!(
            "git credential approve failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(())
}

fn git_credential_reject(repo_root: &Path, host: &str, username: &str) -> Result<()> {
    let payload = format!("protocol=https\nhost={}\nusername={}\n\n", host, username);
    let mut cmd = ProcessCommand::new("git");
    cmd.current_dir(repo_root)
        .arg("credential")
        .arg("reject")
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    let mut child = cmd
        .spawn()
        .with_context(|| "failed spawning git credential reject")?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(payload.as_bytes())
            .with_context(|| "failed writing git credential reject payload")?;
    }
    let output = child
        .wait_with_output()
        .with_context(|| "failed waiting on git credential reject")?;
    if !output.status.success() {
        bail!(
            "git credential reject failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(())
}

fn parse_git_credential_output(stdout: &str) -> Option<GitCredential> {
    let mut username = None::<String>;
    let mut password = None::<String>;
    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        match key.trim() {
            "username" => username = Some(value.trim().to_string()),
            "password" => password = Some(value.trim().to_string()),
            _ => {}
        }
    }
    if username.is_none() && password.is_none() {
        None
    } else {
        Some(GitCredential { username, password })
    }
}

fn verify_git_remote_access(repo_root: &Path, remote_url: &str) -> Result<bool> {
    let output = ProcessCommand::new("git")
        .current_dir(repo_root)
        .args(["ls-remote", "--exit-code", remote_url, "HEAD"])
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .with_context(|| "failed verifying remote access with git ls-remote")?;
    Ok(output.status.success())
}

fn cmd_checkout(repo_root: &Path, args: CheckoutArgs) -> Result<()> {
    let (_config, mut branches) = load_initialized_state(repo_root)?;
    let active_branch = branches.active_branch.clone();
    let source_branch = args.branch.unwrap_or_else(|| active_branch.clone());
    let branch_pointer = branches
        .branches
        .get(&source_branch)
        .ok_or_else(|| anyhow!("timeline branch does not exist: {}", source_branch))?
        .clone();

    let events = read_branch_events(repo_root, &source_branch)?;
    let head_index = load_branch_index(repo_root, &source_branch)?;
    let target_event_id = match args.event {
        Some(token) => Some(token),
        None => branch_pointer.head_event_id.clone(),
    };

    let target_index = match target_event_id.as_deref() {
        Some(event_id) => reconstruct_index_at_event(&events, &head_index, event_id)?,
        None => head_index.clone(),
    };

    let current_base_index = load_branch_index(repo_root, &active_branch)?;
    let hash_jobs = resolve_parallel_jobs(args.hash_jobs, args.burst);
    let current_index = scan_repo(
        repo_root,
        Some(&current_base_index),
        args.strict_hash,
        hash_jobs,
    )?;
    let dirty = diff_indexes(&current_base_index, &current_index);
    if !args.force && !dirty.is_empty() {
        bail!(
            "working tree has uncheckpointed changes on active branch '{}': {} paths (use --force to override)",
            active_branch,
            dirty.len()
        );
    }

    let planned = diff_indexes(&current_index, &target_index);
    let mut missing_objects = Vec::<String>::new();
    for change in &planned {
        match change.kind {
            ChangeKind::Added | ChangeKind::Modified => {
                let target_hash = change
                    .new_hash
                    .as_deref()
                    .ok_or_else(|| anyhow!("missing target hash for {}", change.path))?;
                let current_same = current_index
                    .get(&change.path)
                    .map(|row| row.hash == target_hash)
                    .unwrap_or(false);
                let object_path = timeline_objects_dir(repo_root).join(target_hash);
                if !current_same && !object_path.exists() {
                    missing_objects.push(format!("{} ({})", change.path, target_hash));
                }
            }
            ChangeKind::Deleted => {}
        }
    }
    let repaired_target_objects =
        repair_missing_change_objects_from_git(repo_root, &planned, true)?;
    if !repaired_target_objects.is_empty() {
        missing_objects.retain(|row| {
            let (_, hash) = row
                .rsplit_once(" (")
                .map(|(path, hash)| (path, hash.trim_end_matches(')')))
                .unwrap_or(("", ""));
            !timeline_objects_dir(repo_root).join(hash).exists()
        });
    }

    if !missing_objects.is_empty() {
        bail!(
            "cannot materialize target snapshot; missing object blobs:\n{}\nRun a checkpoint that captures these files before checkout.",
            missing_objects.join("\n")
        );
    }
    if !repaired_target_objects.is_empty() {
        println!(
            "[fugit-checkout] repaired_missing_objects={} source=git_history",
            repaired_target_objects.len()
        );
    }

    if args.dry_run {
        println!(
            "[fugit-checkout] dry-run branch={} event={} planned_changes={} (+{} ~{} -{})",
            source_branch,
            target_event_id.as_deref().unwrap_or("head"),
            planned.len(),
            planned
                .iter()
                .filter(|row| matches!(row.kind, ChangeKind::Added))
                .count(),
            planned
                .iter()
                .filter(|row| matches!(row.kind, ChangeKind::Modified))
                .count(),
            planned
                .iter()
                .filter(|row| matches!(row.kind, ChangeKind::Deleted))
                .count()
        );
        return Ok(());
    }

    for change in &planned {
        let abs_path = repo_root.join(PathBuf::from(&change.path));
        match change.kind {
            ChangeKind::Added | ChangeKind::Modified => {
                let target_hash = change
                    .new_hash
                    .as_deref()
                    .ok_or_else(|| anyhow!("missing target hash for {}", change.path))?;
                let current_same = current_index
                    .get(&change.path)
                    .map(|row| row.hash == target_hash)
                    .unwrap_or(false);
                if current_same {
                    continue;
                }
                let object_path = timeline_objects_dir(repo_root).join(target_hash);
                if let Some(parent) = abs_path.parent() {
                    fs::create_dir_all(parent).with_context(|| {
                        format!("failed creating parent directory {}", parent.display())
                    })?;
                }
                fs::copy(&object_path, &abs_path).with_context(|| {
                    format!(
                        "failed restoring {} from object {}",
                        abs_path.display(),
                        object_path.display()
                    )
                })?;
            }
            ChangeKind::Deleted => {
                if abs_path.exists() {
                    fs::remove_file(&abs_path)
                        .with_context(|| format!("failed deleting {}", abs_path.display()))?;
                }
            }
        }
    }

    if args.move_head {
        if !branches.branches.contains_key(&source_branch) {
            bail!("timeline branch missing after checkout: {}", source_branch);
        }
        if let Some(pointer) = branches.branches.get_mut(&source_branch) {
            pointer.head_event_id = target_event_id.clone();
        }
        branches.active_branch = source_branch.clone();
        write_pretty_json(
            &timeline_branch_index_path(repo_root, &source_branch),
            &target_index,
        )?;
        write_pretty_json(&timeline_branches_path(repo_root), &branches)?;
    }

    println!(
        "[fugit-checkout] restored branch={} event={} changed_paths={} move_head={}",
        source_branch,
        target_event_id.as_deref().unwrap_or("head"),
        planned.len(),
        if args.move_head { "true" } else { "false" }
    );
    Ok(())
}

fn cmd_gc(repo_root: &Path, args: GcArgs) -> Result<()> {
    let (_config, branches) = load_initialized_state(repo_root)?;
    let mut referenced = BTreeSet::<String>::new();
    for branch_name in branches.branches.keys() {
        let events = read_branch_events(repo_root, branch_name)?;
        for event in events {
            for change in event.changes {
                if let Some(hash) = change.old_hash {
                    referenced.insert(hash);
                }
                if let Some(hash) = change.new_hash {
                    referenced.insert(hash);
                }
            }
        }
        let index = load_branch_index(repo_root, branch_name)?;
        for row in index.values() {
            referenced.insert(row.hash.clone());
        }
    }

    let objects_dir = timeline_objects_dir(repo_root);
    let mut total_objects = 0_u64;
    let mut total_bytes = 0_u64;
    let mut pruned_objects = 0_u64;
    let mut pruned_bytes = 0_u64;

    if objects_dir.exists() {
        for entry in fs::read_dir(&objects_dir)
            .with_context(|| format!("failed reading {}", objects_dir.display()))?
        {
            let entry = entry.with_context(|| "failed reading object dir entry")?;
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let hash = entry.file_name().to_string_lossy().to_string();
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            total_objects += 1;
            total_bytes += size;
            if referenced.contains(&hash) {
                continue;
            }
            pruned_objects += 1;
            pruned_bytes += size;
            if !args.dry_run {
                fs::remove_file(&path)
                    .with_context(|| format!("failed deleting object {}", path.display()))?;
            }
        }
    }

    let report = json!({
        "schema_version": "fugit.gc.report.v1",
        "generated_at_utc": now_utc(),
        "dry_run": args.dry_run,
        "total_objects": total_objects,
        "total_bytes": total_bytes,
        "pruned_objects": pruned_objects,
        "pruned_bytes": pruned_bytes,
        "remaining_objects": total_objects.saturating_sub(pruned_objects),
        "remaining_bytes": total_bytes.saturating_sub(pruned_bytes)
    });

    if args.json {
        println!("{}", serde_json::to_string_pretty(&report)?);
    } else {
        println!(
            "[fugit-gc] dry_run={} total_objects={} pruned_objects={} reclaimed_bytes={}",
            args.dry_run, total_objects, pruned_objects, pruned_bytes
        );
    }
    Ok(())
}

fn cmd_lock(repo_root: &Path, args: LockArgs) -> Result<()> {
    let mut state = load_lock_state(repo_root)?;
    let state_changed = prune_expired_locks(&mut state)?;
    match args.action {
        LockAction::List { json } => {
            if state_changed {
                write_pretty_json(&timeline_locks_path(repo_root), &state)?;
            }
            if json {
                println!("{}", serde_json::to_string_pretty(&state.locks)?);
            } else {
                println!("[fugit-lock] active={}", state.locks.len());
                for lock in &state.locks {
                    println!(
                        "{} pattern={} agent={} expires={}",
                        lock.lock_id,
                        lock.pattern,
                        lock.agent_id,
                        lock.expires_at_utc.as_deref().unwrap_or("never")
                    );
                }
            }
        }
        LockAction::Add {
            pattern,
            agent,
            ttl_minutes,
        } => {
            if pattern.trim().is_empty() {
                bail!("lock pattern cannot be empty");
            }
            let lock_id = format!("lock_{}", Uuid::new_v4().simple());
            let created_at = now_utc();
            let expires_at_utc = ttl_minutes.and_then(|minutes| {
                if minutes <= 0 {
                    None
                } else {
                    Some((Utc::now() + Duration::minutes(minutes)).to_rfc3339())
                }
            });
            state.locks.push(FileLock {
                lock_id: lock_id.clone(),
                pattern: pattern.trim().to_string(),
                agent_id: agent.unwrap_or_else(default_agent_id),
                created_at_utc: created_at,
                expires_at_utc,
            });
            write_pretty_json(&timeline_locks_path(repo_root), &state)?;
            println!("[fugit-lock] added {}", lock_id);
        }
        LockAction::Remove { lock_id } => {
            let before = state.locks.len();
            state.locks.retain(|lock| lock.lock_id != lock_id);
            if state.locks.len() == before {
                bail!("lock not found: {}", lock_id);
            }
            write_pretty_json(&timeline_locks_path(repo_root), &state)?;
            println!("[fugit-lock] removed {}", lock_id);
        }
    }
    Ok(())
}

fn cmd_project(args: ProjectArgs) -> Result<()> {
    let mut registry = load_project_registry()?;
    match args.action {
        ProjectAction::List { json } => {
            let rows = registry
                .projects
                .iter()
                .map(|project| {
                    json!({
                        "name": project.name,
                        "repo_root": project.repo_root,
                        "added_at_utc": project.added_at_utc,
                        "updated_at_utc": project.updated_at_utc,
                        "is_default": registry.default_project.as_deref() == Some(project.name.as_str())
                    })
                })
                .collect::<Vec<_>>();
            if json {
                println!("{}", serde_json::to_string_pretty(&rows)?);
            } else {
                println!("[fugit-project] registered={}", rows.len());
                for row in rows {
                    let marker = if row["is_default"].as_bool().unwrap_or(false) {
                        "*"
                    } else {
                        "-"
                    };
                    println!(
                        "{} {} repo_root={}",
                        marker,
                        row["name"].as_str().unwrap_or("unknown"),
                        row["repo_root"].as_str().unwrap_or("unknown")
                    );
                }
            }
        }
        ProjectAction::Add {
            name,
            repo_root,
            set_default,
            json,
        } => {
            validate_project_name(&name)?;
            let canonical_root = resolve_repo_root(&repo_root)?;
            let now = now_utc();
            let normalized_name = name.trim().to_string();
            if let Some(existing) = registry
                .projects
                .iter_mut()
                .find(|project| project.name == normalized_name)
            {
                existing.repo_root = canonical_root.display().to_string();
                existing.updated_at_utc = now.clone();
            } else {
                registry.projects.push(RegisteredProject {
                    name: normalized_name.clone(),
                    repo_root: canonical_root.display().to_string(),
                    added_at_utc: now.clone(),
                    updated_at_utc: now.clone(),
                });
            }
            if set_default {
                registry.default_project = Some(normalized_name.clone());
            }
            registry
                .projects
                .sort_by(|lhs, rhs| lhs.name.cmp(&rhs.name));
            registry.updated_at_utc = now;
            write_project_registry(&registry)?;
            let payload = json!({
                "schema_version": "fugit.project.add.v1",
                "generated_at_utc": now_utc(),
                "name": normalized_name,
                "repo_root": canonical_root.display().to_string(),
                "set_default": set_default,
                "default_project": registry.default_project
            });
            if json {
                println!("{}", serde_json::to_string_pretty(&payload)?);
            } else {
                println!(
                    "[fugit-project] upserted name={} repo_root={}",
                    payload["name"].as_str().unwrap_or("unknown"),
                    payload["repo_root"].as_str().unwrap_or("unknown")
                );
            }
        }
        ProjectAction::Remove { name, json } => {
            let normalized_name = name.trim();
            if normalized_name.is_empty() {
                bail!("project name cannot be empty");
            }
            let before = registry.projects.len();
            registry
                .projects
                .retain(|project| project.name != normalized_name);
            if registry.projects.len() == before {
                bail!("project not found: {}", normalized_name);
            }
            if registry.default_project.as_deref() == Some(normalized_name) {
                registry.default_project = None;
            }
            registry
                .projects
                .sort_by(|lhs, rhs| lhs.name.cmp(&rhs.name));
            registry.updated_at_utc = now_utc();
            write_project_registry(&registry)?;
            let payload = json!({
                "schema_version": "fugit.project.remove.v1",
                "generated_at_utc": now_utc(),
                "name": normalized_name,
                "default_project": registry.default_project
            });
            if json {
                println!("{}", serde_json::to_string_pretty(&payload)?);
            } else {
                println!("[fugit-project] removed name={}", normalized_name);
            }
        }
        ProjectAction::Use { name, json } => {
            let normalized_name = name.trim();
            if normalized_name.is_empty() {
                bail!("project name cannot be empty");
            }
            if !registry
                .projects
                .iter()
                .any(|project| project.name == normalized_name)
            {
                bail!("project not found: {}", normalized_name);
            }
            registry
                .projects
                .sort_by(|lhs, rhs| lhs.name.cmp(&rhs.name));
            registry.default_project = Some(normalized_name.to_string());
            registry.updated_at_utc = now_utc();
            write_project_registry(&registry)?;
            let payload = json!({
                "schema_version": "fugit.project.use.v1",
                "generated_at_utc": now_utc(),
                "default_project": registry.default_project
            });
            if json {
                println!("{}", serde_json::to_string_pretty(&payload)?);
            } else {
                println!("[fugit-project] default project set to {}", normalized_name);
            }
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TaskDispatchKind {
    OwnedClaim,
    Open,
    Steal,
}

impl TaskDispatchKind {
    fn as_str(self) -> &'static str {
        match self {
            TaskDispatchKind::OwnedClaim => "owned_claim",
            TaskDispatchKind::Open => "open",
            TaskDispatchKind::Steal => "steal",
        }
    }
}

fn cmd_task(repo_root: &Path, args: TaskArgs) -> Result<()> {
    let mut state = load_task_state(repo_root)?;
    let state_changed = prune_expired_task_claims(&mut state)?;

    match args.action {
        TaskAction::List {
            json,
            jsonl,
            status,
            agent,
            ready_only,
            fields,
            limit,
        } => {
            if json && jsonl {
                bail!("task list accepts only one of --json or --jsonl");
            }
            if state_changed {
                state.updated_at_utc = now_utc();
                write_pretty_json(&timeline_tasks_path(repo_root), &state)?;
            }
            let status_map = task_status_map(&state);
            let mut indices: Vec<usize> = (0..state.tasks.len()).collect();
            sort_task_indices(&state, &mut indices);
            let mut rows = Vec::<serde_json::Value>::new();
            for idx in indices {
                let task = &state.tasks[idx];
                if let Some(filter) = status
                    && !filter.matches(&task.status)
                {
                    continue;
                }
                if let Some(agent_filter) = agent.as_deref() {
                    let touches_agent = task.created_by_agent_id == agent_filter
                        || task.claimed_by_agent_id.as_deref() == Some(agent_filter)
                        || task.completed_by_agent_id.as_deref() == Some(agent_filter);
                    if !touches_agent {
                        continue;
                    }
                }
                let payload = task_to_json_payload(task, &status_map);
                if ready_only
                    && !payload
                        .get("ready")
                        .and_then(serde_json::Value::as_bool)
                        .unwrap_or(false)
                {
                    continue;
                }
                rows.push(select_task_payload_fields(&payload, &fields));
                if rows.len() >= limit {
                    break;
                }
            }

            if json {
                println!("{}", serde_json::to_string_pretty(&rows)?);
            } else if jsonl {
                for row in rows {
                    println!("{}", serde_json::to_string(&row)?);
                }
            } else if !fields.is_empty() {
                println!("{}", fields.join("\t"));
                for row in rows {
                    let values = fields
                        .iter()
                        .map(|field| {
                            row.get(field.trim())
                                .map(json_value_compact_text)
                                .unwrap_or_default()
                        })
                        .collect::<Vec<_>>();
                    println!("{}", values.join("\t"));
                }
            } else {
                println!("[fugit-task] count={}", rows.len());
                for row in rows {
                    let task_id = row
                        .get("task_id")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("unknown");
                    let title = row
                        .get("title")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("untitled");
                    let status = row
                        .get("status")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("open");
                    let priority = row
                        .get("priority")
                        .and_then(serde_json::Value::as_i64)
                        .unwrap_or(0);
                    let ready = row
                        .get("ready")
                        .and_then(serde_json::Value::as_bool)
                        .unwrap_or(false);
                    let claimed_by = row
                        .get("claimed_by_agent_id")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("none");
                    println!(
                        "{} status={} priority={} ready={} claimed_by={} title={}",
                        task_id, status, priority, ready, claimed_by, title
                    );
                }
            }
        }
        TaskAction::Show { task_id, json } => {
            if state_changed {
                state.updated_at_utc = now_utc();
                write_pretty_json(&timeline_tasks_path(repo_root), &state)?;
            }
            let status_map = task_status_map(&state);
            let task = state
                .tasks
                .iter()
                .find(|task| task.task_id == task_id)
                .ok_or_else(|| anyhow!("task not found: {}", task_id))?;
            let payload = task_to_json_payload(task, &status_map);
            if json {
                println!("{}", serde_json::to_string_pretty(&payload)?);
            } else {
                println!("{}", serde_json::to_string_pretty(&payload)?);
            }
        }
        TaskAction::Current { agent, json } => {
            if state_changed {
                state.updated_at_utc = now_utc();
                write_pretty_json(&timeline_tasks_path(repo_root), &state)?;
            }
            let agent_id = agent.unwrap_or_else(default_agent_id);
            let status_map = task_status_map(&state);
            let mut indices = state
                .tasks
                .iter()
                .enumerate()
                .filter(|(_, task)| {
                    task.status == TaskStatus::Claimed
                        && task.claimed_by_agent_id.as_deref() == Some(agent_id.as_str())
                })
                .map(|(idx, _)| idx)
                .collect::<Vec<_>>();
            sort_task_indices(&state, &mut indices);
            let rows = indices
                .iter()
                .map(|idx| task_to_json_payload(&state.tasks[*idx], &status_map))
                .collect::<Vec<_>>();
            let payload = json!({
                "schema_version": "fugit.task.current.v1",
                "generated_at_utc": now_utc(),
                "agent_id": agent_id,
                "found": !rows.is_empty(),
                "count": rows.len(),
                "task": rows.first().cloned().unwrap_or(serde_json::Value::Null),
                "tasks": rows
            });
            if json {
                println!("{}", serde_json::to_string_pretty(&payload)?);
            } else if let Some(task) = payload.get("task").and_then(|row| row.as_object()) {
                println!(
                    "[fugit-task] current agent={} task_id={} title={}",
                    payload["agent_id"].as_str().unwrap_or("unknown"),
                    task.get("task_id")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("unknown"),
                    task.get("title")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("untitled")
                );
            } else {
                println!(
                    "[fugit-task] no claimed task for agent={}",
                    payload["agent_id"].as_str().unwrap_or("unknown")
                );
            }
        }
        TaskAction::Add {
            title,
            detail,
            agent,
            priority,
            tags,
            depends_on,
            json,
        } => {
            let task = build_manual_task(
                &state,
                &title,
                detail,
                normalize_agent_id(agent),
                priority,
                tags,
                depends_on,
            )?;
            state.tasks.push(task.clone());
            state.updated_at_utc = task.updated_at_utc.clone();
            write_pretty_json(&timeline_tasks_path(repo_root), &state)?;
            append_task_timeline_event(repo_root, &task, &task.created_by_agent_id, "add", None)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&task)?);
            } else {
                println!(
                    "[fugit-task] added {} priority={} tags={}",
                    task.task_id,
                    task.priority,
                    task.tags.join(",")
                );
            }
        }
        TaskAction::Edit {
            task_id,
            title,
            detail,
            clear_detail,
            agent,
            priority,
            tags,
            clear_tags,
            depends_on,
            clear_depends_on,
            json,
        } => {
            let agent_id = normalize_agent_id(agent);
            let patch = TaskEditPatch {
                title,
                detail: resolve_task_text_patch(detail, clear_detail)?,
                priority,
                tags: resolve_task_list_patch(tags, clear_tags, "tags")?,
                depends_on: resolve_task_list_patch(depends_on, clear_depends_on, "depends-on")?,
            };
            let task = edit_task_in_state(&mut state, &task_id, &agent_id, patch)?;
            write_pretty_json(&timeline_tasks_path(repo_root), &state)?;
            append_task_timeline_event(repo_root, &task, &agent_id, "edit", None)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&task)?);
            } else {
                println!("[fugit-task] edited {} by {}", task.task_id, agent_id);
            }
        }
        TaskAction::Remove {
            task_id,
            agent,
            json,
        } => {
            let agent_id = normalize_agent_id(agent);
            let task = remove_task_from_state(&mut state, &task_id, &agent_id)?;
            write_pretty_json(&timeline_tasks_path(repo_root), &state)?;
            append_task_timeline_event(repo_root, &task, &agent_id, "remove", None)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&task)?);
            } else {
                println!("[fugit-task] removed {} by {}", task.task_id, agent_id);
            }
        }
        TaskAction::Approve {
            task_id,
            all_pending_auto_replenish,
            agent,
            json,
        } => {
            let agent_id = normalize_agent_id(agent);
            let approved = approve_tasks_in_state(
                &mut state,
                task_id.as_deref(),
                all_pending_auto_replenish,
                &agent_id,
            )?;
            write_pretty_json(&timeline_tasks_path(repo_root), &state)?;
            for task in &approved {
                append_task_timeline_event(repo_root, task, &agent_id, "edit", None)?;
            }
            let payload = json!({
                "schema_version": "fugit.task.approve.v1",
                "generated_at_utc": now_utc(),
                "agent_id": agent_id,
                "approved_count": approved.len(),
                "tasks": approved
            });
            if json {
                println!("{}", serde_json::to_string_pretty(&payload)?);
            } else {
                println!(
                    "[fugit-task] approved {} task(s) by {}",
                    payload["approved_count"].as_u64().unwrap_or(0),
                    payload["agent_id"].as_str().unwrap_or("unknown")
                );
            }
        }
        TaskAction::Policy { action } => {
            let mut config = load_timeline_config_or_default(repo_root)?;
            match action {
                TaskPolicyAction::Show { json } => {
                    if state_changed {
                        state.updated_at_utc = now_utc();
                        write_pretty_json(&timeline_tasks_path(repo_root), &state)?;
                    }
                    let payload = task_policy_payload(&state, &config);
                    if json {
                        println!("{}", serde_json::to_string_pretty(&payload)?);
                    } else {
                        println!(
                            "[fugit-task-policy] auto_replenish={} confirmation={} configured_agents={} pending_confirmation={}",
                            payload["auto_replenish_enabled"].as_bool().unwrap_or(true),
                            payload["auto_replenish_confirmation"]
                                .as_bool()
                                .unwrap_or(false),
                            payload["configured_replenish_agents"]
                                .as_array()
                                .map(|rows| rows.len())
                                .unwrap_or(0),
                            payload["pending_confirmation_count"].as_u64().unwrap_or(0)
                        );
                    }
                }
                TaskPolicyAction::Set {
                    auto_replenish_enabled,
                    auto_replenish_confirmation,
                    replenish_agents,
                    clear_replenish_agents,
                    agent,
                    json,
                } => {
                    let agent_id = normalize_agent_id(agent);
                    let config_changed = update_task_policy_config(
                        &mut config,
                        auto_replenish_enabled,
                        auto_replenish_confirmation,
                        replenish_agents,
                        clear_replenish_agents,
                    );
                    let updated_task_ids = sync_auto_replenish_policy_in_state(&mut state, &config);
                    if config_changed {
                        write_pretty_json(&timeline_config_path(repo_root), &config)?;
                    }
                    if state_changed || !updated_task_ids.is_empty() {
                        write_pretty_json(&timeline_tasks_path(repo_root), &state)?;
                    }
                    for task_id in &updated_task_ids {
                        if let Some(task) = state.tasks.iter().find(|task| task.task_id == *task_id)
                        {
                            append_task_timeline_event(repo_root, task, &agent_id, "edit", None)?;
                        }
                    }
                    let payload = task_policy_payload(&state, &config);
                    if json {
                        println!("{}", serde_json::to_string_pretty(&payload)?);
                    } else {
                        println!(
                            "[fugit-task-policy] updated_by={} auto_replenish={} confirmation={} configured_agents={} policy_synced_tasks={}",
                            agent_id,
                            payload["auto_replenish_enabled"].as_bool().unwrap_or(true),
                            payload["auto_replenish_confirmation"]
                                .as_bool()
                                .unwrap_or(false),
                            payload["configured_replenish_agents"]
                                .as_array()
                                .map(|rows| rows.len())
                                .unwrap_or(0),
                            updated_task_ids.len()
                        );
                    }
                }
            }
        }
        TaskAction::Sync {
            plan,
            agent,
            default_priority,
            format,
            keep_missing,
            dry_run,
            json,
        } => {
            let plan_path = resolve_task_plan_path(repo_root, &plan)?;
            let rows = parse_task_import_rows(&plan_path, format)?;
            if rows.is_empty() {
                bail!(
                    "task sync file contains no task rows: {}",
                    plan_path.display()
                );
            }
            let plan_source = normalize_task_plan_source(repo_root, &plan_path);
            let agent_id = normalize_agent_id(agent);

            let mut next_state = state.clone();
            let mut report = sync_plan_into_task_state(
                &mut next_state,
                rows,
                &plan_source,
                &agent_id,
                default_priority,
                keep_missing,
            )?;
            report.generated_at_utc = now_utc();
            report.plan = plan_source.clone();
            report.format = match format {
                TaskImportFormatArg::Auto => "auto".to_string(),
                TaskImportFormatArg::Tsv => "tsv".to_string(),
                TaskImportFormatArg::Markdown => "markdown".to_string(),
            };
            report.dry_run = dry_run;

            if !dry_run {
                next_state.updated_at_utc = now_utc();
                write_pretty_json(&timeline_tasks_path(repo_root), &next_state)?;
                for task in &report.created {
                    if let Some(full_task) = next_state
                        .tasks
                        .iter()
                        .find(|row| row.task_id == task.task_id)
                    {
                        append_task_timeline_event(repo_root, full_task, &agent_id, "add", None)?;
                    }
                }
                for task in &report.reopened {
                    if let Some(full_task) = next_state
                        .tasks
                        .iter()
                        .find(|row| row.task_id == task.task_id)
                    {
                        append_task_timeline_event(
                            repo_root, full_task, &agent_id, "reopen", None,
                        )?;
                    }
                }
                for task in &report.updated {
                    if let Some(full_task) = next_state
                        .tasks
                        .iter()
                        .find(|row| row.task_id == task.task_id)
                    {
                        append_task_timeline_event(repo_root, full_task, &agent_id, "edit", None)?;
                    }
                }
                for task in &report.removed {
                    append_task_timeline_event(
                        repo_root,
                        &FugitTask {
                            task_id: task.task_id.clone(),
                            title: task.title.clone(),
                            detail: None,
                            priority: 0,
                            tags: Vec::new(),
                            depends_on: Vec::new(),
                            status: TaskStatus::Open,
                            created_at_utc: now_utc(),
                            updated_at_utc: now_utc(),
                            created_by_agent_id: agent_id.clone(),
                            claimed_by_agent_id: None,
                            claim_started_at_utc: None,
                            claim_expires_at_utc: None,
                            completed_at_utc: None,
                            completed_by_agent_id: None,
                            completed_summary: None,
                            completion_notes: Vec::new(),
                            completion_artifacts: Vec::new(),
                            completion_commands: Vec::new(),
                            source_key: task.source_key.clone(),
                            source_plan: Some(plan_source.clone()),
                            awaiting_confirmation: false,
                            approved_at_utc: None,
                            approved_by_agent_id: None,
                        },
                        &agent_id,
                        "remove",
                        None,
                    )?;
                }
            }

            if json {
                println!("{}", serde_json::to_string_pretty(&report)?);
            } else {
                println!(
                    "[fugit-task] sync plan={} created={} updated={} reopened={} removed={} blocked={} dry_run={}",
                    report.plan,
                    report.created.len(),
                    report.updated.len(),
                    report.reopened.len(),
                    report.removed.len(),
                    report.blocked.len(),
                    dry_run
                );
            }
        }
        TaskAction::Import {
            file,
            agent,
            default_priority,
            format,
            dry_run,
            json,
        } => {
            let resolved_file = resolve_task_plan_path(repo_root, &file)?;
            let plan_source = normalize_task_plan_source(repo_root, &resolved_file);
            let rows = parse_task_import_rows(&resolved_file, format)?;
            if rows.is_empty() {
                bail!(
                    "task import file contains no task rows: {}",
                    resolved_file.display()
                );
            }

            let mut known_keys = BTreeSet::<String>::new();
            for row in &rows {
                if !known_keys.insert(row.key.clone()) {
                    bail!(
                        "duplicate task import key '{}' in {}",
                        row.key,
                        resolved_file.display()
                    );
                }
            }

            for row in &rows {
                for dependency in &row.depends_on_keys {
                    if dependency == &row.key {
                        bail!("task import key '{}' cannot depend on itself", row.key);
                    }
                    if !known_keys.contains(dependency) {
                        bail!(
                            "task import key '{}' depends on unknown key '{}'",
                            row.key,
                            dependency
                        );
                    }
                }
            }

            let fallback_agent = agent.unwrap_or_else(default_agent_id);
            let mut pending = rows;
            let mut imported_records = Vec::<serde_json::Value>::new();
            let mut imported_tasks = Vec::<FugitTask>::new();
            let mut key_to_task_id = BTreeMap::<String, String>::new();

            while !pending.is_empty() {
                let mut progress = false;
                let mut unresolved = Vec::<TaskImportRow>::new();
                for row in pending {
                    if row
                        .depends_on_keys
                        .iter()
                        .all(|key| key_to_task_id.contains_key(key))
                    {
                        progress = true;
                        let depends_on: Vec<String> = row
                            .depends_on_keys
                            .iter()
                            .map(|key| key_to_task_id[key].clone())
                            .collect();
                        let created_by_agent_id =
                            row.agent.clone().unwrap_or_else(|| fallback_agent.clone());
                        let now = now_utc();
                        let task = FugitTask {
                            task_id: format!("task_{}", Uuid::new_v4().simple()),
                            title: row.title.clone(),
                            detail: row.detail.clone(),
                            priority: row.priority.unwrap_or(default_priority),
                            tags: dedupe_keep_order(row.tags.clone()),
                            depends_on: dedupe_keep_order(depends_on),
                            status: TaskStatus::Open,
                            created_at_utc: now.clone(),
                            updated_at_utc: now,
                            created_by_agent_id,
                            claimed_by_agent_id: None,
                            claim_started_at_utc: None,
                            claim_expires_at_utc: None,
                            completed_at_utc: None,
                            completed_by_agent_id: None,
                            completed_summary: None,
                            completion_notes: Vec::new(),
                            completion_artifacts: Vec::new(),
                            completion_commands: Vec::new(),
                            source_key: row.source_key.clone(),
                            source_plan: Some(plan_source.clone()),
                            awaiting_confirmation: false,
                            approved_at_utc: None,
                            approved_by_agent_id: None,
                        };
                        key_to_task_id.insert(row.key.clone(), task.task_id.clone());
                        imported_records.push(json!({
                            "key": row.key,
                            "task_id": task.task_id.clone(),
                            "title": task.title.clone(),
                            "priority": task.priority,
                            "tags": task.tags.clone(),
                            "depends_on": task.depends_on.clone()
                        }));
                        if !dry_run {
                            imported_tasks.push(task);
                        }
                    } else {
                        unresolved.push(row);
                    }
                }
                if !progress {
                    let unresolved_keys = unresolved
                        .iter()
                        .map(|row| row.key.clone())
                        .collect::<Vec<_>>()
                        .join(", ");
                    bail!(
                        "task import has unresolved or cyclic dependencies: {}",
                        unresolved_keys
                    );
                }
                pending = unresolved;
            }

            if !dry_run {
                for task in &imported_tasks {
                    state.tasks.push(task.clone());
                }
                state.updated_at_utc = now_utc();
                write_pretty_json(&timeline_tasks_path(repo_root), &state)?;
                for task in &imported_tasks {
                    append_task_timeline_event(
                        repo_root,
                        task,
                        &task.created_by_agent_id,
                        "add",
                        None,
                    )?;
                }
            }

            let payload = json!({
                "schema_version": "fugit.task.import.v1",
                "generated_at_utc": now_utc(),
                "file": resolved_file.display().to_string(),
                "plan": plan_source,
                "format": match format {
                    TaskImportFormatArg::Auto => "auto",
                    TaskImportFormatArg::Tsv => "tsv",
                    TaskImportFormatArg::Markdown => "markdown"
                },
                "dry_run": dry_run,
                "imported_count": imported_records.len(),
                "tasks": imported_records
            });
            if json {
                println!("{}", serde_json::to_string_pretty(&payload)?);
            } else {
                println!(
                    "[fugit-task] imported {} tasks from {} (dry_run={})",
                    payload["imported_count"].as_u64().unwrap_or(0),
                    payload["file"].as_str().unwrap_or("unknown"),
                    dry_run
                );
            }
        }
        TaskAction::Request {
            agent,
            tags,
            focus,
            prefix,
            contains,
            max,
            claim_ttl_minutes,
            steal_after_minutes,
            no_steal,
            skip_owned,
            no_claim,
            json,
        } => {
            let agent_id = agent.unwrap_or_else(default_agent_id);
            let filters = normalize_task_query_filter(tags, focus, prefix, contains)?;
            let max = max.max(1);
            if max > 1 && !no_claim {
                bail!("task request --max > 1 requires --no-claim");
            }
            let now = Utc::now();
            let config = load_timeline_config_or_default(repo_root)?;
            let mut candidates = select_task_candidates_for_agent(
                &state,
                &agent_id,
                &filters,
                !no_steal,
                !skip_owned,
                steal_after_minutes,
                now,
                max,
            );
            let mut auto_replenish = AutoReplenishEnsureResult::default();
            let should_seed_auto_replenish = candidates.is_empty()
                && config.auto_replenish_enabled
                && !agent_has_available_standard_work(
                    &state,
                    &agent_id,
                    !no_steal,
                    steal_after_minutes,
                    now,
                );
            if should_seed_auto_replenish {
                auto_replenish = ensure_auto_replenish_tasks(&mut state, &config, &agent_id);
                candidates = select_auto_replenish_candidates_for_agent(
                    &state,
                    &agent_id,
                    !no_steal,
                    !skip_owned,
                    steal_after_minutes,
                    now,
                    max,
                );
            }

            let mut timeline_events =
                Vec::<(String, String, String, Option<TaskDispatchKind>)>::new();
            for task_id in &auto_replenish.created_task_ids {
                timeline_events.push((
                    task_id.clone(),
                    SYSTEM_AGENT_ID.to_string(),
                    "add".to_string(),
                    None,
                ));
            }
            for task_id in &auto_replenish.updated_task_ids {
                timeline_events.push((
                    task_id.clone(),
                    SYSTEM_AGENT_ID.to_string(),
                    "edit".to_string(),
                    None,
                ));
            }

            let Some((task_index, dispatch_kind)) = candidates.first().copied() else {
                if state_changed
                    || !auto_replenish.created_task_ids.is_empty()
                    || !auto_replenish.updated_task_ids.is_empty()
                {
                    state.updated_at_utc = now_utc();
                    write_pretty_json(&timeline_tasks_path(repo_root), &state)?;
                    for (task_id, event_agent_id, action, dispatch) in timeline_events {
                        if let Some(task) = state.tasks.iter().find(|task| task.task_id == task_id)
                        {
                            append_task_timeline_event(
                                repo_root,
                                task,
                                &event_agent_id,
                                &action,
                                dispatch,
                            )?;
                        }
                    }
                }
                let payload = json!({
                    "schema_version": "fugit.task.request.v1",
                    "generated_at_utc": now_utc(),
                    "agent_id": agent_id,
                    "assigned": false,
                    "assigned_count": 0,
                    "claimed": false,
                    "max": max,
                    "skip_owned": skip_owned,
                    "filters": {
                        "tags": filters.required_tags,
                        "focus": filters.focus,
                        "prefix": filters.prefix,
                        "contains": filters.contains
                    },
                    "auto_replenish": {
                        "enabled": config.auto_replenish_enabled,
                        "triggered": should_seed_auto_replenish,
                        "confirmation_required": config.auto_replenish_require_confirmation,
                        "agent_ids": auto_replenish.agent_ids,
                        "created_task_ids": auto_replenish.created_task_ids,
                        "updated_task_ids": auto_replenish.updated_task_ids,
                        "pending_confirmation_task_ids": auto_replenish.pending_confirmation_task_ids
                    },
                    "tasks": [],
                    "task": null
                });
                if json {
                    println!("{}", serde_json::to_string_pretty(&payload)?);
                } else {
                    if payload["auto_replenish"]["triggered"]
                        .as_bool()
                        .unwrap_or(false)
                        && payload["auto_replenish"]["pending_confirmation_task_ids"]
                            .as_array()
                            .map(|rows| !rows.is_empty())
                            .unwrap_or(false)
                    {
                        println!(
                            "[fugit-task] auto-replenish is waiting for confirmation for agent={}",
                            payload["agent_id"]
                        );
                    } else {
                        println!(
                            "[fugit-task] no ready tasks available for agent={}",
                            payload["agent_id"]
                        );
                    }
                }
                return Ok(());
            };

            let mut claimed = false;
            if !no_claim {
                apply_task_claim(
                    &mut state.tasks[task_index],
                    &agent_id,
                    claim_ttl_minutes,
                    Utc::now(),
                );
                state.updated_at_utc = now_utc();
                write_pretty_json(&timeline_tasks_path(repo_root), &state)?;
                claimed = true;
                timeline_events.push((
                    state.tasks[task_index].task_id.clone(),
                    agent_id.clone(),
                    "claim".to_string(),
                    Some(dispatch_kind),
                ));
            }
            if state_changed
                || !auto_replenish.created_task_ids.is_empty()
                || !auto_replenish.updated_task_ids.is_empty()
                || claimed
            {
                state.updated_at_utc = now_utc();
                write_pretty_json(&timeline_tasks_path(repo_root), &state)?;
                for (task_id, event_agent_id, action, dispatch) in timeline_events {
                    if let Some(task) = state.tasks.iter().find(|task| task.task_id == task_id) {
                        append_task_timeline_event(
                            repo_root,
                            task,
                            &event_agent_id,
                            &action,
                            dispatch,
                        )?;
                    }
                }
            }
            let task = state.tasks[task_index].clone();
            let status_map = task_status_map(&state);
            let task_rows = candidates
                .iter()
                .map(|(idx, dispatch)| {
                    json!({
                        "dispatch_kind": dispatch.as_str(),
                        "task": task_to_json_payload(&state.tasks[*idx], &status_map)
                    })
                })
                .collect::<Vec<_>>();
            let payload = json!({
                "schema_version": "fugit.task.request.v1",
                "generated_at_utc": now_utc(),
                "agent_id": agent_id,
                "assigned": true,
                "assigned_count": task_rows.len(),
                "claimed": claimed,
                "max": max,
                "skip_owned": skip_owned,
                "dispatch_kind": dispatch_kind.as_str(),
                "filters": {
                    "tags": filters.required_tags,
                    "focus": filters.focus,
                    "prefix": filters.prefix,
                    "contains": filters.contains
                },
                "auto_replenish": {
                    "enabled": config.auto_replenish_enabled,
                    "triggered": should_seed_auto_replenish,
                    "confirmation_required": config.auto_replenish_require_confirmation,
                    "agent_ids": auto_replenish.agent_ids,
                    "created_task_ids": auto_replenish.created_task_ids,
                    "updated_task_ids": auto_replenish.updated_task_ids,
                    "pending_confirmation_task_ids": auto_replenish.pending_confirmation_task_ids
                },
                "tasks": task_rows,
                "task": task_to_json_payload(&task, &status_map)
            });
            if json {
                println!("{}", serde_json::to_string_pretty(&payload)?);
            } else {
                let task_id = payload["task"]["task_id"].as_str().unwrap_or("unknown");
                let title = payload["task"]["title"].as_str().unwrap_or("untitled");
                println!(
                    "[fugit-task] dispatch={} claimed={} max={} task_id={} title={}",
                    dispatch_kind.as_str(),
                    claimed,
                    max,
                    task_id,
                    title
                );
            }
        }
        TaskAction::Claim {
            task_id,
            agent,
            claim_ttl_minutes,
            steal,
            json,
        } => {
            let agent_id = agent.unwrap_or_else(default_agent_id);
            let now = Utc::now();
            let Some(task_index) = state.tasks.iter().position(|task| task.task_id == task_id)
            else {
                bail!("task not found: {}", task_id);
            };
            let task = &state.tasks[task_index];
            if task.status == TaskStatus::Done {
                bail!("task already completed: {}", task.task_id);
            }
            if task.awaiting_confirmation {
                bail!(
                    "task {} is awaiting confirmation before it can be claimed",
                    task.task_id
                );
            }
            if let Some(owner) = task.claimed_by_agent_id.as_deref()
                && owner != agent_id
                && !task_claim_is_expired(task, now)
                && !steal
            {
                bail!(
                    "task {} is currently claimed by {} (use --steal to override)",
                    task.task_id,
                    owner
                );
            }
            apply_task_claim(
                &mut state.tasks[task_index],
                &agent_id,
                claim_ttl_minutes,
                now,
            );
            state.updated_at_utc = now_utc();
            write_pretty_json(&timeline_tasks_path(repo_root), &state)?;
            let task = state.tasks[task_index].clone();
            append_task_timeline_event(repo_root, &task, &agent_id, "claim", None)?;
            if json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&state.tasks[task_index])?
                );
            } else {
                println!(
                    "[fugit-task] claimed {} by {}",
                    state.tasks[task_index].task_id, agent_id
                );
            }
        }
        TaskAction::Done {
            task_id,
            agent,
            summary,
            notes,
            artifacts,
            commands,
            json,
        } => {
            let agent_id = agent.unwrap_or_else(default_agent_id);
            let Some(task_index) = state.tasks.iter().position(|task| task.task_id == task_id)
            else {
                bail!("task not found: {}", task_id);
            };
            let task = &state.tasks[task_index];
            if let Some(owner) = task.claimed_by_agent_id.as_deref()
                && owner != agent_id
            {
                bail!(
                    "task {} is claimed by {}; release/steal before marking done",
                    task.task_id,
                    owner
                );
            }
            let now = now_utc();
            state.tasks[task_index].status = TaskStatus::Done;
            state.tasks[task_index].updated_at_utc = now.clone();
            state.tasks[task_index].completed_at_utc = Some(now);
            state.tasks[task_index].completed_by_agent_id = Some(agent_id.clone());
            state.tasks[task_index].completed_summary =
                normalize_optional_text(summary, "task completion summary")?;
            state.tasks[task_index].completion_notes = normalize_string_list(notes);
            state.tasks[task_index].completion_artifacts = normalize_string_list(artifacts);
            state.tasks[task_index].completion_commands = normalize_string_list(commands);
            state.tasks[task_index].claimed_by_agent_id = None;
            state.tasks[task_index].claim_started_at_utc = None;
            state.tasks[task_index].claim_expires_at_utc = None;
            state.updated_at_utc = now_utc();
            write_pretty_json(&timeline_tasks_path(repo_root), &state)?;
            let task = state.tasks[task_index].clone();
            append_task_timeline_event(repo_root, &task, &agent_id, "done", None)?;
            let config = load_timeline_config_or_default(repo_root)?;
            let auto_bridge_sync =
                maybe_queue_auto_bridge_sync_for_task_done(repo_root, &config, &task);
            if json {
                let mut payload = serde_json::to_value(&state.tasks[task_index])?;
                if let Some(object) = payload.as_object_mut() {
                    object.insert("auto_bridge_sync".to_string(), auto_bridge_sync);
                }
                println!("{}", serde_json::to_string_pretty(&payload)?);
            } else {
                println!(
                    "[fugit-task] completed {} by {} auto_bridge_sync={}",
                    state.tasks[task_index].task_id,
                    agent_id,
                    auto_bridge_sync["status"].as_str().unwrap_or("unknown")
                );
            }
        }
        TaskAction::Reopen {
            task_id,
            agent,
            json,
        } => {
            let agent_id = agent.unwrap_or_else(default_agent_id);
            let task = reopen_task_in_state(&mut state, &task_id, &agent_id)?;
            write_pretty_json(&timeline_tasks_path(repo_root), &state)?;
            append_task_timeline_event(repo_root, &task, &agent_id, "reopen", None)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&task)?);
            } else {
                println!("[fugit-task] reopened {} by {}", task.task_id, agent_id);
            }
        }
        TaskAction::Release {
            task_id,
            agent,
            json,
        } => {
            let agent_id = agent.unwrap_or_else(default_agent_id);
            let Some(task_index) = state.tasks.iter().position(|task| task.task_id == task_id)
            else {
                bail!("task not found: {}", task_id);
            };
            if state.tasks[task_index].status == TaskStatus::Done {
                bail!(
                    "task already completed: {}",
                    state.tasks[task_index].task_id
                );
            }
            if let Some(owner) = state.tasks[task_index].claimed_by_agent_id.as_deref()
                && owner != agent_id
            {
                bail!(
                    "task {} is claimed by {}; cannot release as {}",
                    state.tasks[task_index].task_id,
                    owner,
                    agent_id
                );
            }
            state.tasks[task_index].status = TaskStatus::Open;
            state.tasks[task_index].updated_at_utc = now_utc();
            state.tasks[task_index].claimed_by_agent_id = None;
            state.tasks[task_index].claim_started_at_utc = None;
            state.tasks[task_index].claim_expires_at_utc = None;
            state.updated_at_utc = now_utc();
            write_pretty_json(&timeline_tasks_path(repo_root), &state)?;
            let task = state.tasks[task_index].clone();
            append_task_timeline_event(repo_root, &task, &agent_id, "release", None)?;
            if json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&state.tasks[task_index])?
                );
            } else {
                println!("[fugit-task] released {}", state.tasks[task_index].task_id);
            }
        }
        TaskAction::Gui {
            project,
            host,
            port,
            no_open,
            background,
            json,
        } => {
            if json && !background {
                bail!("--json requires --background for task gui");
            }
            let open_browser = !no_open;
            if background {
                if port == 0 {
                    bail!("--background requires explicit non-zero --port");
                }
                let url = task_gui_url(&host, port, project.as_deref());
                spawn_task_gui_background(repo_root, &host, port, project.as_deref())?;
                let mut opened_browser = false;
                if open_browser {
                    if open_url_in_browser(&url).is_ok() {
                        opened_browser = true;
                    } else {
                        eprintln!(
                            "[fugit-task-gui] warning: launched server but failed opening browser"
                        );
                    }
                }
                if json {
                    println!(
                        "{}",
                        serde_json::to_string_pretty(&json!({
                            "schema_version": "fugit.task.gui.launch.v1",
                            "generated_at_utc": now_utc(),
                            "background": true,
                            "url": url,
                            "host": host,
                            "port": port,
                            "project": project,
                            "opened_browser": opened_browser
                        }))?
                    );
                } else {
                    println!("[fugit-task-gui] launched background server at {}", url);
                }
            } else {
                let listener = bind_task_gui_listener(&host, port)?;
                let local_addr = listener
                    .local_addr()
                    .with_context(|| "failed resolving task-gui local address")?;
                let url = task_gui_url(
                    &local_addr.ip().to_string(),
                    local_addr.port(),
                    project.as_deref(),
                );
                println!(
                    "[fugit-task-gui] serving live task board at {} (Ctrl+C to stop)",
                    url
                );
                if open_browser && let Err(err) = open_url_in_browser(&url) {
                    eprintln!(
                        "[fugit-task-gui] warning: failed opening browser automatically: {}",
                        err
                    );
                }
                serve_task_gui(listener, repo_root, project.as_deref())?;
            }
        }
    }

    Ok(())
}

fn append_task_timeline_event(
    repo_root: &Path,
    task: &FugitTask,
    agent_id: &str,
    action: &str,
    dispatch_kind: Option<TaskDispatchKind>,
) -> Result<()> {
    if !timeline_is_initialized(repo_root) {
        return Ok(());
    }

    let (_config, mut branches) = load_initialized_state(repo_root)?;
    let active_branch = branches.active_branch.clone();
    let parent_event_id = branches
        .branches
        .get(&active_branch)
        .and_then(|row| row.head_event_id.clone());
    let tracked_file_count = load_branch_index(repo_root, &active_branch)
        .map(|index| index.len())
        .unwrap_or(0);
    let event_id = format!("evt_{}", Uuid::new_v4().simple());
    let event = TimelineEvent {
        schema_version: SCHEMA_EVENT.to_string(),
        event_id: event_id.clone(),
        created_at_utc: now_utc(),
        branch: active_branch.clone(),
        parent_event_id,
        agent_id: agent_id.to_string(),
        summary: task_timeline_summary(action, task, dispatch_kind),
        tags: task_timeline_tags(action, task, dispatch_kind),
        metrics: EventMetrics {
            tracked_file_count,
            changed_file_count: 0,
            added_count: 0,
            modified_count: 0,
            deleted_count: 0,
            changed_bytes_total: 0,
        },
        changes: Vec::new(),
    };
    append_jsonl(
        &timeline_branch_events_path(repo_root, &active_branch),
        &event,
    )?;
    if let Some(pointer) = branches.branches.get_mut(&active_branch) {
        pointer.head_event_id = Some(event_id);
    }
    write_pretty_json(&timeline_branches_path(repo_root), &branches)?;
    Ok(())
}

fn task_timeline_summary(
    action: &str,
    task: &FugitTask,
    dispatch_kind: Option<TaskDispatchKind>,
) -> String {
    let title = task.title.trim();
    let action_label = if task_is_auto_replenish(task) {
        format!("auto-replenish {}", action)
    } else {
        action.to_string()
    };
    match (action, dispatch_kind) {
        ("add", _) if task_is_auto_replenish(task) => {
            format!("task auto-replenish add: {} \"{}\"", task.task_id, title)
        }
        ("edit", _) if task_is_auto_replenish(task) => {
            format!("task auto-replenish edit: {} \"{}\"", task.task_id, title)
        }
        ("claim", Some(dispatch)) => format!(
            "task claim: {} \"{}\" (dispatch={})",
            task.task_id,
            title,
            dispatch.as_str()
        ),
        ("claim", None) => format!("task claim: {} \"{}\"", task.task_id, title),
        ("done", _) => format!("task done: {} \"{}\"", task.task_id, title),
        ("reopen", _) => format!("task reopen: {} \"{}\"", task.task_id, title),
        ("remove", _) => format!("task remove: {} \"{}\"", task.task_id, title),
        ("release", _) => format!("task release: {} \"{}\"", task.task_id, title),
        (_, _) => format!("task {}: {} \"{}\"", action_label, task.task_id, title),
    }
}

fn task_timeline_tags(
    action: &str,
    task: &FugitTask,
    dispatch_kind: Option<TaskDispatchKind>,
) -> Vec<String> {
    let mut tags = vec![
        "task".to_string(),
        format!("task_action:{}", action),
        format!("task_id:{}", task.task_id),
    ];
    if let Some(dispatch) = dispatch_kind {
        tags.push(format!("task_dispatch:{}", dispatch.as_str()));
    }
    if task_is_auto_replenish(task) {
        tags.push("task_kind:auto_replenish".to_string());
        if let Some(agent_id) = task_auto_replenish_agent_id(task) {
            tags.push(format!("task_replenish_agent:{}", agent_id));
        }
    }
    for tag in &task.tags {
        tags.push(format!("task_tag:{}", tag));
    }
    dedupe_keep_order(tags)
}

fn bind_task_gui_listener(host: &str, port: u16) -> Result<TcpListener> {
    let bind_addr = format!("{}:{}", host.trim(), port);
    let listener = TcpListener::bind(&bind_addr)
        .with_context(|| format!("failed binding task gui listener at {}", bind_addr))?;
    Ok(listener)
}

fn task_gui_url(host: &str, port: u16, project: Option<&str>) -> String {
    let browser_host = match host {
        "0.0.0.0" => "127.0.0.1",
        "::" => "localhost",
        _ => host,
    };
    let base = if browser_host.contains(':') && !browser_host.starts_with('[') {
        format!("http://[{}]:{}", browser_host, port)
    } else {
        format!("http://{}:{}", browser_host, port)
    };
    if let Some(project_key) = project {
        let trimmed = project_key.trim();
        if !trimmed.is_empty() {
            return format!("{}/?project={}", base, percent_encode(trimmed));
        }
    }
    base
}

fn spawn_task_gui_background(
    repo_root: &Path,
    host: &str,
    port: u16,
    project: Option<&str>,
) -> Result<()> {
    let current_exe =
        std::env::current_exe().with_context(|| "failed resolving current executable")?;
    let mut cmd = ProcessCommand::new(current_exe);
    cmd.arg("--repo-root")
        .arg(repo_root)
        .arg("task")
        .arg("gui")
        .arg("--host")
        .arg(host)
        .arg("--port")
        .arg(port.to_string())
        .args(
            project
                .filter(|token| !token.trim().is_empty())
                .map(|token| vec!["--project".to_string(), token.to_string()])
                .unwrap_or_default(),
        )
        .arg("--no-open")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    cmd.spawn()
        .with_context(|| "failed spawning background task gui process")?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn open_url_in_browser(url: &str) -> Result<()> {
    let status = ProcessCommand::new("open")
        .arg(url)
        .status()
        .with_context(|| "failed invoking 'open'")?;
    if !status.success() {
        bail!("'open' exited with status {}", status);
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn open_url_in_browser(url: &str) -> Result<()> {
    let status = ProcessCommand::new("cmd")
        .args(["/C", "start", "", url])
        .status()
        .with_context(|| "failed invoking 'cmd /C start'")?;
    if !status.success() {
        bail!("'cmd /C start' exited with status {}", status);
    }
    Ok(())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_url_in_browser(url: &str) -> Result<()> {
    let status = ProcessCommand::new("xdg-open")
        .arg(url)
        .status()
        .with_context(|| "failed invoking 'xdg-open'")?;
    if !status.success() {
        bail!("'xdg-open' exited with status {}", status);
    }
    Ok(())
}

#[cfg(not(any(target_os = "macos", target_os = "windows", unix)))]
fn open_url_in_browser(_url: &str) -> Result<()> {
    bail!("automatic browser launch is not supported on this platform")
}

fn serve_task_gui(
    listener: TcpListener,
    repo_root: &Path,
    default_project: Option<&str>,
) -> Result<()> {
    for incoming in listener.incoming() {
        match incoming {
            Ok(mut stream) => {
                if let Err(err) =
                    handle_task_gui_connection(&mut stream, repo_root, default_project)
                {
                    eprintln!("[fugit-task-gui] request error: {}", err);
                }
            }
            Err(err) => {
                eprintln!("[fugit-task-gui] incoming connection error: {}", err);
            }
        }
    }
    Ok(())
}

fn handle_task_gui_connection(
    stream: &mut TcpStream,
    repo_root: &Path,
    default_project: Option<&str>,
) -> Result<()> {
    let Some(request) = read_http_request(stream)? else {
        return Ok(());
    };
    let method = request.method.as_str();
    let path = request.target.path.as_str();
    let query = &request.target.query;

    if method == "GET" && path == "/health" {
        return write_http_json(stream, "200 OK", &json!({ "ok": true }));
    }

    if path == "/api/tasks" {
        if method != "GET" {
            return write_http_json_error(
                stream,
                "405 Method Not Allowed",
                "GET required for /api/tasks",
            );
        }
        let selected_project = query.get("project").map(String::as_str).or(default_project);
        return match task_gui_payload(repo_root, selected_project) {
            Ok(payload) => write_http_json(stream, "200 OK", &payload),
            Err(err) => write_http_json_error(stream, "400 Bad Request", &err.to_string()),
        };
    }

    if path == "/api/timeline" {
        if method != "GET" {
            return write_http_json_error(
                stream,
                "405 Method Not Allowed",
                "GET required for /api/timeline",
            );
        }
        let selected_project = query.get("project").map(String::as_str).or(default_project);
        let selected_branch = query
            .get("branch")
            .map(String::as_str)
            .map(str::trim)
            .filter(|token| !token.is_empty());
        let limit = parse_query_usize(query, "limit")
            .unwrap_or(120)
            .clamp(1, 1000);
        let offset = parse_query_usize(query, "offset")
            .unwrap_or(0)
            .min(1_000_000);
        return match task_gui_timeline_payload(
            repo_root,
            selected_project,
            selected_branch,
            limit,
            offset,
        ) {
            Ok(payload) => write_http_json(stream, "200 OK", &payload),
            Err(err) => write_http_json_error(stream, "400 Bad Request", &err.to_string()),
        };
    }

    if path == "/api/tasks/add" {
        if method != "POST" {
            return write_http_json_error(
                stream,
                "405 Method Not Allowed",
                "POST required for /api/tasks/add",
            );
        }
        if !request_content_type_is_json(&request) {
            return write_http_json_error(
                stream,
                "415 Unsupported Media Type",
                "application/json body required for /api/tasks/add",
            );
        }
        let selected_project = query.get("project").map(String::as_str).or(default_project);
        return match task_gui_add_task(repo_root, selected_project, &request.body) {
            Ok(payload) => write_http_json(stream, "200 OK", &payload),
            Err(err) => write_http_json_error(stream, "400 Bad Request", &err.to_string()),
        };
    }

    if path == "/api/tasks/edit" {
        if method != "POST" {
            return write_http_json_error(
                stream,
                "405 Method Not Allowed",
                "POST required for /api/tasks/edit",
            );
        }
        if !request_content_type_is_json(&request) {
            return write_http_json_error(
                stream,
                "415 Unsupported Media Type",
                "application/json body required for /api/tasks/edit",
            );
        }
        let selected_project = query.get("project").map(String::as_str).or(default_project);
        return match task_gui_edit_task(repo_root, selected_project, &request.body) {
            Ok(payload) => write_http_json(stream, "200 OK", &payload),
            Err(err) => write_http_json_error(stream, "400 Bad Request", &err.to_string()),
        };
    }

    if path == "/api/tasks/remove" {
        if method != "POST" {
            return write_http_json_error(
                stream,
                "405 Method Not Allowed",
                "POST required for /api/tasks/remove",
            );
        }
        if !request_content_type_is_json(&request) {
            return write_http_json_error(
                stream,
                "415 Unsupported Media Type",
                "application/json body required for /api/tasks/remove",
            );
        }
        let selected_project = query.get("project").map(String::as_str).or(default_project);
        return match task_gui_remove_task(repo_root, selected_project, &request.body) {
            Ok(payload) => write_http_json(stream, "200 OK", &payload),
            Err(err) => write_http_json_error(stream, "400 Bad Request", &err.to_string()),
        };
    }

    if path == "/api/tasks/approve" {
        if method != "POST" {
            return write_http_json_error(
                stream,
                "405 Method Not Allowed",
                "POST required for /api/tasks/approve",
            );
        }
        if !request_content_type_is_json(&request) {
            return write_http_json_error(
                stream,
                "415 Unsupported Media Type",
                "application/json body required for /api/tasks/approve",
            );
        }
        let selected_project = query.get("project").map(String::as_str).or(default_project);
        return match task_gui_approve_task(repo_root, selected_project, &request.body) {
            Ok(payload) => write_http_json(stream, "200 OK", &payload),
            Err(err) => write_http_json_error(stream, "400 Bad Request", &err.to_string()),
        };
    }

    if method == "GET" && path == "/" {
        let html = task_gui_html();
        return write_http_response(
            stream,
            "200 OK",
            "text/html; charset=utf-8",
            html.as_bytes(),
        );
    }

    if method != "GET" && method != "POST" {
        return write_http_json_error(
            stream,
            "405 Method Not Allowed",
            "supported methods: GET, POST",
        );
    }

    write_http_json_error(stream, "404 Not Found", "unknown task gui endpoint")
}

#[derive(Debug, Clone)]
struct HttpTarget {
    path: String,
    query: BTreeMap<String, String>,
}

#[derive(Debug, Clone)]
struct HttpRequest {
    method: String,
    target: HttpTarget,
    headers: BTreeMap<String, String>,
    body: Vec<u8>,
}

fn request_content_type_is_json(request: &HttpRequest) -> bool {
    request
        .headers
        .get("content-type")
        .map(|value| value.to_ascii_lowercase().contains("application/json"))
        .unwrap_or(true)
}

fn read_http_request(stream: &mut TcpStream) -> Result<Option<HttpRequest>> {
    let mut buffer = Vec::<u8>::with_capacity(8192);
    let mut chunk = [0_u8; 4096];
    let mut header_end = None;
    let mut expected_total = None;

    loop {
        let read = stream
            .read(&mut chunk)
            .with_context(|| "failed reading task-gui request")?;
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.len() > TASK_GUI_MAX_REQUEST_BYTES {
            bail!(
                "task-gui request exceeds maximum size of {} bytes",
                TASK_GUI_MAX_REQUEST_BYTES
            );
        }
        if header_end.is_none()
            && let Some(idx) = find_http_header_end(&buffer)
        {
            header_end = Some(idx);
            let content_length = parse_http_content_length(&buffer[..idx])?;
            expected_total = Some(idx + 4 + content_length);
        }
        if let Some(total_len) = expected_total
            && buffer.len() >= total_len
        {
            break;
        }
    }

    if buffer.is_empty() {
        return Ok(None);
    }

    let header_end = find_http_header_end(&buffer)
        .ok_or_else(|| anyhow!("task-gui request missing header terminator"))?;
    let content_length = parse_http_content_length(&buffer[..header_end])?;
    let total_len = header_end + 4 + content_length;
    if buffer.len() < total_len {
        bail!("task-gui request body shorter than declared content-length");
    }
    parse_http_request(&buffer[..total_len]).map(Some)
}

fn find_http_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

fn parse_http_content_length(header_bytes: &[u8]) -> Result<usize> {
    let header_text = String::from_utf8_lossy(header_bytes);
    for line in header_text.lines().skip(1) {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        if name.trim().eq_ignore_ascii_case("content-length") {
            return value
                .trim()
                .parse::<usize>()
                .with_context(|| format!("invalid content-length '{}'", value.trim()));
        }
    }
    Ok(0)
}

fn parse_http_request(bytes: &[u8]) -> Result<HttpRequest> {
    let header_end = find_http_header_end(bytes)
        .ok_or_else(|| anyhow!("task-gui request missing header terminator"))?;
    let header_text = String::from_utf8_lossy(&bytes[..header_end]);
    let mut lines = header_text.split("\r\n");
    let request_line = lines
        .next()
        .ok_or_else(|| anyhow!("task-gui request missing request line"))?;
    let mut parts = request_line.split_whitespace();
    let method = parts
        .next()
        .ok_or_else(|| anyhow!("task-gui request missing method"))?
        .to_string();
    let raw_target = parts
        .next()
        .ok_or_else(|| anyhow!("task-gui request missing target"))?;
    let target = parse_http_target_from_raw(raw_target);
    let mut headers = BTreeMap::<String, String>::new();
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }
    let content_length = headers
        .get("content-length")
        .map(String::as_str)
        .unwrap_or("0")
        .parse::<usize>()
        .with_context(|| "invalid content-length header")?;
    let body_start = header_end + 4;
    let body_end = body_start.saturating_add(content_length).min(bytes.len());
    let body = bytes[body_start..body_end].to_vec();
    Ok(HttpRequest {
        method,
        target,
        headers,
        body,
    })
}

#[cfg(test)]
fn parse_http_target(request: &str) -> Option<HttpTarget> {
    let first_line = request.lines().next()?;
    let mut parts = first_line.split_whitespace();
    let _method = parts.next()?;
    let raw_target = parts.next()?;
    Some(parse_http_target_from_raw(raw_target))
}

fn parse_http_target_from_raw(raw_target: &str) -> HttpTarget {
    let mut pieces = raw_target.splitn(2, '?');
    let path = pieces.next().unwrap_or("/").to_string();
    let query = pieces.next().map(parse_query_string).unwrap_or_default();
    HttpTarget { path, query }
}

fn parse_query_string(query: &str) -> BTreeMap<String, String> {
    let mut out = BTreeMap::<String, String>::new();
    for pair in query.split('&') {
        if pair.trim().is_empty() {
            continue;
        }
        let mut parts = pair.splitn(2, '=');
        let key = percent_decode(parts.next().unwrap_or_default());
        if key.trim().is_empty() {
            continue;
        }
        let value = percent_decode(parts.next().unwrap_or_default());
        out.insert(key, value);
    }
    out
}

fn parse_query_usize(query: &BTreeMap<String, String>, key: &str) -> Option<usize> {
    query.get(key)?.trim().parse::<usize>().ok()
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = String::with_capacity(input.len());
    let mut idx = 0;
    while idx < bytes.len() {
        let b = bytes[idx];
        if b == b'%' && idx + 2 < bytes.len() {
            let hi = bytes[idx + 1];
            let lo = bytes[idx + 2];
            if let (Some(hi), Some(lo)) = (hex_to_u8(hi), hex_to_u8(lo)) {
                out.push((hi << 4 | lo) as char);
                idx += 3;
                continue;
            }
        }
        if b == b'+' {
            out.push(' ');
        } else {
            out.push(b as char);
        }
        idx += 1;
    }
    out
}

fn percent_encode(input: &str) -> String {
    let mut out = String::new();
    for ch in input.bytes() {
        let is_unreserved = ch.is_ascii_alphanumeric() || matches!(ch, b'-' | b'_' | b'.' | b'~');
        if is_unreserved {
            out.push(ch as char);
        } else if ch == b' ' {
            out.push('+');
        } else {
            out.push('%');
            out.push_str(&format!("{:02X}", ch));
        }
    }
    out
}

fn hex_to_u8(ch: u8) -> Option<u8> {
    match ch {
        b'0'..=b'9' => Some(ch - b'0'),
        b'a'..=b'f' => Some(10 + (ch - b'a')),
        b'A'..=b'F' => Some(10 + (ch - b'A')),
        _ => None,
    }
}

fn write_http_response(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    body: &[u8],
) -> Result<()> {
    let headers = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream
        .write_all(headers.as_bytes())
        .with_context(|| "failed writing task-gui headers")?;
    stream
        .write_all(body)
        .with_context(|| "failed writing task-gui body")?;
    stream
        .flush()
        .with_context(|| "failed flushing task-gui response")?;
    Ok(())
}

fn write_http_json(
    stream: &mut TcpStream,
    status: &str,
    payload: &serde_json::Value,
) -> Result<()> {
    let bytes =
        serde_json::to_vec_pretty(payload).with_context(|| "failed serializing http json body")?;
    write_http_response(stream, status, "application/json; charset=utf-8", &bytes)
}

fn write_http_json_error(stream: &mut TcpStream, status: &str, message: &str) -> Result<()> {
    write_http_json(
        stream,
        status,
        &json!({
            "ok": false,
            "error": message
        }),
    )
}

fn resolve_task_gui_project_selection(
    repo_root: &Path,
    project_selector: Option<&str>,
) -> Result<(Vec<TaskGuiProject>, TaskGuiProject, PathBuf)> {
    let projects = collect_task_gui_projects(repo_root)?;
    let selected = resolve_selected_task_gui_project(&projects, project_selector)
        .cloned()
        .ok_or_else(|| anyhow!("task gui has no available projects"))?;
    let selected_repo = PathBuf::from(selected.repo_root.clone());
    Ok((projects, selected, selected_repo))
}

fn task_gui_add_task(
    repo_root: &Path,
    project_selector: Option<&str>,
    body: &[u8],
) -> Result<serde_json::Value> {
    let request: TaskGuiCreateRequest =
        serde_json::from_slice(body).with_context(|| "invalid task gui add payload")?;
    let (_projects, selected, selected_repo) =
        resolve_task_gui_project_selection(repo_root, project_selector)?;
    let mut state = load_task_state(&selected_repo)?;
    let _ = prune_expired_task_claims(&mut state)?;
    let task = build_manual_task(
        &state,
        &request.title,
        request.detail,
        normalize_agent_id(request.agent),
        request.priority.unwrap_or(0),
        request.tags.unwrap_or_default(),
        request.depends_on.unwrap_or_default(),
    )?;
    state.tasks.push(task.clone());
    state.updated_at_utc = task.updated_at_utc.clone();
    write_pretty_json(&timeline_tasks_path(&selected_repo), &state)?;
    append_task_timeline_event(
        &selected_repo,
        &task,
        &task.created_by_agent_id,
        "add",
        None,
    )?;
    Ok(json!({
        "ok": true,
        "action": "add",
        "selected_project": {
            "key": selected.key,
            "name": selected.name,
            "repo_root": selected.repo_root
        },
        "task": task
    }))
}

fn task_gui_edit_task(
    repo_root: &Path,
    project_selector: Option<&str>,
    body: &[u8],
) -> Result<serde_json::Value> {
    let request: TaskGuiEditRequest =
        serde_json::from_slice(body).with_context(|| "invalid task gui edit payload")?;
    let (_projects, selected, selected_repo) =
        resolve_task_gui_project_selection(repo_root, project_selector)?;
    let mut state = load_task_state(&selected_repo)?;
    let _ = prune_expired_task_claims(&mut state)?;
    let agent_id = normalize_agent_id(request.agent);
    let task = edit_task_in_state(
        &mut state,
        &request.task_id,
        &agent_id,
        TaskEditPatch {
            title: request.title,
            detail: match request.detail {
                None => TaskTextPatch::Keep,
                Some(None) => TaskTextPatch::Clear,
                Some(Some(value)) => TaskTextPatch::Set(value),
            },
            priority: request.priority,
            tags: request.tags.map(dedupe_keep_order),
            depends_on: request.depends_on.map(dedupe_keep_order),
        },
    )?;
    write_pretty_json(&timeline_tasks_path(&selected_repo), &state)?;
    append_task_timeline_event(&selected_repo, &task, &agent_id, "edit", None)?;
    Ok(json!({
        "ok": true,
        "action": "edit",
        "selected_project": {
            "key": selected.key,
            "name": selected.name,
            "repo_root": selected.repo_root
        },
        "task": task
    }))
}

fn task_gui_remove_task(
    repo_root: &Path,
    project_selector: Option<&str>,
    body: &[u8],
) -> Result<serde_json::Value> {
    let request: TaskGuiRemoveRequest =
        serde_json::from_slice(body).with_context(|| "invalid task gui remove payload")?;
    let (_projects, selected, selected_repo) =
        resolve_task_gui_project_selection(repo_root, project_selector)?;
    let mut state = load_task_state(&selected_repo)?;
    let _ = prune_expired_task_claims(&mut state)?;
    let agent_id = normalize_agent_id(request.agent);
    let task = remove_task_from_state(&mut state, &request.task_id, &agent_id)?;
    write_pretty_json(&timeline_tasks_path(&selected_repo), &state)?;
    append_task_timeline_event(&selected_repo, &task, &agent_id, "remove", None)?;
    Ok(json!({
        "ok": true,
        "action": "remove",
        "selected_project": {
            "key": selected.key,
            "name": selected.name,
            "repo_root": selected.repo_root
        },
        "task": task
    }))
}

fn task_gui_approve_task(
    repo_root: &Path,
    project_selector: Option<&str>,
    body: &[u8],
) -> Result<serde_json::Value> {
    let request: TaskGuiApproveRequest =
        serde_json::from_slice(body).with_context(|| "invalid task gui approve payload")?;
    let (_projects, selected, selected_repo) =
        resolve_task_gui_project_selection(repo_root, project_selector)?;
    let mut state = load_task_state(&selected_repo)?;
    let _ = prune_expired_task_claims(&mut state)?;
    let agent_id = normalize_agent_id(request.agent);
    let approved = approve_tasks_in_state(
        &mut state,
        request.task_id.as_deref(),
        request.all_pending_auto_replenish.unwrap_or(false),
        &agent_id,
    )?;
    write_pretty_json(&timeline_tasks_path(&selected_repo), &state)?;
    for task in &approved {
        append_task_timeline_event(&selected_repo, task, &agent_id, "edit", None)?;
    }
    Ok(json!({
        "ok": true,
        "action": "approve",
        "selected_project": {
            "key": selected.key,
            "name": selected.name,
            "repo_root": selected.repo_root
        },
        "approved_count": approved.len(),
        "tasks": approved
    }))
}

fn task_gui_payload(repo_root: &Path, project_selector: Option<&str>) -> Result<serde_json::Value> {
    let (projects, selected, selected_repo) =
        resolve_task_gui_project_selection(repo_root, project_selector)?;
    let mut state = load_task_state(&selected_repo)?;
    let changed = prune_expired_task_claims(&mut state)?;
    if changed {
        state.updated_at_utc = now_utc();
        write_pretty_json(&timeline_tasks_path(&selected_repo), &state)?;
    }
    let config = load_timeline_config_or_default(&selected_repo)?;
    let status_map = task_status_map(&state);
    let mut indices: Vec<usize> = (0..state.tasks.len()).collect();
    sort_task_indices(&state, &mut indices);
    let tasks = indices
        .into_iter()
        .map(|idx| task_to_json_payload(&state.tasks[idx], &status_map))
        .collect::<Vec<_>>();
    Ok(json!({
        "schema_version": "fugit.task.gui.snapshot.v1",
        "generated_at_utc": now_utc(),
        "selected_project": {
            "key": selected.key,
            "name": selected.name,
            "repo_root": selected.repo_root
        },
        "projects": projects,
        "timeline_initialized": timeline_is_initialized(&selected_repo),
        "policy": task_policy_payload(&state, &config),
        "count": tasks.len(),
        "tasks": tasks
    }))
}

fn task_gui_timeline_payload(
    repo_root: &Path,
    project_selector: Option<&str>,
    branch_selector: Option<&str>,
    limit: usize,
    offset: usize,
) -> Result<serde_json::Value> {
    let (projects, selected, selected_repo) =
        resolve_task_gui_project_selection(repo_root, project_selector)?;
    let timeline_initialized = timeline_is_initialized(&selected_repo);
    if !timeline_initialized {
        return Ok(json!({
            "schema_version": "fugit.task.gui.timeline.v1",
            "generated_at_utc": now_utc(),
            "selected_project": {
                "key": selected.key,
                "name": selected.name,
                "repo_root": selected.repo_root
            },
            "projects": projects,
            "timeline_initialized": false,
            "active_branch": null,
            "branch": null,
            "branches": [],
            "offset": offset,
            "limit": limit,
            "count": 0,
            "total_events": 0,
            "has_more": false,
            "next_offset": offset,
            "events": []
        }));
    }

    let (_config, branches_state) = load_initialized_state(&selected_repo)?;
    let mut branches = branches_state.branches.keys().cloned().collect::<Vec<_>>();
    branches.sort();
    let active_branch = branches_state.active_branch.clone();
    let selected_branch = branch_selector
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .filter(|token| branches_state.branches.contains_key(*token))
        .map(ToString::to_string)
        .unwrap_or_else(|| active_branch.clone());

    let all_events = read_branch_events(&selected_repo, &selected_branch)?;
    let total_events = all_events.len();
    let page = timeline_events_page(&all_events, offset, limit);
    let count = page.len();
    let has_more = offset + count < total_events;
    let next_offset = offset + count;
    let events = page
        .into_iter()
        .map(|event| {
            let task_action = timeline_tag_value(&event.tags, "task_action:");
            let task_id = timeline_tag_value(&event.tags, "task_id:");
            let task_dispatch = timeline_tag_value(&event.tags, "task_dispatch:");
            let is_task_event = event.tags.iter().any(|tag| tag == "task")
                || task_action.is_some()
                || task_id.is_some();
            json!({
                "event_id": event.event_id,
                "created_at_utc": event.created_at_utc,
                "branch": event.branch,
                "agent_id": event.agent_id,
                "summary": event.summary,
                "tags": event.tags,
                "metrics": {
                    "tracked_file_count": event.metrics.tracked_file_count,
                    "changed_file_count": event.metrics.changed_file_count,
                    "added_count": event.metrics.added_count,
                    "modified_count": event.metrics.modified_count,
                    "deleted_count": event.metrics.deleted_count,
                    "changed_bytes_total": event.metrics.changed_bytes_total
                },
                "is_task_event": is_task_event,
                "task_action": task_action,
                "task_id": task_id,
                "task_dispatch": task_dispatch
            })
        })
        .collect::<Vec<_>>();

    Ok(json!({
        "schema_version": "fugit.task.gui.timeline.v1",
        "generated_at_utc": now_utc(),
        "selected_project": {
            "key": selected.key,
            "name": selected.name,
            "repo_root": selected.repo_root
        },
        "projects": projects,
        "timeline_initialized": true,
        "active_branch": active_branch,
        "branch": selected_branch,
        "branches": branches,
        "offset": offset,
        "limit": limit,
        "count": count,
        "total_events": total_events,
        "has_more": has_more,
        "next_offset": next_offset,
        "events": events
    }))
}

fn timeline_events_page(
    events: &[TimelineEvent],
    offset: usize,
    limit: usize,
) -> Vec<TimelineEvent> {
    if limit == 0 || events.is_empty() || offset >= events.len() {
        return Vec::new();
    }
    let end_exclusive = events.len().saturating_sub(offset);
    let start_inclusive = end_exclusive.saturating_sub(limit);
    let mut page = events[start_inclusive..end_exclusive].to_vec();
    page.reverse();
    page
}

fn timeline_tag_value(tags: &[String], prefix: &str) -> Option<String> {
    for tag in tags {
        if let Some(rest) = tag.strip_prefix(prefix) {
            let token = rest.trim();
            if !token.is_empty() {
                return Some(token.to_string());
            }
        }
    }
    None
}

fn task_gui_html() -> &'static str {
    r#"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>fugit task board</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7fb;
      --card: #ffffff;
      --ink: #111827;
      --muted: #6b7280;
      --border: #dbe2ef;
      --open: #065f46;
      --claimed: #92400e;
      --done: #1e40af;
      --blocked: #9f1239;
      --ready: #15803d;
      --timeline-task: #0f766e;
      --timeline-file: #1d4ed8;
      --danger: #b91c1c;
      --accent: #0f172a;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: linear-gradient(180deg, #eef2ff 0%, var(--bg) 30%, var(--bg) 100%);
      color: var(--ink);
    }
    header {
      padding: 18px 20px;
      border-bottom: 1px solid var(--border);
      background: rgba(255,255,255,0.85);
      backdrop-filter: blur(4px);
      position: sticky;
      top: 0;
      z-index: 10;
    }
    .head-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .head-controls {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    h1 { margin: 0; font-size: 20px; }
    .meta { margin-top: 6px; color: var(--muted); font-size: 13px; }
    .project-picker,
    .agent-input,
    .field input,
    .field textarea,
    .timeline-controls select,
    .timeline-controls button,
    .panel-actions button,
    .task-actions button,
    .editor-actions button {
      border: 1px solid var(--border);
      border-radius: 8px;
      background: #fff;
      color: var(--ink);
      font: inherit;
    }
    .project-picker,
    .agent-input {
      padding: 8px 10px;
      min-width: 260px;
      font-size: 13px;
    }
    .agent-input {
      min-width: 200px;
    }
    main {
      padding: 16px;
      display: grid;
      gap: 16px;
      grid-template-columns: 1fr;
    }
    @media (min-width: 1080px) {
      main { grid-template-columns: 1.25fr 1fr; }
    }
    .panel {
      background: rgba(255,255,255,0.82);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 12px;
      box-shadow: 0 2px 10px rgba(15, 23, 42, 0.04);
    }
    .panel-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }
    .panel-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .panel-actions button,
    .task-actions button,
    .editor-actions button,
    .timeline-controls button {
      padding: 7px 11px;
      cursor: pointer;
    }
    .summary {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }
    .pill {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 6px 10px;
      font-size: 12px;
      color: var(--muted);
    }
    .message-error {
      color: var(--danger);
    }
    .message-ok {
      color: var(--ready);
    }
    .editor {
      border: 1px solid var(--border);
      border-radius: 12px;
      background: #f8fafc;
      padding: 12px;
      margin-bottom: 12px;
    }
    .editor-top {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: center;
      margin-bottom: 10px;
    }
    .editor-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 10px;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 6px;
      font-size: 12px;
      color: var(--muted);
    }
    .field input,
    .field textarea {
      padding: 9px 10px;
      font-size: 13px;
      color: var(--ink);
    }
    .field textarea {
      min-height: 96px;
      resize: vertical;
    }
    .field-span {
      grid-column: 1 / -1;
    }
    .editor-actions {
      display: flex;
      gap: 10px;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      margin-top: 10px;
    }
    .ghost-button {
      background: #fff;
    }
    .danger-button {
      color: var(--danger);
      border-color: #fecaca;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 12px;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 12px;
      box-shadow: 0 2px 10px rgba(15, 23, 42, 0.04);
    }
    .row { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
    .title { margin: 0; font-size: 15px; font-weight: 700; }
    .priority { font-size: 12px; color: var(--muted); }
    .status {
      display: inline-block;
      border-radius: 999px;
      padding: 3px 8px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .status-open { color: var(--open); background: #d1fae5; }
    .status-claimed { color: var(--claimed); background: #fef3c7; }
    .status-done { color: var(--done); background: #dbeafe; }
    .detail { margin: 8px 0; font-size: 13px; color: #1f2937; white-space: pre-wrap; }
    .meta-row { font-size: 12px; color: var(--muted); margin-top: 6px; }
    .tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
    .tag {
      font-size: 11px;
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 2px 7px;
      color: #334155;
      background: #f8fafc;
    }
    .state { margin-top: 8px; font-size: 12px; }
    .ready { color: var(--ready); font-weight: 600; }
    .blocked { color: var(--blocked); font-weight: 600; }
    .task-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 12px;
    }
    .timeline-controls {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      margin-bottom: 8px;
    }
    .timeline-controls select,
    .timeline-controls button {
      padding: 6px 10px;
      font-size: 12px;
      cursor: pointer;
    }
    .timeline-controls button[disabled] {
      cursor: not-allowed;
      opacity: 0.55;
    }
    .timeline-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-height: 72vh;
      overflow-y: auto;
      padding-right: 4px;
    }
    .timeline-row {
      background: #fff;
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 10px;
      font-size: 12px;
    }
    .timeline-row.task { border-left: 4px solid var(--timeline-task); }
    .timeline-row.file { border-left: 4px solid var(--timeline-file); }
    .timeline-topline {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      color: var(--muted);
      margin-bottom: 4px;
    }
    .timeline-summary {
      color: var(--ink);
      font-size: 13px;
      margin-bottom: 6px;
      word-break: break-word;
    }
    .timeline-metrics {
      color: var(--muted);
      font-size: 11px;
    }
    .empty {
      margin-top: 20px;
      border: 1px dashed var(--border);
      padding: 20px;
      border-radius: 12px;
      color: var(--muted);
      text-align: center;
      background: var(--card);
    }
  </style>
</head>
<body>
  <header>
    <div class="head-row">
      <h1>fugit task board</h1>
      <div class="head-controls">
        <input id="agentInput" class="agent-input" placeholder="agent id (optional)">
        <label>
          <select id="projectSelect" class="project-picker"></select>
        </label>
      </div>
    </div>
    <div class="meta" id="meta">loading...</div>
  </header>
  <main>
    <section class="panel">
      <div class="panel-top">
        <div class="summary" id="summary"></div>
        <div class="panel-actions">
          <button id="newTaskButton" type="button">new task</button>
          <button id="refreshTasks" type="button">refresh</button>
        </div>
      </div>
      <form id="taskEditor" class="editor" style="display:none;">
        <div class="editor-top">
          <strong id="editorTitle">new task</strong>
          <button id="closeEditor" class="ghost-button" type="button">cancel</button>
        </div>
        <div class="editor-grid">
          <label class="field">
            <span>title</span>
            <input id="taskTitleInput" type="text" autocomplete="off" maxlength="500">
          </label>
          <label class="field">
            <span>priority</span>
            <input id="taskPriorityInput" type="number" step="1">
          </label>
          <label class="field field-span">
            <span>detail</span>
            <textarea id="taskDetailInput" placeholder="optional detail"></textarea>
          </label>
          <label class="field">
            <span>tags (comma separated)</span>
            <input id="taskTagsInput" type="text" autocomplete="off" placeholder="compiler,gui">
          </label>
          <label class="field">
            <span>depends on task ids</span>
            <input id="taskDependsInput" type="text" autocomplete="off" placeholder="task_abc,task_xyz">
          </label>
        </div>
        <div class="editor-actions">
          <button id="saveTaskButton" type="submit">create task</button>
          <div class="meta" id="editorMeta">Use this editor for new tasks and full replacements when editing.</div>
        </div>
      </form>
      <div class="meta" id="actionMeta">Task changes apply immediately and timeline events refresh after each mutation.</div>
      <div class="grid" id="tasks"></div>
      <div class="empty" id="empty" style="display:none;">No tasks yet. Create one here or import a backlog with <code>fugit task import --file /path/to/tasks.tsv</code>.</div>
    </section>
    <section class="panel">
      <div class="timeline-controls">
        <strong>timeline</strong>
        <select id="branchSelect"></select>
        <button id="refreshTimeline" type="button">refresh</button>
        <button id="loadOlder" type="button">load older</button>
      </div>
      <div class="meta" id="timelineMeta">loading timeline...</div>
      <div class="timeline-list" id="timelineList"></div>
      <div class="empty" id="timelineEmpty" style="display:none;">No timeline events yet for this branch.</div>
    </section>
  </main>
  <script>
    const byId = (id) => document.getElementById(id);
    const params = new URLSearchParams(window.location.search);
    let selectedProject = params.get("project") || "";
    let selectedBranch = params.get("branch") || "";
    let timelineOffset = 0;
    let timelineHasMore = false;
    let timelineRows = [];
    let timelineLoading = false;
    const TIMELINE_PAGE_SIZE = 120;
    const EDITOR_STORAGE_KEY = "fugit.task.gui.agent";

    const escapeHtml = (value) => String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");

    const csvSplit = (value) => String(value || "")
      .split(",")
      .map((token) => token.trim())
      .filter(Boolean);

    const projectQuery = () => selectedProject ? `?project=${encodeURIComponent(selectedProject)}` : "";

    const currentAgentId = () => {
      const input = byId("agentInput");
      return input ? input.value.trim() : "";
    };

    const setActionMessage = (message, kind = "ok") => {
      const node = byId("actionMeta");
      node.textContent = message;
      node.className = `meta ${kind === "error" ? "message-error" : "message-ok"}`;
    };

    const syncUrl = () => {
      const next = new URL(window.location.href);
      if (selectedProject) {
        next.searchParams.set("project", selectedProject);
      } else {
        next.searchParams.delete("project");
      }
      if (selectedBranch) {
        next.searchParams.set("branch", selectedBranch);
      } else {
        next.searchParams.delete("branch");
      }
      window.history.replaceState({}, "", next.toString());
    };

    const resetTimeline = () => {
      timelineOffset = 0;
      timelineHasMore = false;
      timelineRows = [];
    };

    const statusClass = (status) => {
      if (status === "open") return "status-open";
      if (status === "claimed") return "status-claimed";
      if (status === "done") return "status-done";
      return "status-open";
    };

    const readJsonResponse = async (response) => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || response.statusText || "request failed");
      }
      return payload;
    };

    const closeEditor = () => {
      const editor = byId("taskEditor");
      editor.dataset.mode = "";
      editor.dataset.taskId = "";
      editor.style.display = "none";
      byId("taskTitleInput").value = "";
      byId("taskPriorityInput").value = "0";
      byId("taskDetailInput").value = "";
      byId("taskTagsInput").value = "";
      byId("taskDependsInput").value = "";
    };

    const openEditor = (mode, task) => {
      const editor = byId("taskEditor");
      editor.dataset.mode = mode;
      editor.dataset.taskId = task?.task_id || "";
      editor.style.display = "block";
      byId("editorTitle").textContent = mode === "edit"
        ? `edit ${task.task_id}`
        : "new task";
      byId("saveTaskButton").textContent = mode === "edit"
        ? "save changes"
        : "create task";
      byId("editorMeta").textContent = mode === "edit"
        ? "Editing replaces the current title, detail, tags, and dependency list."
        : "Create tasks directly from the board without dropping to the CLI.";
      byId("taskTitleInput").value = task?.title || "";
      byId("taskPriorityInput").value = String(task?.priority ?? 0);
      byId("taskDetailInput").value = task?.detail || "";
      byId("taskTagsInput").value = (task?.tags || []).join(", ");
      byId("taskDependsInput").value = (task?.depends_on || []).join(", ");
      byId("taskTitleInput").focus();
    };

    const renderSummary = (tasks) => {
      const counts = { open: 0, claimed: 0, done: 0, ready: 0, blocked: 0 };
      for (const task of tasks) {
        if (counts[task.status] !== undefined) counts[task.status] += 1;
        if (task.ready) counts.ready += 1;
        if (!task.ready && task.status !== "done") counts.blocked += 1;
      }
      byId("summary").innerHTML = [
        `open: ${counts.open}`,
        `claimed: ${counts.claimed}`,
        `done: ${counts.done}`,
        `ready: ${counts.ready}`,
        `blocked: ${counts.blocked}`
      ].map((line) => `<div class="pill">${escapeHtml(line)}</div>`).join("");
    };

    const renderProjectPicker = (projects, selectedKey) => {
      const picker = byId("projectSelect");
      if (!picker) return;
      picker.innerHTML = (projects || []).map((project) => {
        const selected = project.key === selectedKey ? " selected" : "";
        const label = `${project.name} (${project.repo_root})`;
        return `<option value="${escapeHtml(project.key)}"${selected}>${escapeHtml(label)}</option>`;
      }).join("");
      picker.onchange = () => {
        selectedProject = picker.value || "";
        selectedBranch = "";
        resetTimeline();
        closeEditor();
        syncUrl();
        refresh();
        refreshTimeline(true);
      };
    };

    const renderTasks = (tasks) => {
      const editor = byId("taskEditor");
      if (editor.dataset.mode === "edit" && editor.dataset.taskId) {
        const stillExists = tasks.some((task) => task.task_id === editor.dataset.taskId);
        if (!stillExists) {
          closeEditor();
        }
      }
      byId("empty").style.display = tasks.length === 0 ? "block" : "none";
      byId("tasks").innerHTML = tasks.map((task) => {
        const tags = (task.tags || [])
          .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
          .join("");
        const detail = task.detail
          ? `<p class="detail">${escapeHtml(task.detail)}</p>`
          : "";
        const completedSummary = task.completed_summary
          ? `<div class="meta-row">completion summary: ${escapeHtml(task.completed_summary)}</div>`
          : "";
        const completionArtifacts = (task.completion_artifacts || []).length > 0
          ? `<div class="meta-row">artifacts: ${escapeHtml((task.completion_artifacts || []).join(", "))}</div>`
          : "";
        const completionCommands = (task.completion_commands || []).length > 0
          ? `<div class="meta-row">commands: ${escapeHtml((task.completion_commands || []).join(" | "))}</div>`
          : "";
        const deps = (task.depends_on || []).join(", ");
        const blockedBy = (task.blocked_by || []).join(", ");
        const awaitingConfirmation = !!task.awaiting_confirmation;
        const stateLine = task.ready
          ? `<span class="ready">ready</span>`
          : awaitingConfirmation
            ? `<span class="blocked">awaiting approval before dispatch</span>`
            : `<span class="blocked">blocked by: ${escapeHtml(blockedBy || "unknown")}</span>`;
        const approveButton = awaitingConfirmation
          ? `<button type="button" class="ghost-button approve-task" data-task-id="${escapeHtml(task.task_id)}">approve</button>`
          : "";
        const autoReplenishMeta = task.auto_replenish
          ? `<div class="meta-row">auto replenish: ${escapeHtml(task.source_key || "system")}</div>`
          : "";
        return `
          <article class="card">
            <div class="row">
              <h2 class="title">${escapeHtml(task.title || "(untitled)")}</h2>
              <span class="status ${statusClass(task.status)}">${escapeHtml(task.status)}</span>
            </div>
            <div class="priority">id: ${escapeHtml(task.task_id)} • priority: ${escapeHtml(task.priority)}</div>
            ${detail}
            <div class="meta-row">claimed by: ${escapeHtml(task.claimed_by_agent_id || "none")}</div>
            <div class="meta-row">depends on: ${escapeHtml(deps || "none")}</div>
            ${autoReplenishMeta}
            ${completedSummary}
            ${completionArtifacts}
            ${completionCommands}
            <div class="state">${stateLine}</div>
            <div class="tags">${tags}</div>
            <div class="task-actions">
              ${approveButton}
              <button type="button" class="ghost-button edit-task" data-task-id="${escapeHtml(task.task_id)}">edit</button>
              <button type="button" class="ghost-button danger-button remove-task" data-task-id="${escapeHtml(task.task_id)}">remove</button>
            </div>
          </article>
        `;
      }).join("");

      byId("tasks").querySelectorAll(".edit-task").forEach((button) => {
        button.onclick = () => {
          const task = tasks.find((candidate) => candidate.task_id === button.dataset.taskId);
          if (task) {
            openEditor("edit", task);
          }
        };
      });

      byId("tasks").querySelectorAll(".remove-task").forEach((button) => {
        button.onclick = async () => {
          const task = tasks.find((candidate) => candidate.task_id === button.dataset.taskId);
          if (!task) return;
          const confirmed = window.confirm(`Remove ${task.task_id}: ${task.title || "(untitled)"}?`);
          if (!confirmed) return;
          try {
            const payload = { task_id: task.task_id };
            const agent = currentAgentId();
            if (agent) payload.agent = agent;
            const response = await fetch(`/api/tasks/remove${projectQuery()}`, {
              method: "POST",
              cache: "no-store",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload)
            });
            const result = await readJsonResponse(response);
            closeEditor();
            setActionMessage(`removed ${result.task?.task_id || task.task_id}`);
            await refresh();
            await refreshTimeline(true);
          } catch (error) {
            setActionMessage(`remove failed: ${error}`, "error");
          }
        };
      });

      byId("tasks").querySelectorAll(".approve-task").forEach((button) => {
        button.onclick = async () => {
          const task = tasks.find((candidate) => candidate.task_id === button.dataset.taskId);
          if (!task) return;
          try {
            const payload = { task_id: task.task_id };
            const agent = currentAgentId();
            if (agent) payload.agent = agent;
            const response = await fetch(`/api/tasks/approve${projectQuery()}`, {
              method: "POST",
              cache: "no-store",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload)
            });
            const result = await readJsonResponse(response);
            setActionMessage(`approved ${result.tasks?.[0]?.task_id || task.task_id}`);
            await refresh();
            await refreshTimeline(true);
          } catch (error) {
            setActionMessage(`approve failed: ${error}`, "error");
          }
        };
      });
    };

    const renderBranchPicker = (branches, activeBranch, branchValue) => {
      const picker = byId("branchSelect");
      if (!picker) return;
      if (!branches || branches.length === 0) {
        picker.innerHTML = `<option value="">timeline not initialized</option>`;
        picker.disabled = true;
        return;
      }
      picker.disabled = false;
      const selected = branchValue || activeBranch || branches[0];
      selectedBranch = selected;
      picker.innerHTML = branches.map((branch) => {
        const marker = branch === activeBranch ? " (active)" : "";
        const chosen = branch === selected ? " selected" : "";
        return `<option value="${escapeHtml(branch)}"${chosen}>${escapeHtml(branch + marker)}</option>`;
      }).join("");
      picker.onchange = () => {
        selectedBranch = picker.value || "";
        resetTimeline();
        syncUrl();
        refreshTimeline(true);
      };
    };

    const timelineRowClass = (event) => {
      if (event.is_task_event) return "timeline-row task";
      return "timeline-row file";
    };

    const renderTimeline = (payload) => {
      const rows = timelineRows || [];
      byId("timelineEmpty").style.display = rows.length === 0 ? "block" : "none";
      byId("loadOlder").disabled = !timelineHasMore || timelineLoading;
      byId("timelineList").innerHTML = rows.map((event) => {
        const when = new Date(event.created_at_utc).toLocaleString();
        const changed = Number(event.metrics?.changed_file_count || 0);
        const taskInfo = event.is_task_event
          ? `task ${event.task_action || "event"} • ${event.task_id || "unknown"}`
          : `file delta ${changed}`;
        const tagList = (event.tags || []).slice(0, 8).join(", ");
        const dispatch = event.task_dispatch ? ` • dispatch=${event.task_dispatch}` : "";
        return `
          <article class="${timelineRowClass(event)}">
            <div class="timeline-topline">
              <span>${escapeHtml(when)}</span>
              <span>${escapeHtml(event.event_id)}</span>
            </div>
            <div class="timeline-summary">${escapeHtml(event.summary || "(no summary)")}</div>
            <div class="timeline-metrics">branch=${escapeHtml(event.branch)} • agent=${escapeHtml(event.agent_id)} • ${escapeHtml(taskInfo)}${escapeHtml(dispatch)}</div>
            <div class="timeline-metrics">${escapeHtml(tagList ? `tags: ${tagList}` : "tags: none")}</div>
          </article>
        `;
      }).join("");
      const total = payload.total_events || 0;
      const shown = rows.length;
      const branch = payload.branch || "unknown";
      const branchCount = (payload.branches || []).length;
      byId("timelineMeta").textContent = `branch: ${branch} • shown: ${shown}/${total} • branches: ${branchCount} • has_more: ${timelineHasMore}`;
    };

    async function refresh() {
      try {
        const previousProject = selectedProject;
        const response = await fetch(`/api/tasks${projectQuery()}`, { cache: "no-store" });
        const payload = await readJsonResponse(response);
        if (payload.selected_project && payload.selected_project.key) {
          selectedProject = payload.selected_project.key;
        }
        const tasks = payload.tasks || [];
        renderProjectPicker(payload.projects || [], selectedProject);
        const project = payload.selected_project || {};
        const label = project.name ? `${project.name} • ${project.repo_root}` : "unknown project";
        const initState = payload.timeline_initialized ? "initialized" : "not initialized";
        const policy = payload.policy || {};
        const policyText = `auto_replenish=${policy.auto_replenish_enabled !== false ? "on" : "off"} • confirm=${policy.auto_replenish_confirmation ? "on" : "off"} • pending=${policy.pending_confirmation_count || 0}`;
        byId("meta").textContent = `project: ${label} • ${initState} • ${policyText} • updated: ${new Date(payload.generated_at_utc).toLocaleString()} • total: ${tasks.length}`;
        renderSummary(tasks);
        renderTasks(tasks);
        if (selectedProject !== previousProject) {
          resetTimeline();
          await refreshTimeline(true);
        }
      } catch (error) {
        byId("meta").textContent = `failed to load tasks: ${error}`;
      }
    }

    async function refreshTimeline(resetPage) {
      if (timelineLoading) return;
      if (resetPage) {
        resetTimeline();
      }
      timelineLoading = true;
      byId("loadOlder").disabled = true;
      try {
        const query = new URLSearchParams();
        if (selectedProject) query.set("project", selectedProject);
        if (selectedBranch) query.set("branch", selectedBranch);
        query.set("limit", String(TIMELINE_PAGE_SIZE));
        query.set("offset", String(timelineOffset));
        const response = await fetch(`/api/timeline?${query.toString()}`, { cache: "no-store" });
        const payload = await readJsonResponse(response);
        if (payload.selected_project && payload.selected_project.key) {
          selectedProject = payload.selected_project.key;
        }
        if (!payload.timeline_initialized) {
          selectedBranch = "";
          renderBranchPicker([], "", "");
          timelineRows = [];
          timelineHasMore = false;
          byId("timelineMeta").textContent = "timeline not initialized for this project";
          renderTimeline(payload);
          return;
        }
        selectedBranch = payload.branch || selectedBranch;
        renderProjectPicker(payload.projects || [], selectedProject);
        renderBranchPicker(payload.branches || [], payload.active_branch || "", selectedBranch);
        const rows = payload.events || [];
        if (resetPage) {
          timelineRows = rows;
        } else {
          timelineRows = timelineRows.concat(rows);
        }
        timelineHasMore = Boolean(payload.has_more);
        timelineOffset = Number(payload.next_offset || timelineRows.length || 0);
        syncUrl();
        renderTimeline(payload);
      } catch (error) {
        byId("timelineMeta").textContent = `failed to load timeline: ${error}`;
      } finally {
        timelineLoading = false;
        byId("loadOlder").disabled = !timelineHasMore;
      }
    }

    byId("refreshTasks").onclick = () => {
      refresh();
    };
    byId("newTaskButton").onclick = () => {
      openEditor("create");
    };
    byId("closeEditor").onclick = () => {
      closeEditor();
    };
    byId("taskEditor").onsubmit = async (event) => {
      event.preventDefault();
      try {
        const editor = byId("taskEditor");
        const title = byId("taskTitleInput").value.trim();
        if (!title) {
          throw new Error("task title cannot be empty");
        }
        const priorityText = byId("taskPriorityInput").value.trim();
        const payload = {
          title,
          detail: byId("taskDetailInput").value.trim() || null,
          priority: priorityText === "" ? 0 : Number(priorityText),
          tags: csvSplit(byId("taskTagsInput").value),
          depends_on: csvSplit(byId("taskDependsInput").value)
        };
        const agent = currentAgentId();
        if (agent) {
          payload.agent = agent;
        }
        let endpoint = "/api/tasks/add";
        if (editor.dataset.mode === "edit") {
          endpoint = "/api/tasks/edit";
          payload.task_id = editor.dataset.taskId;
        }
        const response = await fetch(`${endpoint}${projectQuery()}`, {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const result = await readJsonResponse(response);
        setActionMessage(`${editor.dataset.mode === "edit" ? "saved" : "created"} ${result.task?.task_id || title}`);
        closeEditor();
        await refresh();
        await refreshTimeline(true);
      } catch (error) {
        setActionMessage(`save failed: ${error}`, "error");
      }
    };
    byId("refreshTimeline").onclick = () => {
      refreshTimeline(true);
    };
    byId("loadOlder").onclick = () => {
      if (timelineHasMore) {
        refreshTimeline(false);
      }
    };

    const agentInput = byId("agentInput");
    agentInput.value = localStorage.getItem(EDITOR_STORAGE_KEY) || "";
    agentInput.onchange = () => {
      localStorage.setItem(EDITOR_STORAGE_KEY, agentInput.value.trim());
    };
    agentInput.onblur = agentInput.onchange;

    refresh().then(() => refreshTimeline(true));
    setInterval(() => {
      if (!document.hidden) {
        refresh();
      }
    }, 1200);
  </script>
</body>
</html>"#
}

fn cmd_mcp(repo_root: &Path, args: McpArgs) -> Result<()> {
    match args.action {
        McpAction::Serve => run_mcp_stdio(repo_root),
    }
}

fn run_mcp_stdio(repo_root: &Path) -> Result<()> {
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut reader = BufReader::new(stdin.lock());
    let mut writer = stdout.lock();

    while let Some(message) = read_mcp_message(&mut reader)? {
        let method = message
            .get("method")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .to_string();
        let id = message.get("id").cloned();
        if id.is_none() {
            // Notification: no response required.
            if method == "notifications/initialized" {
                continue;
            }
            continue;
        }
        let id = id.unwrap_or(json!(null));
        let params = message.get("params").cloned().unwrap_or_else(|| json!({}));
        let response = match method.as_str() {
            "initialize" => json_rpc_ok(
                id,
                json!({
                    "protocolVersion": "2024-11-05",
                    "serverInfo": { "name": "fugit", "version": "0.2.0" },
                    "capabilities": { "tools": { "listChanged": false } }
                }),
            ),
            "tools/list" => json_rpc_ok(
                id,
                json!({
                    "tools": mcp_tools_manifest()
                }),
            ),
            "tools/call" => match mcp_handle_tool_call(repo_root, &params) {
                Ok(result) => json_rpc_ok(id, result),
                Err(err) => json_rpc_err(id, -32000, err.to_string()),
            },
            _ => json_rpc_err(id, -32601, format!("unsupported method: {}", method)),
        };
        write_mcp_message(&mut writer, &response)?;
    }
    Ok(())
}

fn mcp_tools_manifest() -> Vec<serde_json::Value> {
    vec![
        json!({
            "name": "fugit_status",
            "description": "Get timeline status summary for the repository.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "limit": { "type": "integer", "minimum": 1 },
                    "strict_hash": { "type": "boolean" },
                    "hash_jobs": { "type": "integer", "minimum": 1 },
                    "burst": { "type": "boolean" }
                }
            }
        }),
        json!({
            "name": "fugit_checkpoint",
            "description": "Create a timeline checkpoint with summary/agent/tags.",
            "inputSchema": {
                "type": "object",
                "required": ["summary"],
                "properties": {
                    "summary": { "type": "string" },
                    "agent": { "type": "string" },
                    "tags": { "type": "array", "items": { "type": "string" } },
                    "files": { "type": "array", "items": { "type": "string" } },
                    "strict_hash": { "type": "boolean" },
                    "ignore_locks": { "type": "boolean" },
                    "repair": { "type": "string", "enum": ["auto", "strict", "lossy"] },
                    "hash_jobs": { "type": "integer", "minimum": 1 },
                    "object_jobs": { "type": "integer", "minimum": 1 },
                    "burst": { "type": "boolean" }
                }
            }
        }),
        json!({
            "name": "fugit_log",
            "description": "Read timeline events.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "limit": { "type": "integer", "minimum": 1 },
                    "branch": { "type": "string" }
                }
            }
        }),
        json!({
            "name": "fugit_checkout",
            "description": "Materialize a target event or branch head into working tree.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "event": { "type": "string" },
                    "branch": { "type": "string" },
                    "dry_run": { "type": "boolean" },
                    "force": { "type": "boolean" },
                    "strict_hash": { "type": "boolean" },
                    "move_head": { "type": "boolean" },
                    "hash_jobs": { "type": "integer", "minimum": 1 },
                    "burst": { "type": "boolean" }
                }
            }
        }),
        json!({
            "name": "fugit_lock_add",
            "description": "Add a lock pattern for multi-agent coordination.",
            "inputSchema": {
                "type": "object",
                "required": ["pattern"],
                "properties": {
                    "pattern": { "type": "string" },
                    "agent": { "type": "string" },
                    "ttl_minutes": { "type": "integer" }
                }
            }
        }),
        json!({
            "name": "fugit_lock_list",
            "description": "List active lock entries.",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "fugit_task_show",
            "description": "Read a single task by id.",
            "inputSchema": {
                "type": "object",
                "required": ["task_id"],
                "properties": {
                    "task_id": { "type": "string" }
                }
            }
        }),
        json!({
            "name": "fugit_task_current",
            "description": "Return the current claimed task or tasks for an agent.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "agent": { "type": "string" }
                }
            }
        }),
        json!({
            "name": "fugit_task_add",
            "description": "Create a persistent task in the shared queue.",
            "inputSchema": {
                "type": "object",
                "required": ["title"],
                "properties": {
                    "title": { "type": "string" },
                    "detail": { "type": "string" },
                    "agent": { "type": "string" },
                    "priority": { "type": "integer" },
                    "tags": { "type": "array", "items": { "type": "string" } },
                    "depends_on": { "type": "array", "items": { "type": "string" } }
                }
            }
        }),
        json!({
            "name": "fugit_task_edit",
            "description": "Edit task metadata by replacing selected fields.",
            "inputSchema": {
                "type": "object",
                "required": ["task_id"],
                "properties": {
                    "task_id": { "type": "string" },
                    "title": { "type": "string" },
                    "detail": { "type": "string" },
                    "clear_detail": { "type": "boolean" },
                    "agent": { "type": "string" },
                    "priority": { "type": "integer" },
                    "tags": { "type": "array", "items": { "type": "string" } },
                    "clear_tags": { "type": "boolean" },
                    "depends_on": { "type": "array", "items": { "type": "string" } },
                    "clear_depends_on": { "type": "boolean" }
                }
            }
        }),
        json!({
            "name": "fugit_task_remove",
            "description": "Remove a task that is no longer needed.",
            "inputSchema": {
                "type": "object",
                "required": ["task_id"],
                "properties": {
                    "task_id": { "type": "string" },
                    "agent": { "type": "string" }
                }
            }
        }),
        json!({
            "name": "fugit_task_approve",
            "description": "Approve one pending task or all pending auto-replenish tasks awaiting confirmation.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "task_id": { "type": "string" },
                    "all_pending_auto_replenish": { "type": "boolean" },
                    "agent": { "type": "string" }
                }
            }
        }),
        json!({
            "name": "fugit_task_policy_show",
            "description": "Inspect task auto-replenish policy and confirmation state.",
            "inputSchema": {
                "type": "object",
                "properties": {}
            }
        }),
        json!({
            "name": "fugit_task_policy_set",
            "description": "Update task auto-replenish policy and configured replenish agents.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "auto_replenish_enabled": { "type": "boolean" },
                    "auto_replenish_confirmation": { "type": "boolean" },
                    "replenish_agents": { "type": "array", "items": { "type": "string" } },
                    "clear_replenish_agents": { "type": "boolean" },
                    "agent": { "type": "string" }
                }
            }
        }),
        json!({
            "name": "fugit_task_sync",
            "description": "Reconcile a markdown/TSV plan file or markdown payload with the task queue.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "plan": { "type": "string" },
                    "markdown": { "type": "string" },
                    "format": { "type": "string", "enum": ["auto", "tsv", "markdown"] },
                    "agent": { "type": "string" },
                    "default_priority": { "type": "integer" },
                    "keep_missing": { "type": "boolean" },
                    "dry_run": { "type": "boolean" }
                }
            }
        }),
        json!({
            "name": "fugit_task_import",
            "description": "Bulk import tasks into the persistent queue from a TSV file, TSV content, or markdown checklist content.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "file": { "type": "string" },
                    "tsv": { "type": "string" },
                    "markdown": { "type": "string" },
                    "format": { "type": "string", "enum": ["auto", "tsv", "markdown"] },
                    "agent": { "type": "string" },
                    "default_priority": { "type": "integer" },
                    "dry_run": { "type": "boolean" }
                }
            }
        }),
        json!({
            "name": "fugit_task_list",
            "description": "List tasks from the persistent queue.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "status": { "type": "string", "enum": ["open", "claimed", "done"] },
                    "agent": { "type": "string" },
                    "ready_only": { "type": "boolean" },
                    "fields": { "type": "array", "items": { "type": "string" } },
                    "limit": { "type": "integer", "minimum": 1 }
                }
            }
        }),
        json!({
            "name": "fugit_task_request",
            "description": "Request the next best task for an agent with dependency-aware ordering, work stealing, and auto-replenish fallback when the queue is exhausted.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "agent": { "type": "string" },
                    "tags": { "type": "array", "items": { "type": "string" } },
                    "focus": { "type": "string" },
                    "prefix": { "type": "string" },
                    "contains": { "type": "string" },
                    "max": { "type": "integer", "minimum": 1 },
                    "claim_ttl_minutes": { "type": "integer" },
                    "steal_after_minutes": { "type": "integer" },
                    "no_steal": { "type": "boolean" },
                    "skip_owned": { "type": "boolean" },
                    "no_claim": { "type": "boolean" }
                }
            }
        }),
        json!({
            "name": "fugit_task_claim",
            "description": "Claim a specific task by id.",
            "inputSchema": {
                "type": "object",
                "required": ["task_id"],
                "properties": {
                    "task_id": { "type": "string" },
                    "agent": { "type": "string" },
                    "claim_ttl_minutes": { "type": "integer" },
                    "steal": { "type": "boolean" }
                }
            }
        }),
        json!({
            "name": "fugit_task_done",
            "description": "Mark a task as completed.",
            "inputSchema": {
                "type": "object",
                "required": ["task_id"],
                "properties": {
                    "task_id": { "type": "string" },
                    "agent": { "type": "string" },
                    "summary": { "type": "string" },
                    "notes": { "type": "array", "items": { "type": "string" } },
                    "artifacts": { "type": "array", "items": { "type": "string" } },
                    "commands": { "type": "array", "items": { "type": "string" } }
                }
            }
        }),
        json!({
            "name": "fugit_task_reopen",
            "description": "Reopen a completed task and clear its completion metadata.",
            "inputSchema": {
                "type": "object",
                "required": ["task_id"],
                "properties": {
                    "task_id": { "type": "string" },
                    "agent": { "type": "string" }
                }
            }
        }),
        json!({
            "name": "fugit_task_release",
            "description": "Release a claimed task back to open status.",
            "inputSchema": {
                "type": "object",
                "required": ["task_id"],
                "properties": {
                    "task_id": { "type": "string" },
                    "agent": { "type": "string" }
                }
            }
        }),
        json!({
            "name": "fugit_task_gui_launch",
            "description": "Launch the live task-board GUI in a separate window via background server.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project": { "type": "string" },
                    "host": { "type": "string" },
                    "port": { "type": "integer", "minimum": 1, "maximum": 65535 },
                    "open": { "type": "boolean" }
                }
            }
        }),
        json!({
            "name": "fugit_project_list",
            "description": "List registered projects for multi-project coordination.",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "fugit_project_add",
            "description": "Register or update a project name -> repo_root mapping.",
            "inputSchema": {
                "type": "object",
                "required": ["name", "repo_root"],
                "properties": {
                    "name": { "type": "string" },
                    "repo_root": { "type": "string" },
                    "set_default": { "type": "boolean" }
                }
            }
        }),
        json!({
            "name": "fugit_project_use",
            "description": "Set the default project for the task GUI.",
            "inputSchema": {
                "type": "object",
                "required": ["name"],
                "properties": {
                    "name": { "type": "string" }
                }
            }
        }),
        json!({
            "name": "fugit_project_remove",
            "description": "Remove a project from the registry.",
            "inputSchema": {
                "type": "object",
                "required": ["name"],
                "properties": {
                    "name": { "type": "string" }
                }
            }
        }),
        json!({
            "name": "fugit_gc",
            "description": "Prune unreferenced object blobs from .fugit/objects.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "dry_run": { "type": "boolean" }
                }
            }
        }),
        json!({
            "name": "fugit_skill_bundle",
            "description": "Return the fugit skill package for onboarding new agents (SKILL.md + optional openai.yaml).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "include_skill_body": { "type": "boolean" },
                    "include_openai_yaml": { "type": "boolean" }
                }
            }
        }),
        json!({
            "name": "fugit_skill_install_codex",
            "description": "Install the bundled fugit skill into CODEX_HOME/skills/fugit for this machine.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "overwrite": { "type": "boolean" }
                }
            }
        }),
    ]
}

fn mcp_handle_tool_call(repo_root: &Path, params: &serde_json::Value) -> Result<serde_json::Value> {
    let tool_name = params
        .get("name")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| anyhow!("tool call missing 'name'"))?;
    let args = params
        .get("arguments")
        .cloned()
        .unwrap_or_else(|| json!({}));

    let result = match tool_name {
        "fugit_status" => {
            let mut cli_args = vec!["status".to_string(), "--json".to_string()];
            if let Some(limit) = args.get("limit").and_then(serde_json::Value::as_u64) {
                cli_args.push("--limit".to_string());
                cli_args.push(limit.to_string());
            }
            if args
                .get("strict_hash")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false)
            {
                cli_args.push("--strict-hash".to_string());
            }
            if let Some(hash_jobs) = args.get("hash_jobs").and_then(serde_json::Value::as_u64) {
                cli_args.push("--hash-jobs".to_string());
                cli_args.push(hash_jobs.to_string());
            }
            if args
                .get("burst")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false)
            {
                cli_args.push("--burst".to_string());
            }
            run_self_cli_json(repo_root, &cli_args)?
        }
        "fugit_checkpoint" => {
            let summary = args
                .get("summary")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| anyhow!("fugit_checkpoint requires summary"))?;
            let mut cli_args = vec![
                "checkpoint".to_string(),
                "--summary".to_string(),
                summary.to_string(),
                "--json".to_string(),
            ];
            if let Some(agent) = args.get("agent").and_then(serde_json::Value::as_str) {
                cli_args.push("--agent".to_string());
                cli_args.push(agent.to_string());
            }
            if let Some(tags) = args.get("tags").and_then(serde_json::Value::as_array) {
                for tag in tags {
                    if let Some(tag) = tag.as_str() {
                        cli_args.push("--tag".to_string());
                        cli_args.push(tag.to_string());
                    }
                }
            }
            if let Some(files) = args.get("files").and_then(serde_json::Value::as_array) {
                for file in files {
                    if let Some(file) = file.as_str() {
                        cli_args.push("--file".to_string());
                        cli_args.push(file.to_string());
                    }
                }
            }
            if args
                .get("strict_hash")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false)
            {
                cli_args.push("--strict-hash".to_string());
            }
            if args
                .get("ignore_locks")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false)
            {
                cli_args.push("--ignore-locks".to_string());
            }
            if let Some(repair) = args.get("repair").and_then(serde_json::Value::as_str) {
                cli_args.push("--repair".to_string());
                cli_args.push(repair.to_string());
            }
            if let Some(hash_jobs) = args.get("hash_jobs").and_then(serde_json::Value::as_u64) {
                cli_args.push("--hash-jobs".to_string());
                cli_args.push(hash_jobs.to_string());
            }
            if let Some(object_jobs) = args.get("object_jobs").and_then(serde_json::Value::as_u64) {
                cli_args.push("--object-jobs".to_string());
                cli_args.push(object_jobs.to_string());
            }
            if args
                .get("burst")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false)
            {
                cli_args.push("--burst".to_string());
            }
            run_self_cli_json(repo_root, &cli_args)?
        }
        "fugit_log" => {
            let mut cli_args = vec!["log".to_string(), "--json".to_string()];
            if let Some(limit) = args.get("limit").and_then(serde_json::Value::as_u64) {
                cli_args.push("--limit".to_string());
                cli_args.push(limit.to_string());
            }
            if let Some(branch) = args.get("branch").and_then(serde_json::Value::as_str) {
                cli_args.push("--branch".to_string());
                cli_args.push(branch.to_string());
            }
            run_self_cli_json(repo_root, &cli_args)?
        }
        "fugit_checkout" => {
            let mut cli_args = vec!["checkout".to_string()];
            if let Some(event) = args.get("event").and_then(serde_json::Value::as_str) {
                cli_args.push("--event".to_string());
                cli_args.push(event.to_string());
            }
            if let Some(branch) = args.get("branch").and_then(serde_json::Value::as_str) {
                cli_args.push("--branch".to_string());
                cli_args.push(branch.to_string());
            }
            if args
                .get("dry_run")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false)
            {
                cli_args.push("--dry-run".to_string());
            }
            if args
                .get("force")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false)
            {
                cli_args.push("--force".to_string());
            }
            if args
                .get("strict_hash")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false)
            {
                cli_args.push("--strict-hash".to_string());
            }
            if args
                .get("move_head")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false)
            {
                cli_args.push("--move-head".to_string());
            }
            if let Some(hash_jobs) = args.get("hash_jobs").and_then(serde_json::Value::as_u64) {
                cli_args.push("--hash-jobs".to_string());
                cli_args.push(hash_jobs.to_string());
            }
            if args
                .get("burst")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false)
            {
                cli_args.push("--burst".to_string());
            }
            let text = run_self_cli_text(repo_root, &cli_args)?;
            json!({ "checkout": text.trim() })
        }
        "fugit_lock_add" => {
            let pattern = args
                .get("pattern")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| anyhow!("fugit_lock_add requires pattern"))?;
            let mut cli_args = vec![
                "lock".to_string(),
                "add".to_string(),
                "--pattern".to_string(),
                pattern.to_string(),
            ];
            if let Some(agent) = args.get("agent").and_then(serde_json::Value::as_str) {
                cli_args.push("--agent".to_string());
                cli_args.push(agent.to_string());
            }
            if let Some(ttl) = args.get("ttl_minutes").and_then(serde_json::Value::as_i64) {
                cli_args.push("--ttl-minutes".to_string());
                cli_args.push(ttl.to_string());
            }
            let _ = run_self_cli_text(repo_root, &cli_args)?;
            run_self_cli_json(
                repo_root,
                &["lock".to_string(), "list".to_string(), "--json".to_string()],
            )?
        }
        "fugit_lock_list" => run_self_cli_json(
            repo_root,
            &["lock".to_string(), "list".to_string(), "--json".to_string()],
        )?,
        "fugit_task_show" => {
            let task_id = args
                .get("task_id")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| anyhow!("fugit_task_show requires task_id"))?;
            run_self_cli_json(
                repo_root,
                &[
                    "task".to_string(),
                    "show".to_string(),
                    "--task-id".to_string(),
                    task_id.to_string(),
                    "--json".to_string(),
                ],
            )?
        }
        "fugit_task_current" => {
            let mut cli_args = vec![
                "task".to_string(),
                "current".to_string(),
                "--json".to_string(),
            ];
            if let Some(agent) = args.get("agent").and_then(serde_json::Value::as_str) {
                cli_args.push("--agent".to_string());
                cli_args.push(agent.to_string());
            }
            run_self_cli_json(repo_root, &cli_args)?
        }
        "fugit_task_add" => {
            let title = args
                .get("title")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| anyhow!("fugit_task_add requires title"))?;
            let mut cli_args = vec![
                "task".to_string(),
                "add".to_string(),
                "--title".to_string(),
                title.to_string(),
                "--json".to_string(),
            ];
            if let Some(detail) = args.get("detail").and_then(serde_json::Value::as_str) {
                cli_args.push("--detail".to_string());
                cli_args.push(detail.to_string());
            }
            if let Some(agent) = args.get("agent").and_then(serde_json::Value::as_str) {
                cli_args.push("--agent".to_string());
                cli_args.push(agent.to_string());
            }
            if let Some(priority) = args.get("priority").and_then(serde_json::Value::as_i64) {
                cli_args.push("--priority".to_string());
                cli_args.push(priority.to_string());
            }
            if let Some(tags) = args.get("tags").and_then(serde_json::Value::as_array) {
                for tag in tags {
                    if let Some(tag_value) = tag.as_str() {
                        cli_args.push("--tag".to_string());
                        cli_args.push(tag_value.to_string());
                    }
                }
            }
            if let Some(depends_on) = args.get("depends_on").and_then(serde_json::Value::as_array) {
                for dependency in depends_on {
                    if let Some(dep_value) = dependency.as_str() {
                        cli_args.push("--depends-on".to_string());
                        cli_args.push(dep_value.to_string());
                    }
                }
            }
            run_self_cli_json(repo_root, &cli_args)?
        }
        "fugit_task_edit" => {
            let task_id = args
                .get("task_id")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| anyhow!("fugit_task_edit requires task_id"))?;
            let mut cli_args = vec![
                "task".to_string(),
                "edit".to_string(),
                "--task-id".to_string(),
                task_id.to_string(),
                "--json".to_string(),
            ];
            if let Some(title) = args.get("title").and_then(serde_json::Value::as_str) {
                cli_args.push("--title".to_string());
                cli_args.push(title.to_string());
            }
            if let Some(detail) = args.get("detail").and_then(serde_json::Value::as_str) {
                cli_args.push("--detail".to_string());
                cli_args.push(detail.to_string());
            }
            if args
                .get("clear_detail")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false)
            {
                cli_args.push("--clear-detail".to_string());
            }
            if let Some(agent) = args.get("agent").and_then(serde_json::Value::as_str) {
                cli_args.push("--agent".to_string());
                cli_args.push(agent.to_string());
            }
            if let Some(priority) = args.get("priority").and_then(serde_json::Value::as_i64) {
                cli_args.push("--priority".to_string());
                cli_args.push(priority.to_string());
            }
            if let Some(tags) = args.get("tags").and_then(serde_json::Value::as_array) {
                for tag in tags {
                    if let Some(tag_value) = tag.as_str() {
                        cli_args.push("--tag".to_string());
                        cli_args.push(tag_value.to_string());
                    }
                }
            }
            if args
                .get("clear_tags")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false)
            {
                cli_args.push("--clear-tags".to_string());
            }
            if let Some(depends_on) = args.get("depends_on").and_then(serde_json::Value::as_array) {
                for dependency in depends_on {
                    if let Some(dep_value) = dependency.as_str() {
                        cli_args.push("--depends-on".to_string());
                        cli_args.push(dep_value.to_string());
                    }
                }
            }
            if args
                .get("clear_depends_on")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false)
            {
                cli_args.push("--clear-depends-on".to_string());
            }
            run_self_cli_json(repo_root, &cli_args)?
        }
        "fugit_task_remove" => {
            let task_id = args
                .get("task_id")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| anyhow!("fugit_task_remove requires task_id"))?;
            let mut cli_args = vec![
                "task".to_string(),
                "remove".to_string(),
                "--task-id".to_string(),
                task_id.to_string(),
                "--json".to_string(),
            ];
            if let Some(agent) = args.get("agent").and_then(serde_json::Value::as_str) {
                cli_args.push("--agent".to_string());
                cli_args.push(agent.to_string());
            }
            run_self_cli_json(repo_root, &cli_args)?
        }
        "fugit_task_approve" => {
            let mut cli_args = vec![
                "task".to_string(),
                "approve".to_string(),
                "--json".to_string(),
            ];
            if let Some(task_id) = args.get("task_id").and_then(serde_json::Value::as_str) {
                cli_args.push("--task-id".to_string());
                cli_args.push(task_id.to_string());
            }
            if args
                .get("all_pending_auto_replenish")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false)
            {
                cli_args.push("--all-pending-auto-replenish".to_string());
            }
            if let Some(agent) = args.get("agent").and_then(serde_json::Value::as_str) {
                cli_args.push("--agent".to_string());
                cli_args.push(agent.to_string());
            }
            run_self_cli_json(repo_root, &cli_args)?
        }
        "fugit_task_policy_show" => {
            let cli_args = vec![
                "task".to_string(),
                "policy".to_string(),
                "show".to_string(),
                "--json".to_string(),
            ];
            run_self_cli_json(repo_root, &cli_args)?
        }
        "fugit_task_policy_set" => {
            let mut cli_args = vec![
                "task".to_string(),
                "policy".to_string(),
                "set".to_string(),
                "--json".to_string(),
            ];
            if let Some(enabled) = args
                .get("auto_replenish_enabled")
                .and_then(serde_json::Value::as_bool)
            {
                cli_args.push("--auto-replenish-enabled".to_string());
                cli_args.push(enabled.to_string());
            }
            if let Some(require_confirmation) = args
                .get("auto_replenish_confirmation")
                .and_then(serde_json::Value::as_bool)
            {
                cli_args.push("--auto-replenish-confirmation".to_string());
                cli_args.push(require_confirmation.to_string());
            }
            if let Some(replenish_agents) = args
                .get("replenish_agents")
                .and_then(serde_json::Value::as_array)
            {
                for agent in replenish_agents {
                    if let Some(agent_id) = agent.as_str() {
                        cli_args.push("--replenish-agent".to_string());
                        cli_args.push(agent_id.to_string());
                    }
                }
            }
            if args
                .get("clear_replenish_agents")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false)
            {
                cli_args.push("--clear-replenish-agents".to_string());
            }
            if let Some(agent) = args.get("agent").and_then(serde_json::Value::as_str) {
                cli_args.push("--agent".to_string());
                cli_args.push(agent.to_string());
            }
            run_self_cli_json(repo_root, &cli_args)?
        }
        "fugit_task_sync" => {
            let mut cli_args = vec!["task".to_string(), "sync".to_string(), "--json".to_string()];
            let mut temp_file_to_remove: Option<PathBuf> = None;
            let mut inferred_format: Option<&str> = None;

            let plan_file = if let Some(plan) = args.get("plan").and_then(serde_json::Value::as_str)
            {
                PathBuf::from(plan)
            } else if let Some(markdown) = args.get("markdown").and_then(serde_json::Value::as_str)
            {
                inferred_format = Some("markdown");
                let temp_path =
                    write_mcp_task_import_temp_file(repo_root, "sync_markdown", markdown)?;
                temp_file_to_remove = Some(temp_path.clone());
                temp_path
            } else {
                bail!("fugit_task_sync requires one of: plan, markdown");
            };

            cli_args.push("--plan".to_string());
            cli_args.push(plan_file.display().to_string());

            if let Some(format) = args.get("format").and_then(serde_json::Value::as_str) {
                cli_args.push("--format".to_string());
                cli_args.push(format.to_string());
            } else if let Some(format) = inferred_format {
                cli_args.push("--format".to_string());
                cli_args.push(format.to_string());
            }
            if let Some(agent) = args.get("agent").and_then(serde_json::Value::as_str) {
                cli_args.push("--agent".to_string());
                cli_args.push(agent.to_string());
            }
            if let Some(priority) = args
                .get("default_priority")
                .and_then(serde_json::Value::as_i64)
            {
                cli_args.push("--default-priority".to_string());
                cli_args.push(priority.to_string());
            }
            if args
                .get("keep_missing")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false)
            {
                cli_args.push("--keep-missing".to_string());
            }
            if args
                .get("dry_run")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false)
            {
                cli_args.push("--dry-run".to_string());
            }

            let sync_result = run_self_cli_json(repo_root, &cli_args);
            if let Some(temp_file) = temp_file_to_remove {
                let _ = fs::remove_file(&temp_file);
            }
            sync_result?
        }
        "fugit_task_import" => {
            let mut cli_args = vec![
                "task".to_string(),
                "import".to_string(),
                "--json".to_string(),
            ];
            let mut temp_file_to_remove: Option<PathBuf> = None;
            let mut inferred_format: Option<&str> = None;

            let import_file = if let Some(file) =
                args.get("file").and_then(serde_json::Value::as_str)
            {
                PathBuf::from(file)
            } else if let Some(tsv) = args.get("tsv").and_then(serde_json::Value::as_str) {
                inferred_format = Some("tsv");
                let temp_path = write_mcp_task_import_temp_file(repo_root, "tsv", tsv)?;
                temp_file_to_remove = Some(temp_path.clone());
                temp_path
            } else if let Some(markdown) = args.get("markdown").and_then(serde_json::Value::as_str)
            {
                inferred_format = Some("markdown");
                let temp_path = write_mcp_task_import_temp_file(repo_root, "markdown", markdown)?;
                temp_file_to_remove = Some(temp_path.clone());
                temp_path
            } else {
                bail!("fugit_task_import requires one of: file, tsv, markdown");
            };

            cli_args.push("--file".to_string());
            cli_args.push(import_file.display().to_string());

            if let Some(format) = args.get("format").and_then(serde_json::Value::as_str) {
                cli_args.push("--format".to_string());
                cli_args.push(format.to_string());
            } else if let Some(format) = inferred_format {
                cli_args.push("--format".to_string());
                cli_args.push(format.to_string());
            }

            if let Some(agent) = args.get("agent").and_then(serde_json::Value::as_str) {
                cli_args.push("--agent".to_string());
                cli_args.push(agent.to_string());
            }
            if let Some(priority) = args
                .get("default_priority")
                .and_then(serde_json::Value::as_i64)
            {
                cli_args.push("--default-priority".to_string());
                cli_args.push(priority.to_string());
            }
            if args
                .get("dry_run")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false)
            {
                cli_args.push("--dry-run".to_string());
            }

            let import_result = run_self_cli_json(repo_root, &cli_args);
            if let Some(temp_file) = temp_file_to_remove {
                let _ = fs::remove_file(&temp_file);
            }
            import_result?
        }
        "fugit_task_list" => {
            let mut cli_args = vec!["task".to_string(), "list".to_string(), "--json".to_string()];
            if let Some(status) = args.get("status").and_then(serde_json::Value::as_str) {
                cli_args.push("--status".to_string());
                cli_args.push(status.to_string());
            }
            if let Some(agent) = args.get("agent").and_then(serde_json::Value::as_str) {
                cli_args.push("--agent".to_string());
                cli_args.push(agent.to_string());
            }
            if args
                .get("ready_only")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false)
            {
                cli_args.push("--ready-only".to_string());
            }
            if let Some(fields) = args.get("fields").and_then(serde_json::Value::as_array) {
                let joined = fields
                    .iter()
                    .filter_map(serde_json::Value::as_str)
                    .map(str::trim)
                    .filter(|field| !field.is_empty())
                    .collect::<Vec<_>>()
                    .join(",");
                if !joined.is_empty() {
                    cli_args.push("--fields".to_string());
                    cli_args.push(joined);
                }
            }
            if let Some(limit) = args.get("limit").and_then(serde_json::Value::as_u64) {
                cli_args.push("--limit".to_string());
                cli_args.push(limit.to_string());
            }
            run_self_cli_json(repo_root, &cli_args)?
        }
        "fugit_task_request" => {
            let mut cli_args = vec![
                "task".to_string(),
                "request".to_string(),
                "--json".to_string(),
            ];
            if let Some(agent) = args.get("agent").and_then(serde_json::Value::as_str) {
                cli_args.push("--agent".to_string());
                cli_args.push(agent.to_string());
            }
            if let Some(tags) = args.get("tags").and_then(serde_json::Value::as_array) {
                for tag in tags {
                    if let Some(tag_value) = tag.as_str() {
                        cli_args.push("--tag".to_string());
                        cli_args.push(tag_value.to_string());
                    }
                }
            }
            if let Some(focus) = args.get("focus").and_then(serde_json::Value::as_str) {
                cli_args.push("--focus".to_string());
                cli_args.push(focus.to_string());
            }
            if let Some(prefix) = args.get("prefix").and_then(serde_json::Value::as_str) {
                cli_args.push("--prefix".to_string());
                cli_args.push(prefix.to_string());
            }
            if let Some(contains) = args.get("contains").and_then(serde_json::Value::as_str) {
                cli_args.push("--contains".to_string());
                cli_args.push(contains.to_string());
            }
            if let Some(max) = args.get("max").and_then(serde_json::Value::as_u64) {
                cli_args.push("--max".to_string());
                cli_args.push(max.to_string());
            }
            if let Some(ttl) = args
                .get("claim_ttl_minutes")
                .and_then(serde_json::Value::as_i64)
            {
                cli_args.push("--claim-ttl-minutes".to_string());
                cli_args.push(ttl.to_string());
            }
            if let Some(steal_after) = args
                .get("steal_after_minutes")
                .and_then(serde_json::Value::as_i64)
            {
                cli_args.push("--steal-after-minutes".to_string());
                cli_args.push(steal_after.to_string());
            }
            if args
                .get("no_steal")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false)
            {
                cli_args.push("--no-steal".to_string());
            }
            if args
                .get("skip_owned")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false)
            {
                cli_args.push("--skip-owned".to_string());
            }
            if args
                .get("no_claim")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false)
            {
                cli_args.push("--no-claim".to_string());
            }
            run_self_cli_json(repo_root, &cli_args)?
        }
        "fugit_task_claim" => {
            let task_id = args
                .get("task_id")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| anyhow!("fugit_task_claim requires task_id"))?;
            let mut cli_args = vec![
                "task".to_string(),
                "claim".to_string(),
                "--task-id".to_string(),
                task_id.to_string(),
                "--json".to_string(),
            ];
            if let Some(agent) = args.get("agent").and_then(serde_json::Value::as_str) {
                cli_args.push("--agent".to_string());
                cli_args.push(agent.to_string());
            }
            if let Some(ttl) = args
                .get("claim_ttl_minutes")
                .and_then(serde_json::Value::as_i64)
            {
                cli_args.push("--claim-ttl-minutes".to_string());
                cli_args.push(ttl.to_string());
            }
            if args
                .get("steal")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false)
            {
                cli_args.push("--steal".to_string());
            }
            run_self_cli_json(repo_root, &cli_args)?
        }
        "fugit_task_done" => {
            let task_id = args
                .get("task_id")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| anyhow!("fugit_task_done requires task_id"))?;
            let mut cli_args = vec![
                "task".to_string(),
                "done".to_string(),
                "--task-id".to_string(),
                task_id.to_string(),
                "--json".to_string(),
            ];
            if let Some(agent) = args.get("agent").and_then(serde_json::Value::as_str) {
                cli_args.push("--agent".to_string());
                cli_args.push(agent.to_string());
            }
            if let Some(summary) = args.get("summary").and_then(serde_json::Value::as_str) {
                cli_args.push("--summary".to_string());
                cli_args.push(summary.to_string());
            }
            if let Some(notes) = args.get("notes").and_then(serde_json::Value::as_array) {
                for note in notes {
                    if let Some(note_value) = note.as_str() {
                        cli_args.push("--note".to_string());
                        cli_args.push(note_value.to_string());
                    }
                }
            }
            if let Some(artifacts) = args.get("artifacts").and_then(serde_json::Value::as_array) {
                for artifact in artifacts {
                    if let Some(artifact_value) = artifact.as_str() {
                        cli_args.push("--artifact".to_string());
                        cli_args.push(artifact_value.to_string());
                    }
                }
            }
            if let Some(commands) = args.get("commands").and_then(serde_json::Value::as_array) {
                for command in commands {
                    if let Some(command_value) = command.as_str() {
                        cli_args.push("--command".to_string());
                        cli_args.push(command_value.to_string());
                    }
                }
            }
            run_self_cli_json(repo_root, &cli_args)?
        }
        "fugit_task_reopen" => {
            let task_id = args
                .get("task_id")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| anyhow!("fugit_task_reopen requires task_id"))?;
            let mut cli_args = vec![
                "task".to_string(),
                "reopen".to_string(),
                "--task-id".to_string(),
                task_id.to_string(),
                "--json".to_string(),
            ];
            if let Some(agent) = args.get("agent").and_then(serde_json::Value::as_str) {
                cli_args.push("--agent".to_string());
                cli_args.push(agent.to_string());
            }
            run_self_cli_json(repo_root, &cli_args)?
        }
        "fugit_task_release" => {
            let task_id = args
                .get("task_id")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| anyhow!("fugit_task_release requires task_id"))?;
            let mut cli_args = vec![
                "task".to_string(),
                "release".to_string(),
                "--task-id".to_string(),
                task_id.to_string(),
                "--json".to_string(),
            ];
            if let Some(agent) = args.get("agent").and_then(serde_json::Value::as_str) {
                cli_args.push("--agent".to_string());
                cli_args.push(agent.to_string());
            }
            run_self_cli_json(repo_root, &cli_args)?
        }
        "fugit_task_gui_launch" => {
            let mut cli_args = vec![
                "task".to_string(),
                "gui".to_string(),
                "--background".to_string(),
                "--json".to_string(),
            ];
            if let Some(project) = args.get("project").and_then(serde_json::Value::as_str) {
                cli_args.push("--project".to_string());
                cli_args.push(project.to_string());
            }
            if let Some(host) = args.get("host").and_then(serde_json::Value::as_str) {
                cli_args.push("--host".to_string());
                cli_args.push(host.to_string());
            }
            if let Some(port) = args.get("port").and_then(serde_json::Value::as_u64) {
                cli_args.push("--port".to_string());
                cli_args.push(port.to_string());
            }
            let open = args
                .get("open")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(true);
            if !open {
                cli_args.push("--no-open".to_string());
            }
            run_self_cli_json(repo_root, &cli_args)?
        }
        "fugit_project_list" => run_self_cli_json(
            repo_root,
            &[
                "project".to_string(),
                "list".to_string(),
                "--json".to_string(),
            ],
        )?,
        "fugit_project_add" => {
            let name = args
                .get("name")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| anyhow!("fugit_project_add requires name"))?;
            let root = args
                .get("repo_root")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| anyhow!("fugit_project_add requires repo_root"))?;
            let mut cli_args = vec![
                "project".to_string(),
                "add".to_string(),
                "--name".to_string(),
                name.to_string(),
                "--repo-root".to_string(),
                root.to_string(),
                "--json".to_string(),
            ];
            if args
                .get("set_default")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false)
            {
                cli_args.push("--set-default".to_string());
            }
            run_self_cli_json(repo_root, &cli_args)?
        }
        "fugit_project_use" => {
            let name = args
                .get("name")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| anyhow!("fugit_project_use requires name"))?;
            run_self_cli_json(
                repo_root,
                &[
                    "project".to_string(),
                    "use".to_string(),
                    "--name".to_string(),
                    name.to_string(),
                    "--json".to_string(),
                ],
            )?
        }
        "fugit_project_remove" => {
            let name = args
                .get("name")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| anyhow!("fugit_project_remove requires name"))?;
            run_self_cli_json(
                repo_root,
                &[
                    "project".to_string(),
                    "remove".to_string(),
                    "--name".to_string(),
                    name.to_string(),
                    "--json".to_string(),
                ],
            )?
        }
        "fugit_gc" => {
            let mut cli_args = vec!["gc".to_string(), "--json".to_string()];
            if args
                .get("dry_run")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false)
            {
                cli_args.push("--dry-run".to_string());
            }
            run_self_cli_json(repo_root, &cli_args)?
        }
        "fugit_skill_bundle" => {
            let include_skill_body = args
                .get("include_skill_body")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(true);
            let include_openai_yaml = args
                .get("include_openai_yaml")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(true);
            fugit_skill_bundle(include_skill_body, include_openai_yaml)
        }
        "fugit_skill_install_codex" => {
            let overwrite = args
                .get("overwrite")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false);
            let installed = install_fugit_skill_to_codex(overwrite)?;
            json!({
                "schema_version": "fugit.skill.install.v1",
                "generated_at_utc": now_utc(),
                "skill_id": FUGIT_SKILL_ID,
                "installed_path": installed.display().to_string(),
                "overwrite": overwrite
            })
        }
        _ => bail!("unsupported tool: {}", tool_name),
    };

    Ok(json!({
        "content": [
            {
                "type": "text",
                "text": serde_json::to_string_pretty(&result)?
            }
        ],
        "structuredContent": result,
        "isError": false
    }))
}

fn run_self_cli_json(repo_root: &Path, args: &[String]) -> Result<serde_json::Value> {
    let current_exe =
        std::env::current_exe().with_context(|| "failed resolving current executable")?;
    let mut cmd = ProcessCommand::new(current_exe);
    cmd.arg("--repo-root").arg(repo_root).args(args);
    let output = cmd.output().with_context(|| {
        format!(
            "failed running fugit subprocess for args: {}",
            args.join(" ")
        )
    })?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if !output.status.success() {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(stdout.trim()) {
            return Ok(parsed);
        }
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        bail!(
            "fugit subprocess failed for args: {}\nstdout: {}\nstderr: {}",
            args.join(" "),
            stdout.trim(),
            stderr.trim()
        );
    }
    let text = stdout;
    let parsed: serde_json::Value = serde_json::from_str(text.trim()).with_context(|| {
        format!(
            "expected JSON output from fugit subprocess for args: {}",
            args.join(" ")
        )
    })?;
    Ok(parsed)
}

fn run_self_cli_text(repo_root: &Path, args: &[String]) -> Result<String> {
    let current_exe =
        std::env::current_exe().with_context(|| "failed resolving current executable")?;
    let mut cmd = ProcessCommand::new(current_exe);
    cmd.arg("--repo-root").arg(repo_root).args(args);
    let output = cmd.output().with_context(|| {
        format!(
            "failed running fugit subprocess for args: {}",
            args.join(" ")
        )
    })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        bail!(
            "fugit subprocess failed for args: {}\nstdout: {}\nstderr: {}",
            args.join(" "),
            stdout.trim(),
            stderr.trim()
        );
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn json_rpc_ok(id: serde_json::Value, result: serde_json::Value) -> serde_json::Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": result
    })
}

fn json_rpc_err(id: serde_json::Value, code: i64, message: String) -> serde_json::Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": {
            "code": code,
            "message": message
        }
    })
}

fn read_mcp_message(reader: &mut dyn BufRead) -> Result<Option<serde_json::Value>> {
    let mut content_length: Option<usize> = None;
    loop {
        let mut line = String::new();
        let read = reader
            .read_line(&mut line)
            .with_context(|| "failed reading MCP header line")?;
        if read == 0 {
            return Ok(None);
        }
        if line == "\r\n" || line == "\n" {
            break;
        }
        if let Some(rest) = line.trim().strip_prefix("Content-Length:") {
            let len = rest
                .trim()
                .parse::<usize>()
                .with_context(|| format!("invalid Content-Length header '{}'", line.trim()))?;
            content_length = Some(len);
        }
    }
    let len = content_length.ok_or_else(|| anyhow!("missing Content-Length header"))?;
    let mut payload = vec![0_u8; len];
    reader
        .read_exact(&mut payload)
        .with_context(|| "failed reading MCP payload bytes")?;
    let message = serde_json::from_slice::<serde_json::Value>(&payload)
        .with_context(|| "invalid MCP JSON payload")?;
    Ok(Some(message))
}

fn write_mcp_message(writer: &mut dyn Write, message: &serde_json::Value) -> Result<()> {
    let payload = serde_json::to_vec(message).with_context(|| "failed serializing MCP message")?;
    writer
        .write_all(format!("Content-Length: {}\r\n\r\n", payload.len()).as_bytes())
        .with_context(|| "failed writing MCP header")?;
    writer
        .write_all(&payload)
        .with_context(|| "failed writing MCP payload")?;
    writer
        .flush()
        .with_context(|| "failed flushing MCP response")
}

fn truncate_bridge_subject(value: &str, max_chars: usize) -> String {
    let trimmed = value.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }
    let mut out = String::new();
    for ch in trimmed.chars().take(max_chars.saturating_sub(3)) {
        out.push(ch);
    }
    out.push_str("...");
    out
}

fn build_bridge_commit_message(events: &[TimelineEvent], note: Option<&str>) -> (String, String) {
    let note_subject = note
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| truncate_bridge_subject(value, 72));
    let subject = if let Some(note_subject) = note_subject {
        format!(
            "timeline sync: {} ({} event{})",
            note_subject,
            events.len(),
            if events.len() == 1 { "" } else { "s" }
        )
    } else {
        format!(
            "timeline sync: {} ({} event{})",
            Utc::now().format("%Y-%m-%dT%H:%M:%SZ"),
            events.len(),
            if events.len() == 1 { "" } else { "s" }
        )
    };
    let mut lines = Vec::<String>::new();
    if let Some(note) = note.map(str::trim).filter(|value| !value.is_empty()) {
        lines.push(format!("Trigger note: {}", note));
        lines.push(String::new());
    }
    lines.push("Timeline events included in this sync:".to_string());
    for event in events {
        lines.push(format!(
            "- {} {} [{}] {}",
            event.created_at_utc, event.event_id, event.agent_id, event.summary
        ));
    }
    if events.is_empty() {
        lines.push("- no timeline events found (manual sync)".to_string());
    }
    (subject, lines.join("\n"))
}

fn perform_bridge_sync_github(
    repo_root: &Path,
    active_branch: &str,
    options: &BridgeSyncGithubOptions,
) -> Result<serde_json::Value> {
    ensure_git_repo(repo_root)?;

    if let Some(remote_url) = git_remote_url(repo_root, &options.remote)?
        && (remote_url.starts_with("http://") || remote_url.starts_with("https://"))
        && let Some(host) = parse_git_host(&remote_url)
    {
        let cred = git_credential_fill(repo_root, &host, None)?;
        let has_password = cred.as_ref().and_then(|row| row.password.clone()).is_some();
        if !has_password {
            bail!(
                "missing credentials for remote host '{}'; run `fugit bridge auth login --remote {}` first",
                host,
                options.remote
            );
        }
    }
    if options.repair_journal {
        let report = repair_branch_event_journal(repo_root, active_branch)?;
        if report
            .get("repaired")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false)
        {
            println!(
                "[fugit-bridge] repaired_event_journal branch={} dropped_lines={} backup={}",
                active_branch,
                report
                    .get("dropped_count")
                    .and_then(serde_json::Value::as_u64)
                    .unwrap_or(0),
                report
                    .get("backup_file")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("unknown")
            );
        }
    }
    let mut events = read_branch_events(repo_root, active_branch)?;
    if events.len() > options.event_count {
        let start = events.len().saturating_sub(options.event_count);
        events = events.split_off(start);
    }

    let (subject, body) = build_bridge_commit_message(&events, options.note.as_deref());

    run_git(repo_root, &["add", "-A"])?;
    let staged_clean = ProcessCommand::new("git")
        .current_dir(repo_root)
        .args(["diff", "--cached", "--quiet"])
        .status()
        .with_context(|| "failed checking staged git diff")?
        .success();

    if staged_clean {
        return Ok(json!({
            "schema_version": "fugit.bridge.sync_github.v1",
            "generated_at_utc": now_utc(),
            "remote": options.remote,
            "branch": options.branch,
            "note": options.note,
            "trigger": options.trigger,
            "included_event_count": events.len(),
            "committed": false,
            "pushed": false,
            "no_push": options.no_push,
            "message": "no staged changes after git add -A; skipping commit/push",
            "commit_subject": subject
        }));
    }

    let mut cmd = ProcessCommand::new("git");
    cmd.current_dir(repo_root)
        .arg("commit")
        .arg("-m")
        .arg(&subject)
        .arg("-m")
        .arg(&body);
    run_process(cmd, "failed committing timeline bridge sync")?;

    let pushed = if options.no_push {
        false
    } else {
        if options.pack_threads.is_some() || options.burst_push {
            let threads = resolve_parallel_jobs(options.pack_threads, options.burst_push);
            run_git_with_configs(
                repo_root,
                &[("pack.threads", threads.to_string())],
                &["push", &options.remote, &format!("HEAD:{}", options.branch)],
            )?;
        } else {
            run_git(
                repo_root,
                &["push", &options.remote, &format!("HEAD:{}", options.branch)],
            )?;
        }
        true
    };

    Ok(json!({
        "schema_version": "fugit.bridge.sync_github.v1",
        "generated_at_utc": now_utc(),
        "remote": options.remote,
        "branch": options.branch,
        "note": options.note,
        "trigger": options.trigger,
        "included_event_count": events.len(),
        "committed": true,
        "pushed": pushed,
        "no_push": options.no_push,
        "commit_subject": subject
    }))
}

fn queue_bridge_auto_sync_background(
    repo_root: &Path,
    config: &TimelineConfig,
    options: &BridgeSyncGithubOptions,
) -> Result<serde_json::Value> {
    let mut state = load_bridge_auto_sync_state(repo_root, config)?;
    let now = now_utc();
    if let Some(lock) = load_bridge_auto_sync_lock(repo_root)? {
        if bridge_auto_sync_lock_is_stale(&lock) {
            remove_bridge_auto_sync_lock(repo_root);
        } else {
            state.updated_at_utc = now.clone();
            state.status = "running".to_string();
            state.last_requested_at_utc = Some(now);
            state.pending_trigger = true;
            state.pending_note = options.note.clone();
            state.last_trigger = options.trigger.clone();
            state.last_remote = Some(options.remote.clone());
            state.last_branch = Some(options.branch.clone());
            write_bridge_auto_sync_state(repo_root, &state)?;
            return Ok(json!({
                "schema_version": "fugit.bridge.auto_sync.request.v1",
                "generated_at_utc": now_utc(),
                "accepted": true,
                "queued": true,
                "already_running": true,
                "status": state.status,
                "note": options.note,
                "trigger": options.trigger,
                "remote": options.remote,
                "branch": options.branch
            }));
        }
    }

    let lock = BridgeAutoSyncLock {
        schema_version: SCHEMA_BRIDGE_AUTO_SYNC_LOCK.to_string(),
        lock_id: format!("auto_sync_{}", Uuid::new_v4().simple()),
        created_at_utc: now.clone(),
    };
    write_bridge_auto_sync_lock(repo_root, &lock)?;

    state.updated_at_utc = now.clone();
    state.status = "queued".to_string();
    state.last_requested_at_utc = Some(now);
    state.last_note = options.note.clone();
    state.last_trigger = options.trigger.clone();
    state.last_remote = Some(options.remote.clone());
    state.last_branch = Some(options.branch.clone());
    state.last_result = None;
    state.last_error = None;
    state.pending_trigger = false;
    state.pending_note = None;
    write_bridge_auto_sync_state(repo_root, &state)?;

    let current_exe =
        std::env::current_exe().with_context(|| "failed resolving current executable")?;
    let mut cmd = ProcessCommand::new(current_exe);
    cmd.arg("--repo-root")
        .arg(repo_root)
        .arg("bridge")
        .arg("sync-github")
        .arg("--remote")
        .arg(&options.remote)
        .arg("--branch")
        .arg(&options.branch)
        .arg("--event-count")
        .arg(options.event_count.to_string())
        .arg("--background-worker");
    if options.no_push {
        cmd.arg("--no-push");
    }
    if options.repair_journal {
        cmd.arg("--repair-journal");
    }
    if let Some(note) = options.note.as_deref() {
        cmd.arg("--note").arg(note);
    }
    if let Some(trigger) = options.trigger.as_deref() {
        cmd.arg("--trigger").arg(trigger);
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if let Err(err) = cmd.spawn() {
        remove_bridge_auto_sync_lock(repo_root);
        state.updated_at_utc = now_utc();
        state.status = "error".to_string();
        state.last_error = Some(format!("failed spawning bridge auto-sync worker: {}", err));
        write_bridge_auto_sync_state(repo_root, &state)?;
        bail!("failed spawning bridge auto-sync worker: {}", err);
    }

    Ok(json!({
        "schema_version": "fugit.bridge.auto_sync.request.v1",
        "generated_at_utc": now_utc(),
        "accepted": true,
        "queued": true,
        "already_running": false,
        "status": "queued",
        "note": options.note,
        "trigger": options.trigger,
        "remote": options.remote,
        "branch": options.branch
    }))
}

fn run_bridge_auto_sync_worker(
    repo_root: &Path,
    config: &TimelineConfig,
    active_branch: &str,
    initial_options: BridgeSyncGithubOptions,
) -> Result<()> {
    let mut current_options = initial_options;
    let mut guard_loops = 0_usize;
    loop {
        guard_loops += 1;
        if guard_loops > 8 {
            let mut state = load_bridge_auto_sync_state(repo_root, config)?;
            state.updated_at_utc = now_utc();
            state.status = "error".to_string();
            state.last_error = Some("bridge auto-sync exceeded retry loop guard".to_string());
            write_bridge_auto_sync_state(repo_root, &state)?;
            remove_bridge_auto_sync_lock(repo_root);
            bail!("bridge auto-sync exceeded retry loop guard");
        }

        let mut state = load_bridge_auto_sync_state(repo_root, config)?;
        state.updated_at_utc = now_utc();
        state.status = "running".to_string();
        state.last_started_at_utc = Some(now_utc());
        state.last_note = current_options.note.clone();
        state.last_trigger = current_options.trigger.clone();
        state.last_remote = Some(current_options.remote.clone());
        state.last_branch = Some(current_options.branch.clone());
        state.last_error = None;
        write_bridge_auto_sync_state(repo_root, &state)?;

        let result = perform_bridge_sync_github(repo_root, active_branch, &current_options);
        let mut state = load_bridge_auto_sync_state(repo_root, config)?;
        state.updated_at_utc = now_utc();
        state.last_finished_at_utc = Some(now_utc());
        match result {
            Ok(report) => {
                let committed = report
                    .get("committed")
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(false);
                let pushed = report
                    .get("pushed")
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(false);
                state.status = if !committed {
                    "noop".to_string()
                } else if pushed {
                    "success".to_string()
                } else {
                    "committed_local".to_string()
                };
                state.last_result = Some(
                    report
                        .get("commit_subject")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("bridge sync complete")
                        .to_string(),
                );
                state.last_error = None;
            }
            Err(err) => {
                state.status = "error".to_string();
                state.last_error = Some(err.to_string());
                state.last_result = None;
            }
        }

        let mut next_note = None;
        if state.pending_trigger {
            next_note = state
                .pending_note
                .clone()
                .or_else(|| current_options.note.clone());
            state.pending_trigger = false;
            state.pending_note = None;
            state.status = "queued".to_string();
        }
        write_bridge_auto_sync_state(repo_root, &state)?;

        if let Some(note) = next_note {
            current_options.note = Some(note);
            current_options.trigger = Some("bridge_auto_sync_pending".to_string());
            continue;
        }
        break;
    }
    remove_bridge_auto_sync_lock(repo_root);
    Ok(())
}

fn maybe_queue_auto_bridge_sync_for_task_done(
    repo_root: &Path,
    config: &TimelineConfig,
    task: &FugitTask,
) -> serde_json::Value {
    let mut state = load_bridge_auto_sync_state(repo_root, config)
        .unwrap_or_else(|_| default_bridge_auto_sync_state(config));
    if !config.auto_bridge_sync_enabled {
        state.updated_at_utc = now_utc();
        state.status = "disabled".to_string();
        let _ = write_bridge_auto_sync_state(repo_root, &state);
        return json!({
            "enabled": false,
            "queued": false,
            "status": "disabled"
        });
    }
    if !config.auto_bridge_sync_on_task_done {
        state.updated_at_utc = now_utc();
        state.status = "task_done_disabled".to_string();
        let _ = write_bridge_auto_sync_state(repo_root, &state);
        return json!({
            "enabled": true,
            "queued": false,
            "status": "task_done_disabled"
        });
    }

    let note = task_timeline_summary("done", task, None);
    let options = BridgeSyncGithubOptions {
        remote: config.default_bridge_remote.clone(),
        branch: config.default_bridge_branch.clone(),
        event_count: config.auto_bridge_sync_event_count,
        no_push: config.auto_bridge_sync_no_push,
        pack_threads: None,
        burst_push: false,
        repair_journal: false,
        note: Some(note),
        trigger: Some("task_done".to_string()),
    };
    match queue_bridge_auto_sync_background(repo_root, config, &options) {
        Ok(payload) => payload,
        Err(err) => {
            let mut state = load_bridge_auto_sync_state(repo_root, config)
                .unwrap_or_else(|_| default_bridge_auto_sync_state(config));
            state.updated_at_utc = now_utc();
            state.status = "error".to_string();
            state.last_error = Some(err.to_string());
            let _ = write_bridge_auto_sync_state(repo_root, &state);
            json!({
                "enabled": true,
                "queued": false,
                "status": "error",
                "error": err.to_string()
            })
        }
    }
}

fn ensure_git_repo(repo_root: &Path) -> Result<()> {
    let output = ProcessCommand::new("git")
        .current_dir(repo_root)
        .args(["rev-parse", "--is-inside-work-tree"])
        .output()
        .with_context(|| "failed invoking git")?;

    if !output.status.success() {
        bail!("git bridge requires a git work tree");
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout != "true" {
        bail!("git bridge requires a git work tree");
    }
    Ok(())
}

fn run_git(repo_root: &Path, args: &[&str]) -> Result<()> {
    let mut cmd = ProcessCommand::new("git");
    cmd.current_dir(repo_root).args(args);
    run_process(cmd, &format!("git command failed: git {}", args.join(" ")))
}

fn run_git_with_configs(repo_root: &Path, configs: &[(&str, String)], args: &[&str]) -> Result<()> {
    let mut cmd = ProcessCommand::new("git");
    cmd.current_dir(repo_root);
    for (key, value) in configs {
        cmd.arg("-c").arg(format!("{key}={value}"));
    }
    cmd.args(args);
    run_process(cmd, &format!("git command failed: git {}", args.join(" ")))
}

fn git_has_worktree_changes(repo_root: &Path) -> Result<bool> {
    let output = ProcessCommand::new("git")
        .current_dir(repo_root)
        .args(["status", "--porcelain"])
        .output()
        .with_context(|| "failed checking git worktree status")?;
    if !output.status.success() {
        bail!("failed checking git worktree status");
    }
    Ok(!String::from_utf8_lossy(&output.stdout).trim().is_empty())
}

#[cfg(test)]
fn collect_missing_timeline_objects(repo_root: &Path) -> Result<Vec<String>> {
    Ok(collect_missing_timeline_objects_detailed(repo_root)?
        .into_iter()
        .map(|row| row.render())
        .collect())
}

fn collect_missing_timeline_objects_detailed(
    repo_root: &Path,
) -> Result<Vec<MissingTimelineObject>> {
    if !timeline_is_initialized(repo_root) {
        return Ok(Vec::new());
    }

    let (_config, branches) = load_initialized_state(repo_root)?;
    let objects_dir = timeline_objects_dir(repo_root);
    let mut missing = BTreeMap::<String, MissingTimelineObject>::new();

    for branch_name in branches.branches.keys() {
        let index = load_branch_index(repo_root, branch_name)?;
        for (path, row) in &index {
            if !objects_dir.join(&row.hash).exists() {
                let item = MissingTimelineObject {
                    scope: "index".to_string(),
                    branch: branch_name.clone(),
                    event_id: None,
                    edge: None,
                    path: path.clone(),
                    hash: row.hash.clone(),
                };
                missing.insert(item.render(), item);
            }
        }

        for event in read_branch_events(repo_root, branch_name)? {
            for change in &event.changes {
                if let Some(hash) = change.old_hash.as_deref()
                    && !objects_dir.join(hash).exists()
                {
                    let item = MissingTimelineObject {
                        scope: "event".to_string(),
                        branch: branch_name.clone(),
                        event_id: Some(event.event_id.clone()),
                        edge: Some("old".to_string()),
                        path: change.path.clone(),
                        hash: hash.to_string(),
                    };
                    missing.insert(item.render(), item);
                }
                if let Some(hash) = change.new_hash.as_deref()
                    && !objects_dir.join(hash).exists()
                {
                    let item = MissingTimelineObject {
                        scope: "event".to_string(),
                        branch: branch_name.clone(),
                        event_id: Some(event.event_id.clone()),
                        edge: Some("new".to_string()),
                        path: change.path.clone(),
                        hash: hash.to_string(),
                    };
                    missing.insert(item.render(), item);
                }
            }
        }
    }

    Ok(missing.into_values().collect())
}

fn repair_missing_timeline_objects_from_git(
    repo_root: &Path,
    missing: &[MissingTimelineObject],
) -> Result<Vec<MissingTimelineObject>> {
    let mut repaired = Vec::<MissingTimelineObject>::new();
    let mut attempted = BTreeSet::<(String, String)>::new();
    for item in missing {
        let key = (item.path.clone(), item.hash.clone());
        if !attempted.insert(key) {
            continue;
        }
        if timeline_objects_dir(repo_root).join(&item.hash).exists() {
            repaired.push(item.clone());
            continue;
        }
        if repair_timeline_object_from_git(repo_root, &item.path, &item.hash)? {
            repaired.push(item.clone());
        }
    }
    Ok(repaired)
}

fn repair_missing_change_objects_from_git(
    repo_root: &Path,
    changes: &[ChangeRecord],
    use_new_hash: bool,
) -> Result<Vec<String>> {
    let mut repaired = Vec::<String>::new();
    let mut attempted = BTreeSet::<(String, String)>::new();

    for change in changes {
        let candidate_hash = if use_new_hash {
            match change.kind {
                ChangeKind::Added | ChangeKind::Modified => change.new_hash.as_deref(),
                ChangeKind::Deleted => None,
            }
        } else {
            match change.kind {
                ChangeKind::Modified | ChangeKind::Deleted => change.old_hash.as_deref(),
                ChangeKind::Added => None,
            }
        };
        let Some(expected_hash) = candidate_hash else {
            continue;
        };
        let key = (change.path.clone(), expected_hash.to_string());
        if !attempted.insert(key.clone()) {
            continue;
        }
        if timeline_objects_dir(repo_root).join(expected_hash).exists() {
            continue;
        }
        if repair_timeline_object_from_git(repo_root, &change.path, expected_hash)? {
            repaired.push(format!("{} ({})", key.0, key.1));
        }
    }

    Ok(repaired)
}

fn repair_timeline_object_from_git(
    repo_root: &Path,
    rel_path: &str,
    expected_hash: &str,
) -> Result<bool> {
    let object_path = timeline_objects_dir(repo_root).join(expected_hash);
    if object_path.exists() {
        return Ok(true);
    }

    let rel_path = normalize_user_path(rel_path);
    let mut candidates = vec!["HEAD".to_string(), ":".to_string()];
    candidates.extend(git_history_revisions_for_path(repo_root, &rel_path)?);

    let mut seen = BTreeSet::<String>::new();
    for revision in candidates {
        if !seen.insert(revision.clone()) {
            continue;
        }
        let Some(bytes) = git_show_path_at_revision(repo_root, &revision, &rel_path)? else {
            continue;
        };
        if hash_bytes(&bytes) != expected_hash {
            continue;
        }
        store_object_bytes(repo_root, expected_hash, &bytes)?;
        return Ok(true);
    }

    Ok(false)
}

fn git_history_revisions_for_path(repo_root: &Path, rel_path: &str) -> Result<Vec<String>> {
    let output = match ProcessCommand::new("git")
        .current_dir(repo_root)
        .args(["log", "--format=%H", "--all", "--", rel_path])
        .output()
    {
        Ok(output) => output,
        Err(_) => return Ok(Vec::new()),
    };
    if !output.status.success() {
        return Ok(Vec::new());
    }

    let mut revisions = Vec::<String>::new();
    let mut seen = BTreeSet::<String>::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let revision = line.trim();
        if revision.is_empty() {
            continue;
        }
        if seen.insert(revision.to_string()) {
            revisions.push(revision.to_string());
        }
    }
    Ok(revisions)
}

fn git_show_path_at_revision(
    repo_root: &Path,
    revision: &str,
    rel_path: &str,
) -> Result<Option<Vec<u8>>> {
    let spec = if revision == ":" {
        format!(":{}", rel_path)
    } else {
        format!("{}:{}", revision, rel_path)
    };
    let output = match ProcessCommand::new("git")
        .current_dir(repo_root)
        .args(["show", "--no-textconv", &spec])
        .output()
    {
        Ok(output) => output,
        Err(_) => return Ok(None),
    };
    if !output.status.success() {
        return Ok(None);
    }
    Ok(Some(output.stdout))
}

fn run_process(mut cmd: ProcessCommand, context_msg: &str) -> Result<()> {
    let output = cmd.output().with_context(|| context_msg.to_string())?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        bail!("{}\nstdout: {}\nstderr: {}", context_msg, stdout, stderr);
    }
    Ok(())
}

fn load_initialized_state(repo_root: &Path) -> Result<(TimelineConfig, BranchesState)> {
    let config = load_json_optional::<TimelineConfig>(&timeline_config_path(repo_root))?
        .ok_or_else(|| {
            anyhow!(
                "timeline not initialized: missing {}",
                timeline_config_path(repo_root).display()
            )
        })?;
    let branches = load_json_optional::<BranchesState>(&timeline_branches_path(repo_root))?
        .ok_or_else(|| {
            anyhow!(
                "timeline not initialized: missing {}",
                timeline_branches_path(repo_root).display()
            )
        })?;
    if !branches.branches.contains_key(&branches.active_branch) {
        bail!("timeline branch metadata invalid: active branch pointer missing");
    }
    Ok((config, branches))
}

fn build_default_timeline_config(repo_root: &Path) -> TimelineConfig {
    let now = now_utc();
    let default_branch = detect_git_branch(repo_root).unwrap_or_else(|| "trunk".to_string());
    TimelineConfig {
        schema_version: SCHEMA_CONFIG.to_string(),
        repo_root: ".".to_string(),
        created_at_utc: now.clone(),
        updated_at_utc: now,
        backend_mode: default_backend_mode(),
        default_bridge_remote: "origin".to_string(),
        default_bridge_branch: default_branch,
        cloud_endpoint: None,
        storage_namespace: None,
        billing_account_id: None,
        auto_bridge_sync_enabled: default_auto_bridge_sync_enabled(),
        auto_bridge_sync_on_task_done: default_auto_bridge_sync_on_task_done(),
        auto_bridge_sync_event_count: default_auto_bridge_sync_event_count(),
        auto_bridge_sync_no_push: default_auto_bridge_sync_no_push(),
        auto_replenish_enabled: default_auto_replenish_enabled(),
        auto_replenish_require_confirmation: default_auto_replenish_require_confirmation(),
        auto_replenish_agents: Vec::new(),
    }
}

fn load_timeline_config_or_default(repo_root: &Path) -> Result<TimelineConfig> {
    Ok(
        load_json_optional::<TimelineConfig>(&timeline_config_path(repo_root))?
            .unwrap_or_else(|| build_default_timeline_config(repo_root)),
    )
}

fn default_bridge_auto_sync_state(config: &TimelineConfig) -> BridgeAutoSyncState {
    BridgeAutoSyncState {
        schema_version: SCHEMA_BRIDGE_AUTO_SYNC.to_string(),
        updated_at_utc: now_utc(),
        status: "idle".to_string(),
        enabled: config.auto_bridge_sync_enabled,
        on_task_done: config.auto_bridge_sync_on_task_done,
        event_count: config.auto_bridge_sync_event_count,
        no_push: config.auto_bridge_sync_no_push,
        last_requested_at_utc: None,
        last_started_at_utc: None,
        last_finished_at_utc: None,
        last_note: None,
        last_trigger: None,
        last_remote: None,
        last_branch: None,
        last_result: None,
        last_error: None,
        pending_trigger: false,
        pending_note: None,
    }
}

fn load_bridge_auto_sync_state(
    repo_root: &Path,
    config: &TimelineConfig,
) -> Result<BridgeAutoSyncState> {
    let mut state = load_json_optional::<BridgeAutoSyncState>(
        &timeline_bridge_auto_sync_state_path(repo_root),
    )?
    .unwrap_or_else(|| default_bridge_auto_sync_state(config));
    if state.schema_version.trim().is_empty() {
        state.schema_version = SCHEMA_BRIDGE_AUTO_SYNC.to_string();
    }
    state.enabled = config.auto_bridge_sync_enabled;
    state.on_task_done = config.auto_bridge_sync_on_task_done;
    state.event_count = config.auto_bridge_sync_event_count;
    state.no_push = config.auto_bridge_sync_no_push;
    Ok(state)
}

fn load_bridge_auto_sync_lock(repo_root: &Path) -> Result<Option<BridgeAutoSyncLock>> {
    load_json_optional::<BridgeAutoSyncLock>(&timeline_bridge_auto_sync_lock_path(repo_root))
}

fn bridge_auto_sync_lock_is_stale(lock: &BridgeAutoSyncLock) -> bool {
    match parse_rfc3339_utc(&lock.created_at_utc) {
        Some(created_at) => {
            created_at + Duration::minutes(AUTO_BRIDGE_SYNC_STALE_MINUTES) <= Utc::now()
        }
        None => true,
    }
}

fn write_bridge_auto_sync_state(repo_root: &Path, state: &BridgeAutoSyncState) -> Result<()> {
    write_pretty_json(&timeline_bridge_auto_sync_state_path(repo_root), state)
}

fn write_bridge_auto_sync_lock(repo_root: &Path, lock: &BridgeAutoSyncLock) -> Result<()> {
    write_pretty_json(&timeline_bridge_auto_sync_lock_path(repo_root), lock)
}

fn remove_bridge_auto_sync_lock(repo_root: &Path) {
    let path = timeline_bridge_auto_sync_lock_path(repo_root);
    if path.exists() {
        let _ = fs::remove_file(path);
    }
}

fn bridge_auto_sync_payload(
    config: &TimelineConfig,
    state: &BridgeAutoSyncState,
) -> serde_json::Value {
    json!({
        "schema_version": "fugit.bridge.auto_sync.v1",
        "generated_at_utc": now_utc(),
        "enabled": config.auto_bridge_sync_enabled,
        "on_task_done": config.auto_bridge_sync_on_task_done,
        "event_count": config.auto_bridge_sync_event_count,
        "no_push": config.auto_bridge_sync_no_push,
        "status": state.status,
        "last_requested_at_utc": state.last_requested_at_utc,
        "last_started_at_utc": state.last_started_at_utc,
        "last_finished_at_utc": state.last_finished_at_utc,
        "last_note": state.last_note,
        "last_trigger": state.last_trigger,
        "last_remote": state.last_remote,
        "last_branch": state.last_branch,
        "last_result": state.last_result,
        "last_error": state.last_error,
        "pending_trigger": state.pending_trigger,
        "pending_note": state.pending_note
    })
}

fn detect_git_branch(repo_root: &Path) -> Option<String> {
    let output = ProcessCommand::new("git")
        .current_dir(repo_root)
        .args(["branch", "--show-current"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if branch.is_empty() {
        None
    } else {
        Some(branch)
    }
}

fn load_branch_index(repo_root: &Path, branch: &str) -> Result<BTreeMap<String, FileRecord>> {
    let index_path = timeline_branch_index_path(repo_root, branch);
    Ok(load_json_optional::<BTreeMap<String, FileRecord>>(&index_path)?.unwrap_or_default())
}

fn collect_branch_events_with_errors(
    repo_root: &Path,
    branch: &str,
) -> Result<(Vec<TimelineEvent>, Vec<serde_json::Value>, Vec<String>)> {
    let path = timeline_branch_events_path(repo_root, branch);
    if !path.exists() {
        return Ok((Vec::new(), Vec::new(), Vec::new()));
    }

    let file = fs::File::open(&path)
        .with_context(|| format!("failed opening timeline events {}", path.display()))?;
    let reader = BufReader::new(file);
    let mut out = Vec::<TimelineEvent>::new();
    let mut valid_lines = Vec::<String>::new();
    let mut corrupt = Vec::<serde_json::Value>::new();
    for (idx, line) in reader.lines().enumerate() {
        let line = line.with_context(|| format!("failed reading line {}", idx + 1))?;
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<TimelineEvent>(&line) {
            Ok(event) => {
                valid_lines.push(line);
                out.push(event);
            }
            Err(err) => {
                corrupt.push(json!({
                    "line": idx + 1,
                    "preview": line.chars().take(160).collect::<String>(),
                    "error": err.to_string()
                }));
            }
        }
    }
    Ok((out, corrupt, valid_lines))
}

fn repair_branch_event_journal(repo_root: &Path, branch: &str) -> Result<serde_json::Value> {
    let path = timeline_branch_events_path(repo_root, branch);
    let (events, corrupt, valid_lines) = collect_branch_events_with_errors(repo_root, branch)?;
    if corrupt.is_empty() {
        return Ok(json!({
            "attempted": true,
            "branch": branch,
            "file": path.display().to_string(),
            "repaired": false,
            "dropped_count": 0,
            "backup_file": null,
            "corrupt_lines": []
        }));
    }

    let backup = path.with_extension(format!("jsonl.bak.{}", Uuid::new_v4().simple()));
    fs::copy(&path, &backup).with_context(|| {
        format!(
            "failed backing up timeline event journal {} -> {}",
            path.display(),
            backup.display()
        )
    })?;
    let rewritten = if valid_lines.is_empty() {
        String::new()
    } else {
        format!("{}\n", valid_lines.join("\n"))
    };
    fs::write(&path, rewritten.as_bytes())
        .with_context(|| format!("failed rewriting repaired journal {}", path.display()))?;

    Ok(json!({
        "attempted": true,
        "branch": branch,
        "file": path.display().to_string(),
        "repaired": true,
        "kept_event_count": events.len(),
        "dropped_count": corrupt.len(),
        "backup_file": backup.display().to_string(),
        "corrupt_lines": corrupt
    }))
}

fn read_branch_events(repo_root: &Path, branch: &str) -> Result<Vec<TimelineEvent>> {
    let path = timeline_branch_events_path(repo_root, branch);
    let (events, corrupt, _) = collect_branch_events_with_errors(repo_root, branch)?;
    if let Some(first) = corrupt.first() {
        bail!(
            "failed parsing timeline event at {}:{}\ncorrupt_line={}",
            path.display(),
            first
                .get("line")
                .and_then(serde_json::Value::as_u64)
                .unwrap_or(0),
            first
                .get("preview")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
        );
    }
    Ok(events)
}

fn read_branch_events_tail(
    repo_root: &Path,
    branch: &str,
    limit: usize,
) -> Result<Vec<TimelineEvent>> {
    if limit == 0 {
        return Ok(Vec::new());
    }
    let path = timeline_branch_events_path(repo_root, branch);
    let (events, corrupt, _) = collect_branch_events_with_errors(repo_root, branch)?;
    if let Some(first) = corrupt.first() {
        bail!(
            "failed parsing timeline event at {}:{}\ncorrupt_line={}",
            path.display(),
            first
                .get("line")
                .and_then(serde_json::Value::as_u64)
                .unwrap_or(0),
            first
                .get("preview")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
        );
    }
    let start = events.len().saturating_sub(limit);
    Ok(events.into_iter().skip(start).collect())
}

fn reconstruct_index_at_event(
    events: &[TimelineEvent],
    head_index: &BTreeMap<String, FileRecord>,
    event_id: &str,
) -> Result<BTreeMap<String, FileRecord>> {
    let mut target_idx = None;
    for (idx, event) in events.iter().enumerate() {
        if event.event_id == event_id {
            target_idx = Some(idx);
            break;
        }
    }
    let target_idx =
        target_idx.ok_or_else(|| anyhow!("event not found on branch: {}", event_id))?;

    let mut index = head_index.clone();
    for event in events.iter().skip(target_idx + 1).rev() {
        for change in event.changes.iter().rev() {
            match change.kind {
                ChangeKind::Added => {
                    index.remove(&change.path);
                }
                ChangeKind::Modified | ChangeKind::Deleted => {
                    let old_hash = change.old_hash.as_ref().ok_or_else(|| {
                        anyhow!(
                            "cannot reconstruct event {}; missing old_hash for {}",
                            event.event_id,
                            change.path
                        )
                    })?;
                    let old_size_bytes = change.old_size_bytes.unwrap_or(0);
                    let modified_unix_secs = index
                        .get(&change.path)
                        .map(|row| row.modified_unix_secs)
                        .unwrap_or(0);
                    index.insert(
                        change.path.clone(),
                        FileRecord {
                            schema_version: SCHEMA_FILE_RECORD.to_string(),
                            hash: old_hash.clone(),
                            size_bytes: old_size_bytes,
                            modified_unix_secs,
                        },
                    );
                }
            }
        }
    }

    Ok(index)
}

fn append_jsonl<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .with_context(|| format!("failed opening {} for append", path.display()))?;
    serde_json::to_writer(&mut file, value)
        .with_context(|| format!("failed serializing jsonl row for {}", path.display()))?;
    file.write_all(b"\n")
        .with_context(|| format!("failed writing newline for {}", path.display()))?;
    Ok(())
}

fn store_object(repo_root: &Path, hash: &str, source_path: &Path) -> Result<()> {
    let object_path = timeline_objects_dir(repo_root).join(hash);
    if object_path.exists() {
        return Ok(());
    }
    fs::copy(source_path, &object_path).with_context(|| {
        format!(
            "failed storing timeline object {} from {}",
            object_path.display(),
            source_path.display()
        )
    })?;
    Ok(())
}

fn store_object_bytes(repo_root: &Path, hash: &str, bytes: &[u8]) -> Result<()> {
    let object_path = timeline_objects_dir(repo_root).join(hash);
    if object_path.exists() {
        return Ok(());
    }
    fs::write(&object_path, bytes)
        .with_context(|| format!("failed storing timeline object {}", object_path.display()))?;
    Ok(())
}

fn store_objects(
    repo_root: &Path,
    objects: &[(String, PathBuf)],
    object_jobs: usize,
) -> Result<()> {
    if objects.is_empty() {
        return Ok(());
    }

    if object_jobs <= 1 || objects.len() <= 1 {
        for (hash, source_path) in objects {
            store_object(repo_root, hash, source_path)?;
        }
        return Ok(());
    }

    let parallel_jobs = object_jobs.min(objects.len());
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(parallel_jobs)
        .build()
        .with_context(|| format!("failed building object-store thread pool ({parallel_jobs})"))?;
    let rows = objects.to_vec();
    let result: Result<Vec<()>> = pool.install(|| {
        rows.into_par_iter()
            .map(|(hash, source_path)| store_object(repo_root, &hash, &source_path))
            .collect()
    });
    result?;
    Ok(())
}

fn resolve_parallel_jobs(requested_jobs: Option<usize>, burst: bool) -> usize {
    if burst {
        return std::thread::available_parallelism()
            .map(|count| count.get())
            .unwrap_or(1);
    }
    requested_jobs.unwrap_or(1).max(1)
}

fn load_lock_state(repo_root: &Path) -> Result<LockState> {
    let path = timeline_locks_path(repo_root);
    let mut state = load_json_optional::<LockState>(&path)?.unwrap_or(LockState {
        schema_version: SCHEMA_LOCKS.to_string(),
        locks: Vec::new(),
    });
    if state.schema_version.trim().is_empty() {
        state.schema_version = SCHEMA_LOCKS.to_string();
    }
    Ok(state)
}

fn prune_expired_locks(state: &mut LockState) -> Result<bool> {
    let mut changed = false;
    if state.schema_version != SCHEMA_LOCKS {
        state.schema_version = SCHEMA_LOCKS.to_string();
        changed = true;
    }

    let now = Utc::now();
    let before = state.locks.len();
    state.locks.retain(|lock| {
        let Some(expires_at_utc) = lock.expires_at_utc.as_deref() else {
            return true;
        };
        match DateTime::parse_from_rfc3339(expires_at_utc) {
            Ok(expiry) => expiry.with_timezone(&Utc) > now,
            Err(_) => false,
        }
    });
    if state.locks.len() != before {
        changed = true;
    }
    Ok(changed)
}

fn lock_pattern_matches_path(pattern: &str, path: &str) -> bool {
    let normalized_pattern = normalize_user_path(pattern);
    let normalized_path = normalize_user_path(path);
    if normalized_pattern.is_empty() || normalized_path.is_empty() {
        return false;
    }

    if let Ok(glob) = Glob::new(&normalized_pattern) {
        let matcher = glob.compile_matcher();
        if matcher.is_match(&normalized_path) {
            return true;
        }
    }

    normalized_path == normalized_pattern
        || normalized_path.starts_with(&format!("{}/", normalized_pattern))
}

fn collect_lock_conflicts(
    repo_root: &Path,
    changes: &[ChangeRecord],
    current_agent_id: &str,
) -> Result<Vec<FileLock>> {
    if changes.is_empty() {
        return Ok(Vec::new());
    }

    let mut state = load_lock_state(repo_root)?;
    let state_changed = prune_expired_locks(&mut state)?;
    if state_changed {
        write_pretty_json(&timeline_locks_path(repo_root), &state)?;
    }

    let mut conflicts = Vec::<FileLock>::new();
    let mut seen = BTreeSet::<String>::new();
    for lock in &state.locks {
        if lock.agent_id == current_agent_id {
            continue;
        }
        let has_conflict = changes
            .iter()
            .any(|change| lock_pattern_matches_path(&lock.pattern, &change.path));
        if has_conflict && seen.insert(lock.lock_id.clone()) {
            conflicts.push(lock.clone());
        }
    }
    Ok(conflicts)
}

fn load_task_state(repo_root: &Path) -> Result<TaskState> {
    let path = timeline_tasks_path(repo_root);
    let mut state = load_json_optional::<TaskState>(&path)?.unwrap_or(TaskState {
        schema_version: SCHEMA_TASKS.to_string(),
        updated_at_utc: now_utc(),
        tasks: Vec::new(),
    });
    if state.schema_version.trim().is_empty() {
        state.schema_version = SCHEMA_TASKS.to_string();
    }
    Ok(state)
}

fn normalize_task_title(title: &str) -> Result<String> {
    let normalized = title.trim();
    if normalized.is_empty() {
        bail!("task title cannot be empty");
    }
    Ok(normalized.to_string())
}

fn normalize_task_detail(detail: Option<String>) -> Option<String> {
    detail.and_then(|value| {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

fn normalize_optional_text(value: Option<String>, field_name: &str) -> Result<Option<String>> {
    match value {
        Some(value) => {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                bail!("{} cannot be empty", field_name);
            }
            Ok(Some(trimmed))
        }
        None => Ok(None),
    }
}

fn normalize_string_list(values: Vec<String>) -> Vec<String> {
    dedupe_keep_order(values)
}

fn normalize_agent_id(agent: Option<String>) -> String {
    agent
        .and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        })
        .unwrap_or_else(default_agent_id)
}

fn resolve_checkpoint_repair_mode(
    requested: CheckpointRepairModeArg,
    allow_lossy_repair: bool,
) -> CheckpointRepairModeArg {
    if allow_lossy_repair {
        CheckpointRepairModeArg::Lossy
    } else {
        requested
    }
}

fn resolve_task_text_patch(value: Option<String>, clear: bool) -> Result<TaskTextPatch> {
    if clear && value.is_some() {
        bail!("cannot combine detail update with --clear-detail");
    }
    if clear {
        Ok(TaskTextPatch::Clear)
    } else if let Some(value) = value {
        Ok(TaskTextPatch::Set(value))
    } else {
        Ok(TaskTextPatch::Keep)
    }
}

fn resolve_task_list_patch(
    values: Vec<String>,
    clear: bool,
    field_name: &str,
) -> Result<Option<Vec<String>>> {
    if clear && !values.is_empty() {
        bail!(
            "cannot combine {} replacement values with --clear-{}",
            field_name,
            field_name
        );
    }
    if clear {
        Ok(Some(Vec::new()))
    } else if values.is_empty() {
        Ok(None)
    } else {
        Ok(Some(dedupe_keep_order(values)))
    }
}

fn validate_task_dependencies(
    state: &TaskState,
    editing_task_id: Option<&str>,
    depends_on: &[String],
) -> Result<()> {
    let known_ids = state
        .tasks
        .iter()
        .map(|task| task.task_id.as_str())
        .collect::<BTreeSet<_>>();
    for dependency in depends_on {
        let token = dependency.trim();
        if token.is_empty() {
            continue;
        }
        if editing_task_id == Some(token) {
            bail!("task {} cannot depend on itself", token);
        }
        if !known_ids.contains(token) {
            bail!("task dependency not found: {}", token);
        }
    }
    Ok(())
}

fn task_dependents(state: &TaskState, task_id: &str) -> Vec<String> {
    state
        .tasks
        .iter()
        .filter(|task| {
            task.depends_on
                .iter()
                .any(|dependency| dependency == task_id)
        })
        .map(|task| task.task_id.clone())
        .collect()
}

fn build_manual_task(
    state: &TaskState,
    title: &str,
    detail: Option<String>,
    agent_id: String,
    priority: i32,
    tags: Vec<String>,
    depends_on: Vec<String>,
) -> Result<FugitTask> {
    let normalized_title = normalize_task_title(title)?;
    let normalized_tags = dedupe_keep_order(tags);
    let normalized_depends_on = dedupe_keep_order(depends_on);
    validate_task_dependencies(state, None, &normalized_depends_on)?;
    let now = now_utc();
    Ok(FugitTask {
        task_id: format!("task_{}", Uuid::new_v4().simple()),
        title: normalized_title,
        detail: normalize_task_detail(detail),
        priority,
        tags: normalized_tags,
        depends_on: normalized_depends_on,
        status: TaskStatus::Open,
        created_at_utc: now.clone(),
        updated_at_utc: now.clone(),
        created_by_agent_id: agent_id,
        claimed_by_agent_id: None,
        claim_started_at_utc: None,
        claim_expires_at_utc: None,
        completed_at_utc: None,
        completed_by_agent_id: None,
        completed_summary: None,
        completion_notes: Vec::new(),
        completion_artifacts: Vec::new(),
        completion_commands: Vec::new(),
        source_key: None,
        source_plan: None,
        awaiting_confirmation: false,
        approved_at_utc: None,
        approved_by_agent_id: None,
    })
}

fn edit_task_in_state(
    state: &mut TaskState,
    task_id: &str,
    agent_id: &str,
    patch: TaskEditPatch,
) -> Result<FugitTask> {
    let Some(task_index) = state.tasks.iter().position(|task| task.task_id == task_id) else {
        bail!("task not found: {}", task_id);
    };
    if let Some(owner) = state.tasks[task_index].claimed_by_agent_id.as_deref()
        && owner != agent_id
    {
        bail!(
            "task {} is claimed by {}; cannot edit as {}",
            state.tasks[task_index].task_id,
            owner,
            agent_id
        );
    }
    if let Some(depends_on) = patch.depends_on.as_ref() {
        validate_task_dependencies(state, Some(task_id), depends_on)?;
    }

    let mut changed = false;
    if let Some(title) = patch.title {
        let normalized = normalize_task_title(&title)?;
        if state.tasks[task_index].title != normalized {
            state.tasks[task_index].title = normalized;
            changed = true;
        }
    }

    match patch.detail {
        TaskTextPatch::Keep => {}
        TaskTextPatch::Clear => {
            if state.tasks[task_index].detail.is_some() {
                state.tasks[task_index].detail = None;
                changed = true;
            }
        }
        TaskTextPatch::Set(value) => {
            let normalized = normalize_task_detail(Some(value));
            if state.tasks[task_index].detail != normalized {
                state.tasks[task_index].detail = normalized;
                changed = true;
            }
        }
    }

    if let Some(priority) = patch.priority
        && state.tasks[task_index].priority != priority
    {
        state.tasks[task_index].priority = priority;
        changed = true;
    }

    if let Some(tags) = patch.tags
        && state.tasks[task_index].tags != tags
    {
        state.tasks[task_index].tags = tags;
        changed = true;
    }

    if let Some(depends_on) = patch.depends_on
        && state.tasks[task_index].depends_on != depends_on
    {
        state.tasks[task_index].depends_on = depends_on;
        changed = true;
    }

    if !changed {
        bail!("task edit produced no changes: {}", task_id);
    }

    let now = now_utc();
    state.tasks[task_index].updated_at_utc = now.clone();
    state.updated_at_utc = now;
    Ok(state.tasks[task_index].clone())
}

fn remove_task_from_state(
    state: &mut TaskState,
    task_id: &str,
    agent_id: &str,
) -> Result<FugitTask> {
    let Some(task_index) = state.tasks.iter().position(|task| task.task_id == task_id) else {
        bail!("task not found: {}", task_id);
    };
    if let Some(owner) = state.tasks[task_index].claimed_by_agent_id.as_deref()
        && owner != agent_id
    {
        bail!(
            "task {} is claimed by {}; cannot remove as {}",
            state.tasks[task_index].task_id,
            owner,
            agent_id
        );
    }
    let dependents = task_dependents(state, task_id);
    if !dependents.is_empty() {
        bail!(
            "task {} still has dependents: {}",
            task_id,
            dependents.join(", ")
        );
    }

    let now = now_utc();
    let mut removed = state.tasks.remove(task_index);
    removed.updated_at_utc = now.clone();
    state.updated_at_utc = now;
    Ok(removed)
}

fn reopen_task_in_state(state: &mut TaskState, task_id: &str, agent_id: &str) -> Result<FugitTask> {
    let Some(task_index) = state.tasks.iter().position(|task| task.task_id == task_id) else {
        bail!("task not found: {}", task_id);
    };
    if let Some(owner) = state.tasks[task_index].claimed_by_agent_id.as_deref()
        && owner != agent_id
    {
        bail!(
            "task {} is claimed by {}; cannot reopen as {}",
            state.tasks[task_index].task_id,
            owner,
            agent_id
        );
    }
    if state.tasks[task_index].status != TaskStatus::Done {
        bail!("task is not completed: {}", state.tasks[task_index].task_id);
    }

    let now = now_utc();
    state.tasks[task_index].status = TaskStatus::Open;
    state.tasks[task_index].updated_at_utc = now.clone();
    state.tasks[task_index].claimed_by_agent_id = None;
    state.tasks[task_index].claim_started_at_utc = None;
    state.tasks[task_index].claim_expires_at_utc = None;
    state.tasks[task_index].completed_at_utc = None;
    state.tasks[task_index].completed_by_agent_id = None;
    state.tasks[task_index].completed_summary = None;
    state.tasks[task_index].completion_notes = Vec::new();
    state.tasks[task_index].completion_artifacts = Vec::new();
    state.tasks[task_index].completion_commands = Vec::new();
    state.updated_at_utc = now;
    Ok(state.tasks[task_index].clone())
}

fn approve_tasks_in_state(
    state: &mut TaskState,
    task_id: Option<&str>,
    all_pending_auto_replenish: bool,
    agent_id: &str,
) -> Result<Vec<FugitTask>> {
    if task_id.is_some() && all_pending_auto_replenish {
        bail!("task approve accepts either --task-id or --all-pending-auto-replenish");
    }
    if task_id.is_none() && !all_pending_auto_replenish {
        bail!("task approve requires --task-id or --all-pending-auto-replenish");
    }

    let indices = if let Some(task_id) = task_id {
        let task_index = state
            .tasks
            .iter()
            .position(|task| task.task_id == task_id)
            .ok_or_else(|| anyhow!("task not found: {}", task_id))?;
        vec![task_index]
    } else {
        state
            .tasks
            .iter()
            .enumerate()
            .filter(|(_, task)| {
                task.status == TaskStatus::Open
                    && task.awaiting_confirmation
                    && task_is_auto_replenish(task)
            })
            .map(|(idx, _)| idx)
            .collect::<Vec<_>>()
    };

    if indices.is_empty() {
        bail!("no pending auto-replenish tasks are awaiting confirmation");
    }

    let mut approved = Vec::<FugitTask>::new();
    let now = now_utc();
    for task_index in indices {
        if !state.tasks[task_index].awaiting_confirmation {
            bail!(
                "task {} is not awaiting confirmation",
                state.tasks[task_index].task_id
            );
        }
        state.tasks[task_index].awaiting_confirmation = false;
        state.tasks[task_index].approved_at_utc = Some(now.clone());
        state.tasks[task_index].approved_by_agent_id = Some(agent_id.to_string());
        state.tasks[task_index].updated_at_utc = now.clone();
        approved.push(state.tasks[task_index].clone());
    }
    state.updated_at_utc = now;
    Ok(approved)
}

fn sync_auto_replenish_policy_in_state(
    state: &mut TaskState,
    config: &TimelineConfig,
) -> Vec<String> {
    let mut updated = Vec::<String>::new();
    for task in &mut state.tasks {
        if sync_auto_replenish_task_confirmation(task, config.auto_replenish_require_confirmation) {
            updated.push(task.task_id.clone());
        }
    }
    if !updated.is_empty() {
        state.updated_at_utc = now_utc();
    }
    updated
}

fn update_task_policy_config(
    config: &mut TimelineConfig,
    auto_replenish_enabled: Option<bool>,
    auto_replenish_confirmation: Option<bool>,
    replenish_agents: Vec<String>,
    clear_replenish_agents: bool,
) -> bool {
    let mut changed = false;
    if let Some(enabled) = auto_replenish_enabled
        && config.auto_replenish_enabled != enabled
    {
        config.auto_replenish_enabled = enabled;
        changed = true;
    }
    if let Some(require_confirmation) = auto_replenish_confirmation
        && config.auto_replenish_require_confirmation != require_confirmation
    {
        config.auto_replenish_require_confirmation = require_confirmation;
        changed = true;
    }
    if clear_replenish_agents {
        if !config.auto_replenish_agents.is_empty() {
            config.auto_replenish_agents.clear();
            changed = true;
        }
    }
    let normalized_agents = dedupe_keep_order(
        replenish_agents
            .into_iter()
            .filter_map(|value| {
                let trimmed = value.trim().to_string();
                if trimmed.is_empty() || trimmed == SYSTEM_AGENT_ID {
                    None
                } else {
                    Some(trimmed)
                }
            })
            .collect(),
    );
    for agent_id in normalized_agents {
        if !config.auto_replenish_agents.contains(&agent_id) {
            config.auto_replenish_agents.push(agent_id);
            changed = true;
        }
    }
    if changed {
        config.updated_at_utc = now_utc();
    }
    changed
}

fn task_policy_payload(state: &TaskState, config: &TimelineConfig) -> serde_json::Value {
    let pending_confirmation_task_ids = state
        .tasks
        .iter()
        .filter(|task| {
            task.status == TaskStatus::Open
                && task.awaiting_confirmation
                && task_is_auto_replenish(task)
        })
        .map(|task| task.task_id.clone())
        .collect::<Vec<_>>();
    json!({
        "schema_version": "fugit.task.policy.v1",
        "generated_at_utc": now_utc(),
        "auto_replenish_enabled": config.auto_replenish_enabled,
        "auto_replenish_confirmation": config.auto_replenish_require_confirmation,
        "configured_replenish_agents": config.auto_replenish_agents,
        "observed_replenish_agents": collect_auto_replenish_agents(state, config, ""),
        "pending_confirmation_count": pending_confirmation_task_ids.len(),
        "pending_confirmation_task_ids": pending_confirmation_task_ids
    })
}

fn normalize_task_query_filter(
    tags: Vec<String>,
    focus: Option<String>,
    prefix: Option<String>,
    contains: Option<String>,
) -> Result<TaskQueryFilter> {
    Ok(TaskQueryFilter {
        required_tags: dedupe_keep_order(tags),
        focus: normalize_optional_text(focus, "task focus")?,
        prefix: normalize_optional_text(prefix, "task prefix")?,
        contains: normalize_optional_text(contains, "task contains")?,
    })
}

fn auto_replenish_source_key(agent_id: &str) -> String {
    format!("agent:{}", agent_id.trim())
}

fn task_is_auto_replenish(task: &FugitTask) -> bool {
    task.source_plan.as_deref() == Some(AUTO_REPLENISH_SOURCE_PLAN)
}

fn task_auto_replenish_agent_id(task: &FugitTask) -> Option<&str> {
    if !task_is_auto_replenish(task) {
        return None;
    }
    task.source_key
        .as_deref()
        .and_then(|value| value.strip_prefix("agent:"))
}

fn task_is_auto_replenish_for_agent(task: &FugitTask, agent_id: &str) -> bool {
    task_auto_replenish_agent_id(task) == Some(agent_id)
}

fn task_is_ready_for_dispatch(task: &FugitTask, status_map: &BTreeMap<String, TaskStatus>) -> bool {
    task.status != TaskStatus::Done
        && !task.awaiting_confirmation
        && task_blocked_by(task, status_map).is_empty()
}

fn collect_auto_replenish_agents(
    state: &TaskState,
    config: &TimelineConfig,
    requesting_agent_id: &str,
) -> Vec<String> {
    let mut agents = Vec::<String>::new();
    for configured in &config.auto_replenish_agents {
        let trimmed = configured.trim();
        if trimmed.is_empty() || trimmed == SYSTEM_AGENT_ID {
            continue;
        }
        agents.push(trimmed.to_string());
    }
    for task in &state.tasks {
        for candidate in [
            Some(task.created_by_agent_id.as_str()),
            task.claimed_by_agent_id.as_deref(),
            task.completed_by_agent_id.as_deref(),
        ] {
            let Some(agent_id) = candidate else {
                continue;
            };
            let trimmed = agent_id.trim();
            if trimmed.is_empty() || trimmed == SYSTEM_AGENT_ID {
                continue;
            }
            agents.push(trimmed.to_string());
        }
    }
    if !requesting_agent_id.trim().is_empty() && requesting_agent_id != SYSTEM_AGENT_ID {
        agents.push(requesting_agent_id.to_string());
    }
    dedupe_keep_order(agents)
}

fn build_auto_replenish_task(agent_id: &str, require_confirmation: bool) -> FugitTask {
    let now = now_utc();
    FugitTask {
        task_id: format!("task_{}", Uuid::new_v4().simple()),
        title: format!("Scout for more tasks to add to fugit ({})", agent_id),
        detail: Some(
            "The ready queue is empty for this agent. Inspect the repo, identify the next useful backlog items, and add them to fugit after checking for duplicates.".to_string(),
        ),
        priority: 0,
        tags: vec![
            "system:auto-replenish".to_string(),
            "workflow:queue-scout".to_string(),
        ],
        depends_on: Vec::new(),
        status: TaskStatus::Open,
        created_at_utc: now.clone(),
        updated_at_utc: now.clone(),
        created_by_agent_id: SYSTEM_AGENT_ID.to_string(),
        claimed_by_agent_id: None,
        claim_started_at_utc: None,
        claim_expires_at_utc: None,
        completed_at_utc: None,
        completed_by_agent_id: None,
        completed_summary: None,
        completion_notes: Vec::new(),
        completion_artifacts: Vec::new(),
        completion_commands: Vec::new(),
        source_key: Some(auto_replenish_source_key(agent_id)),
        source_plan: Some(AUTO_REPLENISH_SOURCE_PLAN.to_string()),
        awaiting_confirmation: require_confirmation,
        approved_at_utc: None,
        approved_by_agent_id: None,
    }
}

fn sync_auto_replenish_task_confirmation(task: &mut FugitTask, require_confirmation: bool) -> bool {
    if !task_is_auto_replenish(task) || task.status != TaskStatus::Open {
        return false;
    }
    let mut changed = false;
    let now = now_utc();
    if require_confirmation {
        if !task.awaiting_confirmation
            && task.approved_at_utc.is_none()
            && task.approved_by_agent_id.is_none()
        {
            task.awaiting_confirmation = true;
            task.approved_at_utc = None;
            task.approved_by_agent_id = None;
            changed = true;
        }
    } else if task.awaiting_confirmation {
        task.awaiting_confirmation = false;
        task.approved_at_utc = Some(now.clone());
        task.approved_by_agent_id = Some(SYSTEM_AGENT_ID.to_string());
        changed = true;
    }
    if changed {
        task.updated_at_utc = now;
    }
    changed
}

fn ensure_auto_replenish_tasks(
    state: &mut TaskState,
    config: &TimelineConfig,
    requesting_agent_id: &str,
) -> AutoReplenishEnsureResult {
    let agent_ids = collect_auto_replenish_agents(state, config, requesting_agent_id);
    let mut result = AutoReplenishEnsureResult {
        agent_ids: agent_ids.clone(),
        ..AutoReplenishEnsureResult::default()
    };
    for agent_id in agent_ids {
        let mut active_indices = state
            .tasks
            .iter()
            .enumerate()
            .filter(|(_, task)| {
                task.status != TaskStatus::Done && task_is_auto_replenish_for_agent(task, &agent_id)
            })
            .map(|(idx, _)| idx)
            .collect::<Vec<_>>();
        active_indices.sort_by_key(|idx| state.tasks[*idx].updated_at_utc.clone());
        if let Some(task_index) = active_indices.pop() {
            if sync_auto_replenish_task_confirmation(
                &mut state.tasks[task_index],
                config.auto_replenish_require_confirmation,
            ) {
                result
                    .updated_task_ids
                    .push(state.tasks[task_index].task_id.clone());
            }
            result
                .available_task_ids
                .push(state.tasks[task_index].task_id.clone());
            if state.tasks[task_index].awaiting_confirmation {
                result
                    .pending_confirmation_task_ids
                    .push(state.tasks[task_index].task_id.clone());
            }
            continue;
        }

        let task = build_auto_replenish_task(&agent_id, config.auto_replenish_require_confirmation);
        result.created_task_ids.push(task.task_id.clone());
        result.available_task_ids.push(task.task_id.clone());
        if task.awaiting_confirmation {
            result
                .pending_confirmation_task_ids
                .push(task.task_id.clone());
        }
        state.tasks.push(task);
    }

    if !result.created_task_ids.is_empty() || !result.updated_task_ids.is_empty() {
        state.updated_at_utc = now_utc();
    }

    result
}

fn task_search_haystacks(task: &FugitTask) -> Vec<String> {
    let mut haystacks = vec![
        task.task_id.to_ascii_lowercase(),
        task.title.to_ascii_lowercase(),
    ];
    if let Some(detail) = task.detail.as_deref() {
        haystacks.push(detail.to_ascii_lowercase());
    }
    for tag in &task.tags {
        haystacks.push(tag.to_ascii_lowercase());
    }
    haystacks
}

fn task_matches_tag_filters(task: &FugitTask, required_tags: &[String]) -> bool {
    if required_tags.is_empty() {
        return true;
    }
    required_tags
        .iter()
        .all(|required| task.tags.iter().any(|task_tag| task_tag == required))
}

fn task_matches_query_filter(task: &FugitTask, filter: &TaskQueryFilter) -> bool {
    if !task_matches_tag_filters(task, &filter.required_tags) {
        return false;
    }
    let haystacks = task_search_haystacks(task);

    if let Some(prefix) = filter.prefix.as_deref() {
        let needle = prefix.to_ascii_lowercase();
        if !haystacks.iter().any(|value| value.starts_with(&needle)) {
            return false;
        }
    }

    if let Some(contains) = filter.contains.as_deref() {
        let needle = contains.to_ascii_lowercase();
        if !haystacks.iter().any(|value| value.contains(&needle)) {
            return false;
        }
    }

    if let Some(focus) = filter.focus.as_deref() {
        let needle = focus.to_ascii_lowercase();
        if !haystacks
            .iter()
            .any(|value| value == &needle || value.starts_with(&needle) || value.contains(&needle))
        {
            return false;
        }
    }

    true
}

fn task_to_json_payload(
    task: &FugitTask,
    status_map: &BTreeMap<String, TaskStatus>,
) -> serde_json::Value {
    let mut blocked_by = task_blocked_by(task, status_map);
    if task.awaiting_confirmation {
        blocked_by.push("confirmation".to_string());
    }
    let ready = task_is_ready_for_dispatch(task, status_map);
    json!({
        "task_id": task.task_id,
        "title": task.title,
        "detail": task.detail,
        "priority": task.priority,
        "status": task.status,
        "tags": task.tags,
        "depends_on": task.depends_on,
        "blocked_by": blocked_by,
        "ready": ready,
        "created_by_agent_id": task.created_by_agent_id,
        "claimed_by_agent_id": task.claimed_by_agent_id,
        "created_at_utc": task.created_at_utc,
        "updated_at_utc": task.updated_at_utc,
        "completed_at_utc": task.completed_at_utc,
        "completed_by_agent_id": task.completed_by_agent_id,
        "completed_summary": task.completed_summary,
        "completion_notes": task.completion_notes,
        "completion_artifacts": task.completion_artifacts,
        "completion_commands": task.completion_commands,
        "claim_expires_at_utc": task.claim_expires_at_utc,
        "source_key": task.source_key,
        "source_plan": task.source_plan,
        "auto_replenish": task_is_auto_replenish(task),
        "awaiting_confirmation": task.awaiting_confirmation,
        "approved_at_utc": task.approved_at_utc,
        "approved_by_agent_id": task.approved_by_agent_id
    })
}

fn select_task_payload_fields(payload: &serde_json::Value, fields: &[String]) -> serde_json::Value {
    if fields.is_empty() {
        return payload.clone();
    }
    let mut out = serde_json::Map::<String, serde_json::Value>::new();
    for field in fields {
        let key = field.trim();
        if key.is_empty() {
            continue;
        }
        if let Some(value) = payload.get(key) {
            out.insert(key.to_string(), value.clone());
        } else {
            out.insert(key.to_string(), serde_json::Value::Null);
        }
    }
    serde_json::Value::Object(out)
}

fn json_value_compact_text(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => String::new(),
        serde_json::Value::Bool(flag) => flag.to_string(),
        serde_json::Value::Number(number) => number.to_string(),
        serde_json::Value::String(text) => text.clone(),
        serde_json::Value::Array(values) => values
            .iter()
            .map(json_value_compact_text)
            .collect::<Vec<_>>()
            .join(","),
        serde_json::Value::Object(_) => serde_json::to_string(value).unwrap_or_default(),
    }
}

fn parse_task_import_rows(file: &Path, format: TaskImportFormatArg) -> Result<Vec<TaskImportRow>> {
    let content = fs::read_to_string(file)
        .with_context(|| format!("failed reading task import file {}", file.display()))?;
    let resolved_format = if matches!(format, TaskImportFormatArg::Auto) {
        detect_task_import_format(file, &content)
    } else {
        format
    };

    let mut rows = Vec::<TaskImportRow>::new();
    for (index, line) in content.lines().enumerate() {
        let line_no = index + 1;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        match resolved_format {
            TaskImportFormatArg::Tsv => {
                if trimmed.starts_with('#') {
                    continue;
                }
                if line_no == 1 {
                    let maybe_header = trimmed.to_ascii_lowercase();
                    if maybe_header.starts_with("key\t") {
                        continue;
                    }
                }
                let row = parse_task_import_tsv_line(trimmed).with_context(|| {
                    format!("invalid task import row {} in {}", line_no, file.display())
                })?;
                rows.push(row);
            }
            TaskImportFormatArg::Markdown => {
                if let Some(row) = parse_task_import_markdown_line(trimmed, line_no)? {
                    rows.push(row);
                }
            }
            TaskImportFormatArg::Auto => unreachable!("auto format is resolved before parsing"),
        }
    }
    Ok(rows)
}

fn detect_task_import_format(file: &Path, content: &str) -> TaskImportFormatArg {
    if let Some(ext) = file.extension().and_then(|value| value.to_str()) {
        let ext = ext.to_ascii_lowercase();
        if ext == "md" || ext == "markdown" {
            return TaskImportFormatArg::Markdown;
        }
    }
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if looks_like_markdown_task_line(trimmed) || looks_like_markdown_checked_task_line(trimmed)
        {
            return TaskImportFormatArg::Markdown;
        }
        if trimmed.contains('\t') {
            return TaskImportFormatArg::Tsv;
        }
    }
    TaskImportFormatArg::Tsv
}

fn looks_like_markdown_task_line(trimmed: &str) -> bool {
    trimmed.starts_with("- [ ] ")
        || trimmed.starts_with("* [ ] ")
        || trimmed.starts_with("- [ ]\t")
        || trimmed.starts_with("* [ ]\t")
}

fn looks_like_markdown_checked_task_line(trimmed: &str) -> bool {
    trimmed.starts_with("- [x] ")
        || trimmed.starts_with("- [X] ")
        || trimmed.starts_with("* [x] ")
        || trimmed.starts_with("* [X] ")
}

fn parse_task_import_markdown_line(trimmed: &str, line_no: usize) -> Result<Option<TaskImportRow>> {
    let mut body = if let Some(rest) = trimmed.strip_prefix("- [ ] ") {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("* [ ] ") {
        rest
    } else if looks_like_markdown_checked_task_line(trimmed) {
        return Ok(None);
    } else {
        return Ok(None);
    };

    body = body.trim();
    if body.is_empty() {
        bail!("markdown task line {} has empty title", line_no);
    }

    let mut key = format!("md_{}", line_no);
    let mut source_key = None;
    if let Some(after_open_tick) = body.strip_prefix('`')
        && let Some(end_tick_idx) = after_open_tick.find('`')
    {
        let candidate = normalize_markdown_import_key(&after_open_tick[..end_tick_idx]);
        if !candidate.is_empty() {
            key = candidate;
            source_key = Some(key.clone());
            let remainder = after_open_tick[end_tick_idx + 1..].trim();
            if !remainder.is_empty() {
                body = remainder.trim_start_matches(|ch| matches!(ch, ':' | '-' | ' '));
            }
        }
    }

    let title = body.trim().to_string();
    if title.is_empty() {
        bail!("markdown task line {} has empty title", line_no);
    }

    Ok(Some(TaskImportRow {
        key,
        source_key,
        title,
        detail: None,
        priority: None,
        tags: Vec::new(),
        depends_on_keys: Vec::new(),
        agent: None,
    }))
}

fn normalize_markdown_import_key(raw: &str) -> String {
    let mut out = String::new();
    let mut last_was_sep = false;
    for ch in raw.trim().chars() {
        let normalized = if ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.') {
            Some(ch)
        } else if ch.is_whitespace() || matches!(ch, ':' | '/' | '\\' | '|' | ',') {
            Some('_')
        } else {
            None
        };
        if let Some(candidate) = normalized {
            if candidate == '_' {
                if !last_was_sep {
                    out.push('_');
                    last_was_sep = true;
                }
            } else {
                out.push(candidate);
                last_was_sep = false;
            }
        }
    }
    out.trim_matches('_').to_string()
}

fn parse_task_import_tsv_line(line: &str) -> Result<TaskImportRow> {
    let cols: Vec<&str> = line.split('\t').collect();
    if cols.len() < 5 || cols.len() > 7 {
        bail!(
            "expected 5 to 7 tab-separated columns: key,priority,tags,depends_on_keys,title[,detail[,agent]]"
        );
    }

    let key = cols[0].trim().to_string();
    if key.is_empty() {
        bail!("task import key cannot be empty");
    }

    let priority = if cols[1].trim().is_empty() {
        None
    } else {
        Some(
            cols[1]
                .trim()
                .parse::<i32>()
                .with_context(|| format!("invalid priority '{}'", cols[1].trim()))?,
        )
    };

    let tags = parse_task_import_csv_tokens(cols[2]);
    let depends_on_keys = parse_task_import_csv_tokens(cols[3]);

    let title = cols[4].trim().to_string();
    if title.is_empty() {
        bail!("task import title cannot be empty");
    }

    let detail = cols.get(5).and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    });

    let agent = cols.get(6).and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    });

    Ok(TaskImportRow {
        source_key: Some(key.clone()),
        key,
        title,
        detail,
        priority,
        tags,
        depends_on_keys,
        agent,
    })
}

fn parse_task_import_csv_tokens(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn resolve_task_plan_path(repo_root: &Path, plan: &Path) -> Result<PathBuf> {
    let candidate = if plan.is_absolute() {
        plan.to_path_buf()
    } else {
        repo_root.join(plan)
    };
    candidate
        .canonicalize()
        .with_context(|| format!("failed resolving plan file {}", candidate.display()))
}

fn normalize_task_plan_source(repo_root: &Path, plan: &Path) -> String {
    if let Ok(relative) = plan.strip_prefix(repo_root) {
        let normalized = normalize_relpath(relative);
        if !normalized.is_empty() {
            return normalized;
        }
    }
    plan.display().to_string()
}

fn task_status_label(status: &TaskStatus) -> &'static str {
    match status {
        TaskStatus::Open => "open",
        TaskStatus::Claimed => "claimed",
        TaskStatus::Done => "done",
    }
}

fn task_sync_record(task: &FugitTask) -> TaskSyncTaskRecord {
    TaskSyncTaskRecord {
        task_id: task.task_id.clone(),
        title: task.title.clone(),
        status: task_status_label(&task.status).to_string(),
        source_key: task.source_key.clone(),
    }
}

fn find_sync_match_for_row(
    state: &TaskState,
    used_indices: &BTreeSet<usize>,
    plan_source: &str,
    row: &TaskImportRow,
) -> Result<Option<(usize, bool)>> {
    if let Some(source_key) = row.source_key.as_deref() {
        let source_matches = state
            .tasks
            .iter()
            .enumerate()
            .filter(|(idx, task)| {
                !used_indices.contains(idx)
                    && task.source_plan.as_deref() == Some(plan_source)
                    && task.source_key.as_deref() == Some(source_key)
            })
            .map(|(idx, _)| idx)
            .collect::<Vec<_>>();
        if source_matches.len() > 1 {
            bail!(
                "task sync found multiple managed tasks for source key '{}' in plan {}",
                source_key,
                plan_source
            );
        }
        if let Some(idx) = source_matches.first().copied() {
            return Ok(Some((idx, false)));
        }
    }

    let title_matches = state
        .tasks
        .iter()
        .enumerate()
        .filter(|(idx, task)| {
            if used_indices.contains(idx) || task.title != row.title {
                return false;
            }
            task.source_plan.as_deref().is_none()
                || task.source_plan.as_deref() == Some(plan_source)
        })
        .map(|(idx, _)| idx)
        .collect::<Vec<_>>();
    if title_matches.len() == 1 {
        return Ok(Some((title_matches[0], true)));
    }
    Ok(None)
}

fn sync_task_needs_update(
    task: &FugitTask,
    row: &TaskImportRow,
    plan_source: &str,
    default_priority: i32,
    depends_on: &[String],
) -> bool {
    task.status == TaskStatus::Done
        || task.title != row.title
        || task.detail != row.detail
        || task.priority != row.priority.unwrap_or(default_priority)
        || task.tags != dedupe_keep_order(row.tags.clone())
        || task.depends_on != dedupe_keep_order(depends_on.to_vec())
        || task.source_plan.as_deref() != Some(plan_source)
        || task.source_key != row.source_key
}

fn mark_task_synced(
    state: &mut TaskState,
    task_index: usize,
    row: &TaskImportRow,
    plan_source: &str,
    default_priority: i32,
    depends_on: Vec<String>,
) -> Result<bool> {
    let desired_title = normalize_task_title(&row.title)?;
    let desired_detail = normalize_task_detail(row.detail.clone());
    let desired_priority = row.priority.unwrap_or(default_priority);
    let desired_tags = dedupe_keep_order(row.tags.clone());
    let desired_depends_on = dedupe_keep_order(depends_on);

    let mut changed = false;
    if state.tasks[task_index].title != desired_title {
        state.tasks[task_index].title = desired_title;
        changed = true;
    }
    if state.tasks[task_index].detail != desired_detail {
        state.tasks[task_index].detail = desired_detail;
        changed = true;
    }
    if state.tasks[task_index].priority != desired_priority {
        state.tasks[task_index].priority = desired_priority;
        changed = true;
    }
    if state.tasks[task_index].tags != desired_tags {
        state.tasks[task_index].tags = desired_tags;
        changed = true;
    }
    if state.tasks[task_index].depends_on != desired_depends_on {
        state.tasks[task_index].depends_on = desired_depends_on;
        changed = true;
    }
    if state.tasks[task_index].source_plan.as_deref() != Some(plan_source) {
        state.tasks[task_index].source_plan = Some(plan_source.to_string());
        changed = true;
    }
    if state.tasks[task_index].source_key != row.source_key {
        state.tasks[task_index].source_key = row.source_key.clone();
        changed = true;
    }
    if changed {
        let now = now_utc();
        state.tasks[task_index].updated_at_utc = now.clone();
        state.updated_at_utc = now;
    }
    Ok(changed)
}

fn sync_plan_into_task_state(
    state: &mut TaskState,
    rows: Vec<TaskImportRow>,
    plan_source: &str,
    agent_id: &str,
    default_priority: i32,
    keep_missing: bool,
) -> Result<TaskSyncReport> {
    let mut known_keys = BTreeSet::<String>::new();
    for row in &rows {
        if !known_keys.insert(row.key.clone()) {
            bail!(
                "duplicate task sync key '{}' in plan {}",
                row.key,
                plan_source
            );
        }
    }
    for row in &rows {
        for dependency in &row.depends_on_keys {
            if dependency == &row.key {
                bail!("task sync key '{}' cannot depend on itself", row.key);
            }
            if !known_keys.contains(dependency) {
                bail!(
                    "task sync key '{}' depends on unknown key '{}'",
                    row.key,
                    dependency
                );
            }
        }
    }

    let mut report = TaskSyncReport {
        schema_version: "fugit.task.sync.v1".to_string(),
        generated_at_utc: now_utc(),
        plan: plan_source.to_string(),
        format: "resolved".to_string(),
        dry_run: false,
        keep_missing,
        created: Vec::new(),
        updated: Vec::new(),
        reopened: Vec::new(),
        removed: Vec::new(),
        unchanged: Vec::new(),
        matched_by_title: Vec::new(),
        blocked: Vec::new(),
    };

    let mut used_indices = BTreeSet::<usize>::new();
    let mut row_to_existing = BTreeMap::<String, usize>::new();
    let mut key_to_task_id = BTreeMap::<String, String>::new();
    let mut expected_task_ids = BTreeSet::<String>::new();

    for row in &rows {
        if let Some((idx, matched_by_title)) =
            find_sync_match_for_row(state, &used_indices, plan_source, row)?
        {
            used_indices.insert(idx);
            row_to_existing.insert(row.key.clone(), idx);
            key_to_task_id.insert(row.key.clone(), state.tasks[idx].task_id.clone());
            expected_task_ids.insert(state.tasks[idx].task_id.clone());
            if matched_by_title {
                report
                    .matched_by_title
                    .push(task_sync_record(&state.tasks[idx]));
            }
        }
    }

    let mut pending = rows
        .iter()
        .filter(|row| !row_to_existing.contains_key(&row.key))
        .cloned()
        .collect::<Vec<_>>();
    while !pending.is_empty() {
        let mut progress = false;
        let mut unresolved = Vec::<TaskImportRow>::new();
        for row in pending {
            if row
                .depends_on_keys
                .iter()
                .all(|key| key_to_task_id.contains_key(key))
            {
                progress = true;
                let depends_on = row
                    .depends_on_keys
                    .iter()
                    .map(|key| key_to_task_id[key].clone())
                    .collect::<Vec<_>>();
                let now = now_utc();
                let task = FugitTask {
                    task_id: format!("task_{}", Uuid::new_v4().simple()),
                    title: normalize_task_title(&row.title)?,
                    detail: normalize_task_detail(row.detail.clone()),
                    priority: row.priority.unwrap_or(default_priority),
                    tags: dedupe_keep_order(row.tags.clone()),
                    depends_on: dedupe_keep_order(depends_on),
                    status: TaskStatus::Open,
                    created_at_utc: now.clone(),
                    updated_at_utc: now.clone(),
                    created_by_agent_id: agent_id.to_string(),
                    claimed_by_agent_id: None,
                    claim_started_at_utc: None,
                    claim_expires_at_utc: None,
                    completed_at_utc: None,
                    completed_by_agent_id: None,
                    completed_summary: None,
                    completion_notes: Vec::new(),
                    completion_artifacts: Vec::new(),
                    completion_commands: Vec::new(),
                    source_key: row.source_key.clone(),
                    source_plan: Some(plan_source.to_string()),
                    awaiting_confirmation: false,
                    approved_at_utc: None,
                    approved_by_agent_id: None,
                };
                key_to_task_id.insert(row.key.clone(), task.task_id.clone());
                expected_task_ids.insert(task.task_id.clone());
                report.created.push(task_sync_record(&task));
                state.tasks.push(task);
            } else {
                unresolved.push(row);
            }
        }
        if !progress {
            let unresolved_keys = unresolved
                .iter()
                .map(|row| row.key.clone())
                .collect::<Vec<_>>()
                .join(", ");
            bail!(
                "task sync has unresolved or cyclic dependencies: {}",
                unresolved_keys
            );
        }
        pending = unresolved;
    }

    for row in &rows {
        let Some(task_id) = key_to_task_id.get(&row.key).cloned() else {
            continue;
        };
        let Some(task_index) = state.tasks.iter().position(|task| task.task_id == task_id) else {
            continue;
        };
        let depends_on = row
            .depends_on_keys
            .iter()
            .map(|key| key_to_task_id[key].clone())
            .collect::<Vec<_>>();
        let needs_update = sync_task_needs_update(
            &state.tasks[task_index],
            row,
            plan_source,
            default_priority,
            &depends_on,
        );
        if let Some(owner) = state.tasks[task_index].claimed_by_agent_id.as_deref()
            && owner != agent_id
            && needs_update
        {
            report.blocked.push(TaskSyncBlockedTask {
                action: "update".to_string(),
                task_id: state.tasks[task_index].task_id.clone(),
                title: state.tasks[task_index].title.clone(),
                reason: format!("claimed by {}", owner),
            });
            continue;
        }

        let mut reopened = false;
        if state.tasks[task_index].status == TaskStatus::Done {
            let reopened_task =
                reopen_task_in_state(state, &state.tasks[task_index].task_id.clone(), agent_id)?;
            report.reopened.push(task_sync_record(&reopened_task));
            reopened = true;
        }
        let changed = mark_task_synced(
            state,
            task_index,
            row,
            plan_source,
            default_priority,
            depends_on,
        )?;
        if changed {
            report
                .updated
                .push(task_sync_record(&state.tasks[task_index]));
        } else if !reopened
            && !report
                .created
                .iter()
                .any(|record| record.task_id == state.tasks[task_index].task_id)
        {
            report
                .unchanged
                .push(task_sync_record(&state.tasks[task_index]));
        }
    }

    if !keep_missing {
        let managed_task_ids = state
            .tasks
            .iter()
            .filter(|task| task.source_plan.as_deref() == Some(plan_source))
            .map(|task| task.task_id.clone())
            .collect::<BTreeSet<_>>();
        let mut pending_remove = managed_task_ids
            .difference(&expected_task_ids)
            .cloned()
            .collect::<Vec<_>>();
        loop {
            let mut progress = false;
            let mut retry = Vec::<String>::new();
            for task_id in pending_remove {
                let Some(task_index) = state.tasks.iter().position(|task| task.task_id == task_id)
                else {
                    continue;
                };
                if let Some(owner) = state.tasks[task_index].claimed_by_agent_id.as_deref()
                    && owner != agent_id
                {
                    report.blocked.push(TaskSyncBlockedTask {
                        action: "remove".to_string(),
                        task_id: state.tasks[task_index].task_id.clone(),
                        title: state.tasks[task_index].title.clone(),
                        reason: format!("claimed by {}", owner),
                    });
                    continue;
                }
                match remove_task_from_state(state, &task_id, agent_id) {
                    Ok(task) => {
                        progress = true;
                        report.removed.push(task_sync_record(&task));
                    }
                    Err(err) => {
                        let reason = err.to_string();
                        if reason.contains("still has dependents") {
                            retry.push(task_id);
                        } else {
                            let fallback = state
                                .tasks
                                .iter()
                                .find(|task| task.task_id == task_id)
                                .cloned();
                            if let Some(task) = fallback {
                                report.blocked.push(TaskSyncBlockedTask {
                                    action: "remove".to_string(),
                                    task_id: task.task_id,
                                    title: task.title,
                                    reason,
                                });
                            }
                        }
                    }
                }
            }
            if retry.is_empty() {
                break;
            }
            if !progress {
                for task_id in retry {
                    if let Some(task) = state.tasks.iter().find(|task| task.task_id == task_id) {
                        report.blocked.push(TaskSyncBlockedTask {
                            action: "remove".to_string(),
                            task_id: task.task_id.clone(),
                            title: task.title.clone(),
                            reason: "still has dependents".to_string(),
                        });
                    }
                }
                break;
            }
            pending_remove = retry;
        }
    }

    Ok(report)
}

fn write_mcp_task_import_temp_file(repo_root: &Path, kind: &str, content: &str) -> Result<PathBuf> {
    let dir = repo_root.join(".fugit").join("mcp_tmp");
    fs::create_dir_all(&dir)
        .with_context(|| format!("failed creating mcp temp dir {}", dir.display()))?;
    let filename = format!("task_import_{}_{}.txt", kind, Uuid::new_v4().simple());
    let path = dir.join(filename);
    fs::write(&path, content.as_bytes()).with_context(|| {
        format!(
            "failed writing mcp task import temp file {}",
            path.display()
        )
    })?;
    Ok(path)
}

fn resolve_fugit_home() -> Result<PathBuf> {
    if let Ok(path) = std::env::var("FUGIT_HOME")
        && !path.trim().is_empty()
    {
        return Ok(PathBuf::from(path.trim()));
    }
    if let Ok(home) = std::env::var("HOME")
        && !home.trim().is_empty()
    {
        return Ok(PathBuf::from(home.trim()).join(".fugit"));
    }
    if let Ok(profile) = std::env::var("USERPROFILE")
        && !profile.trim().is_empty()
    {
        return Ok(PathBuf::from(profile.trim()).join(".fugit"));
    }
    bail!("unable to resolve FUGIT_HOME; set FUGIT_HOME, HOME, or USERPROFILE")
}

fn fugit_projects_registry_path() -> Result<PathBuf> {
    Ok(resolve_fugit_home()?.join("projects.json"))
}

fn load_project_registry() -> Result<ProjectRegistry> {
    let path = fugit_projects_registry_path()?;
    let mut registry = load_json_optional::<ProjectRegistry>(&path)?.unwrap_or(ProjectRegistry {
        schema_version: SCHEMA_PROJECTS.to_string(),
        updated_at_utc: now_utc(),
        default_project: None,
        projects: Vec::new(),
    });
    if registry.schema_version.trim().is_empty() {
        registry.schema_version = SCHEMA_PROJECTS.to_string();
    }
    registry
        .projects
        .sort_by(|lhs, rhs| lhs.name.cmp(&rhs.name));
    Ok(registry)
}

fn write_project_registry(registry: &ProjectRegistry) -> Result<()> {
    let path = fugit_projects_registry_path()?;
    write_pretty_json(&path, registry)
}

fn validate_project_name(name: &str) -> Result<()> {
    if name.trim().is_empty() {
        bail!("project name cannot be empty");
    }
    for ch in name.chars() {
        let allowed = ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.');
        if !allowed {
            bail!(
                "project name '{}' contains unsupported character '{}': use [a-zA-Z0-9._-]",
                name,
                ch
            );
        }
    }
    Ok(())
}

fn collect_task_gui_projects(current_repo_root: &Path) -> Result<Vec<TaskGuiProject>> {
    let registry = load_project_registry()?;
    let current = current_repo_root.display().to_string();
    let default_project = registry.default_project.clone();
    let mut projects = Vec::<TaskGuiProject>::new();
    let mut seen_repo_roots = BTreeSet::<String>::new();
    for project in registry.projects {
        let is_current_repo = project.repo_root == current;
        seen_repo_roots.insert(project.repo_root.clone());
        projects.push(TaskGuiProject {
            key: project.name.clone(),
            name: project.name.clone(),
            repo_root: project.repo_root.clone(),
            is_default: default_project.as_deref() == Some(project.name.as_str()),
            is_current_repo,
        });
    }

    if !seen_repo_roots.contains(&current) {
        projects.push(TaskGuiProject {
            key: "@current".to_string(),
            name: "current".to_string(),
            repo_root: current,
            is_default: projects.is_empty(),
            is_current_repo: true,
        });
    }

    projects.sort_by(|lhs, rhs| lhs.name.cmp(&rhs.name));
    Ok(projects)
}

fn resolve_selected_task_gui_project<'a>(
    projects: &'a [TaskGuiProject],
    selector: Option<&str>,
) -> Option<&'a TaskGuiProject> {
    if projects.is_empty() {
        return None;
    }
    if let Some(token) = selector.map(str::trim).filter(|token| !token.is_empty()) {
        if let Some(project) = projects.iter().find(|project| project.key == token) {
            return Some(project);
        }
        if let Some(project) = projects.iter().find(|project| project.name == token) {
            return Some(project);
        }
    }
    if let Some(project) = projects.iter().find(|project| project.is_default) {
        return Some(project);
    }
    projects
        .iter()
        .find(|project| project.is_current_repo)
        .or_else(|| projects.first())
}

fn prune_expired_task_claims(state: &mut TaskState) -> Result<bool> {
    let mut changed = false;
    if state.schema_version != SCHEMA_TASKS {
        state.schema_version = SCHEMA_TASKS.to_string();
        changed = true;
    }

    let now = Utc::now();
    let now_text = format_utc(now);
    for task in &mut state.tasks {
        if task.status != TaskStatus::Claimed {
            continue;
        }
        if task_claim_is_expired(task, now) {
            task.status = TaskStatus::Open;
            task.updated_at_utc = now_text.clone();
            task.claimed_by_agent_id = None;
            task.claim_started_at_utc = None;
            task.claim_expires_at_utc = None;
            changed = true;
        }
    }
    if changed {
        state.updated_at_utc = now_text;
    }
    Ok(changed)
}

fn task_status_map(state: &TaskState) -> BTreeMap<String, TaskStatus> {
    let mut map = BTreeMap::<String, TaskStatus>::new();
    for task in &state.tasks {
        map.insert(task.task_id.clone(), task.status.clone());
    }
    map
}

fn task_blocked_by(task: &FugitTask, status_map: &BTreeMap<String, TaskStatus>) -> Vec<String> {
    let mut blocked_by = Vec::<String>::new();
    for dependency in &task.depends_on {
        match status_map.get(dependency) {
            Some(TaskStatus::Done) => {}
            _ => blocked_by.push(dependency.clone()),
        }
    }
    blocked_by
}

#[cfg(test)]
fn select_task_for_agent(
    state: &TaskState,
    agent_id: &str,
    filters: &TaskQueryFilter,
    allow_steal: bool,
    include_owned_claims: bool,
    steal_after_minutes: i64,
    now: DateTime<Utc>,
) -> Option<(usize, TaskDispatchKind)> {
    select_task_candidates_for_agent(
        state,
        agent_id,
        filters,
        allow_steal,
        include_owned_claims,
        steal_after_minutes,
        now,
        1,
    )
    .into_iter()
    .next()
}

fn select_task_candidates_for_agent(
    state: &TaskState,
    agent_id: &str,
    filters: &TaskQueryFilter,
    allow_steal: bool,
    include_owned_claims: bool,
    steal_after_minutes: i64,
    now: DateTime<Utc>,
    max: usize,
) -> Vec<(usize, TaskDispatchKind)> {
    if max == 0 {
        return Vec::new();
    }
    let status_map = task_status_map(state);
    let mut owned_claims = Vec::<usize>::new();
    let mut open_tasks = Vec::<usize>::new();
    let mut stealable_tasks = Vec::<usize>::new();

    for (idx, task) in state.tasks.iter().enumerate() {
        if task.status == TaskStatus::Done {
            continue;
        }
        if task_is_auto_replenish(task) {
            continue;
        }
        if !task_matches_query_filter(task, filters) {
            continue;
        }
        if !task_is_ready_for_dispatch(task, &status_map) {
            continue;
        }
        match task.status {
            TaskStatus::Open => open_tasks.push(idx),
            TaskStatus::Claimed => {
                if include_owned_claims && task.claimed_by_agent_id.as_deref() == Some(agent_id) {
                    owned_claims.push(idx);
                } else if allow_steal && task_claim_is_stale(task, now, steal_after_minutes) {
                    stealable_tasks.push(idx);
                }
            }
            TaskStatus::Done => {}
        }
    }

    sort_task_indices(state, &mut owned_claims);
    sort_task_indices(state, &mut open_tasks);
    sort_task_indices(state, &mut stealable_tasks);

    let mut out = Vec::<(usize, TaskDispatchKind)>::new();
    for idx in owned_claims {
        if out.len() >= max {
            return out;
        }
        out.push((idx, TaskDispatchKind::OwnedClaim));
    }
    for idx in open_tasks {
        if out.len() >= max {
            return out;
        }
        out.push((idx, TaskDispatchKind::Open));
    }
    for idx in stealable_tasks {
        if out.len() >= max {
            return out;
        }
        out.push((idx, TaskDispatchKind::Steal));
    }
    out
}

fn select_auto_replenish_candidates_for_agent(
    state: &TaskState,
    agent_id: &str,
    allow_steal: bool,
    include_owned_claims: bool,
    steal_after_minutes: i64,
    now: DateTime<Utc>,
    max: usize,
) -> Vec<(usize, TaskDispatchKind)> {
    if max == 0 {
        return Vec::new();
    }
    let status_map = task_status_map(state);
    let mut owned_claims = Vec::<usize>::new();
    let mut open_tasks = Vec::<usize>::new();
    let mut stealable_tasks = Vec::<usize>::new();

    for (idx, task) in state.tasks.iter().enumerate() {
        if !task_is_auto_replenish_for_agent(task, agent_id) {
            continue;
        }
        if !task_is_ready_for_dispatch(task, &status_map) {
            continue;
        }
        match task.status {
            TaskStatus::Open => open_tasks.push(idx),
            TaskStatus::Claimed => {
                if include_owned_claims && task.claimed_by_agent_id.as_deref() == Some(agent_id) {
                    owned_claims.push(idx);
                } else if allow_steal && task_claim_is_stale(task, now, steal_after_minutes) {
                    stealable_tasks.push(idx);
                }
            }
            TaskStatus::Done => {}
        }
    }

    sort_task_indices(state, &mut owned_claims);
    sort_task_indices(state, &mut open_tasks);
    sort_task_indices(state, &mut stealable_tasks);

    let mut out = Vec::<(usize, TaskDispatchKind)>::new();
    for idx in owned_claims {
        if out.len() >= max {
            return out;
        }
        out.push((idx, TaskDispatchKind::OwnedClaim));
    }
    for idx in open_tasks {
        if out.len() >= max {
            return out;
        }
        out.push((idx, TaskDispatchKind::Open));
    }
    for idx in stealable_tasks {
        if out.len() >= max {
            return out;
        }
        out.push((idx, TaskDispatchKind::Steal));
    }
    out
}

fn agent_has_available_standard_work(
    state: &TaskState,
    agent_id: &str,
    allow_steal: bool,
    steal_after_minutes: i64,
    now: DateTime<Utc>,
) -> bool {
    !select_task_candidates_for_agent(
        state,
        agent_id,
        &TaskQueryFilter::default(),
        allow_steal,
        true,
        steal_after_minutes,
        now,
        1,
    )
    .is_empty()
}

fn apply_task_claim(
    task: &mut FugitTask,
    agent_id: &str,
    claim_ttl_minutes: i64,
    now: DateTime<Utc>,
) {
    let now_text = format_utc(now);
    task.status = TaskStatus::Claimed;
    task.updated_at_utc = now_text.clone();
    task.claimed_by_agent_id = Some(agent_id.to_string());
    task.claim_started_at_utc = Some(now_text.clone());
    task.claim_expires_at_utc = if claim_ttl_minutes <= 0 {
        None
    } else {
        Some(format_utc(now + Duration::minutes(claim_ttl_minutes)))
    };
    task.completed_at_utc = None;
    task.completed_by_agent_id = None;
    task.completed_summary = None;
    task.completion_notes.clear();
    task.completion_artifacts.clear();
    task.completion_commands.clear();
}

fn task_claim_is_expired(task: &FugitTask, now: DateTime<Utc>) -> bool {
    if task.status != TaskStatus::Claimed {
        return false;
    }
    let Some(expires_at) = task.claim_expires_at_utc.as_deref() else {
        return false;
    };
    match parse_rfc3339_utc(expires_at) {
        Some(parsed) => parsed <= now,
        None => true,
    }
}

fn task_claim_is_stale(task: &FugitTask, now: DateTime<Utc>, steal_after_minutes: i64) -> bool {
    if task_claim_is_expired(task, now) {
        return true;
    }
    let stale_window = steal_after_minutes.max(0);
    let Some(started_at) = task
        .claim_started_at_utc
        .as_deref()
        .and_then(parse_rfc3339_utc)
    else {
        return true;
    };
    started_at + Duration::minutes(stale_window) <= now
}

fn sort_task_indices(state: &TaskState, indices: &mut [usize]) {
    indices.sort_by(|lhs, rhs| {
        let left = &state.tasks[*lhs];
        let right = &state.tasks[*rhs];
        right
            .priority
            .cmp(&left.priority)
            .then_with(|| compare_timestamp_text(&left.created_at_utc, &right.created_at_utc))
            .then_with(|| left.task_id.cmp(&right.task_id))
    });
}

fn compare_timestamp_text(left: &str, right: &str) -> Ordering {
    let left_parsed = parse_rfc3339_utc(left);
    let right_parsed = parse_rfc3339_utc(right);
    match (left_parsed, right_parsed) {
        (Some(a), Some(b)) => a.cmp(&b),
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => left.cmp(right),
    }
}

fn parse_rfc3339_utc(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|parsed| parsed.with_timezone(&Utc))
}

fn scan_repo(
    repo_root: &Path,
    previous_index: Option<&BTreeMap<String, FileRecord>>,
    strict_hash: bool,
    hash_jobs: usize,
) -> Result<BTreeMap<String, FileRecord>> {
    let mut index = BTreeMap::<String, FileRecord>::new();
    let mut files_to_hash = Vec::<(String, PathBuf, u64, u64)>::new();
    let ignore_matcher = build_ignore_matcher(repo_root)?;

    let walker = WalkDir::new(repo_root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| should_descend(repo_root, entry.path(), &ignore_matcher));

    for entry in walker {
        let entry = entry.with_context(|| "failed walking repo tree")?;
        if entry.file_type().is_dir() {
            continue;
        }

        let abs_path = entry.path();
        if !abs_path.is_file() {
            continue;
        }

        let rel_path = abs_path
            .strip_prefix(repo_root)
            .with_context(|| format!("failed strip-prefix for {}", abs_path.display()))?;
        let rel_norm = normalize_relpath(rel_path);
        if rel_norm.is_empty() {
            continue;
        }
        if ignore_matcher.matched(rel_path, false).is_ignore() {
            continue;
        }

        let metadata = fs::metadata(abs_path)
            .with_context(|| format!("failed reading metadata {}", abs_path.display()))?;
        let size_bytes = metadata.len();
        let modified_unix_secs = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs())
            .unwrap_or(0);

        if !strict_hash
            && let Some(prev) = previous_index.and_then(|rows| rows.get(&rel_norm))
            && prev.size_bytes == size_bytes
            && prev.modified_unix_secs == modified_unix_secs
        {
            index.insert(
                rel_norm,
                FileRecord {
                    schema_version: SCHEMA_FILE_RECORD.to_string(),
                    hash: prev.hash.clone(),
                    size_bytes,
                    modified_unix_secs,
                },
            );
            continue;
        }

        files_to_hash.push((
            rel_norm,
            abs_path.to_path_buf(),
            size_bytes,
            modified_unix_secs,
        ));
    }

    if hash_jobs <= 1 || files_to_hash.len() <= 1 {
        for (rel_norm, abs_path, size_bytes, modified_unix_secs) in files_to_hash {
            index.insert(
                rel_norm,
                FileRecord {
                    schema_version: SCHEMA_FILE_RECORD.to_string(),
                    hash: hash_file(&abs_path)?,
                    size_bytes,
                    modified_unix_secs,
                },
            );
        }
    } else {
        let parallel_jobs = hash_jobs.min(files_to_hash.len());
        let pool = rayon::ThreadPoolBuilder::new()
            .num_threads(parallel_jobs)
            .build()
            .with_context(|| format!("failed building hash thread pool ({parallel_jobs})"))?;
        let hashed_rows: Result<Vec<(String, FileRecord)>> = pool.install(|| {
            files_to_hash
                .into_par_iter()
                .map(
                    |(rel_norm, abs_path, size_bytes, modified_unix_secs)| -> Result<(String, FileRecord)> {
                        let hash = hash_file(&abs_path)?;
                        Ok((
                            rel_norm,
                            FileRecord {
                                schema_version: SCHEMA_FILE_RECORD.to_string(),
                                hash,
                                size_bytes,
                                modified_unix_secs,
                            },
                        ))
                    },
                )
                .collect()
        });
        for (rel_norm, row) in hashed_rows? {
            index.insert(rel_norm, row);
        }
    }

    Ok(index)
}

fn diff_indexes(
    old_index: &BTreeMap<String, FileRecord>,
    new_index: &BTreeMap<String, FileRecord>,
) -> Vec<ChangeRecord> {
    let keys = old_index
        .keys()
        .chain(new_index.keys())
        .cloned()
        .collect::<BTreeSet<_>>();

    let mut changes = Vec::<ChangeRecord>::new();

    for key in keys {
        let old = old_index.get(&key);
        let new = new_index.get(&key);
        match (old, new) {
            (None, Some(new_row)) => changes.push(ChangeRecord {
                path: key,
                kind: ChangeKind::Added,
                old_hash: None,
                new_hash: Some(new_row.hash.clone()),
                old_size_bytes: None,
                new_size_bytes: Some(new_row.size_bytes),
            }),
            (Some(old_row), None) => changes.push(ChangeRecord {
                path: key,
                kind: ChangeKind::Deleted,
                old_hash: Some(old_row.hash.clone()),
                new_hash: None,
                old_size_bytes: Some(old_row.size_bytes),
                new_size_bytes: None,
            }),
            (Some(old_row), Some(new_row)) if old_row.hash != new_row.hash => {
                changes.push(ChangeRecord {
                    path: key,
                    kind: ChangeKind::Modified,
                    old_hash: Some(old_row.hash.clone()),
                    new_hash: Some(new_row.hash.clone()),
                    old_size_bytes: Some(old_row.size_bytes),
                    new_size_bytes: Some(new_row.size_bytes),
                })
            }
            _ => {}
        }
    }

    changes
}

fn hash_file(path: &Path) -> Result<String> {
    let mut file = fs::File::open(path)
        .with_context(|| format!("failed opening file for hashing {}", path.display()))?;
    let mut buffer = [0_u8; 16 * 1024];
    let mut hasher = Sha256::new();

    loop {
        let read = file
            .read(&mut buffer)
            .with_context(|| format!("failed reading file for hashing {}", path.display()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

fn hash_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn build_ignore_matcher(repo_root: &Path) -> Result<Gitignore> {
    let mut builder = GitignoreBuilder::new(repo_root);
    let root_gitignore = repo_root.join(".gitignore");
    if root_gitignore.exists() {
        builder.add(root_gitignore);
    }
    let root_fugitignore = repo_root.join(".fugitignore");
    if root_fugitignore.exists() {
        builder.add(root_fugitignore);
    }
    let git_info_exclude = repo_root.join(".git").join("info").join("exclude");
    if git_info_exclude.exists() {
        builder.add(git_info_exclude);
    }
    builder
        .build()
        .with_context(|| format!("failed building ignore matcher for {}", repo_root.display()))
}

fn should_descend(repo_root: &Path, path: &Path, ignore_matcher: &Gitignore) -> bool {
    if path == repo_root {
        return true;
    }
    let Ok(rel) = path.strip_prefix(repo_root) else {
        return false;
    };
    let mut components = rel.components();
    let Some(first) = components.next() else {
        return false;
    };
    let first = first.as_os_str().to_string_lossy().to_string();
    if IGNORE_ROOT_ENTRIES.iter().any(|entry| *entry == first) {
        return false;
    }
    !ignore_matcher.matched(rel, true).is_ignore()
}

fn normalize_relpath(path: &Path) -> String {
    let mut out = Vec::<String>::new();
    for component in path.components() {
        let token = component.as_os_str().to_string_lossy().trim().to_string();
        if token.is_empty() || token == "." {
            continue;
        }
        out.push(token);
    }
    out.join("/")
}

fn normalize_user_path(path: &str) -> String {
    let replaced = path.replace('\\', "/");
    let tokens = replaced
        .split('/')
        .filter(|token| !token.trim().is_empty() && *token != ".")
        .map(|token| token.trim().to_string())
        .collect::<Vec<_>>();
    tokens.join("/")
}

fn validate_branch_name(name: &str) -> Result<()> {
    if name.trim().is_empty() {
        bail!("branch name cannot be empty");
    }
    if name.starts_with('/') || name.ends_with('/') {
        bail!("branch name cannot start or end with '/'");
    }
    if name.contains("..") {
        bail!("branch name cannot contain '..'");
    }
    if name.contains("//") {
        bail!("branch name cannot contain empty path segments");
    }

    for ch in name.chars() {
        let allowed = ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | '/');
        if !allowed {
            bail!(
                "branch name '{}' contains unsupported character '{}': use [a-zA-Z0-9._/-]",
                name,
                ch
            );
        }
    }
    Ok(())
}

fn default_agent_id() -> String {
    if let Ok(token) = std::env::var("FUGIT_AGENT_ID")
        && !token.trim().is_empty()
    {
        return token.trim().to_string();
    }
    if let Ok(token) = std::env::var("AGENT_ID")
        && !token.trim().is_empty()
    {
        return token.trim().to_string();
    }
    if let Ok(token) = std::env::var("USER")
        && !token.trim().is_empty()
    {
        return token.trim().to_string();
    }
    "agent.unknown".to_string()
}

fn dedupe_keep_order(values: Vec<String>) -> Vec<String> {
    let mut seen = BTreeSet::<String>::new();
    let mut out = Vec::<String>::new();
    for value in values {
        let token = value.trim().to_string();
        if token.is_empty() {
            continue;
        }
        if seen.insert(token.clone()) {
            out.push(token);
        }
    }
    out
}

fn resolve_repo_root(path: &Path) -> Result<PathBuf> {
    let root = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .with_context(|| "failed reading current directory")?
            .join(path)
    };

    if !root.exists() {
        bail!("repo root does not exist: {}", root.display());
    }

    root.canonicalize()
        .with_context(|| format!("failed canonicalizing {}", root.display()))
}

fn now_utc() -> String {
    Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

fn format_utc(value: DateTime<Utc>) -> String {
    value.format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

fn default_backend_mode() -> String {
    BACKEND_MODE_GIT_BRIDGE.to_string()
}

fn default_auto_bridge_sync_enabled() -> bool {
    true
}

fn default_auto_bridge_sync_on_task_done() -> bool {
    true
}

fn default_auto_bridge_sync_event_count() -> usize {
    12
}

fn default_auto_bridge_sync_no_push() -> bool {
    false
}

fn default_auto_replenish_enabled() -> bool {
    true
}

fn default_auto_replenish_require_confirmation() -> bool {
    false
}

fn timeline_is_initialized(repo_root: &Path) -> bool {
    timeline_config_path(repo_root).exists() && timeline_branches_path(repo_root).exists()
}

fn write_pretty_json<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed creating {}", parent.display()))?;
    }
    let bytes = serde_json::to_vec_pretty(value)
        .with_context(|| format!("failed serializing {}", path.display()))?;
    fs::write(path, bytes).with_context(|| format!("failed writing {}", path.display()))
}

fn load_json_optional<T: DeserializeOwned>(path: &Path) -> Result<Option<T>> {
    if !path.exists() {
        return Ok(None);
    }
    let bytes = fs::read(path).with_context(|| format!("failed reading {}", path.display()))?;
    let value = serde_json::from_slice::<T>(&bytes)
        .with_context(|| format!("invalid json {}", path.display()))?;
    Ok(Some(value))
}

fn timeline_root(repo_root: &Path) -> PathBuf {
    repo_root.join(TIMELINE_ROOT_DIR)
}

fn timeline_config_path(repo_root: &Path) -> PathBuf {
    timeline_root(repo_root).join("config.json")
}

fn timeline_branches_path(repo_root: &Path) -> PathBuf {
    timeline_root(repo_root).join("branches.json")
}

fn timeline_objects_dir(repo_root: &Path) -> PathBuf {
    timeline_root(repo_root).join("objects")
}

fn timeline_locks_path(repo_root: &Path) -> PathBuf {
    timeline_root(repo_root).join("locks.json")
}

fn timeline_tasks_path(repo_root: &Path) -> PathBuf {
    timeline_root(repo_root).join("tasks.json")
}

fn timeline_bridge_auth_path(repo_root: &Path) -> PathBuf {
    timeline_root(repo_root).join("bridge_auth.json")
}

fn timeline_bridge_auto_sync_state_path(repo_root: &Path) -> PathBuf {
    timeline_root(repo_root).join("bridge_auto_sync.json")
}

fn timeline_bridge_auto_sync_lock_path(repo_root: &Path) -> PathBuf {
    timeline_root(repo_root).join("bridge_auto_sync.lock.json")
}

fn timeline_branch_root(repo_root: &Path, branch: &str) -> PathBuf {
    timeline_root(repo_root).join("branches").join(branch)
}

fn timeline_branch_events_path(repo_root: &Path, branch: &str) -> PathBuf {
    timeline_branch_root(repo_root, branch).join("events.jsonl")
}

fn timeline_branch_index_path(repo_root: &Path, branch: &str) -> PathBuf {
    timeline_branch_root(repo_root, branch).join("index.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestRepo {
        root: PathBuf,
    }

    impl TestRepo {
        fn new(label: &str) -> Self {
            let root = std::env::temp_dir().join(format!("fugit-{label}-{}", Uuid::new_v4()));
            fs::create_dir_all(&root).expect("create temp repo root");
            Self { root }
        }

        fn path(&self) -> &Path {
            &self.root
        }

        fn write_file(&self, rel_path: &str, contents: &str) {
            let path = self.root.join(rel_path);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).expect("create parent dirs");
            }
            fs::write(path, contents).expect("write file");
        }

        fn git(&self, args: &[&str]) -> String {
            let output = ProcessCommand::new("git")
                .current_dir(&self.root)
                .args(args)
                .output()
                .expect("run git");
            assert!(
                output.status.success(),
                "git {:?} failed\nstdout: {}\nstderr: {}",
                args,
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            String::from_utf8_lossy(&output.stdout).trim().to_string()
        }
    }

    impl Drop for TestRepo {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn sample_task(task_id: &str, title: &str, priority: i32, status: TaskStatus) -> FugitTask {
        FugitTask {
            task_id: task_id.to_string(),
            title: title.to_string(),
            detail: None,
            priority,
            tags: vec![],
            depends_on: vec![],
            status,
            created_at_utc: now_utc(),
            updated_at_utc: now_utc(),
            created_by_agent_id: "agent.seed".to_string(),
            claimed_by_agent_id: None,
            claim_started_at_utc: None,
            claim_expires_at_utc: None,
            completed_at_utc: None,
            completed_by_agent_id: None,
            completed_summary: None,
            completion_notes: Vec::new(),
            completion_artifacts: Vec::new(),
            completion_commands: Vec::new(),
            source_key: None,
            source_plan: None,
            awaiting_confirmation: false,
            approved_at_utc: None,
            approved_by_agent_id: None,
        }
    }

    #[test]
    fn normalize_user_path_collapses_tokens() {
        let raw = "./src//core\\utils/../index.rs";
        let normalized = normalize_user_path(raw);
        assert_eq!(normalized, "src/core/utils/../index.rs");
    }

    #[test]
    fn parse_git_host_handles_https_and_ssh_forms() {
        assert_eq!(
            parse_git_host("https://github.com/org/repo.git").as_deref(),
            Some("github.com")
        );
        assert_eq!(
            parse_git_host("git@github.com:org/repo.git").as_deref(),
            Some("github.com")
        );
        assert_eq!(
            parse_git_host("ssh://git@internal.example.com:2222/team/repo.git").as_deref(),
            Some("internal.example.com")
        );
    }

    #[test]
    fn parse_git_credential_output_extracts_username_and_password() {
        let raw = "protocol=https\nhost=github.com\nusername=x-access-token\npassword=abc123\n";
        let parsed = parse_git_credential_output(raw).expect("expected parsed credentials");
        assert_eq!(parsed.username.as_deref(), Some("x-access-token"));
        assert_eq!(parsed.password.as_deref(), Some("abc123"));
    }

    #[test]
    fn resolve_parallel_jobs_defaults_and_requested_values() {
        assert_eq!(resolve_parallel_jobs(None, false), 1);
        assert_eq!(resolve_parallel_jobs(Some(4), false), 4);
        assert_eq!(resolve_parallel_jobs(Some(0), false), 1);
        assert!(resolve_parallel_jobs(None, true) >= 1);
    }

    #[test]
    fn lock_pattern_match_supports_glob_and_prefix_paths() {
        assert!(lock_pattern_matches_path("src/**", "src/main.rs"));
        assert!(lock_pattern_matches_path("docs", "docs/plan.md"));
        assert!(!lock_pattern_matches_path("docs/**", "src/docs/plan.md"));
    }

    #[test]
    fn task_blockers_clear_when_dependencies_are_done() {
        let mut state = TaskState {
            schema_version: SCHEMA_TASKS.to_string(),
            updated_at_utc: now_utc(),
            tasks: vec![
                FugitTask {
                    task_id: "task_dep".to_string(),
                    title: "dependency".to_string(),
                    detail: None,
                    priority: 0,
                    tags: vec![],
                    depends_on: vec![],
                    status: TaskStatus::Open,
                    created_at_utc: now_utc(),
                    updated_at_utc: now_utc(),
                    created_by_agent_id: "agent.a".to_string(),
                    claimed_by_agent_id: None,
                    claim_started_at_utc: None,
                    claim_expires_at_utc: None,
                    completed_at_utc: None,
                    completed_by_agent_id: None,
                    completed_summary: None,
                    completion_notes: Vec::new(),
                    completion_artifacts: Vec::new(),
                    completion_commands: Vec::new(),
                    source_key: None,
                    source_plan: None,
                    awaiting_confirmation: false,
                    approved_at_utc: None,
                    approved_by_agent_id: None,
                },
                FugitTask {
                    task_id: "task_child".to_string(),
                    title: "child".to_string(),
                    detail: None,
                    priority: 1,
                    tags: vec![],
                    depends_on: vec!["task_dep".to_string()],
                    status: TaskStatus::Open,
                    created_at_utc: now_utc(),
                    updated_at_utc: now_utc(),
                    created_by_agent_id: "agent.a".to_string(),
                    claimed_by_agent_id: None,
                    claim_started_at_utc: None,
                    claim_expires_at_utc: None,
                    completed_at_utc: None,
                    completed_by_agent_id: None,
                    completed_summary: None,
                    completion_notes: Vec::new(),
                    completion_artifacts: Vec::new(),
                    completion_commands: Vec::new(),
                    source_key: None,
                    source_plan: None,
                    awaiting_confirmation: false,
                    approved_at_utc: None,
                    approved_by_agent_id: None,
                },
            ],
        };

        let status_map = task_status_map(&state);
        assert_eq!(
            task_blocked_by(&state.tasks[1], &status_map),
            vec!["task_dep".to_string()]
        );

        state.tasks[0].status = TaskStatus::Done;
        let status_map = task_status_map(&state);
        assert!(task_blocked_by(&state.tasks[1], &status_map).is_empty());
    }

    #[test]
    fn task_request_prefers_ready_high_priority_tasks() {
        let state = TaskState {
            schema_version: SCHEMA_TASKS.to_string(),
            updated_at_utc: now_utc(),
            tasks: vec![
                FugitTask {
                    task_id: "task_dep_done".to_string(),
                    title: "dep done".to_string(),
                    detail: None,
                    priority: 0,
                    tags: vec![],
                    depends_on: vec![],
                    status: TaskStatus::Done,
                    created_at_utc: "2026-03-01T00:00:00Z".to_string(),
                    updated_at_utc: now_utc(),
                    created_by_agent_id: "agent.a".to_string(),
                    claimed_by_agent_id: None,
                    claim_started_at_utc: None,
                    claim_expires_at_utc: None,
                    completed_at_utc: Some(now_utc()),
                    completed_by_agent_id: Some("agent.a".to_string()),
                    completed_summary: None,
                    completion_notes: Vec::new(),
                    completion_artifacts: Vec::new(),
                    completion_commands: Vec::new(),
                    source_key: None,
                    source_plan: None,
                    awaiting_confirmation: false,
                    approved_at_utc: None,
                    approved_by_agent_id: None,
                },
                FugitTask {
                    task_id: "task_simple".to_string(),
                    title: "simple".to_string(),
                    detail: None,
                    priority: 2,
                    tags: vec!["ui".to_string()],
                    depends_on: vec![],
                    status: TaskStatus::Open,
                    created_at_utc: "2026-03-02T00:00:00Z".to_string(),
                    updated_at_utc: now_utc(),
                    created_by_agent_id: "agent.a".to_string(),
                    claimed_by_agent_id: None,
                    claim_started_at_utc: None,
                    claim_expires_at_utc: None,
                    completed_at_utc: None,
                    completed_by_agent_id: None,
                    completed_summary: None,
                    completion_notes: Vec::new(),
                    completion_artifacts: Vec::new(),
                    completion_commands: Vec::new(),
                    source_key: None,
                    source_plan: None,
                    awaiting_confirmation: false,
                    approved_at_utc: None,
                    approved_by_agent_id: None,
                },
                FugitTask {
                    task_id: "task_priority_ready".to_string(),
                    title: "priority ready".to_string(),
                    detail: None,
                    priority: 10,
                    tags: vec!["ui".to_string()],
                    depends_on: vec!["task_dep_done".to_string()],
                    status: TaskStatus::Open,
                    created_at_utc: "2026-03-03T00:00:00Z".to_string(),
                    updated_at_utc: now_utc(),
                    created_by_agent_id: "agent.a".to_string(),
                    claimed_by_agent_id: None,
                    claim_started_at_utc: None,
                    claim_expires_at_utc: None,
                    completed_at_utc: None,
                    completed_by_agent_id: None,
                    completed_summary: None,
                    completion_notes: Vec::new(),
                    completion_artifacts: Vec::new(),
                    completion_commands: Vec::new(),
                    source_key: None,
                    source_plan: None,
                    awaiting_confirmation: false,
                    approved_at_utc: None,
                    approved_by_agent_id: None,
                },
                FugitTask {
                    task_id: "task_blocked".to_string(),
                    title: "blocked".to_string(),
                    detail: None,
                    priority: 100,
                    tags: vec!["ui".to_string()],
                    depends_on: vec!["task_simple".to_string()],
                    status: TaskStatus::Open,
                    created_at_utc: "2026-03-01T00:00:00Z".to_string(),
                    updated_at_utc: now_utc(),
                    created_by_agent_id: "agent.a".to_string(),
                    claimed_by_agent_id: None,
                    claim_started_at_utc: None,
                    claim_expires_at_utc: None,
                    completed_at_utc: None,
                    completed_by_agent_id: None,
                    completed_summary: None,
                    completion_notes: Vec::new(),
                    completion_artifacts: Vec::new(),
                    completion_commands: Vec::new(),
                    source_key: None,
                    source_plan: None,
                    awaiting_confirmation: false,
                    approved_at_utc: None,
                    approved_by_agent_id: None,
                },
            ],
        };

        let selected = select_task_for_agent(
            &state,
            "agent.worker",
            &TaskQueryFilter {
                required_tags: vec!["ui".to_string()],
                ..Default::default()
            },
            true,
            true,
            90,
            Utc::now(),
        );
        let (idx, dispatch_kind) = selected.expect("expected selected task");
        assert_eq!(dispatch_kind, TaskDispatchKind::Open);
        assert_eq!(state.tasks[idx].task_id, "task_priority_ready");
    }

    #[test]
    fn task_request_can_steal_stale_claims() {
        let now = Utc::now();
        let state = TaskState {
            schema_version: SCHEMA_TASKS.to_string(),
            updated_at_utc: now_utc(),
            tasks: vec![FugitTask {
                task_id: "task_claimed".to_string(),
                title: "claimed".to_string(),
                detail: None,
                priority: 5,
                tags: vec![],
                depends_on: vec![],
                status: TaskStatus::Claimed,
                created_at_utc: "2026-03-01T00:00:00Z".to_string(),
                updated_at_utc: now_utc(),
                created_by_agent_id: "agent.a".to_string(),
                claimed_by_agent_id: Some("agent.other".to_string()),
                claim_started_at_utc: Some(format_utc(now - Duration::minutes(60))),
                claim_expires_at_utc: None,
                completed_at_utc: None,
                completed_by_agent_id: None,
                completed_summary: None,
                completion_notes: Vec::new(),
                completion_artifacts: Vec::new(),
                completion_commands: Vec::new(),
                source_key: None,
                source_plan: None,
                awaiting_confirmation: false,
                approved_at_utc: None,
                approved_by_agent_id: None,
            }],
        };

        let selection = select_task_for_agent(
            &state,
            "agent.worker",
            &TaskQueryFilter::default(),
            true,
            true,
            30,
            now,
        )
        .expect("expected steal candidate");
        assert_eq!(selection.1, TaskDispatchKind::Steal);
        assert_eq!(state.tasks[selection.0].task_id, "task_claimed");

        let blocked = select_task_for_agent(
            &state,
            "agent.worker",
            &TaskQueryFilter::default(),
            false,
            true,
            30,
            now,
        );
        assert!(blocked.is_none());
    }

    #[test]
    fn task_request_can_skip_owned_claims() {
        let now = Utc::now();
        let state = TaskState {
            schema_version: SCHEMA_TASKS.to_string(),
            updated_at_utc: now_utc(),
            tasks: vec![
                FugitTask {
                    task_id: "task_owned".to_string(),
                    title: "owned".to_string(),
                    detail: None,
                    priority: 100,
                    tags: vec![],
                    depends_on: vec![],
                    status: TaskStatus::Claimed,
                    created_at_utc: "2026-03-01T00:00:00Z".to_string(),
                    updated_at_utc: now_utc(),
                    created_by_agent_id: "agent.a".to_string(),
                    claimed_by_agent_id: Some("agent.worker".to_string()),
                    claim_started_at_utc: Some(format_utc(now - Duration::minutes(10))),
                    claim_expires_at_utc: Some(format_utc(now + Duration::minutes(20))),
                    completed_at_utc: None,
                    completed_by_agent_id: None,
                    completed_summary: None,
                    completion_notes: Vec::new(),
                    completion_artifacts: Vec::new(),
                    completion_commands: Vec::new(),
                    source_key: None,
                    source_plan: None,
                    awaiting_confirmation: false,
                    approved_at_utc: None,
                    approved_by_agent_id: None,
                },
                FugitTask {
                    task_id: "task_open".to_string(),
                    title: "open".to_string(),
                    detail: None,
                    priority: 5,
                    tags: vec![],
                    depends_on: vec![],
                    status: TaskStatus::Open,
                    created_at_utc: "2026-03-02T00:00:00Z".to_string(),
                    updated_at_utc: now_utc(),
                    created_by_agent_id: "agent.a".to_string(),
                    claimed_by_agent_id: None,
                    claim_started_at_utc: None,
                    claim_expires_at_utc: None,
                    completed_at_utc: None,
                    completed_by_agent_id: None,
                    completed_summary: None,
                    completion_notes: Vec::new(),
                    completion_artifacts: Vec::new(),
                    completion_commands: Vec::new(),
                    source_key: None,
                    source_plan: None,
                    awaiting_confirmation: false,
                    approved_at_utc: None,
                    approved_by_agent_id: None,
                },
            ],
        };

        let owned = select_task_for_agent(
            &state,
            "agent.worker",
            &TaskQueryFilter::default(),
            true,
            true,
            90,
            now,
        )
        .expect("expected owned claim");
        assert_eq!(owned.1, TaskDispatchKind::OwnedClaim);
        assert_eq!(state.tasks[owned.0].task_id, "task_owned");

        let skipped = select_task_for_agent(
            &state,
            "agent.worker",
            &TaskQueryFilter::default(),
            true,
            false,
            90,
            now,
        )
        .expect("expected open task when skipping owned");
        assert_eq!(skipped.1, TaskDispatchKind::Open);
        assert_eq!(state.tasks[skipped.0].task_id, "task_open");
    }

    #[test]
    fn standard_selection_ignores_auto_replenish_tasks() {
        let now = Utc::now();
        let mut auto_task = build_auto_replenish_task("agent.worker", false);
        apply_task_claim(&mut auto_task, "agent.worker", 30, now);
        let state = TaskState {
            schema_version: SCHEMA_TASKS.to_string(),
            updated_at_utc: now_utc(),
            tasks: vec![
                auto_task,
                sample_task("task_real", "real work", 5, TaskStatus::Open),
            ],
        };

        let selected = select_task_for_agent(
            &state,
            "agent.worker",
            &TaskQueryFilter::default(),
            true,
            true,
            90,
            now,
        )
        .expect("expected normal task");
        assert_eq!(selected.1, TaskDispatchKind::Open);
        assert_eq!(state.tasks[selected.0].task_id, "task_real");
    }

    #[test]
    fn ensure_auto_replenish_creates_agent_scout_tasks() {
        let mut state = TaskState {
            schema_version: SCHEMA_TASKS.to_string(),
            updated_at_utc: now_utc(),
            tasks: vec![],
        };
        let config = TimelineConfig {
            schema_version: SCHEMA_CONFIG.to_string(),
            repo_root: ".".to_string(),
            created_at_utc: now_utc(),
            updated_at_utc: now_utc(),
            backend_mode: default_backend_mode(),
            default_bridge_remote: "origin".to_string(),
            default_bridge_branch: "main".to_string(),
            cloud_endpoint: None,
            storage_namespace: None,
            billing_account_id: None,
            auto_bridge_sync_enabled: true,
            auto_bridge_sync_on_task_done: true,
            auto_bridge_sync_event_count: 12,
            auto_bridge_sync_no_push: false,
            auto_replenish_enabled: true,
            auto_replenish_require_confirmation: true,
            auto_replenish_agents: vec!["agent.alpha".to_string(), "agent.beta".to_string()],
        };

        let result = ensure_auto_replenish_tasks(&mut state, &config, "agent.alpha");
        assert_eq!(result.created_task_ids.len(), 2);
        assert_eq!(result.pending_confirmation_task_ids.len(), 2);
        assert_eq!(state.tasks.len(), 2);
        assert!(state.tasks.iter().all(|task| task.awaiting_confirmation));
        assert!(
            state
                .tasks
                .iter()
                .all(|task| task.source_plan.as_deref() == Some(AUTO_REPLENISH_SOURCE_PLAN))
        );
    }

    #[test]
    fn approve_tasks_in_state_clears_confirmation_gate() {
        let mut state = TaskState {
            schema_version: SCHEMA_TASKS.to_string(),
            updated_at_utc: now_utc(),
            tasks: vec![build_auto_replenish_task("agent.worker", true)],
        };
        let task_id = state.tasks[0].task_id.clone();

        let approved =
            approve_tasks_in_state(&mut state, Some(task_id.as_str()), false, "agent.reviewer")
                .expect("approve task");
        assert_eq!(approved.len(), 1);
        assert!(!state.tasks[0].awaiting_confirmation);
        assert_eq!(
            state.tasks[0].approved_by_agent_id.as_deref(),
            Some("agent.reviewer")
        );
    }

    #[test]
    fn task_gui_url_maps_wildcard_host_for_browser() {
        assert_eq!(task_gui_url("0.0.0.0", 7788, None), "http://127.0.0.1:7788");
        assert_eq!(
            task_gui_url("127.0.0.1", 7788, None),
            "http://127.0.0.1:7788"
        );
        assert_eq!(
            task_gui_url("127.0.0.1", 7788, Some("proj-a")),
            "http://127.0.0.1:7788/?project=proj-a"
        );
    }

    #[test]
    fn collect_missing_timeline_objects_reports_missing_branch_index_blobs() {
        let repo = TestRepo::new("doctor-missing-objects");
        repo.git(&["init"]);
        repo.git(&["config", "user.name", "Fugit Test"]);
        repo.git(&["config", "user.email", "fugit-test@example.com"]);
        repo.write_file("tracked.txt", "alpha\n");
        repo.git(&["add", "."]);
        repo.git(&["commit", "-m", "baseline"]);

        cmd_init(
            repo.path(),
            InitArgs {
                branch: "trunk".to_string(),
                bridge_branch: None,
                bridge_remote: "origin".to_string(),
            },
        )
        .expect("init timeline");

        let index = load_branch_index(repo.path(), "trunk").expect("load branch index");
        let tracked = index.get("tracked.txt").expect("tracked row");
        let object_path = timeline_objects_dir(repo.path()).join(&tracked.hash);
        fs::remove_file(&object_path).expect("remove stored object");

        let missing = collect_missing_timeline_objects(repo.path()).expect("collect missing");
        assert!(
            missing
                .iter()
                .any(|row| row.contains("index:trunk:tracked.txt") && row.contains(&tracked.hash)),
            "expected branch index object to be reported missing: {:?}",
            missing
        );
    }

    #[test]
    fn checkpoint_repairs_missing_old_objects_from_git_history() {
        let repo = TestRepo::new("checkpoint-repair");
        repo.git(&["init"]);
        repo.git(&["config", "user.name", "Fugit Test"]);
        repo.git(&["config", "user.email", "fugit-test@example.com"]);
        repo.write_file("tracked.txt", "alpha\n");
        repo.git(&["add", "."]);
        repo.git(&["commit", "-m", "baseline"]);

        cmd_init(
            repo.path(),
            InitArgs {
                branch: "trunk".to_string(),
                bridge_branch: None,
                bridge_remote: "origin".to_string(),
            },
        )
        .expect("init timeline");

        let index = load_branch_index(repo.path(), "trunk").expect("load branch index");
        let tracked = index.get("tracked.txt").expect("tracked row");
        let object_path = timeline_objects_dir(repo.path()).join(&tracked.hash);
        fs::remove_file(&object_path).expect("remove stored object");

        repo.write_file("tracked.txt", "beta\n");

        cmd_checkpoint(
            repo.path(),
            CheckpointArgs {
                summary: "repair missing old object".to_string(),
                agent: Some("test.agent".to_string()),
                tags: vec![],
                files: vec![],
                strict_hash: true,
                ignore_locks: false,
                hash_jobs: None,
                object_jobs: None,
                burst: false,
                repair: CheckpointRepairModeArg::Auto,
                allow_lossy_repair: false,
                json: false,
            },
        )
        .expect("checkpoint succeeds after git-backed repair");

        assert!(
            object_path.exists(),
            "expected missing object to be restored from git history"
        );
    }

    #[test]
    fn checkpoint_can_continue_with_explicit_lossy_repair_for_timeline_only_blobs() {
        let repo = TestRepo::new("checkpoint-lossy-repair");
        repo.git(&["init"]);
        repo.git(&["config", "user.name", "Fugit Test"]);
        repo.git(&["config", "user.email", "fugit-test@example.com"]);
        repo.write_file("tracked.txt", "alpha\n");
        repo.git(&["add", "."]);
        repo.git(&["commit", "-m", "baseline"]);

        cmd_init(
            repo.path(),
            InitArgs {
                branch: "trunk".to_string(),
                bridge_branch: None,
                bridge_remote: "origin".to_string(),
            },
        )
        .expect("init timeline");

        repo.write_file("tracked.txt", "beta\n");
        cmd_checkpoint(
            repo.path(),
            CheckpointArgs {
                summary: "beta checkpoint".to_string(),
                agent: Some("test.agent".to_string()),
                tags: vec![],
                files: vec![],
                strict_hash: true,
                ignore_locks: false,
                hash_jobs: None,
                object_jobs: None,
                burst: false,
                repair: CheckpointRepairModeArg::Auto,
                allow_lossy_repair: false,
                json: false,
            },
        )
        .expect("beta checkpoint");

        let beta_hash = load_branch_index(repo.path(), "trunk")
            .expect("load branch index")
            .get("tracked.txt")
            .expect("tracked row")
            .hash
            .clone();
        fs::remove_file(timeline_objects_dir(repo.path()).join(&beta_hash))
            .expect("remove beta object");

        repo.write_file("tracked.txt", "gamma\n");

        let strict_err = cmd_checkpoint(
            repo.path(),
            CheckpointArgs {
                summary: "gamma strict".to_string(),
                agent: Some("test.agent".to_string()),
                tags: vec![],
                files: vec![],
                strict_hash: true,
                ignore_locks: false,
                hash_jobs: None,
                object_jobs: None,
                burst: false,
                repair: CheckpointRepairModeArg::Auto,
                allow_lossy_repair: false,
                json: false,
            },
        )
        .expect_err("strict checkpoint should fail when timeline-only blob is missing");
        assert!(
            strict_err.to_string().contains("--repair lossy"),
            "expected lossy repair hint, got: {strict_err:#}"
        );

        cmd_checkpoint(
            repo.path(),
            CheckpointArgs {
                summary: "gamma lossy".to_string(),
                agent: Some("test.agent".to_string()),
                tags: vec![],
                files: vec![],
                strict_hash: true,
                ignore_locks: false,
                hash_jobs: None,
                object_jobs: None,
                burst: false,
                repair: CheckpointRepairModeArg::Lossy,
                allow_lossy_repair: true,
                json: false,
            },
        )
        .expect("lossy repair checkpoint succeeds");

        let current_hash = load_branch_index(repo.path(), "trunk")
            .expect("load repaired branch index")
            .get("tracked.txt")
            .expect("tracked row after repair")
            .hash
            .clone();
        assert_eq!(current_hash, hash_bytes(b"gamma\n"));
    }

    #[test]
    fn parse_http_target_extracts_target_and_query() {
        let request = "GET /api/tasks?project=alpha+one HTTP/1.1\r\nHost: localhost\r\n\r\n";
        let parsed = parse_http_target(request).expect("expected parse");
        assert_eq!(parsed.path, "/api/tasks");
        assert_eq!(
            parsed.query.get("project").map(String::as_str),
            Some("alpha one")
        );
    }

    #[test]
    fn parse_http_request_extracts_method_headers_and_body() {
        let request = concat!(
            "POST /api/tasks/edit?project=alpha HTTP/1.1\r\n",
            "Host: localhost\r\n",
            "Content-Type: application/json\r\n",
            "Content-Length: 15\r\n",
            "\r\n",
            "{\"task_id\":\"x\"}"
        );
        let parsed = parse_http_request(request.as_bytes()).expect("expected parse");
        assert_eq!(parsed.method, "POST");
        assert_eq!(parsed.target.path, "/api/tasks/edit");
        assert_eq!(
            parsed.target.query.get("project").map(String::as_str),
            Some("alpha")
        );
        assert_eq!(
            parsed.headers.get("content-type").map(String::as_str),
            Some("application/json")
        );
        assert_eq!(parsed.body, br#"{"task_id":"x"}"#);
    }

    #[test]
    fn resolve_selected_task_gui_project_prefers_selector_then_default() {
        let projects = vec![
            TaskGuiProject {
                key: "alpha".to_string(),
                name: "alpha".to_string(),
                repo_root: "/tmp/alpha".to_string(),
                is_default: false,
                is_current_repo: false,
            },
            TaskGuiProject {
                key: "beta".to_string(),
                name: "beta".to_string(),
                repo_root: "/tmp/beta".to_string(),
                is_default: true,
                is_current_repo: false,
            },
        ];
        let selected =
            resolve_selected_task_gui_project(&projects, Some("alpha")).expect("selector");
        assert_eq!(selected.key, "alpha");
        let fallback = resolve_selected_task_gui_project(&projects, None).expect("default");
        assert_eq!(fallback.key, "beta");
    }

    #[test]
    fn timeline_events_page_returns_newest_first_with_offset() {
        let make_event = |id: &str| TimelineEvent {
            schema_version: SCHEMA_EVENT.to_string(),
            event_id: id.to_string(),
            created_at_utc: "2026-03-01T00:00:00Z".to_string(),
            branch: "trunk".to_string(),
            parent_event_id: None,
            agent_id: "agent.a".to_string(),
            summary: format!("event {}", id),
            tags: Vec::new(),
            metrics: EventMetrics {
                tracked_file_count: 0,
                changed_file_count: 0,
                added_count: 0,
                modified_count: 0,
                deleted_count: 0,
                changed_bytes_total: 0,
            },
            changes: Vec::new(),
        };
        let events = vec![
            make_event("evt_1"),
            make_event("evt_2"),
            make_event("evt_3"),
            make_event("evt_4"),
            make_event("evt_5"),
        ];

        let first = timeline_events_page(&events, 0, 2);
        assert_eq!(
            first
                .iter()
                .map(|event| event.event_id.as_str())
                .collect::<Vec<_>>(),
            vec!["evt_5", "evt_4"]
        );

        let second = timeline_events_page(&events, 2, 2);
        assert_eq!(
            second
                .iter()
                .map(|event| event.event_id.as_str())
                .collect::<Vec<_>>(),
            vec!["evt_3", "evt_2"]
        );

        let last = timeline_events_page(&events, 4, 2);
        assert_eq!(
            last.iter()
                .map(|event| event.event_id.as_str())
                .collect::<Vec<_>>(),
            vec!["evt_1"]
        );

        assert!(timeline_events_page(&events, 5, 2).is_empty());
    }

    #[test]
    fn task_timeline_tags_include_action_and_task_id() {
        let task = FugitTask {
            task_id: "task_abc".to_string(),
            title: "do thing".to_string(),
            detail: None,
            priority: 1,
            tags: vec!["parser".to_string()],
            depends_on: Vec::new(),
            status: TaskStatus::Done,
            created_at_utc: now_utc(),
            updated_at_utc: now_utc(),
            created_by_agent_id: "agent.a".to_string(),
            claimed_by_agent_id: None,
            claim_started_at_utc: None,
            claim_expires_at_utc: None,
            completed_at_utc: Some(now_utc()),
            completed_by_agent_id: Some("agent.a".to_string()),
            completed_summary: None,
            completion_notes: Vec::new(),
            completion_artifacts: Vec::new(),
            completion_commands: Vec::new(),
            source_key: None,
            source_plan: None,
            awaiting_confirmation: false,
            approved_at_utc: None,
            approved_by_agent_id: None,
        };

        let tags = task_timeline_tags("done", &task, Some(TaskDispatchKind::Open));
        assert!(tags.iter().any(|tag| tag == "task"));
        assert!(tags.iter().any(|tag| tag == "task_action:done"));
        assert!(tags.iter().any(|tag| tag == "task_id:task_abc"));
        assert!(tags.iter().any(|tag| tag == "task_dispatch:open"));
        assert!(tags.iter().any(|tag| tag == "task_tag:parser"));
    }

    #[test]
    fn build_manual_task_rejects_unknown_dependency_ids() {
        let state = TaskState {
            schema_version: SCHEMA_TASKS.to_string(),
            updated_at_utc: now_utc(),
            tasks: vec![],
        };

        let err = build_manual_task(
            &state,
            "implement something",
            None,
            "agent.a".to_string(),
            5,
            vec![],
            vec!["task_missing".to_string()],
        )
        .expect_err("expected unknown dependency to fail");
        assert!(err.to_string().contains("task dependency not found"));
    }

    #[test]
    fn edit_task_in_state_replaces_selected_fields() {
        let mut state = TaskState {
            schema_version: SCHEMA_TASKS.to_string(),
            updated_at_utc: now_utc(),
            tasks: vec![
                FugitTask {
                    task_id: "task_dep".to_string(),
                    title: "dependency".to_string(),
                    detail: None,
                    priority: 0,
                    tags: vec![],
                    depends_on: vec![],
                    status: TaskStatus::Done,
                    created_at_utc: now_utc(),
                    updated_at_utc: now_utc(),
                    created_by_agent_id: "agent.seed".to_string(),
                    claimed_by_agent_id: None,
                    claim_started_at_utc: None,
                    claim_expires_at_utc: None,
                    completed_at_utc: Some(now_utc()),
                    completed_by_agent_id: Some("agent.seed".to_string()),
                    completed_summary: None,
                    completion_notes: Vec::new(),
                    completion_artifacts: Vec::new(),
                    completion_commands: Vec::new(),
                    source_key: None,
                    source_plan: None,
                    awaiting_confirmation: false,
                    approved_at_utc: None,
                    approved_by_agent_id: None,
                },
                FugitTask {
                    task_id: "task_main".to_string(),
                    title: "before".to_string(),
                    detail: Some("old detail".to_string()),
                    priority: 1,
                    tags: vec!["old".to_string()],
                    depends_on: vec![],
                    status: TaskStatus::Open,
                    created_at_utc: now_utc(),
                    updated_at_utc: now_utc(),
                    created_by_agent_id: "agent.seed".to_string(),
                    claimed_by_agent_id: None,
                    claim_started_at_utc: None,
                    claim_expires_at_utc: None,
                    completed_at_utc: None,
                    completed_by_agent_id: None,
                    completed_summary: None,
                    completion_notes: Vec::new(),
                    completion_artifacts: Vec::new(),
                    completion_commands: Vec::new(),
                    source_key: None,
                    source_plan: None,
                    awaiting_confirmation: false,
                    approved_at_utc: None,
                    approved_by_agent_id: None,
                },
            ],
        };

        let task = edit_task_in_state(
            &mut state,
            "task_main",
            "agent.editor",
            TaskEditPatch {
                title: Some("after".to_string()),
                detail: TaskTextPatch::Clear,
                priority: Some(9),
                tags: Some(vec!["compiler".to_string(), "gui".to_string()]),
                depends_on: Some(vec!["task_dep".to_string()]),
            },
        )
        .expect("expected edit to succeed");
        assert_eq!(task.title, "after");
        assert!(task.detail.is_none());
        assert_eq!(task.priority, 9);
        assert_eq!(task.tags, vec!["compiler".to_string(), "gui".to_string()]);
        assert_eq!(task.depends_on, vec!["task_dep".to_string()]);
    }

    #[test]
    fn remove_task_from_state_rejects_tasks_with_dependents() {
        let mut state = TaskState {
            schema_version: SCHEMA_TASKS.to_string(),
            updated_at_utc: now_utc(),
            tasks: vec![
                FugitTask {
                    task_id: "task_parent".to_string(),
                    title: "parent".to_string(),
                    detail: None,
                    priority: 0,
                    tags: vec![],
                    depends_on: vec![],
                    status: TaskStatus::Open,
                    created_at_utc: now_utc(),
                    updated_at_utc: now_utc(),
                    created_by_agent_id: "agent.seed".to_string(),
                    claimed_by_agent_id: None,
                    claim_started_at_utc: None,
                    claim_expires_at_utc: None,
                    completed_at_utc: None,
                    completed_by_agent_id: None,
                    completed_summary: None,
                    completion_notes: Vec::new(),
                    completion_artifacts: Vec::new(),
                    completion_commands: Vec::new(),
                    source_key: None,
                    source_plan: None,
                    awaiting_confirmation: false,
                    approved_at_utc: None,
                    approved_by_agent_id: None,
                },
                FugitTask {
                    task_id: "task_child".to_string(),
                    title: "child".to_string(),
                    detail: None,
                    priority: 0,
                    tags: vec![],
                    depends_on: vec!["task_parent".to_string()],
                    status: TaskStatus::Open,
                    created_at_utc: now_utc(),
                    updated_at_utc: now_utc(),
                    created_by_agent_id: "agent.seed".to_string(),
                    claimed_by_agent_id: None,
                    claim_started_at_utc: None,
                    claim_expires_at_utc: None,
                    completed_at_utc: None,
                    completed_by_agent_id: None,
                    completed_summary: None,
                    completion_notes: Vec::new(),
                    completion_artifacts: Vec::new(),
                    completion_commands: Vec::new(),
                    source_key: None,
                    source_plan: None,
                    awaiting_confirmation: false,
                    approved_at_utc: None,
                    approved_by_agent_id: None,
                },
            ],
        };

        let err = remove_task_from_state(&mut state, "task_parent", "agent.editor")
            .expect_err("expected dependent check to fail");
        assert!(err.to_string().contains("still has dependents"));
    }

    #[test]
    fn reopen_task_in_state_clears_completion_metadata() {
        let mut state = TaskState {
            schema_version: SCHEMA_TASKS.to_string(),
            updated_at_utc: now_utc(),
            tasks: vec![FugitTask {
                task_id: "task_done".to_string(),
                title: "done".to_string(),
                detail: None,
                priority: 0,
                tags: vec![],
                depends_on: vec![],
                status: TaskStatus::Done,
                created_at_utc: now_utc(),
                updated_at_utc: now_utc(),
                created_by_agent_id: "agent.seed".to_string(),
                claimed_by_agent_id: None,
                claim_started_at_utc: None,
                claim_expires_at_utc: None,
                completed_at_utc: Some(now_utc()),
                completed_by_agent_id: Some("agent.seed".to_string()),
                completed_summary: Some("finished".to_string()),
                completion_notes: vec!["note".to_string()],
                completion_artifacts: vec!["artifact".to_string()],
                completion_commands: vec!["cargo test".to_string()],
                source_key: Some("A-01".to_string()),
                source_plan: Some("the_final_plan.md".to_string()),
                awaiting_confirmation: false,
                approved_at_utc: None,
                approved_by_agent_id: None,
            }],
        };

        let reopened =
            reopen_task_in_state(&mut state, "task_done", "agent.editor").expect("reopen task");
        assert_eq!(reopened.status, TaskStatus::Open);
        assert!(reopened.completed_at_utc.is_none());
        assert!(reopened.completed_by_agent_id.is_none());
        assert!(reopened.completed_summary.is_none());
        assert!(reopened.completion_notes.is_empty());
        assert!(reopened.completion_artifacts.is_empty());
        assert!(reopened.completion_commands.is_empty());
    }

    #[test]
    fn sync_plan_into_task_state_reconciles_managed_tasks() {
        let mut state = TaskState {
            schema_version: SCHEMA_TASKS.to_string(),
            updated_at_utc: now_utc(),
            tasks: vec![
                FugitTask {
                    task_id: "task_a01".to_string(),
                    title: "Define compiler contract".to_string(),
                    detail: None,
                    priority: 0,
                    tags: vec![],
                    depends_on: vec![],
                    status: TaskStatus::Open,
                    created_at_utc: now_utc(),
                    updated_at_utc: now_utc(),
                    created_by_agent_id: "agent.seed".to_string(),
                    claimed_by_agent_id: None,
                    claim_started_at_utc: None,
                    claim_expires_at_utc: None,
                    completed_at_utc: None,
                    completed_by_agent_id: None,
                    completed_summary: None,
                    completion_notes: Vec::new(),
                    completion_artifacts: Vec::new(),
                    completion_commands: Vec::new(),
                    source_key: Some("A-01".to_string()),
                    source_plan: Some("the_final_plan.md".to_string()),
                    awaiting_confirmation: false,
                    approved_at_utc: None,
                    approved_by_agent_id: None,
                },
                FugitTask {
                    task_id: "task_a02".to_string(),
                    title: "Add checkpoint json payloads".to_string(),
                    detail: None,
                    priority: 0,
                    tags: vec![],
                    depends_on: vec![],
                    status: TaskStatus::Done,
                    created_at_utc: now_utc(),
                    updated_at_utc: now_utc(),
                    created_by_agent_id: "agent.seed".to_string(),
                    claimed_by_agent_id: None,
                    claim_started_at_utc: None,
                    claim_expires_at_utc: None,
                    completed_at_utc: Some(now_utc()),
                    completed_by_agent_id: Some("agent.seed".to_string()),
                    completed_summary: Some("finished".to_string()),
                    completion_notes: Vec::new(),
                    completion_artifacts: Vec::new(),
                    completion_commands: Vec::new(),
                    source_key: Some("A-02".to_string()),
                    source_plan: Some("the_final_plan.md".to_string()),
                    awaiting_confirmation: false,
                    approved_at_utc: None,
                    approved_by_agent_id: None,
                },
            ],
        };
        let rows = vec![
            TaskImportRow {
                key: "A-02".to_string(),
                source_key: Some("A-02".to_string()),
                title: "Add checkpoint json payloads".to_string(),
                detail: None,
                priority: None,
                tags: Vec::new(),
                depends_on_keys: Vec::new(),
                agent: None,
            },
            TaskImportRow {
                key: "A-03".to_string(),
                source_key: Some("A-03".to_string()),
                title: "Add plan sync".to_string(),
                detail: None,
                priority: Some(5),
                tags: vec!["planning".to_string()],
                depends_on_keys: vec!["A-02".to_string()],
                agent: None,
            },
        ];

        let report = sync_plan_into_task_state(
            &mut state,
            rows,
            "the_final_plan.md",
            "agent.sync",
            0,
            false,
        )
        .expect("sync should succeed");

        assert_eq!(report.created.len(), 1);
        assert_eq!(report.reopened.len(), 1);
        assert_eq!(report.removed.len(), 1);
        assert_eq!(report.blocked.len(), 0);
        assert!(state.tasks.iter().all(|task| task.task_id != "task_a01"));

        let reopened = state
            .tasks
            .iter()
            .find(|task| task.task_id == "task_a02")
            .expect("reopened task");
        assert_eq!(reopened.status, TaskStatus::Open);
        assert!(reopened.completed_at_utc.is_none());

        let created = state
            .tasks
            .iter()
            .find(|task| task.source_key.as_deref() == Some("A-03"))
            .expect("created task");
        assert_eq!(created.depends_on, vec!["task_a02".to_string()]);
        assert_eq!(created.priority, 5);
        assert_eq!(created.tags, vec!["planning".to_string()]);
    }

    #[test]
    fn parse_task_import_tsv_line_parses_expected_fields() {
        let row = parse_task_import_tsv_line(
            "A01\t95\tsemantic,compiler\tA00\tDefine semantic contract\tLock canonical schema\tagent.a",
        )
        .expect("expected valid row");
        assert_eq!(row.key, "A01");
        assert_eq!(row.priority, Some(95));
        assert_eq!(
            row.tags,
            vec!["semantic".to_string(), "compiler".to_string()]
        );
        assert_eq!(row.depends_on_keys, vec!["A00".to_string()]);
        assert_eq!(row.title, "Define semantic contract");
        assert_eq!(row.detail.as_deref(), Some("Lock canonical schema"));
        assert_eq!(row.agent.as_deref(), Some("agent.a"));
    }

    #[test]
    fn parse_task_import_tsv_line_supports_empty_optional_fields() {
        let row = parse_task_import_tsv_line("A02\t\t\t\tDraft follow-up task")
            .expect("expected valid row");
        assert_eq!(row.key, "A02");
        assert_eq!(row.priority, None);
        assert!(row.tags.is_empty());
        assert!(row.depends_on_keys.is_empty());
        assert_eq!(row.title, "Draft follow-up task");
        assert!(row.detail.is_none());
        assert!(row.agent.is_none());
    }

    #[test]
    fn parse_task_import_tsv_line_rejects_non_numeric_priority() {
        let err = parse_task_import_tsv_line("A03\thigh\tsemantic\t\tBad priority row")
            .expect_err("expected invalid priority");
        let message = format!("{err:#}");
        assert!(message.contains("invalid priority"));
    }
}
