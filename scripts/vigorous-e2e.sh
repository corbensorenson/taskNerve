#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

BIN="${FUGIT_BIN:-$REPO_ROOT/target/debug/fugit}"

echo "[vigorous-e2e] building debug binary"
cargo build

if [[ ! -x "$BIN" ]]; then
  echo "[vigorous-e2e] missing binary: $BIN" >&2
  exit 1
fi

TMP_ROOT="$(mktemp -d /tmp/fugit-vigorous-e2e-XXXXXX)"
trap 'rm -rf "$TMP_ROOT" >/dev/null 2>&1 || true' EXIT

export FUGIT_HOME="$TMP_ROOT/fugit-home"
export CODEX_HOME="$TMP_ROOT/codex-home"
mkdir -p "$FUGIT_HOME" "$CODEX_HOME"

create_git_repo() {
  local dir="$1"
  mkdir -p "$dir"
  git -C "$dir" init >/dev/null
  git -C "$dir" config user.name "fugit-e2e"
  git -C "$dir" config user.email "fugit-e2e@example.local"
  if ! git -C "$dir" rev-parse --verify trunk >/dev/null 2>&1; then
    git -C "$dir" checkout -b trunk >/dev/null 2>&1 || true
  fi
}

json_assert() {
  local json_file="$1"
  local expr="$2"
  local message="$3"
  python3 - "$json_file" "$expr" "$message" <<'PY'
import json, sys
path, expr, message = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path, "r", encoding="utf-8") as f:
    payload = json.load(f)
ok = eval(expr, {"payload": payload})
if not ok:
    raise SystemExit(f"[vigorous-e2e] assertion failed: {message}\nexpr={expr}\npayload={payload}")
PY
}

jsonl_assert() {
  local jsonl_file="$1"
  local expr="$2"
  local message="$3"
  python3 - "$jsonl_file" "$expr" "$message" <<'PY'
import json, sys
path, expr, message = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path, "r", encoding="utf-8") as f:
    rows = [json.loads(line) for line in f if line.strip()]
ok = eval(expr, {"rows": rows})
if not ok:
    raise SystemExit(f"[vigorous-e2e] assertion failed: {message}\nexpr={expr}\nrows={rows}")
PY
}

wait_for_auto_sync() {
  local repo_root="$1"
  local json_file="$TMP_ROOT/auto-sync-status.json"
  for _ in $(seq 1 80); do
    "$BIN" --repo-root "$repo_root" bridge auto-sync show --json >"$json_file"
    if python3 - "$json_file" <<'PY'
import json, sys
payload = json.load(open(sys.argv[1], "r", encoding="utf-8"))
status = payload.get("status")
pending = payload.get("pending_trigger")
finished = payload.get("last_finished_at_utc")
if status in {"success", "noop", "committed_local"} and not pending and finished:
    raise SystemExit(0)
raise SystemExit(1)
PY
    then
      return 0
    fi
    sleep 0.25
  done
  echo "[vigorous-e2e] auto sync did not settle in time" >&2
  cat "$json_file" >&2
  exit 1
}

wait_for_advisor_worker() {
  local repo_root="$1"
  local role="$2"
  local json_file="$TMP_ROOT/advisor-status-${role}.json"
  for _ in $(seq 1 80); do
    "$BIN" --repo-root "$repo_root" advisor show --json >"$json_file"
    if python3 - "$json_file" "$role" <<'PY'
import json, sys
payload = json.load(open(sys.argv[1], "r", encoding="utf-8"))
role = sys.argv[2]
worker = (payload.get("workers") or {}).get(role, {})
status = worker.get("status")
finished = worker.get("last_finished_at_utc")
if status == "success" and finished:
    raise SystemExit(0)
raise SystemExit(1)
PY
    then
      return 0
    fi
    sleep 0.25
  done
  echo "[vigorous-e2e] advisor worker ${role} did not settle in time" >&2
  cat "$json_file" >&2
  exit 1
}

echo "[vigorous-e2e] preparing repositories"
REPO_A="$TMP_ROOT/repo-a"
REPO_B="$TMP_ROOT/repo-b"
REPO_C="$TMP_ROOT/repo-c"
REMOTE_BARE="$TMP_ROOT/remote.git"
CLONE_B="$TMP_ROOT/clone-b"

create_git_repo "$REPO_A"
create_git_repo "$REPO_B"
create_git_repo "$REPO_C"
git init --bare "$REMOTE_BARE" >/dev/null

echo "alpha" >"$REPO_A/README.txt"
git -C "$REPO_A" add README.txt
git -C "$REPO_A" commit -m "seed repo-a" >/dev/null
git -C "$REPO_A" remote add origin "$REMOTE_BARE"
git -C "$REPO_A" push -u origin trunk >/dev/null

echo "beta" >"$REPO_B/README.txt"
git -C "$REPO_B" add README.txt
git -C "$REPO_B" commit -m "seed repo-b" >/dev/null

echo "gamma" >"$REPO_C/README.txt"
git -C "$REPO_C" add README.txt
git -C "$REPO_C" commit -m "seed repo-c" >/dev/null

echo "[vigorous-e2e] init/status/backend"
"$BIN" --version >/dev/null
"$BIN" --repo-root "$REPO_A" init --branch trunk >/dev/null
"$BIN" --repo-root "$REPO_A" status --json >"$TMP_ROOT/status.json"
json_assert "$TMP_ROOT/status.json" 'payload.get("schema_version") == "timeline.status.v1" and payload.get("branch") == "trunk"' "status schema/branch mismatch after init"
"$BIN" --repo-root "$REPO_A" status --json --summary-only >"$TMP_ROOT/status-summary.json"
json_assert "$TMP_ROOT/status-summary.json" 'payload.get("changes_included") is False and payload.get("changes") == []' "status --summary-only should suppress per-file change payloads"
"$BIN" --repo-root "$REPO_A" backend show --json >"$TMP_ROOT/backend-show.json"
json_assert "$TMP_ROOT/backend-show.json" 'payload.get("backend_mode") == "git_bridge"' "backend mode should default to git_bridge"
"$BIN" --repo-root "$REPO_A" backend set --mode git-bridge --bridge-remote origin --bridge-branch trunk >/dev/null

echo "[vigorous-e2e] checkpoint/log/branch/checkout"
mkdir -p "$REPO_A/src"
echo "v1" >"$REPO_A/src/main.txt"
"$BIN" --repo-root "$REPO_A" checkpoint --summary "add main" --agent agent.e2e --tag e2e >/dev/null
"$BIN" --repo-root "$REPO_A" log --limit 5 --json >"$TMP_ROOT/log-a.json"
json_assert "$TMP_ROOT/log-a.json" 'isinstance(payload, list) and len(payload) >= 1' "log should contain events"
"$BIN" --repo-root "$REPO_A" branch create feature --switch >/dev/null
echo "v2" >>"$REPO_A/src/main.txt"
"$BIN" --repo-root "$REPO_A" checkpoint --summary "feature update" --agent agent.e2e --tag feature >/dev/null
"$BIN" --repo-root "$REPO_A" checkout --branch trunk --dry-run >/dev/null
"$BIN" --repo-root "$REPO_A" checkout --branch trunk --force >/dev/null
"$BIN" --repo-root "$REPO_A" branch switch trunk >/dev/null

echo "[vigorous-e2e] lock system"
"$BIN" --repo-root "$REPO_A" lock add --pattern "src/**" --agent agent.lock --ttl-minutes 10 >/dev/null
"$BIN" --repo-root "$REPO_A" lock list --json >"$TMP_ROOT/locks.json"
LOCK_ID="$(python3 - "$TMP_ROOT/locks.json" <<'PY'
import json,sys
rows=json.load(open(sys.argv[1]))
print(rows[0]["lock_id"])
PY
)"
"$BIN" --repo-root "$REPO_A" lock remove --lock-id "$LOCK_ID" >/dev/null

