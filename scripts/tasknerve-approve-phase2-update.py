#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

DEFAULT_REVIEW_QUEUE_REL = "taskNerve/update/review_update_queue.json"


def read_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default
    except json.JSONDecodeError:
        return default


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def parse_issue_number(value: str | None) -> int | None:
    if not value:
        return None
    value = value.strip()
    if not value:
        return None
    if value.isdigit():
        return int(value)
    match = re.search(r"/issues/(\\d+)", value)
    if match:
        return int(match.group(1))
    return None


def close_issue(repo_root: Path, repo: str, issue_number: int, comment: str | None) -> None:
    gh_bin = shutil.which("gh")
    if not gh_bin:
        raise RuntimeError("gh CLI not found in PATH")
    if comment:
        subprocess.run(
            [gh_bin, "issue", "comment", str(issue_number), "--repo", repo, "--body", comment],
            cwd=str(repo_root),
            check=True,
        )
    subprocess.run(
        [gh_bin, "issue", "close", str(issue_number), "--repo", repo],
        cwd=str(repo_root),
        check=True,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Approve a TaskNerve phase-2 update queue item.")
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--review-queue-file", default=DEFAULT_REVIEW_QUEUE_REL)
    parser.add_argument("--fingerprint", default=None)
    parser.add_argument("--close-issue", action="store_true")
    parser.add_argument("--issue-repo", default=None)
    parser.add_argument("--issue-number", default=None)
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve()
    queue_path = (repo_root / args.review_queue_file).resolve()
    queue = read_json(queue_path, {"schema_version": "tasknerve.update_review_queue.v1", "items": []})
    items = queue.get("items") if isinstance(queue, dict) else None
    if not isinstance(items, list):
        print("Invalid review queue format.", file=sys.stderr)
        return 1

    target_index = -1
    if args.fingerprint:
        for idx, row in enumerate(items):
            if isinstance(row, dict) and row.get("fingerprint") == args.fingerprint:
                target_index = idx
                break
    else:
        for idx, row in enumerate(items):
            if isinstance(row, dict) and row.get("status") in {"awaiting-owner-approval", "github-issue-opened"}:
                target_index = idx
                break

    if target_index < 0:
        print("No matching phase-2 queue item found.", file=sys.stderr)
        return 1

    item = items[target_index]
    if not isinstance(item, dict):
        print("Selected queue item is invalid.", file=sys.stderr)
        return 1

    item["status"] = "owner-approved"
    item["approved_by"] = "owner"
    item["approved_at_utc"] = __import__("datetime").datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
    items[target_index] = item
    queue["items"] = items
    queue["updated_at_utc"] = item["approved_at_utc"]
    write_json(queue_path, queue)

    if args.close_issue:
        issue_meta = item.get("github_issue") if isinstance(item.get("github_issue"), dict) else {}
        repo = args.issue_repo or __import__("os").environ.get("TASKNERVE_UPDATE_ISSUE_REPO") or "adimus/taskNerve"
        issue_number = parse_issue_number(args.issue_number) or parse_issue_number(issue_meta.get("issue_url"))
        if issue_number:
            close_issue(
                repo_root=repo_root,
                repo=repo,
                issue_number=issue_number,
                comment="Phase-2 update approved in TaskNerve queue; moving to implementation/release.",
            )

    print(json.dumps(item, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
