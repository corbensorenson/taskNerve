#!/usr/bin/env python3
"""
TaskNerve Codex Update Interceptor

Flow:
upstream Codex appcast -> deterministic triage -> optional Codex AI triage/apply ->
phase 1 critical auto path + phase 2 review queue -> optional GitHub issue creation.
"""

from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import textwrap
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

SCHEMA_INTERCEPTOR_POLICY = "tasknerve.update_interceptor_policy.v1"
SCHEMA_INTERCEPTOR_STATE = "tasknerve.codex_upstream_state.v1"
SCHEMA_UPDATE_CHANNEL = "tasknerve.update_channel_manifest.v1"
SCHEMA_CRITICAL_QUEUE = "tasknerve.update_critical_queue.v1"
SCHEMA_REVIEW_QUEUE = "tasknerve.update_review_queue.v1"
SPARKLE_NS = "http://www.andymatuschak.org/xml-namespaces/sparkle"

DEFAULT_UPSTREAM_FEED = "https://persistent.oaistatic.com/codex-app-prod/appcast.xml"
DEFAULT_POLICY_REL = "taskNerve/update/update_interceptor_policy.json"
DEFAULT_STATE_REL = "taskNerve/update/upstream_codex_state.json"
DEFAULT_CHANNEL_REL = "taskNerve/update/update_channel_manifest.json"
DEFAULT_REPORT_REL = "target/update-interceptor/last_interceptor_report.json"
DEFAULT_CRITICAL_QUEUE_REL = "taskNerve/update/critical_update_queue.json"
DEFAULT_REVIEW_QUEUE_REL = "taskNerve/update/review_update_queue.json"

KEYWORD_AREAS = {
    "protocol": [
        "protocol",
        "schema",
        "wire format",
        "api contract",
        "backward compatible",
        "breaking change",
    ],
    "threads": [
        "thread",
        "conversation",
        "resume",
        "history",
        "compression",
        "context",
    ],
    "models": [
        "model",
        "reasoning",
        "token",
        "context length",
        "fast mode",
        "temperature",
    ],
    "auth": [
        "auth",
        "authentication",
        "login",
        "logout",
        "credential",
        "keychain",
        "session",
    ],
    "filesystem": [
        "workspace",
        "file watcher",
        "fs events",
        "documents access",
        "permissions",
        "project root",
    ],
    "updater": [
        "update",
        "updater",
        "sparkle",
        "appcast",
        "installer",
        "dmg",
    ],
    "ui": [
        "render",
        "sidebar",
        "drawer",
        "toolbar",
        "layout",
        "jank",
        "slow",
        "lag",
    ],
    "runtime": [
        "electron",
        "main process",
        "ipc",
        "bridge",
        "host",
        "runtime",
    ],
}


def utc_now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def read_json(path: Path, default: Any) -> Any:
    try:
        raw = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return default
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return default


def write_json_if_changed(path: Path, payload: Any) -> bool:
    normalized = json.dumps(payload, indent=2, sort_keys=False) + "\n"
    current = path.read_text(encoding="utf-8") if path.exists() else None
    if current == normalized:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(normalized, encoding="utf-8")
    return True


def normalize_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    rows: list[str] = []
    for entry in value:
        if not isinstance(entry, str):
            continue
        normalized = entry.strip()
        if normalized and normalized not in rows:
            rows.append(normalized)
    return rows


def trim_history(entries: list[dict[str, Any]], max_entries: int) -> list[dict[str, Any]]:
    if len(entries) <= max_entries:
        return entries
    return entries[-max_entries:]


def normalize_queue(payload: Any, schema_version: str) -> dict[str, Any]:
    if not isinstance(payload, dict):
        payload = {}
    rows = payload.get("items") if isinstance(payload.get("items"), list) else []
    return {
        "schema_version": schema_version,
        "updated_at_utc": str(payload.get("updated_at_utc") or utc_now_iso()),
        "items": [entry for entry in rows if isinstance(entry, dict)],
    }


def upsert_queue_item(queue: dict[str, Any], fingerprint: str, item: dict[str, Any], max_entries: int) -> None:
    rows = queue.get("items") if isinstance(queue.get("items"), list) else []
    replaced = False
    for idx, row in enumerate(rows):
        if isinstance(row, dict) and row.get("fingerprint") == fingerprint:
            rows[idx] = item
            replaced = True
            break
    if not replaced:
        rows.append(item)
    queue["items"] = trim_history(rows, max_entries)
    queue["updated_at_utc"] = utc_now_iso()


def fetch_text(url: str, timeout_seconds: int) -> str:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "tasknerve-update-interceptor/1.0",
            "Accept": "application/xml,text/xml,text/html,text/plain,*/*",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
        return response.read().decode("utf-8", errors="replace")


def strip_html(raw: str) -> str:
    without_tags = re.sub(r"<[^>]+>", " ", raw)
    unescaped = html.unescape(without_tags)
    return re.sub(r"\s+", " ", unescaped).strip()


def sparkle_attr(name: str) -> str:
    return f"{{{SPARKLE_NS}}}{name}"