echo "[vigorous-e2e] task queue + timeline mirror"
"$BIN" --repo-root "$REPO_A" task add --title "task-a" --priority 10 --agent agent.a --json >"$TMP_ROOT/task-a.json"
TASK_A="$(python3 - "$TMP_ROOT/task-a.json" <<'PY'
import json,sys
print(json.load(open(sys.argv[1]))["task_id"])
PY
)"
"$BIN" --repo-root "$REPO_A" task add --title "task-b" --priority 5 --depends-on "$TASK_A" --agent agent.b --json >"$TMP_ROOT/task-b.json"
TASK_B="$(python3 - "$TMP_ROOT/task-b.json" <<'PY'
import json,sys
print(json.load(open(sys.argv[1]))["task_id"])
PY
)"
"$BIN" --repo-root "$REPO_A" task edit --task-id "$TASK_A" --detail "root task" --tag root --agent agent.a --json >"$TMP_ROOT/task-a-edit.json"
json_assert "$TMP_ROOT/task-a-edit.json" 'payload.get("detail") == "root task" and "root" in payload.get("tags", [])' "task edit should replace requested fields"
"$BIN" --repo-root "$REPO_A" task show --task-id "$TASK_A" --json >"$TMP_ROOT/task-a-show.json"
json_assert "$TMP_ROOT/task-a-show.json" 'payload.get("task_id") is not None and payload.get("detail") == "root task"' "task show should expose edited task state"
"$BIN" --repo-root "$REPO_A" task list --jsonl --fields task_id,title,status --limit 2 >"$TMP_ROOT/task-list.jsonl"
jsonl_assert "$TMP_ROOT/task-list.jsonl" 'all(set(row.keys()) == {"task_id","title","status"} for row in rows)' "task list --jsonl --fields should emit compact rows"
"$BIN" --repo-root "$REPO_A" task add --title "task-c" --priority 1 --agent agent.c --json >"$TMP_ROOT/task-c.json"
TASK_C="$(python3 - "$TMP_ROOT/task-c.json" <<'PY'
import json,sys
print(json.load(open(sys.argv[1]))["task_id"])
PY
)"
"$BIN" --repo-root "$REPO_A" task request --agent agent.picker --task-id "$TASK_C" --no-claim --json >"$TMP_ROOT/task-request-specific.json"
json_assert "$TMP_ROOT/task-request-specific.json" 'payload.get("assigned") is True and payload.get("task",{}).get("task_id") == "'"$TASK_C"'" and payload.get("requested_task_id") == "'"$TASK_C"'"' "task request --task-id should target the requested task directly"
"$BIN" --repo-root "$REPO_A" task add --title "task-d" --priority 1 --agent agent.d --json >"$TMP_ROOT/task-d.json"
TASK_D="$(python3 - "$TMP_ROOT/task-d.json" <<'PY'
import json,sys
print(json.load(open(sys.argv[1]))["task_id"])
PY
)"
"$BIN" --repo-root "$REPO_A" task add --title "Execute Phase B deliverables (2026-04-21 through 2026-06-01)" --priority 60 --agent agent.schedule --json >"$TMP_ROOT/task-gated.json"
TASK_GATED="$(python3 - "$TMP_ROOT/task-gated.json" <<'PY'
import json,sys
print(json.load(open(sys.argv[1]))["task_id"])
PY
)"
"$BIN" --repo-root "$REPO_A" task request --agent agent.scheduler --title-contains "Phase B" --no-claim --json >"$TMP_ROOT/task-request-gated-blocked.json"
json_assert "$TMP_ROOT/task-request-gated-blocked.json" 'payload.get("assigned") is False and payload.get("respect_date_gates") is True and payload.get("filters", {}).get("title_contains") == "Phase B"' "task request should skip date-gated tasks by default"
"$BIN" --repo-root "$REPO_A" task request --agent agent.scheduler --task-id "$TASK_GATED" --ignore-date-gates --no-claim --json >"$TMP_ROOT/task-request-gated-override.json"
json_assert "$TMP_ROOT/task-request-gated-override.json" 'payload.get("assigned") is True and payload.get("task",{}).get("task_id") == "'"$TASK_GATED"'" and payload.get("respect_date_gates") is False' "task request should allow explicit date-gate override"
"$BIN" --repo-root "$REPO_A" task request --agent agent.runner --no-claim --max 2 --json >"$TMP_ROOT/task-request-preview.json"
json_assert "$TMP_ROOT/task-request-preview.json" 'payload.get("assigned_count", 0) >= 1 and isinstance(payload.get("tasks"), list)' "task request preview should return a prioritized slice"
"$BIN" --repo-root "$REPO_A" task request --agent agent.runner --focus root --json >"$TMP_ROOT/task-request-1.json"
json_assert "$TMP_ROOT/task-request-1.json" 'payload.get("assigned") is True and payload.get("task",{}).get("task_id") is not None and payload.get("selection_reason") in {"highest_priority_ready","specific_task","owned_claim","stale_claim_steal","auto_replenish_fallback"}' "task request should assign a task with a machine-readable selection reason"
"$BIN" task start --repo-root "$REPO_A" --agent agent.runner --json >"$TMP_ROOT/task-start-current.json"
json_assert "$TMP_ROOT/task-start-current.json" 'payload.get("start_mode") == "resume_current" and payload.get("task", {}).get("task_id") == "'"$TASK_A"'" and payload.get("claimed") is False' "task start should resume the current claim and allow --repo-root after the subcommand"
"$BIN" --repo-root "$REPO_A" task current --agent agent.runner --json >"$TMP_ROOT/task-current.json"
json_assert "$TMP_ROOT/task-current.json" 'payload.get("found") is True and payload.get("task",{}).get("task_id") == "'"$TASK_A"'"' "task current should return the active claim for the agent"
"$BIN" --repo-root "$REPO_A" task show --task-id "$TASK_A" --json >"$TMP_ROOT/task-a-claimed.json"
json_assert "$TMP_ROOT/task-a-claimed.json" 'payload.get("claim_started_at_utc") is not None and payload.get("claim_expires_at_utc") is not None and payload.get("claimed_by_agent_id") == "agent.runner"' "task show should expose consistent claim timestamps after request"
"$BIN" --repo-root "$REPO_A" task status --agent agent.runner --json >"$TMP_ROOT/task-status.json"
json_assert "$TMP_ROOT/task-status.json" 'payload.get("counts", {}).get("mine_claimed") == 1 and payload.get("current", {}).get("task_id") == "'"$TASK_A"'"' "task status should summarize the agent queue and current claim"
"$BIN" --repo-root "$REPO_A" task list --agent agent.runner --mine --json >"$TMP_ROOT/task-mine.json"
json_assert "$TMP_ROOT/task-mine.json" 'len(payload) == 1 and payload[0].get("task_id") == "'"$TASK_A"'" and payload[0].get("claim_started_at_utc") is not None and payload[0].get("claim_expires_at_utc") is not None' "task list --mine should return only the agent-owned claim with lease metadata"
"$BIN" --repo-root "$REPO_A" task claim "$TASK_A" --agent agent.runner --extend-only --claim-ttl-minutes 75 --json >"$TMP_ROOT/task-claim-extend.json"
json_assert "$TMP_ROOT/task-claim-extend.json" 'payload.get("claim_expires_at_utc") is not None and payload.get("claimed_by_agent_id") == "agent.runner"' "task claim --extend-only should renew the existing lease without changing ownership"
TASK_A_EXTENDED_EXPIRY="$(python3 - "$TMP_ROOT/task-claim-extend.json" <<'PY'
import json, sys
payload = json.load(open(sys.argv[1]))
print(payload["claim_expires_at_utc"])
PY
)"
"$BIN" --repo-root "$REPO_A" task list --status in_progress --json >"$TMP_ROOT/task-in-progress.json"
json_assert "$TMP_ROOT/task-in-progress.json" 'any(row.get("task_id") == "'"$TASK_A"'" for row in payload)' "task list should accept in_progress as a claimed-task alias"
"$BIN" --repo-root "$REPO_A" task request --agent agent.runner --json >"$TMP_ROOT/task-request-owned.json"
json_assert "$TMP_ROOT/task-request-owned.json" 'payload.get("dispatch_kind") == "owned_claim" and payload.get("claimed") is False and payload.get("task", {}).get("task_id") == "'"$TASK_A"'" and payload.get("task", {}).get("claim_ttl_remaining_seconds") is not None' "task request should resume the owned claim without creating a new lease"
OWNED_REQUEST_EXPIRY="$(python3 - "$TMP_ROOT/task-request-owned.json" <<'PY'
import json, sys
payload = json.load(open(sys.argv[1]))
print(payload["task"]["claim_expires_at_utc"])
PY
)"
if [[ "$OWNED_REQUEST_EXPIRY" != "$TASK_A_EXTENDED_EXPIRY" ]]; then
  echo "[vigorous-e2e] task request unexpectedly changed the owned claim expiry" >&2
  exit 1
