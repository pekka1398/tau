# Todo

Tau includes a built-in project todo/issue tracker. Todos are stored in `.tau/todos.json` at the project root and are accessible via CLI, interactive mode, and agents.

## CLI Usage

```bash
# List todos
tau todo list                          # all todos, sorted by priority
tau todo list --status open            # filter by status
tau todo list --priority high          # filter by priority
tau todo list --tag bug                # filter by tag

# Add a todo
tau todo add "Fix TUI scroll bug"
tau todo add "Add unit tests" --priority high --tag testing --desc "Cover subagent fork mode"

# Update status
tau todo done t-003                    # mark as done
tau todo update t-003 --status in_progress
tau todo update t-003 --priority critical

# View details
tau todo show t-007

# Delete
tau todo delete t-007

# Summary
tau todo summary
```

## Interactive Mode

In the TUI, use the `/todo` slash command:

```
/todo list
/todo add New feature
/todo done t-003
/todo summary
```

## Statuses

| Status | Icon | Meaning |
|--------|------|---------|
| `open` | `[ ]` | Not started |
| `in_progress` | `[~]` | Currently being worked on |
| `done` | `[x]` | Completed |
| `cancelled` | `[-]` | Won't do |

## Priorities

| Priority | Icon | Meaning |
|----------|------|---------|
| `critical` | `!!!` | Drop everything |
| `high` | `!!` | Important, do soon |
| `medium` | `!` | Normal priority |
| `low` | ` | Nice to have |

## Tags

Tags are freeform strings, comma-separated when adding:

```bash
tau todo add "Bug fix" --tag bug,tui,urgent
```

## Storage Format

Todos are stored in `.tau/todos.json`:

```json
{
  "todos": [
    {
      "id": "t-001",
      "title": "Fix scroll bug",
      "status": "open",
      "priority": "high",
      "tags": ["bug", "tui"],
      "created": "2026-06-11",
      "updated": "2026-06-11",
      "description": "TUI scroll jumps to top on resize"
    }
  ],
  "nextId": 2
}
```

The file is git-trackable, so changes appear in diffs and commit history.

## Agent Access

Agents can read and update todos. In the system prompt, agents see the todo tool and can use it to:

- Check current tasks before starting work
- Mark tasks as done when completed
- Add new bugs discovered during testing

## Filtering Examples

```bash
# All open bugs
tau todo list --status open --tag bug

# Critical items only
tau todo list --priority critical

# What's in progress
tau todo list --status in_progress

# Count by status
tau todo summary
```
