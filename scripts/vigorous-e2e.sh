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
trap 'rm -rf "$TMP_ROOT"' EXIT

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

echo "[vigorous-e2e] preparing repositories"
REPO_A="$TMP_ROOT/repo-a"
REPO_B="$TMP_ROOT/repo-b"
REMOTE_BARE="$TMP_ROOT/remote.git"
CLONE_B="$TMP_ROOT/clone-b"

create_git_repo "$REPO_A"
create_git_repo "$REPO_B"
git init --bare "$REMOTE_BARE" >/dev/null

echo "alpha" >"$REPO_A/README.txt"
git -C "$REPO_A" add README.txt
git -C "$REPO_A" commit -m "seed repo-a" >/dev/null
git -C "$REPO_A" remote add origin "$REMOTE_BARE"
git -C "$REPO_A" push -u origin trunk >/dev/null

echo "beta" >"$REPO_B/README.txt"
git -C "$REPO_B" add README.txt
git -C "$REPO_B" commit -m "seed repo-b" >/dev/null

echo "[vigorous-e2e] init/status/backend"
"$BIN" --version >/dev/null
"$BIN" --repo-root "$REPO_A" init --branch trunk >/dev/null
"$BIN" --repo-root "$REPO_A" status --json >"$TMP_ROOT/status.json"
json_assert "$TMP_ROOT/status.json" 'payload.get("schema_version") == "timeline.status.v1" and payload.get("branch") == "trunk"' "status schema/branch mismatch after init"
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
"$BIN" --repo-root "$REPO_A" task remove --task-id "$TASK_C" --agent agent.c >/dev/null
"$BIN" --repo-root "$REPO_A" task request --agent agent.runner --no-claim --max 2 --json >"$TMP_ROOT/task-request-preview.json"
json_assert "$TMP_ROOT/task-request-preview.json" 'payload.get("assigned_count", 0) >= 1 and isinstance(payload.get("tasks"), list)' "task request preview should return a prioritized slice"
"$BIN" --repo-root "$REPO_A" task request --agent agent.runner --focus root --json >"$TMP_ROOT/task-request-1.json"
json_assert "$TMP_ROOT/task-request-1.json" 'payload.get("assigned") is True and payload.get("task",{}).get("task_id") is not None' "task request should assign a task"
"$BIN" --repo-root "$REPO_A" task done --task-id "$TASK_A" --agent agent.runner --summary "root lane complete" --artifact "$TMP_ROOT/task-a-edit.json" --command "cargo test" >/dev/null
"$BIN" --repo-root "$REPO_A" task request --agent agent.runner --json >"$TMP_ROOT/task-request-2.json"
json_assert "$TMP_ROOT/task-request-2.json" 'payload.get("assigned") is True' "second task request should assign dependent task after completion"
"$BIN" --repo-root "$REPO_A" task show --task-id "$TASK_A" --json >"$TMP_ROOT/task-a-done.json"
json_assert "$TMP_ROOT/task-a-done.json" 'payload.get("completed_summary") == "root lane complete" and "cargo test" in payload.get("completion_commands", [])' "task show should include completion metadata"
"$BIN" --repo-root "$REPO_A" log --limit 50 --json >"$TMP_ROOT/log-task.json"
json_assert "$TMP_ROOT/log-task.json" 'any("task done:" in row.get("summary","") for row in payload)' "task actions should be mirrored into timeline events"
json_assert "$TMP_ROOT/log-task.json" 'any("task edit:" in row.get("summary","") for row in payload) and any("task remove:" in row.get("summary","") for row in payload)' "edit/remove actions should be mirrored into timeline events"

echo "[vigorous-e2e] project registry"
"$BIN" project add --name proj-a --repo-root "$REPO_A" --set-default --json >"$TMP_ROOT/project-add-a.json"
"$BIN" project add --name proj-b --repo-root "$REPO_B" --json >"$TMP_ROOT/project-add-b.json"
"$BIN" project list --json >"$TMP_ROOT/project-list.json"
json_assert "$TMP_ROOT/project-list.json" 'isinstance(payload, list) and len(payload) >= 2' "project list should include registered projects"
"$BIN" project use --name proj-b --json >"$TMP_ROOT/project-use.json"
"$BIN" project remove --name proj-b --json >"$TMP_ROOT/project-remove.json"

echo "[vigorous-e2e] task GUI + timeline API"
GUI_PORT=7815
"$BIN" --repo-root "$REPO_A" task gui --background --host 127.0.0.1 --port "$GUI_PORT" --project proj-a --no-open >/dev/null
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
if not any(t.get("name") == "fugit_task_edit" for t in tools):
    raise RuntimeError("missing fugit_task_edit in MCP tools")
if not any(t.get("name") == "fugit_task_remove" for t in tools):
    raise RuntimeError("missing fugit_task_remove in MCP tools")

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