fi
"$BIN" --repo-root "$REPO_A" task request --agent agent.runner --skip-owned --no-claim --json >"$TMP_ROOT/task-request-skip-owned.json"
json_assert "$TMP_ROOT/task-request-skip-owned.json" 'payload.get("dispatch_kind") == "open" and payload.get("claimed") is False and payload.get("task",{}).get("task_id") in {"'"$TASK_C"'","'"$TASK_D"'"} and payload.get("skip_owned") is True' "task request --skip-owned should bypass the agent's existing claim without forcing a new claim"
"$BIN" --repo-root "$REPO_A" task request --agent agent.runner --max-new-claims 1 --json >"$TMP_ROOT/task-request-max-new.json"
json_assert "$TMP_ROOT/task-request-max-new.json" 'payload.get("claimed") is True and payload.get("owned_claim_count") == 1 and payload.get("task",{}).get("task_id") in {"'"$TASK_C"'","'"$TASK_D"'"}' "task request --max-new-claims should explicitly allow one additional claim"
EXTRA_TASK="$(python3 - "$TMP_ROOT/task-request-max-new.json" <<'PY'
import json, sys
payload = json.load(open(sys.argv[1]))
print(payload["task"]["task_id"])
PY
)"
"$BIN" --repo-root "$REPO_A" task heartbeat --task-id "$TASK_A" --agent agent.runner --claim-ttl-minutes 60 --note "lease heartbeat" --artifact artifacts/heartbeat.log --json >"$TMP_ROOT/task-heartbeat.json"
json_assert "$TMP_ROOT/task-heartbeat.json" 'payload.get("task_id") == "'"$TASK_A"'" and payload.get("last_progress_note") == "lease heartbeat" and payload.get("last_artifact") == "artifacts/heartbeat.log"' "task heartbeat should renew the lease and attach progress/artifact breadcrumbs"
"$BIN" --repo-root "$REPO_A" task release --task-id "$EXTRA_TASK" --agent agent.runner --state blocked --reason "waiting on upstream api" --json >"$TMP_ROOT/task-release-blocked.json"
json_assert "$TMP_ROOT/task-release-blocked.json" 'payload.get("lifecycle_state") == "blocked" and payload.get("blocked_reason") == "waiting on upstream api"' "task release --state blocked should preserve blocker metadata on the task"
"$BIN" --repo-root "$REPO_A" task update --task-id "$EXTRA_TASK" --clear-blocked --agent agent.runner --json >"$TMP_ROOT/task-update-clear-blocked.json"
json_assert "$TMP_ROOT/task-update-clear-blocked.json" 'payload.get("blocked_reason") is None' "task update --clear-blocked should reopen the task for dispatch"
"$BIN" --repo-root "$REPO_A" task request --agent agent.runner --task-id "$EXTRA_TASK" --no-claim --json >"$TMP_ROOT/task-request-unblocked.json"
json_assert "$TMP_ROOT/task-request-unblocked.json" 'payload.get("assigned") is True and payload.get("task",{}).get("task_id") == "'"$EXTRA_TASK"'"' "cleared blocked tasks should be dispatchable again"
"$BIN" --repo-root "$REPO_A" task progress --task-id "$TASK_A" --agent agent.runner --note "implemented root workflow" --json >"$TMP_ROOT/task-progress.json"
json_assert "$TMP_ROOT/task-progress.json" 'payload.get("progress_count") >= 2 and payload.get("last_progress_note") == "implemented root workflow"' "task progress should append an execution breadcrumb"
"$BIN" --repo-root "$REPO_A" task note --task-id "$TASK_A" --agent agent.runner --artifact artifacts/report.json --artifact artifacts/trace.log --json >"$TMP_ROOT/task-note.json"
json_assert "$TMP_ROOT/task-note.json" 'payload.get("artifact_count") == 3 and payload.get("last_artifact") == "artifacts/trace.log"' "task note should append artifact breadcrumbs for handoff and resume"
if "$BIN" --repo-root "$REPO_A" task list --all --limit 1 >/dev/null; then
  :
else
  echo "[vigorous-e2e] task list --all should be accepted as a no-op alias" >&2
  exit 1
fi
if "$BIN" --repo-root "$REPO_A" task done --task-id "$TASK_D" --agent agent.runner >/dev/null 2>&1; then
  echo "[vigorous-e2e] expected task done to require a regression or benchmark check by default" >&2
  exit 1
fi
"$BIN" --repo-root "$REPO_A" task add --title "cancel me" --agent agent.runner --json >"$TMP_ROOT/task-add-cancel.json"
CANCEL_TASK="$(python3 - "$TMP_ROOT/task-add-cancel.json" <<'PY'
import json, sys
payload = json.load(open(sys.argv[1]))
print(payload["task_id"])
PY
)"
"$BIN" --repo-root "$REPO_A" task cancel --task-id "$CANCEL_TASK" --agent agent.runner --reason "superseded" --json >"$TMP_ROOT/task-cancel.json"
json_assert "$TMP_ROOT/task-cancel.json" 'payload.get("lifecycle_state") == "canceled" and payload.get("canceled_reason") == "superseded"' "task cancel should preserve cancellation reason on the task"
"$BIN" --repo-root "$REPO_A" task release --task-id "$TASK_C" --agent agent.runner >/dev/null
"$BIN" --repo-root "$REPO_A" task done --task-id "$TASK_A" --agent agent.runner --summary "root lane complete" --artifact "$TMP_ROOT/task-a-edit.json" --command "cargo test" --regression "test -f README.txt" --claim-next --json >"$TMP_ROOT/task-done.json"
json_assert "$TMP_ROOT/task-done.json" 'payload.get("completed_summary") == "root lane complete" and payload.get("auto_bridge_sync", {}).get("status") is not None and payload.get("quality_checks", {}).get("created_count") == 1 and payload.get("claim_next", {}).get("task", {}).get("task", {}).get("task_id") == "'"$TASK_B"'"' "task done should include completion metadata, quality checks, auto bridge sync status, and claim the next ready task"
wait_for_auto_sync "$REPO_A"
"$BIN" --repo-root "$REPO_A" bridge auto-sync show --json >"$TMP_ROOT/auto-sync-after-task-done.json"
json_assert "$TMP_ROOT/auto-sync-after-task-done.json" 'payload.get("status") in {"success","committed_local","noop"} and "task done:" in (payload.get("last_note") or "") and payload.get("last_trigger") == "task_done"' "task done should queue bridge auto-sync with task note"
AUTO_SYNC_SUBJECT="$(git --git-dir "$REMOTE_BARE" log --format=%s -1 trunk)"
if [[ "$AUTO_SYNC_SUBJECT" != timeline\ sync:\ task\ done:* ]]; then
  echo "[vigorous-e2e] unexpected auto-sync subject: $AUTO_SYNC_SUBJECT" >&2
  exit 1