def parse_appcast_latest(feed_xml: str) -> dict[str, Any]:
    root = ET.fromstring(feed_xml)
    item = root.find(".//item")
    if item is None:
        raise ValueError("upstream appcast has no item entries")

    enclosure = item.find("enclosure")
    title = (item.findtext("title") or "").strip() or None
    description_raw = item.findtext("description") or ""
    description = strip_html(description_raw) if description_raw else ""
    pub_date = (item.findtext("pubDate") or "").strip() or None
    release_notes_link = (item.findtext(sparkle_attr("releaseNotesLink")) or "").strip() or None

    enclosure_url = None
    short_version = None
    build_version = None
    if enclosure is not None:
        enclosure_url = (enclosure.attrib.get("url") or "").strip() or None
        short_version = (
            (enclosure.attrib.get(sparkle_attr("shortVersionString")) or "").strip() or None
        )
        build_version = (enclosure.attrib.get(sparkle_attr("version")) or "").strip() or None

    if short_version is None and title:
        match = re.search(r"\b(\d+\.\d+(?:\.\d+)*)\b", title)
        if match:
            short_version = match.group(1)
    if build_version is None and title:
        match = re.search(r"\bbuild[\s:#-]*(\d+)\b", title, flags=re.IGNORECASE)
        if match:
            build_version = match.group(1)

    if not short_version and not build_version:
        raise ValueError("unable to parse upstream version/build from appcast")

    return {
        "title": title,
        "description": description,
        "published_at_utc": pub_date,
        "release_notes_url": release_notes_link,
        "download_url": enclosure_url,
        "upstream_version": short_version,
        "upstream_build": build_version,
    }


def detect_areas(text_blob: str) -> dict[str, list[str]]:
    lowered = text_blob.lower()
    matched: dict[str, list[str]] = {}
    for area, terms in KEYWORD_AREAS.items():
        hits = [term for term in terms if term in lowered]
        if hits:
            matched[area] = sorted(set(hits))
    return matched


def normalize_policy(policy: dict[str, Any]) -> dict[str, Any]:
    ai = policy.get("ai") if isinstance(policy.get("ai"), dict) else {}
    checks = policy.get("checks") if isinstance(policy.get("checks"), dict) else {}
    decision = policy.get("decision") if isinstance(policy.get("decision"), dict) else {}
    issues = policy.get("issues") if isinstance(policy.get("issues"), dict) else {}
    return {
        "schema_version": policy.get("schema_version") or SCHEMA_INTERCEPTOR_POLICY,
        "updated_at_utc": policy.get("updated_at_utc") or utc_now_iso(),
        "upstream_feed_url": (
            str(policy.get("upstream_feed_url")).strip()
            if isinstance(policy.get("upstream_feed_url"), str)
            else DEFAULT_UPSTREAM_FEED
        ),
        "tasknerve_appcast_url": (
            str(policy.get("tasknerve_appcast_url")).strip()
            if isinstance(policy.get("tasknerve_appcast_url"), str)
            else ""
        ),
        "ai": {
            "enabled": bool(ai.get("enabled", True)),
            "model": str(ai.get("model")).strip() if isinstance(ai.get("model"), str) else "gpt-5.3-codex",
            "min_confidence": float(ai.get("min_confidence", 0.6)),
            "timeout_seconds": int(ai.get("timeout_seconds", 360)),
            "auto_apply_enabled": bool(ai.get("auto_apply_enabled", False)),
            "apply_timeout_seconds": int(ai.get("apply_timeout_seconds", 1800)),
        },
        "decision": {
            "required_review_areas": normalize_string_list(decision.get("required_review_areas"))
            or ["protocol", "threads", "models", "auth", "filesystem", "updater", "runtime"],
            "critical_areas": normalize_string_list(decision.get("critical_areas"))
            or ["protocol", "threads", "models", "auth", "filesystem", "updater", "runtime"],
            "hard_block_terms": normalize_string_list(decision.get("hard_block_terms")),
            "auto_promote_on_pass": bool(decision.get("auto_promote_on_pass", True)),
            "phase_two_requires_owner_approval": bool(
                decision.get("phase_two_requires_owner_approval", True)
            ),
            "max_history_entries": int(decision.get("max_history_entries", 32)),
        },
        "checks": {
            "base_commands": normalize_string_list(checks.get("base_commands")),
            "area_commands": {
                key: normalize_string_list(value)
                for key, value in (checks.get("area_commands") or {}).items()
                if isinstance(key, str)
            },
            "ai_recommended_command_aliases": {
                key: str(value).strip()
                for key, value in (checks.get("ai_recommended_command_aliases") or {}).items()
                if isinstance(key, str) and isinstance(value, str) and value.strip()
            },
        },
        "issues": {
            "enabled": bool(issues.get("enabled", True)),
            "repo": str(issues.get("repo")).strip() if isinstance(issues.get("repo"), str) else "",
            "labels": normalize_string_list(issues.get("labels")) or ["update-interceptor", "non-critical"],
            "assignees": normalize_string_list(issues.get("assignees")),
        },
    }


