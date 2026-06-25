# Development

See [AGENTS.md](https://github.com/pekka1398/tau/blob/main/AGENTS.md) for additional guidelines.

## Setup

```bash
git clone https://github.com/pekka1398/tau
cd tau
bun install
bun run build
```

Run from source:

```bash
/path/to/tau/tau-test.sh
```

The script can be run from any directory. Tau keeps the caller's current working directory.

## Forking / Rebranding

Configure via `package.json`:

```json
{
  "tauConfig": {
    "name": "tau",
    "configDir": ".tau"
  }
}
```

Change `name`, `configDir`, and `bin` field for your fork. Affects CLI banner, config paths, and environment variable names.

## Path Resolution

Three execution modes: npm install, standalone binary, tsx from source.

**Always use `src/config.ts`** for package assets:

```typescript
import { getPackageDir, getThemeDir } from "./config.js";
```

Never use `__dirname` directly for package assets.

## Debug Command

`/debug` (hidden) writes to `~/.tau/agent/tau-debug.log`:
- Rendered TUI lines with ANSI codes
- Last messages sent to the LLM

## Testing

```bash
./test.sh                         # Run non-LLM tests (no API keys needed)
bun run test                      # Run all tests
bunx vitest --run test/specific.test.ts  # Run specific coding-agent test
```

Top-level `reference-repo/`, `test`, and `note` directories are ignored local scratch/reference material. They are not part of the tracked Tau source tree or release/test surface.

## Project Structure

```
src/
  cli/          # Argument parsing and print-mode file handling
  core/         # Agent runtime, OpenRouter AI layer, tools, TUI, sessions
  modes/        # Interactive and print mode entry points
  utils/        # Shared runtime helpers
scripts/        # Build, model generation, and verification scripts
docs/           # User and developer documentation
examples/       # Extension, prompt, and SDK examples
ai-dash/        # Local bash execution bridge dependency
```

## Debugging Tool Result Rendering

The bash tool result display involves multiple layers. When debugging rendering issues, trace through each layer:

### Architecture

```
ai-dash (fd3 metadata) 
  → bash tool execute (reads metadata, returns result with details.intent)
    → tool_execution_end event (carries result)
      → ToolExecutionComponent.updateResult(result)
        → rebuildBashResultRenderComponent(component, result, options)
          → intent check → early return or store/display output
            → BashResultRenderComponent.render() → uses collapsedStyledOutput or children
              → TUI doRender() → differential rendering
```

### Debug environment variables

```bash
TAU_DEBUG_TOOL_RESULT=1   # Enable all debug logs below
TAU_DEBUG_LOADER=1        # Loader state machine transitions
TAU_CLEAR_ON_SHRINK=1     # Force full re-render on content shrink
```

### Debug log files (created when TAU_DEBUG_TOOL_RESULT=1)

| File | What it logs |
|------|-------------|
| `/tmp/bash-rebuild.log` | Every `rebuildBashResultRenderComponent` call — intent, expanded, isPartial, which branch taken |
| `/tmp/bash-render.log` | Every `BashResultRenderComponent.render()` call — whether collapsedStyledOutput exists, how many lines |
| `/tmp/tool-result-end.log` | `tool_execution_end` event data — hasDetails, hasMetadata, intent, exitCode |
| `/tmp/tui-render.log` | TUI `doRender()` — prev/new line counts, firstChanged/lastChanged, which rendering path taken |
| `/tmp/loader-debug.log` | Loader state machine transitions with elapsed time |

### Key lesson: cached state vs children

`BashResultRenderComponent` has TWO sources of render content:
1. `children` — added by `component.addChild()` in `rebuildBashResultRenderComponent`
2. `state.collapsedStyledOutput` — set when collapsing output, read by `render()` for truncation

When hiding a result via early return, BOTH must be cleared. `component.clear()` only clears children. The cached `collapsedStyledOutput` must be explicitly set to `null`.

### Common debug flow

1. Run with `TAU_DEBUG_TOOL_RESULT=1`
2. Check `/tmp/bash-rebuild.log` — did the intent check run? Did it return early?
3. Check `/tmp/bash-render.log` — does `collapsedStyledOutput` still exist after the intent check?
4. Check `/tmp/tui-render.log` — did the TUI re-render after the component was cleared?
5. If the component is empty but content still appears on screen, check for stale cached state