fi
"$BIN" --repo-root "$REPO_A" task current --agent agent.runner --json >"$TMP_ROOT/task-current-after-done.json"
json_assert "$TMP_ROOT/task-current-after-done.json" 'payload.get("task", {}).get("task_id") == "'"$TASK_B"'"' "task done --claim-next should make the next task current immediately"
"$BIN" --repo-root "$REPO_A" task show --task-id "$TASK_A" --json >"$TMP_ROOT/task-a-done.json"
json_assert "$TMP_ROOT/task-a-done.json" 'payload.get("completed_summary") == "root lane complete" and "cargo test" in payload.get("completion_commands", []) and payload.get("progress_count") == 1' "task show should include completion metadata and progress breadcrumbs"
"$BIN" --repo-root "$REPO_A" check list --json >"$TMP_ROOT/check-list.json"
json_assert "$TMP_ROOT/check-list.json" 'any(row.get("task_id") == "'"$TASK_A"'" and row.get("kind") == "regression" for row in payload)' "task done should register a regression check"
"$BIN" --repo-root "$REPO_A" task remove --task-id "$TASK_C" --agent agent.c >/dev/null
"$BIN" --repo-root "$REPO_A" log --limit 50 --json >"$TMP_ROOT/log-task.json"
json_assert "$TMP_ROOT/log-task.json" 'any("task done:" in row.get("summary","") for row in payload)' "task actions should be mirrored into timeline events"
json_assert "$TMP_ROOT/log-task.json" 'any("task edit:" in row.get("summary","") for row in payload) and any("task remove:" in row.get("summary","") for row in payload) and any("check add:" in row.get("summary","") for row in payload) and any("task progress:" in row.get("summary","") for row in payload)' "task and check actions should be mirrored into timeline events"

echo "[vigorous-e2e] auto replenish policy"
"$BIN" --repo-root "$REPO_B" init --branch trunk >/dev/null
"$BIN" --repo-root "$REPO_B" task policy set --auto-replenish-enabled true --auto-replenish-confirmation true --clear-replenish-agents --replenish-agent agent.alpha --replenish-agent agent.beta --agent agent.admin --json >"$TMP_ROOT/task-policy-set.json"
json_assert "$TMP_ROOT/task-policy-set.json" 'payload.get("auto_replenish_enabled") is True and payload.get("auto_replenish_confirmation") is True and payload.get("configured_replenish_agents") == ["agent.alpha", "agent.beta"]' "task policy set should persist replenish defaults"
"$BIN" --repo-root "$REPO_B" task request --agent agent.alpha --json >"$TMP_ROOT/auto-request-pending.json"
json_assert "$TMP_ROOT/auto-request-pending.json" 'payload.get("assigned") is False and payload.get("auto_replenish", {}).get("triggered") is True and len(payload.get("auto_replenish", {}).get("pending_confirmation_task_ids", [])) == 2' "empty queue should seed confirmation-gated auto replenish tasks"
"$BIN" --repo-root "$REPO_B" task approve --all-pending-auto-replenish --agent agent.admin --json >"$TMP_ROOT/auto-approve.json"
json_assert "$TMP_ROOT/auto-approve.json" 'payload.get("approved_count") == 2' "task approve should clear pending auto-replenish confirmations"
"$BIN" --repo-root "$REPO_B" task request --agent agent.alpha --json >"$TMP_ROOT/auto-request-claimed.json"
json_assert "$TMP_ROOT/auto-request-claimed.json" 'payload.get("assigned") is True and payload.get("task", {}).get("auto_replenish") is True and payload.get("claimed") is True' "approved auto-replenish task should become dispatchable"
"$BIN" --repo-root "$REPO_B" task add --title "real follow-up" --priority 50 --agent agent.manager --json >"$TMP_ROOT/auto-real-task.json"
"$BIN" --repo-root "$REPO_B" task request --agent agent.alpha --json >"$TMP_ROOT/auto-request-real.json"
json_assert "$TMP_ROOT/auto-request-real.json" 'payload.get("assigned") is True and payload.get("task", {}).get("auto_replenish") is False and payload.get("task", {}).get("title") == "real follow-up"' "real tasks should outrank owned auto-replenish fallback work"

echo "[vigorous-e2e] advisor providers + low-task automation"
"$BIN" --repo-root "$REPO_C" init --branch trunk >/dev/null
mkdir -p "$TMP_ROOT/advisor-prompts"
cat >"$TMP_ROOT/fake-advisor.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
ROLE=""
MODEL=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --role)
      ROLE="$2"
      shift 2
      ;;
    --model)
      MODEL="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done
if [[ -n "${ADVISOR_PROMPT_DIR:-}" ]]; then
  mkdir -p "$ADVISOR_PROMPT_DIR"
  cat >"$ADVISOR_PROMPT_DIR/${ROLE:-unknown}.txt"
else
  cat >/dev/null
fi
if [[ "$ROLE" == "reviewer" ]]; then
  cat <<JSON
{"summary":"Reviewer pass queued a docs follow-up","notes":["model=${MODEL}"],"findings":[{"title":"README needs advisor workflow coverage","severity":"low","detail":"The public docs do not explain the advisor flow yet.","evidence_paths":["README.md"]}],"tasks":[{"key":"review_docs","title":"Document advisor workflow","detail":"Add CLI and GUI advisor usage to the README.","priority":36,"tags":["advisor","docs"],"depends_on_keys":[]}]}
JSON
else
  cat <<JSON
{"summary":"Task manager refreshed the backlog","notes":["model=${MODEL}"],"findings":[],"tasks":[{"key":"advisor_contract","title":"Define advisor run contract","detail":"Document provider selection, low-water triggers, and task-sync rules.","priority":44,"tags":["advisor","docs"],"depends_on_keys":[]},{"key":"advisor_e2e","title":"Add advisor e2e coverage","detail":"Exercise low-water automation and manual review runs.","priority":40,"tags":["advisor","test"],"depends_on_keys":["advisor_contract"]}]}
JSON
fi
EOF
chmod +x "$TMP_ROOT/fake-advisor.sh"
"$BIN" --repo-root "$REPO_C" advisor workflow init --json >"$TMP_ROOT/advisor-workflow-init.json"
cat >"$REPO_C/FUGIT_WORKFLOW.md" <<'EOF'
---
advisor:
  auto_task_generation: true
  auto_review: true
  low_task_threshold: 1
  require_confirmation: true
reviewer:
  goal: "Review the repo-owned advisor workflow path"
  guidance:
    - "Prefer findings about missing docs or operator ergonomics."
task_manager:
  goal: "Generate the next workflow-driven backlog slice"
  guidance:
    - "Prefer deterministic docs and test tasks."
  max_tasks: 4
---
Use repo-owned workflow instructions.