def deterministic_classification(candidate: dict[str, Any], policy: dict[str, Any]) -> dict[str, Any]:
    combined_text = "\n".join(
        [
            candidate.get("title") or "",
            candidate.get("description") or "",
            candidate.get("release_notes_text") or "",
        ]
    )
    area_hits = detect_areas(combined_text)
    matched_areas = sorted(area_hits.keys())
    hard_block_terms = [term.lower() for term in policy["decision"]["hard_block_terms"]]
    lowered_blob = combined_text.lower()
    hard_block_hits = [term for term in hard_block_terms if term and term in lowered_blob]
    required_areas = set(policy["decision"]["required_review_areas"])
    critical_areas = set(policy["decision"]["critical_areas"])
    critical_hit_areas = sorted(set(matched_areas).intersection(critical_areas))

    if not matched_areas and not hard_block_hits:
        decision = "defer"
        reason = "no-relevant-upstream-signals"
    elif hard_block_hits:
        decision = "review"
        reason = "hard-block-term-detected"
    elif required_areas.intersection(matched_areas):
        decision = "review"
        reason = "required-area-affected"
    else:
        decision = "review"
        reason = "non-required-area-affected"

    return {
        "decision": decision,
        "reason": reason,
        "matched_areas": matched_areas,
        "area_hits": area_hits,
        "hard_block_hits": hard_block_hits,
        "critical_hit_areas": critical_hit_areas,
        "critical_needed": bool(critical_hit_areas or hard_block_hits),
    }


