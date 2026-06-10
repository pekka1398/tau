#!/usr/bin/env python3
"""Extract tool usage from pi dump-prompts JSONL files."""

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

DUMP_DIR = Path.home() / ".pi" / "agent" / "dump-prompts"


def extract_tool_calls(dump_dir: Path):
    """Yield (tool_name, args_dict, timestamp) from all JSONL files."""
    for jsonl_file in sorted(dump_dir.glob("*.jsonl")):
        with open(jsonl_file) as f:
            for line in f:
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(entry, dict):
                    continue
                if entry.get("type") != "request":
                    continue
                timestamp = entry.get("timestamp", "")
                data = entry.get("data", {})
                if not isinstance(data, dict):
                    continue
                # Two formats: {"payload": {"messages": [...]}} or {"newMessages": [...]}
                messages = []
                if "payload" in data:
                    messages = data["payload"].get("messages", [])
                elif "newMessages" in data:
                    messages = data["newMessages"]
                for msg in messages:
                    if not isinstance(msg, dict) or msg.get("role") != "assistant":
                        continue
                    for tc in msg.get("tool_calls", []):
                        fn = tc.get("function", {})
                        name = fn.get("name", "unknown")
                        raw_args = fn.get("arguments", "{}")
                        try:
                            args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
                        except json.JSONDecodeError:
                            args = {"_raw": raw_args}
                        yield name, args, timestamp


def main():
    dump_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else DUMP_DIR
    if not dump_dir.exists():
        print(f"Directory not found: {dump_dir}", file=sys.stderr)
        sys.exit(1)

    tool_counter = Counter()
    bash_commands = defaultdict(list)

    for name, args, ts in extract_tool_calls(dump_dir):
        tool_counter[name] += 1
        if name == "bash":
            cmd = args.get("command", "")
            if isinstance(cmd, list):
                cmd = "\n".join(cmd)
            bash_commands[cmd.strip()].append(ts)

    # Print summary
    print("# Tool Usage Summary\n")
    print("## Tool Call Counts\n")
    print("| Tool | Count |")
    print("|------|-------|")
    for tool, count in tool_counter.most_common():
        print(f"| {tool} | {count} |")
    print(f"\n**Total tool calls:** {sum(tool_counter.values())}\n")

    # Print bash commands grouped by first word
    print("## Bash Commands\n")
    by_command = defaultdict(list)
    for cmd, timestamps in bash_commands.items():
        first_word = cmd.split()[0] if cmd.split() else "(empty)"
        by_command[first_word].append((cmd, len(timestamps), timestamps))

    for cmd_name in sorted(by_command.keys(), key=lambda x: -sum(c for _, c, _ in by_command[x])):
        entries = by_command[cmd_name]
        total = sum(count for _, count, _ in entries)
        print(f"### {cmd_name} ({total} calls)\n")
        for cmd, count, _ in sorted(entries, key=lambda x: -x[1]):
            print(f"```bash\n{cmd}\n```\n")


if __name__ == "__main__":
    main()