- Keep findings brief.
- Keep generated tasks concrete.
EOF
"$BIN" --repo-root "$REPO_C" advisor workflow show --json >"$TMP_ROOT/advisor-workflow-show.json"
json_assert "$TMP_ROOT/advisor-workflow-show.json" 'payload.get("exists") is True and payload.get("valid") is True and payload.get("reviewer", {}).get("goal") == "Review the repo-owned advisor workflow path"' "advisor workflow show should load repo-owned workflow guidance"
"$BIN" --repo-root "$REPO_C" advisor workflow sync-policy --json >"$TMP_ROOT/advisor-workflow-sync.json"
json_assert "$TMP_ROOT/advisor-workflow-sync.json" 'payload.get("policy", {}).get("low_task_threshold") == 1 and payload.get("policy", {}).get("require_confirmation") is True' "advisor workflow sync should apply policy defaults"
"$BIN" --repo-root "$REPO_C" advisor provider add-command --name fake-advisor --executable "$TMP_ROOT/fake-advisor.sh" --arg "--role" --arg "{role}" --arg "--model" --arg "{model}" --json >"$TMP_ROOT/advisor-provider.json"
ADVISOR_PROVIDER_ID="$(python3 - "$TMP_ROOT/advisor-provider.json" <<'PY'
import json,sys
print(json.load(open(sys.argv[1]))["provider_id"])
PY
)"
"$BIN" --repo-root "$REPO_C" advisor provider assign --role reviewer --provider "$ADVISOR_PROVIDER_ID" --model claude-pro --json >"$TMP_ROOT/advisor-assign-reviewer.json"
"$BIN" --repo-root "$REPO_C" advisor provider assign --role task-manager --provider "$ADVISOR_PROVIDER_ID" --model qwen-lite --json >"$TMP_ROOT/advisor-assign-manager.json"
"$BIN" --repo-root "$REPO_C" advisor policy show --json >"$TMP_ROOT/advisor-policy.json"
json_assert "$TMP_ROOT/advisor-policy.json" 'payload.get("require_confirmation") is True and payload.get("low_task_threshold") == 1' "advisor workflow sync should configure the advisor policy"
ADVISOR_PROMPT_DIR="$TMP_ROOT/advisor-prompts" "$BIN" --repo-root "$REPO_C" task request --agent agent.lowwater --no-claim --json >"$TMP_ROOT/advisor-lowwater-request.json"
json_assert "$TMP_ROOT/advisor-lowwater-request.json" 'payload.get("advisor", {}).get("triggered") is True' "low-task request should queue advisor automation"
wait_for_advisor_worker "$REPO_C" reviewer
wait_for_advisor_worker "$REPO_C" task_manager
"$BIN" --repo-root "$REPO_C" advisor show --json >"$TMP_ROOT/advisor-show.json"
json_assert "$TMP_ROOT/advisor-show.json" 'payload.get("assignments", {}).get("reviewer", {}).get("provider_id") == "'"$ADVISOR_PROVIDER_ID"'" and payload.get("workers", {}).get("task_manager", {}).get("status") == "success" and payload.get("workflow", {}).get("exists") is True' "advisor show should expose assignments, worker status, and workflow state"
python3 - "$TMP_ROOT/advisor-prompts/reviewer.txt" <<'PY'
import sys
text = open(sys.argv[1], "r", encoding="utf-8").read()
if "Use repo-owned workflow instructions." not in text:
    raise SystemExit("workflow instructions missing from reviewer prompt")
PY
"$BIN" --repo-root "$REPO_C" task list --json >"$TMP_ROOT/advisor-task-list.json"
json_assert "$TMP_ROOT/advisor-task-list.json" 'any(row.get("title") == "Define advisor run contract" and row.get("awaiting_confirmation") is True for row in payload)' "advisor research should sync confirmation-gated tasks into the queue"
ADVISOR_TASK_ID="$(python3 - "$TMP_ROOT/advisor-task-list.json" <<'PY'
import json,sys
rows=json.load(open(sys.argv[1]))
for row in rows:
    if row.get("title") == "Define advisor run contract":
        print(row["task_id"])
        break
else:
    raise SystemExit("advisor task not found")
PY
)"
"$BIN" --repo-root "$REPO_C" task approve --task-id "$ADVISOR_TASK_ID" --agent agent.review >/dev/null
ADVISOR_PROMPT_DIR="$TMP_ROOT/advisor-prompts" "$BIN" --repo-root "$REPO_C" advisor review --goal "manual docs review" --sync-suggested-tasks --json >"$TMP_ROOT/advisor-review.json"
json_assert "$TMP_ROOT/advisor-review.json" 'payload.get("findings_count") >= 1 and payload.get("generated_task_count") >= 1 and payload.get("synced_task_count") >= 1' "manual advisor review should record findings and sync suggested tasks when requested"
MANUAL_ADVISOR_RUN_ID="$(python3 - "$TMP_ROOT/advisor-review.json" <<'PY'
import json,sys
print(json.load(open(sys.argv[1]))["run_id"])
PY
)"
"$BIN" --repo-root "$REPO_C" advisor run show --run-id "$MANUAL_ADVISOR_RUN_ID" --json >"$TMP_ROOT/advisor-run-show.json"
json_assert "$TMP_ROOT/advisor-run-show.json" 'payload.get("run_id") == "'"$MANUAL_ADVISOR_RUN_ID"'" and payload.get("workflow", {}).get("path", "").endswith("FUGIT_WORKFLOW.md")' "advisor run show should expose stored report workflow metadata"
"$BIN" --repo-root "$REPO_C" advisor run rerun --run-id "$MANUAL_ADVISOR_RUN_ID" --json >"$TMP_ROOT/advisor-rerun.json"
json_assert "$TMP_ROOT/advisor-rerun.json" 'payload.get("run_id") != "'"$MANUAL_ADVISOR_RUN_ID"'" and payload.get("generated_task_count", 0) >= 1' "advisor run rerun should execute a fresh pass"
"$BIN" --repo-root "$REPO_C" advisor runs --json >"$TMP_ROOT/advisor-runs.json"
json_assert "$TMP_ROOT/advisor-runs.json" 'len(payload) >= 3' "advisor runs should record low-water, manual, and rerun executions"

echo "[vigorous-e2e] task sync + reopen"
cat >"$REPO_A/the_final_plan.md" <<'EOF'
- [ ] `A-01` Define compiler contract
- [ ] `A-02` Add checkpoint json payloads
EOF
"$BIN" --repo-root "$REPO_A" task sync --plan "$REPO_A/the_final_plan.md" --json >"$TMP_ROOT/task-sync-1.json"
json_assert "$TMP_ROOT/task-sync-1.json" 'payload.get("schema_version") == "fugit.task.sync.v1" and len(payload.get("created", [])) == 2' "task sync should create plan-backed tasks"
SYNC_TASK_ID="$(python3 - "$TMP_ROOT/task-sync-1.json" <<'PY'
import json,sys
payload=json.load(open(sys.argv[1]))
print(payload["created"][1]["task_id"])
PY
)"
"$BIN" --repo-root "$REPO_A" task done --task-id "$SYNC_TASK_ID" --agent agent.sync --regression "test -f README.txt" >/dev/null
"$BIN" --repo-root "$REPO_A" task reopen --task-id "$SYNC_TASK_ID" --agent agent.sync --json >"$TMP_ROOT/task-reopen.json"
json_assert "$TMP_ROOT/task-reopen.json" 'payload.get("status") == "open" and payload.get("completed_at_utc") is None' "task reopen should clear completion metadata"
cat >"$REPO_A/the_final_plan.md" <<'EOF'
- [ ] `A-02` Add checkpoint json payloads
- [ ] `A-03` Add plan sync
EOF
"$BIN" --repo-root "$REPO_A" task sync --plan "$REPO_A/the_final_plan.md" --json >"$TMP_ROOT/task-sync-2.json"
json_assert "$TMP_ROOT/task-sync-2.json" 'len(payload.get("removed", [])) >= 1 and any(row.get("source_key") == "A-03" for row in payload.get("created", []))' "task sync should remove stale plan tasks and create new ones"

echo "[vigorous-e2e] quality gate + deprecate"
"$BIN" --repo-root "$REPO_A" check policy show --json >"$TMP_ROOT/check-policy-show.json"
json_assert "$TMP_ROOT/check-policy-show.json" 'payload.get("enabled") is True and payload.get("require_on_task_done") is True and payload.get("run_before_sync") is True' "quality checks should be enabled by default"
"$BIN" --repo-root "$REPO_A" check add --kind regression --command "exit 1" --task-id "$TASK_A" --agent agent.qa --json >"$TMP_ROOT/check-add-failing.json"
FAILING_CHECK_ID="$(python3 - "$TMP_ROOT/check-add-failing.json" <<'PY'
import json,sys
print(json.load(open(sys.argv[1]))["check_id"])
PY
)"
if "$BIN" --repo-root "$REPO_A" bridge sync-github --remote origin --branch trunk --no-push >/dev/null 2>&1; then
  echo "[vigorous-e2e] expected bridge sync to fail when a quality check fails" >&2
  exit 1
