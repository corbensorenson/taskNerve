#!/usr/bin/env python3
import pathlib
import re
import sys


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: annotate-clippy-log.py <clippy.log>", file=sys.stderr)
        return 2

    log_path = pathlib.Path(sys.argv[1])
    lines = log_path.read_text(errors="replace").splitlines()
    emitted = 0
    for index, line in enumerate(lines):
        stripped = line.strip()
        if not stripped.startswith(("warning:", "error:")):
            continue
        level = "error" if stripped.startswith("error:") else "warning"
        message = stripped.split(": ", 1)[1] if ": " in stripped else stripped
        location = None
        for candidate in lines[index + 1:index + 8]:
            match = re.match(r"\s*--> ([^:]+):(\d+):(\d+)", candidate)
            if match:
                location = match.groups()
                break
        if location:
            file_path, line_no, col_no = location
            print(f"::{level} file={file_path},line={line_no},col={col_no}::{message}")
        else:
            print(f"::{level}::{message}")
        emitted += 1
        if emitted >= 25:
            break
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