def first_json_object(text: str) -> dict[str, Any] | None:
    text = text.strip()
    if not text:
        return None
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{.*\}", text, flags=re.DOTALL)
    if not match:
        return None
    try:
        parsed = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def codex_exec_json(*, repo_root: Path, prompt: str, model: str, timeout_seconds: int) -> dict[str, Any]:
    codex_bin = shutil.which("codex")
    if not codex_bin:
        raise RuntimeError("codex CLI is not installed or not in PATH")

    with tempfile.TemporaryDirectory(prefix="tasknerve-update-ai-") as tmpdir:
        tmp_path = Path(tmpdir)
        schema_path = tmp_path / "schema.json"
        output_path = tmp_path / "output.json"
        schema_path.write_text(
            json.dumps(
                {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "decision",
                        "confidence",
                        "summary",
                        "areas",
                        "recommended_checks",
                    ],
                    "properties": {
                        "decision": {"type": "string", "enum": ["adopt", "defer", "ignore"]},
                        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                        "summary": {"type": "string"},
                        "areas": {"type": "array", "items": {"type": "string"}},
                        "recommended_checks": {"type": "array", "items": {"type": "string"}},
                    },
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )

        cmd = [
            codex_bin,
            "exec",
            "--skip-git-repo-check",
            "--cd",
            str(repo_root),
            "--output-schema",
            str(schema_path),
            "--output-last-message",
            str(output_path),
            "--model",
            model,
            "-",
        ]
        run = subprocess.run(
            cmd,
            input=prompt,
            text=True,
            capture_output=True,
            timeout=timeout_seconds,
            cwd=str(repo_root),
        )
        if run.returncode != 0:
            raise RuntimeError(
                f"codex exec failed ({run.returncode}): {run.stderr.strip() or run.stdout.strip()}"
            )

        if output_path.exists():
            parsed = first_json_object(output_path.read_text(encoding="utf-8"))
            if parsed:
                return parsed
        parsed_stdout = first_json_object(run.stdout)
        if parsed_stdout:
            return parsed_stdout
        raise RuntimeError("codex exec returned non-JSON output")


def run_ai_triage(*, repo_root: Path, candidate: dict[str, Any], deterministic: dict[str, Any], policy: dict[str, Any]) -> dict[str, Any]:
    prompt = textwrap.dedent(
        f"""
        You are the Codex->TaskNerve update interceptor triage agent.

        Goal:
        Decide if TaskNerve should auto-adopt this upstream Codex update into TaskNerve's update channel.

        Constraints:
        - Prefer minimal, compatibility-first decisions.
        - Recommend "adopt" only if this likely protects TaskNerve compatibility or protocol correctness.
        - If uncertain, choose "defer".
        - Return strict JSON matching the provided schema.

        Upstream candidate:
        {json.dumps(candidate, indent=2)}

        Deterministic pre-analysis:
        {json.dumps(deterministic, indent=2)}

        Policy:
        {json.dumps(policy["decision"], indent=2)}
        """
    ).strip()

    result = codex_exec_json(
        repo_root=repo_root,
        prompt=prompt,
        model=policy["ai"]["model"],
        timeout_seconds=policy["ai"]["timeout_seconds"],
    )
    return {
        "decision": str(result.get("decision", "")).strip().lower(),
        "confidence": float(result.get("confidence", 0)),
        "summary": str(result.get("summary", "")).strip(),
        "areas": normalize_string_list(result.get("areas")),
        "recommended_checks": normalize_string_list(result.get("recommended_checks")),
        "raw": result,
    }


def run_ai_apply(*, repo_root: Path, candidate: dict[str, Any], deterministic: dict[str, Any], policy: dict[str, Any]) -> dict[str, Any]:
    if not policy["ai"]["auto_apply_enabled"]:
        return {"attempted": False, "skipped_reason": "ai-auto-apply-disabled"}

    prompt = textwrap.dedent(
        f"""
        You are the Codex->TaskNerve update interceptor apply agent.

        Apply only compatibility-focused changes needed for TaskNerve to remain compliant
        with the upstream Codex release metadata below. Keep changes minimal and deterministic.

        Requirements:
        - Modify source-of-truth files only.
        - Preserve TaskNerve custom behavior unless compatibility requires adjustment.
        - Update docs when user-visible behavior changes.

        Upstream candidate:
        {json.dumps(candidate, indent=2)}

        Deterministic analysis:
        {json.dumps(deterministic, indent=2)}

        End with a concise summary.
        """
    ).strip()

    codex_bin = shutil.which("codex")
    if not codex_bin:
        return {"attempted": False, "skipped_reason": "codex-cli-not-found"}

    cmd = [
        codex_bin,
        "exec",
        "--skip-git-repo-check",
        "--cd",
        str(repo_root),
        "--model",
        policy["ai"]["model"],
        "-",
    ]
    run = subprocess.run(
        cmd,
        input=prompt,
        text=True,
        capture_output=True,
        timeout=policy["ai"]["apply_timeout_seconds"],
        cwd=str(repo_root),
    )
    return {
        "attempted": True,
        "exit_code": run.returncode,
        "stdout_tail": "\n".join((run.stdout or "").splitlines()[-40:]),
        "stderr_tail": "\n".join((run.stderr or "").splitlines()[-40:]),
        "ok": run.returncode == 0,
    }


def choose_final_decision(deterministic: dict[str, Any], ai_triage: dict[str, Any] | None, policy: dict[str, Any]) -> dict[str, Any]:
    final = deterministic["decision"]
    reason = f"deterministic:{deterministic['reason']}"
    min_confidence = float(policy["ai"]["min_confidence"])

    if ai_triage:
        ai_decision = ai_triage.get("decision")
        ai_confidence = float(ai_triage.get("confidence", 0))
        if ai_confidence >= min_confidence:
            if ai_decision == "adopt" and deterministic["decision"] != "defer":
                final = "adopt"
                reason = "ai-adopt-high-confidence"
            elif ai_decision in {"defer", "ignore"}:
                final = "defer"
                reason = f"ai-{ai_decision}-high-confidence"
            elif deterministic["decision"] != "defer":
                final = "review"
                reason = "ai-uncertain-review"
        elif deterministic["decision"] != "defer":
            final = "review"
            reason = "ai-low-confidence-review"

    return {"decision": final, "reason": reason}


def compute_check_commands(policy: dict[str, Any], matched_areas: list[str], ai_triage: dict[str, Any] | None) -> list[str]:
    commands: list[str] = []
    for command in policy["checks"]["base_commands"]:
        if command not in commands:
            commands.append(command)
    for area in matched_areas:
        for command in policy["checks"]["area_commands"].get(area, []):
            if command not in commands:
                commands.append(command)
    if ai_triage:
        aliases = policy["checks"]["ai_recommended_command_aliases"]
        for alias in ai_triage.get("recommended_checks", []):
            command = aliases.get(alias)
            if command and command not in commands:
                commands.append(command)
    return commands


def run_check_commands(commands: list[str], repo_root: Path) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for command in commands:
        start = dt.datetime.now(dt.timezone.utc)
        run = subprocess.run(command, shell=True, cwd=str(repo_root), text=True, capture_output=True)
        end = dt.datetime.now(dt.timezone.utc)
        results.append(
            {
                "command": command,
                "ok": run.returncode == 0,
                "exit_code": run.returncode,
                "started_at_utc": start.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
                "finished_at_utc": end.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
                "stdout_tail": "\n".join((run.stdout or "").splitlines()[-80:]),
                "stderr_tail": "\n".join((run.stderr or "").splitlines()[-80:]),
            }
        )
        if run.returncode != 0:
            break
    return results


def latest_fingerprint(candidate: dict[str, Any]) -> str:
    return "|".join(
        [
            str(candidate.get("upstream_version") or ""),
            str(candidate.get("upstream_build") or ""),
            str(candidate.get("published_at_utc") or ""),
            str(candidate.get("download_url") or ""),
        ]
    )


def github_token_from_env() -> str:
    for key in ("TASKNERVE_UPDATE_GITHUB_TOKEN", "GITHUB_TOKEN", "GH_TOKEN"):
        token = os.getenv(key, "").strip()
        if token:
            return token
    return ""


def github_api_json(
    *,
    method: str,
    url: str,
    token: str,
    payload: dict[str, Any] | None = None,
    timeout_seconds: int = 20,
) -> Any:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(
        url,
        method=method,
        data=data,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "tasknerve-update-interceptor/1.0",
            **({"Content-Type": "application/json"} if payload is not None else {}),
        },
    )
    with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
        raw = response.read().decode("utf-8", errors="replace")
        return json.loads(raw) if raw else {}