fi
"$BIN" --repo-root "$REPO_A" check deprecate --check-id "$FAILING_CHECK_ID" --reason "obsolete coverage" --agent agent.qa --json >"$TMP_ROOT/check-deprecate.json"
json_assert "$TMP_ROOT/check-deprecate.json" 'payload.get("deprecated_reason") == "obsolete coverage"' "check deprecate should record the deprecation reason"
"$BIN" --repo-root "$REPO_A" check run --json >"$TMP_ROOT/check-run.json"
json_assert "$TMP_ROOT/check-run.json" 'payload.get("ok") is True and payload.get("selected_count", 0) >= 1' "check run should pass once the stale failing check is deprecated"
"$BIN" --repo-root "$REPO_A" bridge sync-github --remote origin --branch trunk --no-push >/dev/null

echo "[vigorous-e2e] project registry"
"$BIN" project add --name proj-a --repo-root "$REPO_A" --set-default --json >"$TMP_ROOT/project-add-a.json"
"$BIN" project add --name proj-b --repo-root "$REPO_B" --json >"$TMP_ROOT/project-add-b.json"
"$BIN" project add --name proj-c --repo-root "$REPO_C" --json >"$TMP_ROOT/project-add-c.json"
"$BIN" project discover --root "$TMP_ROOT" --json >"$TMP_ROOT/project-discover.json"
json_assert "$TMP_ROOT/project-discover.json" 'payload.get("selected_project", {}).get("repo_root") is not None and len(payload.get("created", [])) + len(payload.get("updated", [])) >= 2' "project discover should find initialized fugit repos under the requested root"
"$BIN" project list --json >"$TMP_ROOT/project-list.json"
json_assert "$TMP_ROOT/project-list.json" 'isinstance(payload, list) and len(payload) >= 3 and any("is_most_recent" in row for row in payload)' "project list should include registry rows with recent-project metadata"
"$BIN" project use --name proj-b --json >"$TMP_ROOT/project-use.json"
"$BIN" project remove --name proj-b --json >"$TMP_ROOT/project-remove.json"

echo "[vigorous-e2e] task GUI + timeline API"
GUI_PORT="$("$BIN" --repo-root "$REPO_A" task gui --background --host 127.0.0.1 --port 0 --project proj-a --no-open --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["port"])')"
sleep 0.7
curl -s "http://127.0.0.1:$GUI_PORT/health" >"$TMP_ROOT/gui-health.json"
curl -s "http://127.0.0.1:$GUI_PORT/api/tasks?project=proj-a" >"$TMP_ROOT/gui-tasks.json"
curl -s "http://127.0.0.1:$GUI_PORT/api/timeline?project=proj-a&branch=trunk&limit=30&offset=0" >"$TMP_ROOT/gui-timeline.json"
curl -s -X POST "http://127.0.0.1:$GUI_PORT/api/tasks/add?project=proj-a" \
  -H "Content-Type: application/json" \
  -d '{"title":"gui task","priority":2,"tags":["gui"]}' >"$TMP_ROOT/gui-add.json"
GUI_TASK_ID="$(python3 - "$TMP_ROOT/gui-add.json" <<'PY'
import json,sys
print(json.load(open(sys.argv[1]))["task"]["task_id"])
PY
)"
curl -s -X POST "http://127.0.0.1:$GUI_PORT/api/tasks/edit?project=proj-a" \
  -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$GUI_TASK_ID\",\"title\":\"gui task updated\",\"detail\":\"board edited\",\"tags\":[\"gui\",\"edited\"],\"depends_on\":[]}" >"$TMP_ROOT/gui-edit.json"
curl -s -X POST "http://127.0.0.1:$GUI_PORT/api/tasks/remove?project=proj-a" \
  -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$GUI_TASK_ID\"}" >"$TMP_ROOT/gui-remove.json"
json_assert "$TMP_ROOT/gui-tasks.json" 'payload.get("schema_version") == "fugit.task.gui.snapshot.v1"' "task GUI payload schema mismatch"
json_assert "$TMP_ROOT/gui-timeline.json" 'payload.get("schema_version") == "fugit.task.gui.timeline.v1"' "timeline GUI payload schema mismatch"
json_assert "$TMP_ROOT/gui-timeline.json" 'any("task_action" in row for row in payload.get("events",[]))' "timeline payload should include task event metadata"
json_assert "$TMP_ROOT/gui-add.json" 'payload.get("ok") is True and payload.get("task",{}).get("task_id") is not None' "GUI add endpoint should return created task"
json_assert "$TMP_ROOT/gui-edit.json" 'payload.get("ok") is True and payload.get("task",{}).get("title") == "gui task updated"' "GUI edit endpoint should return updated task"
json_assert "$TMP_ROOT/gui-remove.json" 'payload.get("ok") is True and payload.get("task",{}).get("task_id") is not None' "GUI remove endpoint should return removed task"
GUI_PID="$(lsof -ti tcp:$GUI_PORT || true)"
if [[ -n "$GUI_PID" ]]; then
  kill "$GUI_PID" || true
fi

echo "[vigorous-e2e] advisor GUI API"
ADVISOR_GUI_PORT="$("$BIN" --repo-root "$REPO_C" task gui --background --host 127.0.0.1 --port 0 --project proj-c --no-open --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["port"])')"
sleep 0.7
curl -s "http://127.0.0.1:$ADVISOR_GUI_PORT/api/advisor?project=proj-c" >"$TMP_ROOT/gui-advisor.json"
GUI_ADVISOR_RUN_ID="$(python3 - "$TMP_ROOT/gui-advisor.json" <<'PY'
import json,sys
payload=json.load(open(sys.argv[1]))
runs=payload.get("runs") or []
if not runs:
    raise SystemExit("advisor gui has no runs")
print(runs[0]["run_id"])
PY
)"
curl -s "http://127.0.0.1:$ADVISOR_GUI_PORT/api/advisor/run-detail?project=proj-c&run_id=$GUI_ADVISOR_RUN_ID" >"$TMP_ROOT/gui-advisor-detail.json"
curl -s -X POST "http://127.0.0.1:$ADVISOR_GUI_PORT/api/advisor/rerun?project=proj-c" \
  -H "Content-Type: application/json" \
  -d "{\"run_id\":\"$GUI_ADVISOR_RUN_ID\",\"background\":false}" >"$TMP_ROOT/gui-advisor-rerun.json"
json_assert "$TMP_ROOT/gui-advisor.json" 'payload.get("workflow", {}).get("exists") is True and len(payload.get("runs", [])) >= 1' "advisor GUI payload should expose workflow state and recent runs"
json_assert "$TMP_ROOT/gui-advisor-detail.json" 'payload.get("report", {}).get("run_id") == "'"$GUI_ADVISOR_RUN_ID"'"' "advisor GUI detail endpoint should return the selected run report"
json_assert "$TMP_ROOT/gui-advisor-rerun.json" 'payload.get("ok") is True and payload.get("result", {}).get("run_id") is not None' "advisor GUI rerun endpoint should execute the selected run"
ADVISOR_GUI_PID="$(lsof -ti tcp:$ADVISOR_GUI_PORT || true)"
if [[ -n "$ADVISOR_GUI_PID" ]]; then
  kill "$ADVISOR_GUI_PID" || true
fi

