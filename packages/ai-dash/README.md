# ai-dash

Modified dash shell for yuuuu AI coding assistant.

Base: [dash from kernel.org](https://git.kernel.org/pub/scm/utils/dash/dash.git)
Source: `src/` (original dash source tree)

## What's modified

### 1. `fedit` builtin — `src/bltin/fedit.c`

File editing command using SEARCH/REPLACE patch format.

```
fedit <file> << 'EOF'
<<<<<<< SEARCH
old content
=======
new content
>>>>>>> REPLACE
EOF
```

**Features:**
- 3-layer fuzzy matching: exact → trim trailing whitespace → trim all whitespace
- Multiple SEARCH/REPLACE blocks in one call
- Pure deletion (empty replace block)
- Heredoc input (`<< 'MARKER'`)
- Unified diff output
- Cargo-style diagnostics (E2000-E2005):
  - File not found + similar filename suggestion (edit distance)
  - Is a directory
  - File too large (>10MB limit)
  - Empty patch / unterminated block / search not found

**Registration:** `builtins.def.in` → `feditcmd fedit`

### 2. `rm` builtin — `src/bltin/rm.c`

Moves files to trash instead of deleting. Follows [FreeDesktop trash spec](https://specifications.freedesktop.org/trash-spec/latest/).

```
~/.local/share/Trash/
├── files/       ← trashed files
└── info/        ← .trashinfo metadata
```

**Behavior:** Same flags as standard `rm`, but moves instead of deletes.

| Flag | Behavior |
|------|----------|
| `-r` / `-R` | Recursive — trash directory and contents |
| `-f` | Force — silently skip nonexistent files |

**Trash info format:**
```
[Trash Info]
Path=/original/absolute/path
DeletionDate=2026-06-07T18:54:59
```

Interoperable with desktop file managers (Nautilus, Dolphin, etc.).

**Registration:** `builtins.def.in` → `rmcmd rm`

### 3. Enhanced diagnostics — `src/exec.c`

Cargo-style error messages for command execution failures.

**Command not found (E1001):**
```
error[E1001]: Command Not Found
  --> git stauts

   = detail: not found
   = suggestion: did you mean 'git status'?
```
Uses edit distance to find similar commands in the hash table.

**File not found (E1001) — path commands:**
```
error[E1001]: File Not Found
  --> ./nonexistent.sh

   = detail: not found
   = suggestion: did you mean './existing.sh'?
```
Scans the same directory for similar filenames.

**Permission denied (E1003):**
```
error[E1003]: Permission Denied
  --> /etc/shadow

   = detail: Permission denied
   = suggestion: check file permissions with 'ls -l'
```

**Is a directory (E1004):**
```
error[E1004]: Is a Directory
  --> /tmp/somedir

   = detail: cannot execute a directory
   = suggestion: use 'ls' to list directory contents
```

### 4. Flag injection diagnostics — `src/eval.c`

Prints hints when commands are missing common non-interactive flags. Does NOT modify the command — just warns.

| Command | Missing flag | Hint |
|---------|-------------|------|
| `apt install pkg` | `-y` | `add -y for non-interactive` |
| `git commit` | `-m` | `add -m "..." for non-interactive` |
| `git log/diff/show` | `--no-pager` | `add --no-pager to avoid pager` |
| `npm init` | `-y` | `add -y for non-interactive` |
| `pip install` | `--no-input` | `add --no-input for non-interactive` |

## Files changed from original dash

| File | Change |
|------|--------|
| `src/builtins.def.in` | Added `feditcmd fedit` and `rmcmd rm` |
| `src/bltin/fedit.c` | **New** — fedit builtin |
| `src/bltin/rm.c` | **New** — rm → trash builtin |
| `src/exec.c` | Added `ai_diag()`, `edit_distance()`, `suggest_similar_command()`, `suggest_nearby_file()`; enhanced `shellexec()` and `find_command()` error handling |
| `src/eval.c` | Added `check_missing_flags()` called before command execution |
| `src/Makefile.am` | Added `bltin/fedit.c` and `bltin/rm.c` to `dash_CFILES` |

## Building

```bash
cd packages/ai-dash/src
./autogen.sh
./configure
make
cp src/dash ../bin/ai-dash
```

## Testing

```bash
# fedit
echo "hello" > /tmp/test.txt
packages/ai-dash/bin/ai-dash -c 'fedit /tmp/test.txt << EOF
<<<<<<< SEARCH
hello
=======
world
>>>>>>> REPLACE
EOF'
cat /tmp/test.txt  # → "world"

# rm → trash
echo "test" > /tmp/delme.txt
packages/ai-dash/bin/ai-dash -c 'rm /tmp/delme.txt'
ls ~/.local/share/Trash/files/delme.txt  # exists
cat ~/.local/share/Trash/info/delme.txt.trashinfo  # has Path + DeletionDate

# diagnostics
packages/ai-dash/bin/ai-dash -c 'xyznonexistent'  # E1001 + suggestion
packages/ai-dash/bin/ai-dash -c 'fedit /tmp/nonexistent'  # E2003 + suggestion
packages/ai-dash/bin/ai-dash -c 'git commit'  # hint: add -m
```