def github_api_find_open_issue_by_fingerprint(*, repo: str, fingerprint: str, token: str) -> dict[str, Any] | None:
    query = f'repo:{repo} is:issue is:open in:body "{fingerprint}"'
    search_url = f"https://api.github.com/search/issues?q={urllib.parse.quote_plus(query)}&per_page=1"
    payload = github_api_json(method="GET", url=search_url, token=token)
    items = payload.get("items") if isinstance(payload, dict) else None
    if not isinstance(items, list) or not items:
        return None
    first = items[0] if isinstance(items[0], dict) else None
    if not isinstance(first, dict):
        return None
    return {
        "issue_number": first.get("number"),
        "issue_url": first.get("html_url"),
        "issue_title": first.get("title"),
    }


def github_api_create_issue(
    *,
    repo: str,
    token: str,
    title: str,
    body: str,
    labels: list[str],
    assignees: list[str],
) -> dict[str, Any]:
    create_url = f"https://api.github.com/repos/{repo}/issues"
    payload: dict[str, Any] = {
        "title": title,
        "body": body,
        "labels": labels,
    }
    if assignees:
        payload["assignees"] = assignees
    created = github_api_json(method="POST", url=create_url, token=token, payload=payload)
    if not isinstance(created, dict):
        raise ValueError("github issues create returned invalid payload")
    return {
        "issue_number": created.get("number"),
        "issue_url": created.get("html_url"),
        "issue_title": created.get("title") or title,
    }