echo "[vigorous-e2e] gui launcher wrapper"
WRAPPER_PORT=7816
FUGIT_BIN="$BIN" FUGIT_GUI_ROOT="$TMP_ROOT" FUGIT_GUI_PORT="$WRAPPER_PORT" "$REPO_ROOT/scripts/fugit-gui" --project proj-a --no-open >/dev/null
sleep 0.7
curl -s "http://127.0.0.1:$WRAPPER_PORT/api/tasks?project=proj-a" >"$TMP_ROOT/gui-wrapper.json"
json_assert "$TMP_ROOT/gui-wrapper.json" 'payload.get("selected_project", {}).get("key") == "proj-a"' "fugit-gui wrapper should launch the board against the requested project"
WRAPPER_PID="$(lsof -ti tcp:$WRAPPER_PORT || true)"
if [[ -n "$WRAPPER_PID" ]]; then
  kill "$WRAPPER_PID" || true
fi

echo "[vigorous-e2e] bridge auth/sync/pull"
"$BIN" --repo-root "$REPO_A" bridge summary --limit 5 --markdown >/dev/null
"$BIN" --repo-root "$REPO_A" bridge auth status --json --host example.com >"$TMP_ROOT/bridge-auth-status.json"
"$BIN" --repo-root "$REPO_A" bridge auth login --host example.com --token "token-e2e" --helper store >/dev/null
"$BIN" --repo-root "$REPO_A" bridge auth logout --host example.com --username x-access-token >/dev/null
"$BIN" --repo-root "$REPO_A" bridge sync-github --remote origin --branch trunk --event-count 5 >/dev/null

git clone "$REMOTE_BARE" "$CLONE_B" >/dev/null 2>&1
git -C "$CLONE_B" config user.name "fugit-e2e"
git -C "$CLONE_B" config user.email "fugit-e2e@example.local"
git -C "$CLONE_B" checkout -B trunk origin/trunk >/dev/null
echo "remote-change" >>"$CLONE_B/README.txt"
git -C "$CLONE_B" add README.txt
git -C "$CLONE_B" commit -m "remote update" >/dev/null
git -C "$CLONE_B" push origin trunk >/dev/null
echo "local-uncommitted" >>"$REPO_A/local-note.txt"
"$BIN" --repo-root "$REPO_A" bridge pull-github --remote origin --branch trunk --autostash >/dev/null

echo "[vigorous-e2e] gc/doctor/skill"
"$BIN" --repo-root "$REPO_A" gc --dry-run --json >"$TMP_ROOT/gc.json"
"$BIN" --repo-root "$REPO_A" doctor --json >"$TMP_ROOT/doctor.json"
"$BIN" skill show --json --include-openai-yaml >"$TMP_ROOT/skill-show.json"
"$BIN" skill doctor --json >"$TMP_ROOT/skill-doctor.json"
"$BIN" skill install-codex --overwrite >/dev/null
json_assert "$TMP_ROOT/skill-doctor.json" 'payload.get("ok") is True' "skill doctor should pass"

echo "[vigorous-e2e] doctor fix"
INDEX_HASH="$(python3 - "$REPO_A/.fugit/branches/trunk/index.json" <<'PY'
import json, sys
index = json.load(open(sys.argv[1]))
print(index["README.txt"]["hash"])
PY
)"
rm -f "$REPO_A/.fugit/objects/$INDEX_HASH"
"$BIN" --repo-root "$REPO_A" doctor --fix --json >"$TMP_ROOT/doctor-fix.json"
json_assert "$TMP_ROOT/doctor-fix.json" 'payload.get("repair",{}).get("requested") is True and payload.get("repair",{}).get("repaired_count", 0) >= 1 and payload.get("summary",{}).get("pass") is True' "doctor --fix should repair missing timeline objects"

echo "[vigorous-e2e] checkpoint json errors"
REPO_C="$TMP_ROOT/repo-c"
create_git_repo "$REPO_C"
echo "alpha" >"$REPO_C/tracked.txt"
git -C "$REPO_C" add tracked.txt
git -C "$REPO_C" commit -m "seed repo-c" >/dev/null
"$BIN" --repo-root "$REPO_C" init --branch trunk >/dev/null
echo "beta" >"$REPO_C/tracked.txt"
"$BIN" --repo-root "$REPO_C" checkpoint --summary "beta" --json >"$TMP_ROOT/checkpoint-ok.json"
json_assert "$TMP_ROOT/checkpoint-ok.json" 'payload.get("ok") is True and payload.get("event_id") is not None' "checkpoint --json should emit structured success payload"
INDEX_HASH_C="$(python3 - "$REPO_C/.fugit/branches/trunk/index.json" <<'PY'
import json, sys
index = json.load(open(sys.argv[1]))
print(index["tracked.txt"]["hash"])
PY
)"
rm -f "$REPO_C/.fugit/objects/$INDEX_HASH_C"
echo "gamma" >"$REPO_C/tracked.txt"
if "$BIN" --repo-root "$REPO_C" checkpoint --summary "gamma" --json >"$TMP_ROOT/checkpoint-error.json"; then
  echo "[vigorous-e2e] expected checkpoint --json failure when old object blob is missing" >&2
  exit 1
fi
json_assert "$TMP_ROOT/checkpoint-error.json" 'payload.get("ok") is False and payload.get("error", {}).get("code") == "missing_old_objects" and len(payload.get("error", {}).get("missing_blobs", [])) >= 1' "checkpoint --json should emit structured failure payload"
"$BIN" --repo-root "$REPO_C" checkpoint --summary "gamma preflight" --preflight --json >"$TMP_ROOT/checkpoint-preflight.json"
json_assert "$TMP_ROOT/checkpoint-preflight.json" 'payload.get("ready") is False and len(payload.get("missing_old_objects", [])) >= 1' "checkpoint --preflight should surface missing old objects without writing a new event"
"$BIN" --repo-root "$REPO_C" checkpoint --summary "gamma repaired" --repair-missing-blobs --json >"$TMP_ROOT/checkpoint-repair-alias.json"
json_assert "$TMP_ROOT/checkpoint-repair-alias.json" 'payload.get("ok") is True and payload.get("repair_mode") == "auto"' "checkpoint --repair-missing-blobs should act as an auto-repair alias"
printf '{"broken":\n' >>"$REPO_C/.fugit/branches/trunk/events.jsonl"
echo "delta" >>"$REPO_C/tracked.txt"
"$BIN" --repo-root "$REPO_C" bridge sync-github --no-push --repair-journal >/dev/null
BACKUP_COUNT="$(find "$REPO_C/.fugit/branches/trunk" -maxdepth 1 -name 'events.jsonl.bak.*' | wc -l | tr -d ' ')"
if [[ "${BACKUP_COUNT:-0}" -lt 1 ]]; then
  echo "[vigorous-e2e] expected bridge sync --repair-journal to create a journal backup" >&2
  exit 1
fi

echo "[vigorous-e2e] quickstart flow"
REPO_Q="$TMP_ROOT/repo-quickstart"
create_git_repo "$REPO_Q"
echo "quickstart" >"$REPO_Q/q.txt"
git -C "$REPO_Q" add q.txt
git -C "$REPO_Q" commit -m "seed quickstart" >/dev/null
"$BIN" --repo-root "$REPO_Q" quickstart --branch trunk --summary "quickstart checkpoint" --agent agent.q >/dev/null

echo "[vigorous-e2e] MCP tool flow"
python3 - "$BIN" "$REPO_A" <<'PY'
import json, subprocess, sys

bin_path, repo_root = sys.argv[1], sys.argv[2]
proc = subprocess.Popen(
    [bin_path, "--repo-root", repo_root, "mcp", "serve"],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
)

def send(msg):
    payload = json.dumps(msg).encode("utf-8")
    header = f"Content-Length: {len(payload)}\r\n\r\n".encode("utf-8")
    proc.stdin.write(header + payload)
    proc.stdin.flush()

