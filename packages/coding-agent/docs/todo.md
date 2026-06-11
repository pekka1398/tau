# Todo

Pi includes a built-in project todo/issue tracker. Todos are stored in `.pi/todos.json` at the project root and are accessible via CLI, interactive mode, and agents.

## CLI Usage

```bash
# List todos
pi todo list                          # all todos, sorted by priority
pi todo list --status open            # filter by status
pi todo list --priority high          # filter by priority
pi todo list --tag bug                # filter by tag

# Add a todo
pi todo add "Fix TUI scroll bug"
pi todo add "Add unit tests" --priority high --tag testing --desc "Cover subagent fork mode"

# Update status
pi todo done t-003                    # mark as done
pi todo update t-003 --status in_progress
pi todo update t-003 --priority critical

# View details
pi todo show t-007

# Delete
pi todo delete t-007

# Summary
pi todo summary
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
pi todo add "Bug fix" --tag bug,tui,urgent
```

## Storage Format

Todos are stored in `.pi/todos.json`:

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
pi todo list --status open --tag bug

# Critical items only
pi todo list --priority critical

# What's in progress
pi todo list --status in_progress

# Count by status
pi todo summary
```