def maybe_create_phase_two_issue(
    *,
    repo_root: Path,
    policy: dict[str, Any],
    candidate: dict[str, Any],
    non_critical_areas: list[str],
    ai_triage: dict[str, Any] | None,
    skip_issue_create: bool,
) -> dict[str, Any]:
    if skip_issue_create:
        return {"attempted": False, "skipped_reason": "skip-issue-create"}
    if not policy["issues"]["enabled"]:
        return {"attempted": False, "skipped_reason": "issues-disabled"}
    if not non_critical_areas:
        return {"attempted": False, "skipped_reason": "no-non-critical-areas"}

    repo = os.getenv("TASKNERVE_UPDATE_ISSUE_REPO", "").strip() or policy["issues"]["repo"]
    if not repo:
        return {"attempted": False, "skipped_reason": "issues-repo-not-configured"}

    fingerprint = candidate["fingerprint"]

    title = (
        f"[Update Interceptor] Phase-2 review for Codex {candidate.get('upstream_version') or 'unknown'}"
    )
    body = "\n".join(
        [
            "TaskNerve update interceptor flagged non-critical follow-up work.",
            "",
            f"- Upstream version: {candidate.get('upstream_version')}",
            f"- Upstream build: {candidate.get('upstream_build')}",
            f"- Published at: {candidate.get('published_at_utc')}",
            f"- Release notes: {candidate.get('release_notes_url') or 'n/a'}",
            f"- Fingerprint: {fingerprint}",
            "",
            "Non-critical areas:",
            *[f"- {area}" for area in non_critical_areas],
            "",
            "AI summary:",
            (ai_triage or {}).get("summary") or "(none)",
            "",
            "Approval flow:",
            "1. Review this issue.",
            "2. Approve/adjust planned non-critical changes.",
            "3. Run TaskNerve-controlled implementation + release push.",
        ]
    )

    token = github_token_from_env()
    if token:
        try:
            existing = github_api_find_open_issue_by_fingerprint(
                repo=repo,
                fingerprint=fingerprint,
                token=token,
            )
            if existing:
                return {
                    "attempted": True,
                    "ok": True,
                    "created": False,
                    "transport": "github-api",
                    **existing,
                }

            created = github_api_create_issue(
                repo=repo,
                token=token,
                title=title,
                body=body,
                labels=policy["issues"]["labels"],
                assignees=policy["issues"]["assignees"],
            )
            return {
                "attempted": True,
                "ok": True,
                "created": True,
                "transport": "github-api",
                **created,
            }
        except Exception as error:  # noqa: BLE001
            return {
                "attempted": True,
                "ok": False,
                "transport": "github-api",
                "error": f"github api issue flow failed: {error}",
            }

    gh_bin = shutil.which("gh")
    if not gh_bin:
        return {"attempted": False, "skipped_reason": "gh-cli-not-found-and-no-github-token"}

    search_cmd = [
        gh_bin,
        "issue",
        "list",
        "--repo",
        repo,
        "--state",
        "open",
        "--search",
        f'"{fingerprint}" in:body',
        "--json",
        "number,url,title",
    ]
    search_run = subprocess.run(search_cmd, cwd=str(repo_root), text=True, capture_output=True)
    if search_run.returncode != 0:
        return {
            "attempted": True,
            "ok": False,
            "transport": "gh-cli",
            "error": f"gh issue list failed: {search_run.stderr.strip() or search_run.stdout.strip()}",
        }

    try:
        existing = json.loads(search_run.stdout or "[]")
    except json.JSONDecodeError:
        existing = []
    if isinstance(existing, list) and existing:
        first = existing[0] if isinstance(existing[0], dict) else {}
        return {
            "attempted": True,
            "ok": True,
            "created": False,
            "transport": "gh-cli",
            "issue_number": first.get("number"),
            "issue_url": first.get("url"),
            "issue_title": first.get("title"),
        }

    create_cmd = [gh_bin, "issue", "create", "--repo", repo, "--title", title, "--body", body]
    for label in policy["issues"]["labels"]:
        create_cmd.extend(["--label", label])
    for assignee in policy["issues"]["assignees"]:
        create_cmd.extend(["--assignee", assignee])

    create_run = subprocess.run(create_cmd, cwd=str(repo_root), text=True, capture_output=True)
    if create_run.returncode != 0:
        return {
            "attempted": True,
            "ok": False,
            "transport": "gh-cli",
            "error": f"gh issue create failed: {create_run.stderr.strip() or create_run.stdout.strip()}",
        }

    issue_url = (create_run.stdout or "").strip().splitlines()[-1]
    return {
        "attempted": True,
        "ok": True,
        "created": True,
        "transport": "gh-cli",
        "issue_url": issue_url,
        "issue_title": title,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="TaskNerve Codex update interceptor")
    parser.add_argument("--repo-root", default=".", help="Repository root")
    parser.add_argument("--policy-file", default=DEFAULT_POLICY_REL)
    parser.add_argument("--state-file", default=DEFAULT_STATE_REL)
    parser.add_argument("--channel-file", default=DEFAULT_CHANNEL_REL)
    parser.add_argument("--report-file", default=DEFAULT_REPORT_REL)
    parser.add_argument("--critical-queue-file", default=DEFAULT_CRITICAL_QUEUE_REL)
    parser.add_argument("--review-queue-file", default=DEFAULT_REVIEW_QUEUE_REL)
    parser.add_argument("--upstream-feed-url", default=None)
    parser.add_argument("--timeout-seconds", type=int, default=20)
    parser.add_argument("--force", action="store_true", help="Process even if upstream fingerprint is unchanged")
    parser.add_argument("--skip-checks", action="store_true")
    parser.add_argument("--skip-ai-apply", action="store_true")
    parser.add_argument("--skip-issue-create", action="store_true")
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve()
    policy_path = (repo_root / args.policy_file).resolve()
    state_path = (repo_root / args.state_file).resolve()
    channel_path = (repo_root / args.channel_file).resolve()
    report_path = (repo_root / args.report_file).resolve()
    critical_queue_path = (repo_root / args.critical_queue_file).resolve()
    review_queue_path = (repo_root / args.review_queue_file).resolve()

    policy_raw = read_json(policy_path, {})
    policy = normalize_policy(policy_raw if isinstance(policy_raw, dict) else {})
    write_json_if_changed(policy_path, policy)

    state = read_json(
        state_path,
        {
            "schema_version": SCHEMA_INTERCEPTOR_STATE,
            "updated_at_utc": utc_now_iso(),
            "upstream_feed_url": policy["upstream_feed_url"],
            "latest_seen": None,
            "history": [],
        },
    )
    if not isinstance(state, dict):
        state = {}
    state.setdefault("schema_version", SCHEMA_INTERCEPTOR_STATE)
    state.setdefault("history", [])
    if not isinstance(state["history"], list):
        state["history"] = []

    channel = read_json(
        channel_path,
        {
            "schema_version": SCHEMA_UPDATE_CHANNEL,
            "updated_at_utc": utc_now_iso(),
            "channel_name": "stable",
            "appcast_url": policy.get("tasknerve_appcast_url") or "",
            "owner_delivery_mode": "interceptor-gated",
            "ai_interceptor_enabled": bool(policy["ai"]["enabled"]),
            "last_intercepted_upstream": None,
            "last_validated_candidate": None,
            "pending_release_candidate": None,
            "latest_published_release": None,
        },
    )
    if not isinstance(channel, dict):
        channel = {}
    channel.setdefault("schema_version", SCHEMA_UPDATE_CHANNEL)
    channel.setdefault("channel_name", "stable")
    channel.setdefault("owner_delivery_mode", "interceptor-gated")
    channel.setdefault("ai_interceptor_enabled", bool(policy["ai"]["enabled"]))
    if not channel.get("appcast_url"):
        channel["appcast_url"] = policy.get("tasknerve_appcast_url") or ""

    critical_queue = normalize_queue(read_json(critical_queue_path, {}), SCHEMA_CRITICAL_QUEUE)
    review_queue = normalize_queue(read_json(review_queue_path, {}), SCHEMA_REVIEW_QUEUE)

    upstream_feed_url = args.upstream_feed_url or policy["upstream_feed_url"] or DEFAULT_UPSTREAM_FEED

    notes_fetch_error: str | None = None
    try:
        feed_xml = fetch_text(upstream_feed_url, args.timeout_seconds)
        candidate = parse_appcast_latest(feed_xml)
    except Exception as error:  # noqa: BLE001
        report = {
            "ok": False,
            "checked_at_utc": utc_now_iso(),
            "error": f"Failed to read upstream appcast: {error}",
            "upstream_feed_url": upstream_feed_url,
        }
        write_json_if_changed(report_path, report)
        print(report["error"], file=sys.stderr)
        return 1

    if candidate.get("release_notes_url"):
        try:
            notes_raw = fetch_text(candidate["release_notes_url"], args.timeout_seconds)
            candidate["release_notes_text"] = strip_html(notes_raw)[:20000]
        except Exception as error:  # noqa: BLE001
            notes_fetch_error = str(error)
            candidate["release_notes_text"] = ""
    else:
        candidate["release_notes_text"] = ""
    candidate["fingerprint"] = latest_fingerprint(candidate)

    existing_latest = state.get("latest_seen") if isinstance(state.get("latest_seen"), dict) else None
    existing_fingerprint = existing_latest.get("fingerprint") if existing_latest else None
    unchanged = existing_fingerprint == candidate["fingerprint"]
    if unchanged and not args.force:
        report = {
            "ok": True,
            "checked_at_utc": utc_now_iso(),
            "upstream_feed_url": upstream_feed_url,
            "status": "no-change",
            "candidate": candidate,
            "notes_fetch_error": notes_fetch_error,
        }
        write_json_if_changed(report_path, report)
        print("No upstream change detected; interceptor no-op.")
        return 0

    deterministic = deterministic_classification(candidate, policy)

    ai_enabled = policy["ai"]["enabled"]
    ai_override = os.getenv("TASKNERVE_UPDATE_AI_ENABLED")
    if ai_override in {"0", "false", "FALSE", "False"}:
        ai_enabled = False
    elif ai_override in {"1", "true", "TRUE", "True"}:
        ai_enabled = True

    ai_triage: dict[str, Any] | None = None
    ai_triage_error: str | None = None
    if ai_enabled:
        try:
            ai_triage = run_ai_triage(
                repo_root=repo_root,
                candidate=candidate,
                deterministic=deterministic,
                policy=policy,
            )
        except Exception as error:  # noqa: BLE001
            ai_triage_error = str(error)

    final = choose_final_decision(deterministic, ai_triage, policy)
    critical_needed = bool(deterministic.get("critical_needed"))
    critical_areas = set(policy["decision"]["critical_areas"])
    non_critical_areas = sorted(set(deterministic.get("matched_areas", [])) - critical_areas)

    phase_one_critical = critical_needed and final["decision"] in {"review", "adopt"}
    phase_two_required = (
        bool(policy["decision"]["phase_two_requires_owner_approval"])
        and bool(non_critical_areas or final["decision"] == "review")
    )

    run_checks = final["decision"] in {"review", "adopt"} and not args.skip_checks
    commands = compute_check_commands(policy, deterministic["matched_areas"], ai_triage) if run_checks else []
    check_results = run_check_commands(commands, repo_root) if commands else []
    checks_ok = all(entry.get("ok") for entry in check_results) if check_results else True

    ai_apply_result: dict[str, Any] | None = None
    if phase_one_critical and checks_ok and ai_enabled and not args.skip_ai_apply:
        ai_apply_result = run_ai_apply(
            repo_root=repo_root,
            candidate=candidate,
            deterministic=deterministic,
            policy=policy,
        )
        if ai_apply_result.get("attempted") and not ai_apply_result.get("ok"):
            checks_ok = False

    promoted = (
        phase_one_critical
        and checks_ok
        and bool(policy["decision"]["auto_promote_on_pass"])
    )

    phase_two_issue = maybe_create_phase_two_issue(
        repo_root=repo_root,
        policy=policy,
        candidate=candidate,
        non_critical_areas=non_critical_areas,
        ai_triage=ai_triage,
        skip_issue_create=args.skip_issue_create,
    ) if phase_two_required else {"attempted": False, "skipped_reason": "phase-two-not-required"}

    history_entry = {
        "checked_at_utc": utc_now_iso(),
        "upstream_feed_url": upstream_feed_url,
        "candidate": {
            "upstream_version": candidate.get("upstream_version"),
            "upstream_build": candidate.get("upstream_build"),
            "published_at_utc": candidate.get("published_at_utc"),
            "title": candidate.get("title"),
            "download_url": candidate.get("download_url"),
            "release_notes_url": candidate.get("release_notes_url"),
            "fingerprint": candidate.get("fingerprint"),
        },
        "deterministic": deterministic,
        "ai_triage": ai_triage,
        "ai_triage_error": ai_triage_error,
        "final_decision": final,
        "phase_one_critical": phase_one_critical,
        "phase_two_required": phase_two_required,
        "phase_two_issue": phase_two_issue,
        "checks_ok": checks_ok,
        "check_results": check_results,
        "ai_apply": ai_apply_result,
        "promoted": promoted,
    }

    state["schema_version"] = SCHEMA_INTERCEPTOR_STATE
    state["updated_at_utc"] = utc_now_iso()
    state["upstream_feed_url"] = upstream_feed_url
    state["latest_seen"] = {
        "upstream_version": candidate.get("upstream_version"),
        "upstream_build": candidate.get("upstream_build"),
        "published_at_utc": candidate.get("published_at_utc"),
        "title": candidate.get("title"),
        "download_url": candidate.get("download_url"),
        "release_notes_url": candidate.get("release_notes_url"),
        "fingerprint": candidate.get("fingerprint"),
    }
    state["history"] = trim_history(
        state.get("history", []) + [history_entry],
        int(policy["decision"]["max_history_entries"]),
    )

    channel["schema_version"] = SCHEMA_UPDATE_CHANNEL
    channel["updated_at_utc"] = utc_now_iso()
    channel["ai_interceptor_enabled"] = bool(ai_enabled)
    channel["last_intercepted_upstream"] = state["latest_seen"]
    if final["decision"] in {"review", "adopt"} and checks_ok:
        channel["last_validated_candidate"] = {
            "validated_at_utc": utc_now_iso(),
            "decision": final["decision"],
            "reason": final["reason"],
            "upstream_version": candidate.get("upstream_version"),
            "upstream_build": candidate.get("upstream_build"),
            "published_at_utc": candidate.get("published_at_utc"),
            "release_notes_url": candidate.get("release_notes_url"),
            "download_url": candidate.get("download_url"),
            "check_commands": [entry.get("command") for entry in check_results],
        }
    if promoted:
        channel["pending_release_candidate"] = {
            "promoted_at_utc": utc_now_iso(),
            "source": "codex-update-interceptor",
            "release_phase": "critical-fast",
            "upstream_version": candidate.get("upstream_version"),
            "upstream_build": candidate.get("upstream_build"),
            "published_at_utc": candidate.get("published_at_utc"),
            "release_notes_url": candidate.get("release_notes_url"),
            "download_url": candidate.get("download_url"),
            "decision_reason": final["reason"],
        }

    if phase_one_critical:
        upsert_queue_item(
            critical_queue,
            candidate["fingerprint"],
            {
                "fingerprint": candidate["fingerprint"],
                "updated_at_utc": utc_now_iso(),
                "status": "auto-applied" if promoted else "pending-critical-action",
                "upstream_version": candidate.get("upstream_version"),
                "upstream_build": candidate.get("upstream_build"),
                "published_at_utc": candidate.get("published_at_utc"),
                "release_notes_url": candidate.get("release_notes_url"),
                "download_url": candidate.get("download_url"),
                "decision": final["decision"],
                "decision_reason": final["reason"],
                "critical_areas": sorted(deterministic.get("critical_hit_areas", [])),
                "checks_ok": checks_ok,
            },
            int(policy["decision"]["max_history_entries"]),
        )

    if phase_two_required:
        phase_two_status = "awaiting-owner-approval"
        if phase_two_issue.get("ok") and phase_two_issue.get("issue_url"):
            phase_two_status = "github-issue-opened"
        upsert_queue_item(
            review_queue,
            candidate["fingerprint"],
            {
                "fingerprint": candidate["fingerprint"],
                "updated_at_utc": utc_now_iso(),
                "status": phase_two_status,
                "upstream_version": candidate.get("upstream_version"),
                "upstream_build": candidate.get("upstream_build"),
                "published_at_utc": candidate.get("published_at_utc"),
                "release_notes_url": candidate.get("release_notes_url"),
                "download_url": candidate.get("download_url"),
                "decision": final["decision"],
                "decision_reason": final["reason"],
                "non_critical_areas": non_critical_areas,
                "ai_summary": ai_triage.get("summary") if ai_triage else None,
                "checks_ok": checks_ok,
                "github_issue": phase_two_issue,
            },
            int(policy["decision"]["max_history_entries"]),
        )

    channel["pending_critical_count"] = len(critical_queue.get("items", []))
    channel["pending_phase_two_review_count"] = len(review_queue.get("items", []))

    report = {
        "ok": True,
        "checked_at_utc": utc_now_iso(),
        "upstream_feed_url": upstream_feed_url,
        "candidate": candidate,
        "notes_fetch_error": notes_fetch_error,
        "deterministic": deterministic,
        "ai_enabled": ai_enabled,
        "ai_triage": ai_triage,
        "ai_triage_error": ai_triage_error,
        "final_decision": final,
        "critical_needed": critical_needed,
        "phase_one_critical": phase_one_critical,
        "phase_two_required": phase_two_required,
        "non_critical_areas": non_critical_areas,
        "phase_two_issue": phase_two_issue,
        "run_checks": run_checks,
        "check_results": check_results,
        "checks_ok": checks_ok,
        "ai_apply": ai_apply_result,
        "promoted": promoted,
        "state_file": str(state_path),
        "channel_file": str(channel_path),
        "critical_queue_file": str(critical_queue_path),
        "review_queue_file": str(review_queue_path),
    }

    changed = False
    changed |= write_json_if_changed(state_path, state)
    changed |= write_json_if_changed(channel_path, channel)
    changed |= write_json_if_changed(critical_queue_path, critical_queue)
    changed |= write_json_if_changed(review_queue_path, review_queue)
    changed |= write_json_if_changed(report_path, report)

    print(json.dumps(report, indent=2))
    if changed:
        print("Interceptor updated state/channel/queue/report files.")
    else:
        print("Interceptor run completed with no file changes.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