def recv():
    def read_line():
        return proc.stdout.readline()
    content_length = None
    while True:
        line = read_line()
        if not line:
            raise RuntimeError("mcp server closed stdout")
        if line in (b"\r\n", b"\n"):
            break
        token = line.decode("utf-8").strip()
        if token.lower().startswith("content-length:"):
            content_length = int(token.split(":", 1)[1].strip())
    if content_length is None:
        raise RuntimeError("missing content-length")
    body = proc.stdout.read(content_length)
    return json.loads(body.decode("utf-8"))

send({"jsonrpc":"2.0","id":1,"method":"initialize","params":{}})
resp = recv()
if "result" not in resp:
    raise RuntimeError(f"initialize failed: {resp}")

send({"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}})
resp = recv()
tools = resp.get("result", {}).get("tools", [])
if not any(t.get("name") == "fugit_task_request" for t in tools):
    raise RuntimeError("missing fugit_task_request in MCP tools")
if not any(t.get("name") == "fugit_task_show" for t in tools):
    raise RuntimeError("missing fugit_task_show in MCP tools")
if not any(t.get("name") == "fugit_task_current" for t in tools):
    raise RuntimeError("missing fugit_task_current in MCP tools")
if not any(t.get("name") == "fugit_task_edit" for t in tools):
    raise RuntimeError("missing fugit_task_edit in MCP tools")
if not any(t.get("name") == "fugit_task_remove" for t in tools):
    raise RuntimeError("missing fugit_task_remove in MCP tools")
if not any(t.get("name") == "fugit_task_sync" for t in tools):
    raise RuntimeError("missing fugit_task_sync in MCP tools")
if not any(t.get("name") == "fugit_task_reopen" for t in tools):
    raise RuntimeError("missing fugit_task_reopen in MCP tools")
if not any(t.get("name") == "fugit_check_run" for t in tools):
    raise RuntimeError("missing fugit_check_run in MCP tools")
if not any(t.get("name") == "fugit_check_deprecate" for t in tools):
    raise RuntimeError("missing fugit_check_deprecate in MCP tools")

send({
    "jsonrpc":"2.0",
    "id":3,
    "method":"tools/call",
    "params":{"name":"fugit_status","arguments":{"limit":5}}
})
resp = recv()
if "result" not in resp:
    raise RuntimeError(f"fugit_status MCP call failed: {resp}")

send({
    "jsonrpc":"2.0",
    "id":31,
    "method":"tools/call",
    "params":{"name":"fugit_task_list","arguments":{"limit":2,"fields":["task_id","title"]}}
})
resp = recv()
listed = resp.get("result", {}).get("structuredContent", [])
if "result" not in resp or not listed or set(listed[0].keys()) != {"task_id","title"}:
    raise RuntimeError(f"fugit_task_list MCP compact call failed: {resp}")

send({
    "jsonrpc":"2.0",
    "id":4,
    "method":"tools/call",
    "params":{"name":"fugit_task_add","arguments":{"title":"mcp task","priority":3}}
})
resp = recv()
if "result" not in resp:
    raise RuntimeError(f"fugit_task_add MCP call failed: {resp}")
mcp_task = resp["result"].get("structuredContent", {})
mcp_task_id = mcp_task.get("task_id")
if not mcp_task_id:
    raise RuntimeError(f"fugit_task_add MCP call returned no task id: {resp}")

send({
    "jsonrpc":"2.0",
    "id":5,
    "method":"tools/call",
    "params":{"name":"fugit_task_edit","arguments":{"task_id":mcp_task_id,"detail":"mcp edited","tags":["mcp","edited"]}}
})
resp = recv()
edited = resp.get("result", {}).get("structuredContent", {})
if "result" not in resp or edited.get("detail") != "mcp edited":
    raise RuntimeError(f"fugit_task_edit MCP call failed: {resp}")

send({
    "jsonrpc":"2.0",
    "id":6,
    "method":"tools/call",
    "params":{"name":"fugit_task_request","arguments":{"agent":"agent.preview","no_claim":True,"max":2}}
})
resp = recv()
preview = resp.get("result", {}).get("structuredContent", {})
if "result" not in resp or preview.get("assigned_count", 0) < 1 or not isinstance(preview.get("tasks"), list):
    raise RuntimeError(f"fugit_task_request preview MCP call failed: {resp}")

send({
    "jsonrpc":"2.0",
    "id":7,
    "method":"tools/call",
    "params":{"name":"fugit_task_show","arguments":{"task_id":mcp_task_id}}
})
resp = recv()
shown = resp.get("result", {}).get("structuredContent", {})
if "result" not in resp or shown.get("task_id") != mcp_task_id:
    raise RuntimeError(f"fugit_task_show MCP call failed: {resp}")

send({
    "jsonrpc":"2.0",
    "id":75,
    "method":"tools/call",
    "params":{"name":"fugit_task_request","arguments":{"agent":"agent.targeted","task_id":mcp_task_id,"no_claim":True}}}
)
resp = recv()
targeted = resp.get("result", {}).get("structuredContent", {})
if "result" not in resp or targeted.get("task", {}).get("task_id") != mcp_task_id:
    raise RuntimeError(f"fugit_task_request targeted MCP call failed: {resp}")

send({
    "jsonrpc":"2.0",
    "id":74,
    "method":"tools/call",
    "params":{"name":"fugit_task_current","arguments":{"agent":"agent.runner"}}}
)
resp = recv()
current_payload = resp.get("result", {}).get("structuredContent", {})
if "result" not in resp or current_payload.get("found") is not True:
    raise RuntimeError(f"fugit_task_current MCP call failed: {resp}")

send({
    "jsonrpc":"2.0",
    "id":71,
    "method":"tools/call",
    "params":{"name":"fugit_task_sync","arguments":{"markdown":"- [ ] `MCP-01` Add mcp synced task","agent":"agent.mcp"}}}
)
resp = recv()
sync_payload = resp.get("result", {}).get("structuredContent", {})
if "result" not in resp or not sync_payload.get("created"):
    raise RuntimeError(f"fugit_task_sync MCP call failed: {resp}")
sync_task_id = sync_payload["created"][0]["task_id"]

send({
    "jsonrpc":"2.0",
    "id":72,
    "method":"tools/call",
    "params":{"name":"fugit_task_done","arguments":{"task_id":sync_task_id,"agent":"agent.mcp","summary":"done via mcp","regressions":["test -f README.txt"]}}}
)
resp = recv()
if "result" not in resp:
    raise RuntimeError(f"fugit_task_done MCP call failed: {resp}")

send({
    "jsonrpc":"2.0",
    "id":721,
    "method":"tools/call",
    "params":{"name":"fugit_check_run","arguments":{}}
})
resp = recv()
quality_payload = resp.get("result", {}).get("structuredContent", {})
if "result" not in resp or quality_payload.get("ok") is not True:
    raise RuntimeError(f"fugit_check_run MCP call failed: {resp}")

send({
    "jsonrpc":"2.0",
    "id":73,
    "method":"tools/call",
    "params":{"name":"fugit_task_reopen","arguments":{"task_id":sync_task_id,"agent":"agent.mcp"}}}
)
resp = recv()
reopened = resp.get("result", {}).get("structuredContent", {})
if "result" not in resp or reopened.get("status") != "open":
    raise RuntimeError(f"fugit_task_reopen MCP call failed: {resp}")

send({
    "jsonrpc":"2.0",
    "id":8,
    "method":"tools/call",
    "params":{"name":"fugit_task_remove","arguments":{"task_id":mcp_task_id}}
})
resp = recv()
removed = resp.get("result", {}).get("structuredContent", {})
if "result" not in resp or removed.get("task_id") != mcp_task_id:
    raise RuntimeError(f"fugit_task_remove MCP call failed: {resp}")

proc.terminate()
proc.wait(timeout=5)
PY

echo "[vigorous-e2e] complete: all checks passed"
